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

function sendUpdateTasks(
  tasks: Task[],
  showLookAhead = false,
  extra: Record<string, unknown> = {},
) {
  send({
    type: "updateTasks",
    tasks: { tasks },
    showLookAhead,
    snoozeUntilTomorrowHour: 9,
    snoozeUntilTomorrowMinute: 0,
    lastCustomSnoozeDays: null,
    ...extra,
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
    // Look-ahead button mirrors desktop wording once active
    expect(document.getElementById("lookAheadBtn")!.textContent).toBe(
      "Look Ahead: ON",
    );
    // Task cards now show the absolute due date + time in parentheses, like
    // desktop (default Joplin formats: DD/MM/YYYY + HH:mm). Assert shape only —
    // the exact date is timezone-dependent.
    expect(document.querySelector(".task-time")!.textContent).toMatch(
      /^Due: .+ \(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\)$/,
    );
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
      expect(document.getElementById("lookAheadBtn")!.textContent).toBe(
        "Look Ahead: OFF",
      );
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
      // mFetchSettings resolves via its 2s timeout (no settingsUpdated)
      await vi.advanceTimersByTimeAsync(2000);
      const dropdown = document.getElementById("snoozeDropdown");
      expect(dropdown).not.toBeNull();
      const label = (value: string) =>
        dropdown!
          .querySelector(`.snooze-option[data-value="${value}"]`)!
          .textContent!.trim();

      expect(label("30min")).toBe("30 minutes (09:30)");
      expect(label("2hr")).toBe("2 hours (11:00)");

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

      // Tab-like layout: name and target time are separate spans, so the
      // times align in a column
      const opt = dropdown!.querySelector('.snooze-option[data-value="2hr"]')!;
      expect(opt.querySelector(".snooze-option-name")!.textContent).toBe(
        "2 hours",
      );
      expect(opt.querySelector(".snooze-option-time")!.textContent).toBe(
        "(11:00)",
      );
    } finally {
      document.getElementById("snoozeDropdown")?.remove();
      vi.useRealTimers();
    }
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

      // Bulk mode: day presets differ per task, so they keep the generic label
      expect(
        dropdown!.querySelector('.snooze-option[data-value="1day"]')!
          .textContent,
      ).toContain("same time");

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

  it("snooze labels follow the Joplin time format sent via updateTasks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 18, 9, 0, 0)); // local 09:00
    try {
      const d = new Date(t1.todo_due);
      const due12 = `${d.getHours() % 12 || 12}:${d
        .getMinutes()
        .toString()
        .padStart(2, "0")} ${d.getHours() >= 12 ? "PM" : "AM"}`;

      // A non-default time format arrives with the update
      sendUpdateTasks([t1], false, { timeFormat: "h:mm A" });
      (
        document.querySelector(
          '.action-btn[data-action="snooze"]',
        ) as HTMLElement
      ).click();
      await vi.advanceTimersByTimeAsync(2000);
      const dropdown = document.getElementById("snoozeDropdown");
      expect(dropdown).not.toBeNull();
      // The day preset time now renders in the 12h format
      expect(
        dropdown!.querySelector('.snooze-option[data-value="1day"]')!
          .textContent,
      ).toBe(`1 day (19. ${due12} Saturday)`);
    } finally {
      document.getElementById("snoozeDropdown")?.remove();
      vi.useRealTimers();
    }
  });

  it("day preset weekday follows the Joplin locale sent via updateTasks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 18, 9, 0, 0)); // local 09:00
    try {
      const d = new Date(t1.todo_due);
      const dueTime = `${d.getHours().toString().padStart(2, "0")}:${d
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;

      // A non-default locale (and a pinned 24h time format) arrives with the
      // update, independent of earlier module state
      sendUpdateTasks([t1], false, { locale: "de_DE", timeFormat: "HH:mm" });
      (
        document.querySelector(
          '.action-btn[data-action="snooze"]',
        ) as HTMLElement
      ).click();
      await vi.advanceTimersByTimeAsync(2000);
      const dropdown = document.getElementById("snoozeDropdown");
      expect(dropdown).not.toBeNull();
      // de_DE → German weekday
      expect(
        dropdown!
          .querySelector('.snooze-option[data-value="1day"]')!
          .textContent!.trim(),
      ).toBe(`1 day (19. ${dueTime} Samstag)`);
    } finally {
      document.getElementById("snoozeDropdown")?.remove();
      vi.useRealTimers();
    }
  });
});
