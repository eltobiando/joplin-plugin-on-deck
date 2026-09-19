import { describe, it, expect, vi, beforeEach } from "vitest";
import joplinMock from "./mocks/api";
import { ReminderManager } from "../src/ReminderManager";
import type { TaskList } from "../src/types";

describe("ReminderManager.snoozeTaskBulk", () => {
  beforeEach(() => {
    joplinMock.data.get = vi.fn(async () => ({ items: [], has_more: false }));
    joplinMock.data.put = vi.fn(async () => ({}));
    joplinMock.settings.value = vi.fn(async (key: string) =>
      key === "lookAheadDays" ? 7 : false,
    );
    joplinMock.settings.values = vi.fn(async () => ({}));
  });

  it("isolates per-task failures, completes all batches, and refreshes once", async () => {
    const BAD_ID = "bad-id";
    const taskIds = Array.from({ length: 120 }, (_, i) =>
      i === 7 ? BAD_ID : `task-${i}`,
    );

    const successfulIds = new Set<string>();
    joplinMock.data.put = vi.fn(async (target: unknown) => {
      const noteId = (target as string[])[1];
      if (noteId === BAD_ID) throw new Error("put rejected for bad-id");
      successfulIds.add(noteId);
      return {};
    });

    let refreshCount = 0;
    const manager = new ReminderManager();
    manager.setWindowCallback(() => {
      refreshCount += 1;
    });

    await manager.snoozeTaskBulk(taskIds, "15min");

    // All batches ran (120 puts, not just the first 50) and the bad id is
    // the only failure
    expect(joplinMock.data.put).toHaveBeenCalledTimes(120);
    expect(successfulIds.size).toBe(119);
    expect(successfulIds.has(BAD_ID)).toBe(false);

    // The single trailing refresh ran exactly once
    expect(refreshCount).toBe(1);
  });
});

describe("ReminderManager.fetchDueTasks full scan", () => {
  beforeEach(() => {
    joplinMock.settings.value = vi.fn(async (key: string) =>
      key === "lookAheadDays" ? 7 : false,
    );
  });

  it("scans all pages when the backend ignores order_by (page 1 not ascending)", async () => {
    const now = Date.now();
    const overdue1 = now - 3600000;
    const overdue2 = now - 1800000;
    const future = now + 3600000;
    joplinMock.data.get = vi.fn(
      async (_target: unknown, opts: { page: number }) => {
        // Out of order: the first row is past the deadline, but due rows
        // sit behind it (what Joplin mobile does)
        if (opts.page === 1) {
          return {
            items: [
              {
                id: "f",
                title: "Future",
                todo_due: future,
                is_conflict: 0,
                deleted_time: 0,
              },
              {
                id: "o1",
                title: "Overdue 1",
                todo_due: overdue1,
                is_conflict: 0,
                deleted_time: 0,
              },
            ],
            has_more: true,
          };
        }
        return {
          items: [
            {
              id: "o2",
              title: "Overdue 2",
              todo_due: overdue2,
              is_conflict: 0,
              deleted_time: 0,
            },
          ],
          has_more: false,
        };
      },
    );

    const result = await new ReminderManager().getDueTasks();

    // Both due rows are found despite the past-deadline row at index 0
    expect(result.tasks.map((t) => t.id).sort()).toEqual(["o1", "o2"]);
    // Every page was fetched (the full scan makes no ordering assumption)
    expect(joplinMock.data.get).toHaveBeenCalledTimes(2);
  });

  it("keeps scanning past a past-deadline row, even when the stream is ascending", async () => {
    const now = Date.now();
    joplinMock.data.get = vi.fn(
      async (_target: unknown, opts: { page: number }) => {
        // Ascending stream (what desktop returns) — page 1 already shows a
        // past-deadline row, but the scan must not stop there
        if (opts.page === 1) {
          return {
            items: [
              {
                id: "o1",
                title: "Overdue",
                todo_due: now - 3600000,
                is_conflict: 0,
                deleted_time: 0,
              },
              {
                id: "f1",
                title: "Future 1",
                todo_due: now + 3600000,
                is_conflict: 0,
                deleted_time: 0,
              },
            ],
            has_more: true,
          };
        }
        return {
          items: [
            {
              id: "f2",
              title: "Future 2",
              todo_due: now + 7200000,
              is_conflict: 0,
              deleted_time: 0,
            },
          ],
          has_more: false,
        };
      },
    );

    const result = await new ReminderManager().getDueTasks();

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe("o1");
    // No early stop — page 2 was fetched even though page 1 was ascending
    expect(joplinMock.data.get).toHaveBeenCalledTimes(2);
  });
});

describe("ReminderManager.checkForDueTasks skip optimization", () => {
  beforeEach(() => {
    joplinMock.data.put = vi.fn(async () => ({}));
    joplinMock.settings.value = vi.fn(async (key: string) =>
      key === "lookAheadDays" ? 7 : false,
    );
  });

  const pastDue = Date.now() - 60 * 60 * 1000;
  const dueNote = {
    id: "t1",
    title: "Task 1",
    todo_due: pastDue,
    parent_id: "p1",
    is_conflict: 0,
    deleted_time: 0,
  };

  // Stub the search endpoint to return the given notes as the due set
  function searchReturning(due: unknown[]) {
    joplinMock.data.get = vi.fn(async (target: string[]) => {
      if (target[0] === "search") return { items: due, has_more: false };
      return { todo_due: pastDue };
    });
  }

  it("still delivers the empty TaskList when the window is open (mobile keeps the panel fresh)", async () => {
    const manager = new ReminderManager();
    const seen: TaskList[] = [];
    manager.setWindowCallback((list) => {
      seen.push(list);
    });
    // What initMobile does: the mobile panel is the persistent consumer
    manager.setWindowOpen(true);

    searchReturning([dueNote]);
    await manager.start(false); // initial check, no interval (mobile mode)
    expect(seen).toHaveLength(1);
    expect(seen[0].tasks).toHaveLength(1);

    // User snoozes the last due task — search now finds nothing due
    searchReturning([]);
    await manager.snoozeTask("t1", "15min");

    // The clear must reach the callback — otherwise the panel stays stale
    expect(seen).toHaveLength(2);
    expect(seen[1].tasks).toHaveLength(0);
  });

  it("skips the callback when the window is closed and nothing is due (desktop optimization)", async () => {
    const manager = new ReminderManager();
    const seen: TaskList[] = [];
    manager.setWindowCallback((list) => {
      seen.push(list);
    });
    // windowOpen stays false — desktop with the window closed

    searchReturning([dueNote]);
    await manager.start(false);
    expect(seen).toHaveLength(1);
    expect(seen[0].tasks).toHaveLength(1);

    searchReturning([]);
    await manager.snoozeTask("t1", "15min");

    // The skip fires: no second callback while closed and nothing is due
    expect(seen).toHaveLength(1);
  });
});
