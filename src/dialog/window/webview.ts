// WebView UI logic
// This file handles the window UI and communicates with the plugin
import type {
  Task,
  TaskList,
  SnoozePreset,
  PluginToWindowMessage,
} from "../../types";

// Configured time for "Tomorrow at" snooze (updated via IPC)
let snoozeUntilTomorrowHour: number = 9;
let snoozeUntilTomorrowMinute: number = 0;

// Last custom snooze day count used in this session (updated via IPC, not persisted)
let lastCustomSnoozeDays: number | null = null;

// Joplin date/time display formats (General settings, updated via IPC)
let dateFormat: string = "DD/MM/YYYY";
let timeFormat: string = "HH:mm";

// True after the first updateTasks arrives — until then the static
// "Loading tasks..." state from the HTML stays visible
let hasLoaded: boolean = false;

// Format relative time (e.g., "2 hours ago", "in 3 days")
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const absDiff = Math.abs(diff);
  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // Future task
  if (diff < 0) {
    if (seconds < 60) {
      return "In less than a minute";
    } else if (minutes < 60) {
      return `In ${minutes} minute${minutes !== 1 ? "s" : ""}`;
    } else if (hours < 24) {
      return `In ${hours} hour${hours !== 1 ? "s" : ""}`;
    } else {
      return `In ${days} day${days !== 1 ? "s" : ""}`;
    }
  }

  // Past task (overdue)
  if (seconds < 60) {
    return "Just now";
  } else if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  } else {
    return `${days} day${days !== 1 ? "s" : ""} ago`;
  }
}

// Format absolute due date & time using Joplin's date/time format settings
// (moment-style tokens, e.g. "YYYY-MM-DD" + "HH:mm" -> "2026-05-01 12:00")
function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const tokens: Record<string, string> = {
    YYYY: `${d.getFullYear()}`,
    YY: `${d.getFullYear()}`.slice(-2),
    MM: `${d.getMonth() + 1}`.padStart(2, "0"),
    DD: `${d.getDate()}`.padStart(2, "0"),
    HH: `${d.getHours()}`.padStart(2, "0"),
    h: `${d.getHours() % 12 || 12}`,
    mm: `${d.getMinutes()}`.padStart(2, "0"),
    A: d.getHours() >= 12 ? "PM" : "AM",
  };
  return `${dateFormat} ${timeFormat}`.replace(
    /YYYY|YY|MM|DD|HH|h|mm|A/g,
    (m) => tokens[m] ?? m,
  );
}

// Get urgency class from task data (computed by ReminderManager)
function getUrgencyClass(task: Task): string {
  return task.urgency || "overdue-low";
}

// Render task list
function renderTasks(tasks: Task[]) {
  const taskListEl = document.getElementById("taskList");
  const taskCountEl = document.getElementById("taskCount");

  if (!taskListEl) {
    console.error("[On-Deck WebView] taskList element not found");
    return;
  }

  if (tasks.length === 0) {
    // Keep the static "Loading tasks..." state until the first update arrives
    if (!hasLoaded) return;

    taskListEl.innerHTML = `
			<div class="empty-state">
				<div class="empty-state-icon">✅</div>
				<div>All caught up! No due tasks.</div>
			</div>
		`;

    if (taskCountEl) {
      taskCountEl.style.display = "none";
    }
    return;
  }

  // Update task count badge
  if (taskCountEl) {
    taskCountEl.textContent = tasks.length.toString();
    taskCountEl.style.display = "inline";
  }

  taskListEl.innerHTML = tasks
    .map((task) => {
      const urgencyClass = getUrgencyClass(task);
      return `
			<div class="task-card ${urgencyClass}" data-task-id="${task.id}">
				<div class="task-info">
					<div class="task-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
					<div class="task-time">Due: ${formatRelativeTime(task.todo_due)} (${formatDateTime(task.todo_due)})</div>
				</div>
				<div class="task-actions">
					<button class="action-btn" data-action="snooze" data-task-id="${task.id}" title="Snooze">🕐</button>
					<button class="action-btn" data-action="open" data-task-id="${task.id}" title="Open note">📝</button>
				</div>
			</div>
		`;
    })
    .join("");

  // Attach event listeners to task cards
  attachTaskCardListeners();
}

// Escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Attach event listeners to task card buttons
function attachTaskCardListeners() {
  const actionBtns = document.querySelectorAll(".action-btn");

  actionBtns.forEach((btn) => {
    (btn as HTMLElement).onclick = () => {
      const action = btn.getAttribute("data-action");
      const taskId = btn.getAttribute("data-task-id");

      if (!action || !taskId) return;

      switch (action) {
        case "open":
          (window as any).webviewApi.postMessage({
            type: "openNote",
            taskId,
          });
          break;
        case "snooze":
          showSnoozeDropdown(taskId);
          break;
      }
    };
  });
}

// Pending promise for settings refresh — resolves when plugin responds
let pendingSettingsPromise: Promise<void> | null = null;

// Request fresh settings from plugin — resolves on response or 2s timeout
function fetchSettings(): Promise<void> {
  if (pendingSettingsPromise) return pendingSettingsPromise;
  return (pendingSettingsPromise = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      pendingSettingsPromise = null;
      resolve();
    }, 2000);
    // Store a resolver that clears timeout on response
    (window as any)._settingsResolve = () => {
      clearTimeout(timeout);
      pendingSettingsPromise = null;
      resolve();
    };
    (window as any).webviewApi.postMessage({ type: "requestSettings" });
  }));
}

// Show snooze dropdown (exposed globally for window.ts snooze-all button)
// When taskIds is provided, sends bulkSnooze; otherwise sends snoozeTask for a single task.
async function showSnoozeDropdown(taskId: string | null, taskIds?: string[]) {
  // Fetch fresh settings before rendering
  await fetchSettings();

  const isBulk = !!taskIds && taskIds.length > 0;
  const countLabel = isBulk ? ` (${taskIds.length} tasks)` : "";

  // Remove existing dropdown
  const existingDropdown = document.getElementById("snoozeDropdown");
  if (existingDropdown) {
    existingDropdown.remove();
  }

  // Add styles if not already present
  if (!document.getElementById("snoozeDropdownStyles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "snoozeDropdownStyles";
    styleEl.textContent = `
			.snooze-option {
				padding: 6px 12px;
				cursor: pointer;
				border-radius: 6px;
				transition: all 0.15s ease;
				font-size: 13px;
			}
			.snooze-option:hover {
				background-color: #3498db;
				color: white;
			}
		`;
    document.head.appendChild(styleEl);
  }

  // Create dropdown container
  const dropdown = document.createElement("div");
  dropdown.id = "snoozeDropdown";
  dropdown.style.cssText = `
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: white;
		border: 1px solid #ccc;
		box-shadow: 0 4px 20px rgba(0,0,0,0.3);
		border-radius: 8px;
		padding: 16px;
		min-width: 220px;
		z-index: 1000;
	`;

  // Preset options
  const presets: { label: string; value: SnoozePreset }[] = [
    { label: "15 minutes", value: "15min" },
    { label: "30 minutes", value: "30min" },
    { label: "1 hour", value: "1hr" },
    { label: "2 hours", value: "2hr" },
    { label: "3 hours", value: "3hr" },
    {
      label: `Tomorrow at ${snoozeUntilTomorrowHour}:${snoozeUntilTomorrowMinute.toString().padStart(2, "0")}`,
      value: "tomorrow",
    },
    { label: "1 day (same time)", value: "1day" },
    { label: "3 days (same time)", value: "3day" },
    { label: "7 days (same time)", value: "7day" },
  ];

  dropdown.innerHTML = `
		<div style="font-weight: 600; margin-bottom: 8px; color: #333; font-size: 14px;">Snooze for${countLabel}</div>
		<div style="display: flex; flex-direction: column; gap: 4px;">
			${presets
        .map(
          (preset) => `
				<div class="snooze-option" data-value="${preset.value}">
					${preset.label}
				</div>
			`,
        )
        .join("")}
		</div>
		<div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #eee;">
			<div style="font-size: 12px; color: #666; margin-bottom: 8px;">Custom</div>
			<div style="display: flex; gap: 6px; align-items: center;">
				<input type="number" id="customSnoozeValue" min="1" value="${lastCustomSnoozeDays ?? 1}"
					style="width: 60px; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; text-align: center;" />
				<select id="customSnoozeUnit"
					style="flex: 1; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: white;">
					<option value="days">days</option>
					<option value="hours">hours</option>
					<option value="minutes">minutes</option>
				</select>
				<button class="customSnoozeBtn"
					style="padding: 6px 12px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; white-space: nowrap;">OK</button>
			</div>
		</div>
		<div style="margin-top: 12px;">
			<button class="cancel-btn" style="width: 100%; padding: 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 13px;">Cancel</button>
		</div>
	`;

  // Click handler for snooze options
  dropdown.querySelectorAll(".snooze-option").forEach((option) => {
    option.addEventListener("click", () => {
      const value = option.getAttribute("data-value") as SnoozePreset;
      if (isBulk) {
        (window as any).webviewApi.postMessage({
          type: "bulkSnooze",
          taskIds,
          snooze: value,
        });
      } else {
        (window as any).webviewApi.postMessage({
          type: "snoozeTask",
          taskId,
          snooze: value,
        });
      }
      dropdown.remove();
    });
  });

  // Custom snooze handler
  const customValue = dropdown.querySelector(
    "#customSnoozeValue",
  ) as HTMLInputElement;
  const customUnit = dropdown.querySelector(
    "#customSnoozeUnit",
  ) as HTMLSelectElement;
  const applyCustomSnooze = () => {
    const value = parseInt(customValue.value, 10);
    const unit = customUnit.value as "minutes" | "hours" | "days";
    if (value > 0) {
      if (isBulk) {
        (window as any).webviewApi.postMessage({
          type: "bulkSnooze",
          taskIds,
          snooze: { value, unit },
        });
      } else {
        (window as any).webviewApi.postMessage({
          type: "snoozeTask",
          taskId,
          snooze: { value, unit },
        });
      }
      dropdown.remove();
    }
  };
  customValue.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyCustomSnooze();
  });
  const customSnoozeBtn = dropdown.querySelector(".customSnoozeBtn");
  if (customSnoozeBtn) {
    (customSnoozeBtn as HTMLElement).onclick = applyCustomSnooze;
  }

  // Cancel button
  const cancelBtn = dropdown.querySelector(".cancel-btn");
  if (cancelBtn) {
    (cancelBtn as HTMLElement).onclick = () => dropdown.remove();
  }

  // Click outside to close
  const onClickOutside = (e: MouseEvent) => {
    if (!dropdown.contains(e.target as Node)) {
      dropdown.remove();
      document.removeEventListener("click", onClickOutside);
    }
  };

  // Small delay to prevent immediate close
  setTimeout(() => {
    document.addEventListener("click", onClickOutside);
  }, 10);

  document.body.appendChild(dropdown);
}

// Expose globally so window.ts can call it for the snooze-all button
(window as any).showSnoozeDropdown = showSnoozeDropdown;

// Listen for messages from plugin
(window as any).webviewApi.onMessage((message: PluginToWindowMessage) => {
  switch (message.type) {
    case "updateTasks": {
      hasLoaded = true;
      const tasks: TaskList = message.tasks;
      if (typeof message.snoozeUntilTomorrowHour === "number") {
        snoozeUntilTomorrowHour = message.snoozeUntilTomorrowHour;
      }
      if (typeof message.snoozeUntilTomorrowMinute === "number") {
        snoozeUntilTomorrowMinute = message.snoozeUntilTomorrowMinute;
      }
      if (typeof message.lastCustomSnoozeDays === "number") {
        lastCustomSnoozeDays = message.lastCustomSnoozeDays;
      }
      if (typeof message.dateFormat === "string" && message.dateFormat) {
        dateFormat = message.dateFormat;
      }
      if (typeof message.timeFormat === "string" && message.timeFormat) {
        timeFormat = message.timeFormat;
      }
      if ((window as any).setRefreshLoading) {
        (window as any).setRefreshLoading(false);
      }
      renderTasks(tasks.tasks);
      // Update LookAhead toggle button state
      if ((window as any).updateLookAheadButtonState) {
        (window as any).updateLookAheadButtonState(message.showLookAhead);
      }
      break;
    }
    case "settingsUpdated":
      if (typeof message.snoozeUntilTomorrowHour === "number") {
        snoozeUntilTomorrowHour = message.snoozeUntilTomorrowHour;
      }
      if (typeof message.snoozeUntilTomorrowMinute === "number") {
        snoozeUntilTomorrowMinute = message.snoozeUntilTomorrowMinute;
      }
      if (typeof message.lastCustomSnoozeDays === "number") {
        lastCustomSnoozeDays = message.lastCustomSnoozeDays;
      }
      if ((window as any)._settingsResolve) {
        (window as any)._settingsResolve();
      }
      break;
  }
});

// Signal ready to plugin
(window as any).webviewApi.postMessage({ type: "ready" });
