// @vitest-environment jsdom
//
// Basic DOM tests for the standalone window UI (src/dialog/window/webview.ts).
// The webview talks to the plugin through the `webviewApi` global that
// window.ts installs; here we stub it and drive the UI through the captured
// onMessage handler. Module state (hasLoaded, etc.) is shared, so the tests
// in this file run in declaration order.
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Task } from "../src/types";

const apiPost = vi.fn();
let onMessageHandler: ((message: any) => void) | null = null;
// Mock call history is cleared between tests, so the ready post made at
// import time (beforeAll) is counted separately
let readyPosts = 0;

const t1: Task = {
  id: "t1",
  title: "Task One",
  todo_due: 1700000000000,
  urgency: "overdue-high",
};
const t2: Task = {
  id: "t2",
  title: "Task Two",
  todo_due: 1700003600000,
  urgency: "upcoming",
};

function sendUpdateTasks(tasks: Task[], extra: Record<string, unknown> = {}) {
  onMessageHandler?.({
    type: "updateTasks",
    tasks: { tasks },
    showLookAhead: false,
    snoozeUntilTomorrowHour: 9,
    snoozeUntilTomorrowMinute: 0,
    lastCustomSnoozeDays: null,
    ...extra,
  });
}

beforeAll(async () => {
  document.body.innerHTML = `
    <span id="taskCount" style="display: none">0</span>
    <div id="taskList">Loading tasks...</div>`;
  (window as any).webviewApi = {
    postMessage: (message: any) => {
      if (message?.type === "ready") readyPosts += 1;
      apiPost(message);
    },
    onMessage: (fn: (message: any) => void) => {
      onMessageHandler = fn;
    },
  };
  // Import last: the module registers its handler and posts "ready" at load
  await import("../src/dialog/window/webview");
});

describe("dialog/window/webview", () => {
  it("posts ready exactly once on load", () => {
    expect(readyPosts).toBe(1);
  });

  it("the first update (even an empty one) replaces the static loading state", () => {
    expect(onMessageHandler).not.toBeNull();
    sendUpdateTasks([]);
    expect(document.querySelector(".empty-state")).not.toBeNull();
  });

  it("renders task cards with title, urgency class and count", () => {
    sendUpdateTasks([t1, t2]);
    const cards = document.querySelectorAll(".task-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].className).toContain("overdue-high");
    expect(document.querySelector(".task-title")!.textContent).toBe("Task One");
    const count = document.getElementById("taskCount")!;
    expect(count.textContent).toBe("2");
    expect(count.style.display).toBe("inline");
  });

  it("the open button posts openNote for its task", () => {
    sendUpdateTasks([t1]);
    (
      document.querySelector('.action-btn[data-action="open"]') as HTMLElement
    ).click();
    expect(apiPost).toHaveBeenCalledWith({ type: "openNote", taskId: "t1" });
  });

  it("snooze dropdown: picking a preset posts snoozeTask and closes the dropdown", async () => {
    sendUpdateTasks([t1]);
    vi.useFakeTimers();
    try {
      (
        document.querySelector(
          '.action-btn[data-action="snooze"]',
        ) as HTMLElement
      ).click();
      // fetchSettings resolves via its 2s timeout (no settingsUpdated arrives)
      await vi.advanceTimersByTimeAsync(2000);
      const dropdown = document.getElementById("snoozeDropdown");
      expect(dropdown).not.toBeNull();

      (
        dropdown!.querySelector(
          '.snooze-option[data-value="15min"]',
        ) as HTMLElement
      ).click();
      expect(apiPost).toHaveBeenCalledWith({
        type: "snoozeTask",
        taskId: "t1",
        snooze: "15min",
      });
      expect(document.getElementById("snoozeDropdown")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("snooze dropdown: instant presets show now+offset, day presets the task's due time", async () => {
    sendUpdateTasks([t1]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 18, 9, 0, 0)); // local 09:00
    try {
      (
        document.querySelector(
          '.action-btn[data-action="snooze"]',
        ) as HTMLElement
      ).click();
      // fetchSettings resolves via its 2s timeout (no settingsUpdated arrives)
      await vi.advanceTimersByTimeAsync(2000);
      const dropdown = document.getElementById("snoozeDropdown");
      expect(dropdown).not.toBeNull();
      const label = (value: string) =>
        dropdown!
          .querySelector(`.snooze-option[data-value="${value}"]`)!
          .textContent!.trim();

      expect(label("15min")).toBe("15 minutes (09:15)");
      expect(label("1hr")).toBe("1 hour (10:00)");
      expect(label("3hr")).toBe("3 hours (12:00)");

      // Day presets land on now + N days at the task's original clock time;
      // with the fake clock at Fri 2026-09-18 the dates are deterministic
      const d = new Date(t1.todo_due);
      const dueTime = `${d.getHours().toString().padStart(2, "0")}:${d
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;
      expect(label("1day")).toBe(`1 day (19. ${dueTime} Saturday)`);
      expect(label("3day")).toBe(`3 days (21. ${dueTime} Monday)`);
      expect(label("7day")).toBe(`7 days (25. ${dueTime} Friday)`);

      // "Tomorrow" already carries the configured time
      expect(label("tomorrow")).toBe("Tomorrow at 9:00");

      // Tab-like layout: name and target time are separate spans, so the
      // times align in a column
      const opt = dropdown!.querySelector('.snooze-option[data-value="3hr"]')!;
      expect(opt.querySelector(".snooze-option-name")!.textContent).toBe(
        "3 hours",
      );
      expect(opt.querySelector(".snooze-option-time")!.textContent).toBe(
        "(12:00)",
      );
    } finally {
      document.getElementById("snoozeDropdown")?.remove();
      vi.useRealTimers();
    }
  });

  it("snooze dropdown: day presets stay (same time) when snoozing several tasks", async () => {
    sendUpdateTasks([t1, t2]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 18, 9, 0, 0));
    try {
      (window as any).showSnoozeDropdown(null, ["t1", "t2"]);
      await vi.advanceTimersByTimeAsync(2000);
      const dropdown = document.getElementById("snoozeDropdown");
      expect(dropdown).not.toBeNull();
      const label = (value: string) =>
        dropdown!
          .querySelector(`.snooze-option[data-value="${value}"]`)!
          .textContent!.trim();

      // Instant presets share one target time across all tasks
      expect(label("3hr")).toBe("3 hours (12:00)");
      // Day presets differ per task — generic label
      expect(label("1day")).toBe("1 day (same time)");
      expect(label("7day")).toBe("7 days (same time)");
    } finally {
      document.getElementById("snoozeDropdown")?.remove();
      vi.useRealTimers();
    }
  });

  it("day preset weekday follows the Joplin locale sent via updateTasks", async () => {
    // timeFormat pinned so the test is independent of earlier module state
    sendUpdateTasks([t1], { locale: "de_DE", timeFormat: "HH:mm" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 18, 9, 0, 0)); // local 09:00
    try {
      (
        document.querySelector(
          '.action-btn[data-action="snooze"]',
        ) as HTMLElement
      ).click();
      // fetchSettings resolves via its 2s timeout (no settingsUpdated arrives)
      await vi.advanceTimersByTimeAsync(2000);
      const dropdown = document.getElementById("snoozeDropdown");
      expect(dropdown).not.toBeNull();
      const label = (value: string) =>
        dropdown!
          .querySelector(`.snooze-option[data-value="${value}"]`)!
          .textContent!.trim();

      const d = new Date(t1.todo_due);
      const dueTime = `${d.getHours().toString().padStart(2, "0")}:${d
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;
      // de_DE → German weekday
      expect(label("1day")).toBe(`1 day (19. ${dueTime} Samstag)`);
      expect(label("7day")).toBe(`7 days (25. ${dueTime} Freitag)`);
    } finally {
      document.getElementById("snoozeDropdown")?.remove();
      vi.useRealTimers();
    }
  });
});
