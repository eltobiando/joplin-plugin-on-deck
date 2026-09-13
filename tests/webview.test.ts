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
});
