import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import joplinMock from "./mocks/api";
import { ReminderManager } from "../src/ReminderManager";

const NOW = new Date(2026, 4, 30, 12, 0, 0).getTime();
const H = 60 * 60 * 1000;

function note(
  id: string,
  todoDue: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    title: `Task ${id}`,
    todo_due: todoDue,
    parent_id: "p1",
    is_conflict: 0,
    deleted_time: 0,
    ...extra,
  };
}

describe("ReminderManager.getDueTasks", () => {
  const overdueHigh = note("high", NOW - 25 * H);
  const overdueMed = note("med", NOW - 5 * H);
  const overdueLow = note("low", NOW - 30 * 60 * 1000);
  const dueNow = note("now", NOW);
  const upcoming = note("soon", NOW + 2 * H);
  const farFuture = note("far", NOW + 3 * 24 * H);
  const noDue = note("nodue", 0);
  const deleted = note("deleted", NOW - H, { deleted_time: NOW });
  const conflicted = note("conflict", NOW - H, { is_conflict: 1 });
  const all = [
    overdueHigh,
    overdueMed,
    overdueLow,
    dueNow,
    upcoming,
    farFuture,
    noDue,
    deleted,
    conflicted,
  ];

  function stubSearch(items: unknown[]) {
    joplinMock.data.get = vi.fn(async (target: string[]) =>
      target[0] === "search"
        ? { items, has_more: false }
        : { todo_due: undefined },
    );
  }

  function stubSettings(showLookAhead: boolean) {
    joplinMock.settings.value = vi.fn(async (key: string) =>
      key === "showLookAhead" ? showLookAhead : 7,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only due/overdue tasks with urgency classes, sorted by due date, when look-ahead is off", async () => {
    stubSettings(false);
    stubSearch(all);
    const manager = new ReminderManager();
    const { tasks } = await manager.getDueTasks();

    // Overdue + exactly-now only; no missing due date, deleted,
    // conflicted or future tasks
    expect(tasks.map((t) => t.id)).toEqual(["high", "med", "low", "now"]);
    expect(tasks.map((t) => t.urgency)).toEqual([
      "overdue-high",
      "overdue-medium",
      "overdue-low",
      "overdue-low",
    ]);
  });

  it("includes upcoming tasks within the look-ahead window when look-ahead is on", async () => {
    stubSettings(true);
    stubSearch(all);
    const manager = new ReminderManager();
    const { tasks } = await manager.getDueTasks();

    expect(tasks.map((t) => t.id)).toEqual([
      "high",
      "med",
      "low",
      "now",
      "soon",
      "far",
    ]);
    expect(tasks.find((t) => t.id === "soon")?.urgency).toBe("upcoming");
  });

  it("stops paginating on an empty page and queries pages in order", async () => {
    stubSettings(false);
    joplinMock.data.get = vi.fn(async (_target: string[], opts: any) => ({
      items:
        opts?.page === 1
          ? [note("a", NOW - 2 * H)]
          : opts?.page === 2
            ? [note("b", NOW - 1 * H)]
            : [],
      // has_more stays true — only the empty page must end the loop
      has_more: true,
    }));
    const manager = new ReminderManager();
    const { tasks } = await manager.getDueTasks();

    expect(tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(joplinMock.data.get).toHaveBeenCalledTimes(3); // page 3 was empty
    expect(
      joplinMock.data.get.mock.calls.map((c) => (c[1] as any).page),
    ).toEqual([1, 2, 3]);
  });
});
