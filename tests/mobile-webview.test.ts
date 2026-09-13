// @vitest-environment jsdom
//
// Basic DOM tests for the mobile panel UI (src/mobile-webview.ts). The panel
// talks to the plugin through the `webviewApi` global Joplin injects; we
// stub it and drive the UI through the captured onMessage handler. Module
// state is shared, so the tests in this file run in declaration order.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { Task } from "../src/types";

const apiPost = vi.fn();
let onMessageHandler: ((event: any) => void) | null = null;
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

function send(message: Record<string, unknown>) {
  // Plugin→panel messages arrive wrapped: { message: actualMessage }
  onMessageHandler?.({ message });
}

function sendUpdateTasks(tasks: Task[], showLookAhead = false) {
  send({
    type: "updateTasks",
    tasks: { tasks },
    showLookAhead,
    snoozeUntilTomorrowHour: 9,
    snoozeUntilTomorrowMinute: 0,
    lastCustomSnoozeDays: null,
  });
}

beforeAll(async () => {
  document.body.innerHTML = `
    <div id="taskList"></div>
    <span id="taskCount" style="display: none">0</span>
    <div id="emptyState" style="display: none"></div>
    <div>
      <button id="refreshBtn" class="footer-btn">Refresh</button>
      <button id="lookAheadBtn" class="footer-btn">Look Ahead</button>
      <button id="snoozeAllBtn" class="footer-btn">Snooze All</button>
    </div>`;
  (globalThis as any).webviewApi = {
    postMessage: (message: any) => {
      if (message?.type === "ready") readyPosts += 1;
      apiPost(message);
    },
    onMessage: (fn: (event: any) => void) => {
      onMessageHandler = fn;
    },
  };
  await import("../src/mobile-webview");
  // mInit runs at import when the document is already ready; if jsdom
  // reports the document as still loading, take the DOMContentLoaded branch
  if (readyPosts === 0) {
    document.dispatchEvent(new Event("DOMContentLoaded"));
  }
});

afterAll(() => {
  // The pagehide path clears the 5s heartbeat interval started by mInit
  window.dispatchEvent(new Event("pagehide"));
});

describe("mobile-webview", () => {
  it("posts ready on load and shows the pre-load empty state", () => {
    expect(readyPosts).toBeGreaterThanOrEqual(1);
    const empty = document.getElementById("emptyState")!;
    expect(empty.style.display).toBe("flex");
    // Before the first update there is no "All caught up" content yet
    expect(empty.innerHTML).toBe("");
  });

  it("renders tasks, the count and the look-ahead active state", () => {
    sendUpdateTasks([t1, t2], true);
    expect(document.querySelectorAll(".task-card")).toHaveLength(2);
    expect(document.querySelector(".task-title")!.textContent).toBe("Task One");
    const count = document.getElementById("taskCount")!;
    expect(count.textContent).toBe("2");
    expect(document.getElementById("emptyState")!.style.display).toBe("none");
    expect(
      document.getElementById("lookAheadBtn")!.classList.contains("active"),
    ).toBe(true);
  });

  it("refresh click posts refresh and spins until the next update arrives", () => {
    const refreshBtn = document.getElementById(
      "refreshBtn",
    ) as HTMLButtonElement;
    vi.useFakeTimers();
    try {
      refreshBtn.click();
      expect(apiPost).toHaveBeenCalledWith({ type: "refresh" });
      expect(refreshBtn.classList.contains("loading")).toBe(true);
      expect(refreshBtn.disabled).toBe(true);

      // The response clears the loading state
      sendUpdateTasks([t1]);
      expect(refreshBtn.classList.contains("loading")).toBe(false);
      expect(refreshBtn.disabled).toBe(false);
      // And the look-ahead toggle follows the new flag
      expect(
        document.getElementById("lookAheadBtn")!.classList.contains("active"),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the 15s safety net clears the refresh loading state without a response", async () => {
    const refreshBtn = document.getElementById(
      "refreshBtn",
    ) as HTMLButtonElement;
    vi.useFakeTimers();
    try {
      refreshBtn.click();
      expect(refreshBtn.disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(15000);
      expect(refreshBtn.disabled).toBe(false);
      expect(refreshBtn.classList.contains("loading")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the open button posts openNote for its task", () => {
    (
      document.querySelector('.action-btn[data-action="open"]') as HTMLElement
    ).click();
    expect(apiPost).toHaveBeenCalledWith({ type: "openNote", taskId: "t1" });
  });

  it("snooze all opens the bulk dropdown and posts bulkSnooze", async () => {
    sendUpdateTasks([t1, t2]);
    vi.useFakeTimers();
    try {
      (document.getElementById("snoozeAllBtn") as HTMLElement).click();
      expect(apiPost).toHaveBeenCalledWith({ type: "requestSettings" });
      // mFetchSettings resolves via its 2s timeout (no settingsUpdated)
      await vi.advanceTimersByTimeAsync(2000);
      const dropdown = document.getElementById("snoozeDropdown");
      expect(dropdown).not.toBeNull();

      (
        dropdown!.querySelector(
          '.snooze-option[data-value="1day"]',
        ) as HTMLElement
      ).click();
      expect(apiPost).toHaveBeenCalledWith({
        type: "bulkSnooze",
        taskIds: ["t1", "t2"],
        snooze: "1day",
      });
      expect(document.getElementById("snoozeDropdown")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows 'All caught up' when the list becomes empty after loading", () => {
    sendUpdateTasks([]);
    const empty = document.getElementById("emptyState")!;
    expect(empty.style.display).toBe("flex");
    expect(empty.innerHTML).toContain("All caught up");
    expect(document.getElementById("taskCount")!.style.display).toBe("none");
  });
});
