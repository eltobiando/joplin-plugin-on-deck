// On-Deck mobile panel WebView script
// Runs inside joplin.views.panels on mobile
// Communicates with the plugin via the injected webviewApi
import type {
  Task,
  SnoozePreset,
  PluginToWindowMessage,
  WindowToPluginMessage,
} from "./types";

declare const webviewApi: {
  postMessage(message: WindowToPluginMessage): Promise<unknown>;
  onMessage(listener: (event: any) => void): void;
};

let mHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
let mRefreshLoadingTimeout: ReturnType<typeof setTimeout> | null = null;

let mSnoozeHour: number = 9;
let mSnoozeMinute: number = 0;
// Last custom snooze day count used in this session (updated via IPC, not persisted)
let mLastCustomSnoozeDays: number | null = null;
let mPendingSettings: Promise<void> | null = null;
let mHasLoaded = false; // true after first updateTasks arrives

function mEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function mFormatTime(timestamp: number): string {
  if (!timestamp || timestamp <= 0 || Number.isNaN(timestamp))
    return "No due date";
  const now = Date.now();
  const diff = now - timestamp;
  const absDiff = Math.abs(diff);
  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (diff < 0) {
    if (seconds < 60) return "In less than a minute";
    if (minutes < 60) return `In ${minutes} minute${minutes !== 1 ? "s" : ""}`;
    if (hours < 24) return `In ${hours} hour${hours !== 1 ? "s" : ""}`;
    return `In ${days} day${days !== 1 ? "s" : ""}`;
  }

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

function mRenderTasks(tasks: Task[]) {
  const taskListEl = document.getElementById("taskList");
  const taskCountEl = document.getElementById("taskCount");
  const emptyEl = document.getElementById("emptyState");

  if (!taskListEl) return;

  if (tasks.length === 0) {
    taskListEl.innerHTML = "";
    if (taskCountEl) taskCountEl.style.display = "none";
    if (emptyEl) {
      emptyEl.style.display = "flex";
      if (mHasLoaded) {
        emptyEl.innerHTML = `<div class="empty-state-icon">&#9989;</div><div>All caught up! No due tasks.</div>`;
      }
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";

  if (taskCountEl) {
    taskCountEl.textContent = tasks.length.toString();
    taskCountEl.style.display = "inline";
  }

  taskListEl.innerHTML = tasks
    .map((task) => {
      const urgencyClass = task.urgency || "overdue-low";
      return (
        `<div class="task-card ${urgencyClass}" data-task-id="${task.id}">` +
        `<div class="task-info">` +
        `<div class="task-title" title="${mEscape(task.title)}">${mEscape(task.title)}</div>` +
        `<div class="task-time">Due: ${mFormatTime(task.todo_due)}</div>` +
        `</div>` +
        `<div class="task-actions">` +
        `<button class="action-btn" data-action="snooze" data-task-id="${task.id}" title="Snooze">&#9201;</button>` +
        `<button class="action-btn" data-action="open" data-task-id="${task.id}" title="Open note">&#128221;</button>` +
        `</div>` +
        `</div>`
      );
    })
    .join("");

  mAttachCardListeners();
}

function mAttachCardListeners() {
  document.querySelectorAll(".action-btn").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      const action = btn.getAttribute("data-action");
      const taskId = btn.getAttribute("data-task-id");
      if (!action || !taskId) return;

      if (action === "open") {
        webviewApi.postMessage({ type: "openNote", taskId });
      } else if (action === "snooze") {
        mShowSnooze(taskId);
      }
    };
  });
}

// Refresh button loading state (spinning icon + disabled)
function mSetRefreshLoading(loading: boolean) {
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    (refreshBtn as HTMLButtonElement).classList.toggle("loading", loading);
    (refreshBtn as HTMLButtonElement).disabled = loading;
  }
  if (mRefreshLoadingTimeout !== null) {
    clearTimeout(mRefreshLoadingTimeout);
    mRefreshLoadingTimeout = null;
  }
  if (loading) {
    // Safety net in case no updateTasks arrives
    mRefreshLoadingTimeout = setTimeout(() => mSetRefreshLoading(false), 15000);
  }
}

function mAttachFooter() {
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    (refreshBtn as HTMLButtonElement).onclick = () => {
      mSetRefreshLoading(true);
      webviewApi.postMessage({ type: "refresh" });
    };
  }

  const lookAheadBtn = document.getElementById("lookAheadBtn");
  if (lookAheadBtn) {
    (lookAheadBtn as HTMLButtonElement).onclick = () => {
      webviewApi.postMessage({ type: "toggleLookAhead" });
    };
  }

  const snoozeAllBtn = document.getElementById("snoozeAllBtn");
  if (snoozeAllBtn) {
    (snoozeAllBtn as HTMLButtonElement).onclick = () => {
      const taskCards = document.querySelectorAll(".task-card");
      const taskIds: string[] = [];
      taskCards.forEach((card) => {
        const id = card.getAttribute("data-task-id");
        if (id) taskIds.push(id);
      });
      if (taskIds.length > 0) {
        mShowSnooze(null, taskIds);
      }
    };
  }
}

function mUpdateLookAhead(active: boolean) {
  const btn = document.getElementById("lookAheadBtn");
  if (!btn) return;
  if (active) btn.classList.add("active");
  else btn.classList.remove("active");
}

function mFetchSettings(): Promise<void> {
  if (mPendingSettings) return mPendingSettings;
  return (mPendingSettings = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      mPendingSettings = null;
      (window as any)._mSettingsResolve = null;
      resolve();
    }, 2000);
    (window as any)._mSettingsResolve = () => {
      clearTimeout(timeout);
      mPendingSettings = null;
      resolve();
    };
    webviewApi.postMessage({ type: "requestSettings" });
  }));
}

function mShowSnooze(taskId: string | null, taskIds?: string[]) {
  const isBulk = !!taskIds && taskIds.length > 0;
  const countLabel = isBulk ? ` (${taskIds.length} tasks)` : "";

  mFetchSettings().then(() => {
    const existing = document.getElementById("snoozeDropdown");
    if (existing) existing.remove();

    const presets: { label: string; value: SnoozePreset }[] = [
      { label: "15 minutes", value: "15min" },
      { label: "30 minutes", value: "30min" },
      { label: "1 hour", value: "1hr" },
      { label: "2 hours", value: "2hr" },
      { label: "3 hours", value: "3hr" },
      {
        label: `Tomorrow at ${mSnoozeHour}:${mSnoozeMinute.toString().padStart(2, "0")}`,
        value: "tomorrow",
      },
      { label: "1 day (same time)", value: "1day" },
      { label: "7 days (same time)", value: "7day" },
    ];

    const dropdown = document.createElement("div");
    dropdown.id = "snoozeDropdown";
    dropdown.innerHTML =
      `<div class="snooze-title">Snooze for${countLabel}</div>` +
      `<div class="snooze-presets">` +
      presets
        .map(
          (p) =>
            `<div class="snooze-option" data-value="${p.value}">${p.label}</div>`,
        )
        .join("") +
      `</div>` +
      `<div class="snooze-custom">` +
      `<div class="snooze-custom-label">Custom</div>` +
      `<div class="snooze-custom-row">` +
      `<input type="number" id="customSnoozeValue" min="1" value="${mLastCustomSnoozeDays ?? 1}" class="snooze-custom-input" />` +
      `<select id="customSnoozeUnit" class="snooze-custom-select">` +
      `<option value="days">days</option>` +
      `<option value="hours">hours</option>` +
      `<option value="minutes">minutes</option>` +
      `</select>` +
      `<button class="snooze-custom-btn">OK</button>` +
      `</div>` +
      `</div>` +
      `<button class="snooze-cancel">Cancel</button>`;

    // Shared removal: cleans up both the DOM element and the outside-click listener
    let onClickOutside: ((e: MouseEvent) => void) | null = null;
    const removeDropdown = () => {
      if (onClickOutside) {
        document.removeEventListener("click", onClickOutside);
        onClickOutside = null;
      }
      if (dropdown.parentNode) dropdown.remove();
    };

    dropdown.querySelectorAll(".snooze-option").forEach((option) => {
      option.addEventListener("click", () => {
        const value = option.getAttribute("data-value") as SnoozePreset;
        if (isBulk) {
          webviewApi.postMessage({
            type: "bulkSnooze",
            taskIds,
            snooze: value,
          });
        } else {
          webviewApi.postMessage({ type: "snoozeTask", taskId, snooze: value });
        }
        removeDropdown();
      });
    });

    const customValue = dropdown.querySelector(
      "#customSnoozeValue",
    ) as HTMLInputElement;
    const customUnit = dropdown.querySelector(
      "#customSnoozeUnit",
    ) as HTMLSelectElement;
    const applyCustom = () => {
      const value = parseInt(customValue.value, 10);
      const unit = customUnit.value as "minutes" | "hours" | "days";
      if (value > 0) {
        if (isBulk) {
          webviewApi.postMessage({
            type: "bulkSnooze",
            taskIds,
            snooze: { value, unit },
          });
        } else {
          webviewApi.postMessage({
            type: "snoozeTask",
            taskId,
            snooze: { value, unit },
          });
        }
        removeDropdown();
      }
    };
    customValue.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyCustom();
    });
    dropdown
      .querySelector(".snooze-custom-btn")!
      .addEventListener("click", applyCustom);
    dropdown
      .querySelector(".snooze-cancel")!
      .addEventListener("click", removeDropdown);

    setTimeout(() => {
      onClickOutside = (e: MouseEvent) => {
        if (!dropdown.contains(e.target as Node)) {
          removeDropdown();
        }
      };
      document.addEventListener("click", onClickOutside);
    }, 10);

    document.body.appendChild(dropdown);
  });
}

// On mobile, plugin→webview messages arrive via webviewApi.onMessage().
// The callback receives { message: actualMessage } (wrapped for desktop compat).
// window.addEventListener('message') catches internal RPC traffic (has 'kind', not 'type').
webviewApi.onMessage((event: any) => {
  const message = (event?.message ?? event) as
    PluginToWindowMessage | undefined;
  if (!message || typeof message !== "object") return;

  if (message.type === "updateTasks") {
    mHasLoaded = true;
    if (typeof message.snoozeUntilTomorrowHour === "number") {
      mSnoozeHour = message.snoozeUntilTomorrowHour;
    }
    if (typeof message.snoozeUntilTomorrowMinute === "number") {
      mSnoozeMinute = message.snoozeUntilTomorrowMinute;
    }
    if (typeof message.lastCustomSnoozeDays === "number") {
      mLastCustomSnoozeDays = message.lastCustomSnoozeDays;
    }
    mSetRefreshLoading(false);
    mRenderTasks(message.tasks.tasks);
    mUpdateLookAhead(message.showLookAhead ?? false);
  } else if (message.type === "settingsUpdated") {
    if (typeof message.snoozeUntilTomorrowHour === "number") {
      mSnoozeHour = message.snoozeUntilTomorrowHour;
    }
    if (typeof message.snoozeUntilTomorrowMinute === "number") {
      mSnoozeMinute = message.snoozeUntilTomorrowMinute;
    }
    if (typeof message.lastCustomSnoozeDays === "number") {
      mLastCustomSnoozeDays = message.lastCustomSnoozeDays;
    }
    if ((window as any)._mSettingsResolve) (window as any)._mSettingsResolve();
  }
});

function mInit() {
  mAttachFooter();
  mRenderTasks([]);
  // Signal to plugin that webview is ready
  webviewApi.postMessage({ type: "ready" });
  // Heartbeat so the plugin knows the webview is still alive
  mHeartbeatInterval = setInterval(() => {
    webviewApi.postMessage({ type: "heartbeat" });
  }, 5000);
}

// Clean up heartbeat when the panel is hidden
window.addEventListener("pagehide", () => {
  if (mHeartbeatInterval) {
    clearInterval(mHeartbeatInterval);
    mHeartbeatInterval = null;
  }
});

// External scripts load AFTER DOMContentLoaded fires — check if already ready
if (
  document.readyState === "complete" ||
  document.readyState === "interactive"
) {
  mInit();
} else {
  document.addEventListener("DOMContentLoaded", mInit);
}
