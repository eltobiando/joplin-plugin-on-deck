// Window-side message handler
// This file runs in the standalone window context
import type { PluginToWindowMessage, WindowToPluginMessage } from "../../types";

let messageListeners: ((event: MessageEvent) => void)[] = [];

// Handle messages from plugin
window.onmessage = (event) => {
  if (event.data && event.data.message) {
    // Forward message to listeners
    messageListeners.forEach((listener) => listener(event));
  }
};

// Snooze All button — shows snooze dropdown for custom time selection
const snoozeAllBtn = document.getElementById("snoozeAllBtn");
if (snoozeAllBtn) {
  (snoozeAllBtn as HTMLElement).onclick = () => {
    const taskCards = document.querySelectorAll(".task-card");
    const taskIds: string[] = Array.from(taskCards)
      .map((card) => card.getAttribute("data-task-id") || "")
      .filter((id) => id);

    if (taskIds.length > 0 && (window as any).showSnoozeDropdown) {
      (window as any).showSnoozeDropdown(null, taskIds);
    }
  };
}

// Refresh button
let refreshLoadingTimeout: number | null = null;
const refreshBtn = document.getElementById("refreshBtn");

// Refresh button loading state (exposed globally for webview.ts)
(window as any).setRefreshLoading = function (loading: boolean) {
  if (refreshBtn) {
    (refreshBtn as HTMLButtonElement).classList.toggle("loading", loading);
    (refreshBtn as HTMLButtonElement).disabled = loading;
  }
  if (refreshLoadingTimeout !== null) {
    clearTimeout(refreshLoadingTimeout);
    refreshLoadingTimeout = null;
  }
  if (loading) {
    // Safety net in case no updateTasks arrives
    refreshLoadingTimeout = window.setTimeout(
      () => (window as any).setRefreshLoading(false),
      15000,
    );
  }
};

if (refreshBtn) {
  (refreshBtn as HTMLElement).onclick = () => {
    (window as any).setRefreshLoading(true);
    (window as any).webviewApi.postMessage({
      type: "refresh",
    });
  };
}

// F5 triggers a refresh instead of reloading the page
window.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "F5") return;
  const target = event.target as HTMLElement;
  // Don't hijack F5 while typing in an input (e.g., custom snooze days)
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"))
    return;
  event.preventDefault();
  refreshBtn?.click();
});

// LookAhead toggle button
const lookAheadBtn = document.getElementById("lookAheadBtn");
if (lookAheadBtn) {
  (lookAheadBtn as HTMLElement).onclick = () => {
    (window as any).webviewApi.postMessage({
      type: "toggleLookAhead",
    });
  };
}

// Update LookAhead button state based on setting (exposed globally for webview.ts)
(window as any).updateLookAheadButtonState = function (active: boolean) {
  if (lookAheadBtn) {
    lookAheadBtn.textContent = active ? "Look Ahead: ON" : "Look Ahead: OFF";
    if (active) {
      lookAheadBtn.classList.add("active");
    } else {
      lookAheadBtn.classList.remove("active");
    }
  }
};

// Emulate Joplin's webviewApi for compatibility.
// The plugin side never responds to messages, so postMessage is
// fire-and-forget — there is no request/response cycle to manage.
(window as any).webviewApi = {
  postMessage: (message: WindowToPluginMessage) => {
    // Use window.opener for standalone window (not window.parent which is self)
    if (!window.opener) {
      console.error(
        "[On-Deck Window] window.opener is null, cannot send message:",
        message,
      );
      return Promise.reject(new Error("No opener window"));
    }
    window.opener.postMessage({ message }, "*");
    return Promise.resolve();
  },

  onMessage: (listener: (message: PluginToWindowMessage) => void) => {
    const messageListener = (event: MessageEvent) => {
      if (event.data && event.data.message) {
        listener(event.data.message);
      }
    };
    messageListeners.push(messageListener);
  },
};

// Privacy overlay: only show when auto-opened by timer
const privacyOverlay = document.getElementById("privacyOverlay");
const showTasksBtn = document.getElementById("showTasksBtn");
if (showTasksBtn) {
  (showTasksBtn as HTMLElement).onclick = () => {
    privacyOverlay?.classList.add("hidden");
  };
}
if (
  privacyOverlay &&
  !new URLSearchParams(window.location.search).get("auto")
) {
  privacyOverlay.classList.add("hidden");
}

// Send window position back to plugin before closing so it can be persisted
window.addEventListener("beforeunload", () => {
  if (window.opener) {
    const message: WindowToPluginMessage = {
      type: "windowClosing",
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
    };
    window.opener.postMessage({ message }, "*");
  }
});
