// On-Deck mobile panel WebView script
// Runs inside joplin.views.panels on mobile
// Communicates with the plugin via the injected webviewApi
import type {
  Task,
  SnoozePreset,
  PluginToWindowMessage,
  WindowToPluginMessage,
} from "./types";
import {
  dateTimeTokens,
  formatClockTime,
  formatDayTarget,
  presetTargetTime,
  replaceTokens,
} from "./snoozeLabels";

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

// Joplin date/time display formats (General settings, updated via IPC)
let mDateFormat: string = "DD/MM/YYYY";
let mTimeFormat: string = "HH:mm";
let mLocale: string = "en";

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

// Format absolute due date & time using Joplin's date/time format settings
// (mirrors the desktop webview's formatDateTime)
function mFormatDateTime(timestamp: number): string {
  return replaceTokens(
    `${mDateFormat} ${mTimeFormat}`,
    dateTimeTokens(new Date(timestamp)),
  );
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
        `<div class="task-card ${urgencyClass}" data-task-id="${task.id}" data-due="${task.todo_due}">` +
        `<div class="task-info">` +
        `<div class="task-title" title="${mEscape(task.title)}">${mEscape(task.title)}</div>` +
        `<div class="task-time">Due: ${mFormatTime(task.todo_due)} (${mFormatDateTime(task.todo_due)})</div>` +
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
  btn.textContent = active ? "Look Ahead: ON" : "Look Ahead: OFF";
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

    // Target date/time for each preset — mirrors
    // ReminderManager.calculateSnoozeTime: instant presets are now + offset,
    // day presets land on now + N days at the task's original clock time.
    // In bulk mode there is no single task due time, so day presets keep
    // the generic "(same time)".
    let taskDue: number | null = null;
    if (taskId) {
      const dueAttr = document
        .querySelector(`.task-card[data-task-id="${taskId}"]`)
        ?.getAttribute("data-due");
      const due = dueAttr ? parseInt(dueAttr, 10) : NaN;
      if (Number.isFinite(due) && due > 0) taskDue = due;
    }
    const now = Date.now();
    const instantTime = (preset: SnoozePreset): string | undefined => {
      const ts = presetTargetTime(now, preset, taskDue);
      return ts === null ? undefined : `(${formatClockTime(ts, mTimeFormat)})`;
    };
    const dayTime = (preset: SnoozePreset): string => {
      const ts = presetTargetTime(now, preset, taskDue);
      if (ts === null) return "(same time)";
      return `(${formatDayTarget(ts, mTimeFormat, mLocale)})`;
    };

    // Name and target time in separate spans so the times line up in a
    // column (tab-like spacing) across all rows
    const presets: {
      name: string;
      time?: string;
      value: SnoozePreset;
      day?: boolean;
    }[] = [
      { name: "15 minutes", time: instantTime("15min"), value: "15min" },
      { name: "30 minutes", time: instantTime("30min"), value: "30min" },
      { name: "1 hour", time: instantTime("1hr"), value: "1hr" },
      { name: "2 hours", time: instantTime("2hr"), value: "2hr" },
      { name: "3 hours", time: instantTime("3hr"), value: "3hr" },
      {
        name: `Tomorrow at ${mSnoozeHour}:${mSnoozeMinute.toString().padStart(2, "0")}`,
        value: "tomorrow",
      },
      { name: "1 day", time: dayTime("1day"), value: "1day", day: true },
      { name: "3 days", time: dayTime("3day"), value: "3day", day: true },
      { name: "7 days", time: dayTime("7day"), value: "7day", day: true },
    ];

    const dropdown = document.createElement("div");
    dropdown.id = "snoozeDropdown";
    dropdown.innerHTML =
      `<div class="snooze-title">Snooze for${countLabel}</div>` +
      `<div class="snooze-presets">` +
      presets
        .map(
          (p) =>
            `<div class="snooze-option" data-value="${p.value}"><span class="snooze-option-name${p.day ? " snooze-option-name--day" : ""}">${p.name}</span> <span class="snooze-option-time">${p.time ?? ""}</span></div>`,
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

    // Lock body scroll while the dropdown is open. Without this, Android's
    // WebView routes the touch-drag to the scrollable task list behind the
    // fixed modal, so the (now 9-item) preset list can't be scrolled.
    const syncBodyScrollLock = () => {
      document.body.classList.toggle(
        "snooze-open",
        !!document.getElementById("snoozeDropdown"),
      );
    };

    // Shared removal: cleans up both the DOM element and the outside-click listener
    let onClickOutside: ((e: MouseEvent) => void) | null = null;
    const removeDropdown = () => {
      if (onClickOutside) {
        document.removeEventListener("click", onClickOutside);
        onClickOutside = null;
      }
      if (dropdown.parentNode) dropdown.remove();
      syncBodyScrollLock();
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
    syncBodyScrollLock();
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
    if (typeof message.dateFormat === "string" && message.dateFormat) {
      mDateFormat = message.dateFormat;
    }
    if (typeof message.timeFormat === "string" && message.timeFormat) {
      mTimeFormat = message.timeFormat;
    }
    if (typeof message.locale === "string" && message.locale) {
      mLocale = message.locale;
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
