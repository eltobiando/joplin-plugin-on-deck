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
