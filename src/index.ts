import joplin from "api";
import {
  MenuItemLocation,
  ToolbarButtonLocation,
  SettingItemType,
} from "api/types";
import { ReminderManager } from "./ReminderManager";
import {
  ReminderWindow,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
} from "./ReminderWindow";
import { TaskList, WindowPosition, WindowToPluginMessage } from "./types";
import { serialExecutor } from "./serialExecutor";
import { MOBILE_PANEL_HTML } from "./mobile-panel-html";

let reminderManager: ReminderManager | null = null;

// Desktop state
let reminderWindow: ReminderWindow | null = null;
let isWindowOpen = false;
let previousTaskCount = 0;

// Mobile state
let isMobile = false;
let mobilePanelHandle: string | null = null;
let mobileWebViewReady = false; // true after webview sent 'ready'
let mobilePendingTasks: TaskList | null = null; // cached while webview is hidden
let mobileHeartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

const runDesktopTaskUpdate = serialExecutor(doHandleDesktopTaskUpdate);
const runMobileTaskUpdate = serialExecutor(doHandleMobileTaskUpdate);

/**
 * Reset the mobile heartbeat timeout. Clears any existing timer first.
 */
function resetMobileHeartbeat() {
  if (mobileHeartbeatTimeout) {
    clearTimeout(mobileHeartbeatTimeout);
  }
  mobileHeartbeatTimeout = setTimeout(() => {
    mobileWebViewReady = false;
    mobileHeartbeatTimeout = null;
  }, 15000);
}

joplin.plugins.register({
  onStart: async function () {
    // Detect platform
    const versionInfo = await joplin.versionInfo();
    isMobile = versionInfo.platform === "mobile";

    // Register settings (shared + platform-specific)
    await registerSharedSettings();
    if (!isMobile) await registerDesktopSettings();

    // Initialize components
    reminderManager = new ReminderManager();

    if (isMobile) {
      await initMobile();
      // Start without timer on mobile — no auto-open window to drive
      await reminderManager.start(false);
    } else {
      await initDesktop();
      await reminderManager.start();
    }
  },
});

async function registerSharedSettings() {
  await joplin.settings.registerSection("onDeckBehavior", { label: "On-Deck" });

  await joplin.settings.registerSettings({
    showLookAhead: {
      value: false,
      type: SettingItemType.Bool,
      public: true,
      section: "onDeckBehavior",
      label: "Show look-ahead tasks (due within next X days)",
    },
    lookAheadDays: {
      value: 7,
      type: SettingItemType.Int,
      public: true,
      section: "onDeckBehavior",
      label: "Show tasks due within next X days",
    },
    snoozeUntilTomorrowHour: {
      value: 9,
      type: SettingItemType.Int,
      public: true,
      section: "onDeckBehavior",
      label: 'Snooze "Tomorrow at" — hour (0–23)',
    },
    snoozeUntilTomorrowMinute: {
      value: 0,
      type: SettingItemType.Int,
      public: true,
      section: "onDeckBehavior",
      label: 'Snooze "Tomorrow at" — minute (0–59)',
    },
  });
}

async function registerDesktopSettings() {
  await joplin.settings.registerSettings({
    windowX: {
      value: null,
      type: SettingItemType.Int,
      public: false,
      label: "Window X",
    },
    windowY: {
      value: null,
      type: SettingItemType.Int,
      public: false,
      label: "Window Y",
    },
    windowWidth: {
      value: DEFAULT_WINDOW_WIDTH,
      type: SettingItemType.Int,
      public: false,
      label: "Window Width",
    },
    windowHeight: {
      value: DEFAULT_WINDOW_HEIGHT,
      type: SettingItemType.Int,
      public: false,
      label: "Window Height",
    },
    autoFocus: {
      value: false,
      type: SettingItemType.Bool,
      public: true,
      section: "onDeckBehavior",
      label: "Bring notification window to foreground on new due tasks",
    },
    privacyOverlay: {
      value: false,
      type: SettingItemType.Bool,
      public: true,
      section: "onDeckBehavior",
      label: "Hide notification window content when notification is shown",
    },
  });
}

async function initDesktop() {
  reminderWindow = new ReminderWindow(reminderManager!);

  // Set up the window callback for task updates
  reminderManager!.setWindowCallback(async (tasks: TaskList) => {
    await runDesktopTaskUpdate(tasks);
  });

  // Set up position callback
  reminderWindow!.setPositionCallback(async (pos: WindowPosition) => {
    await saveWindowPosition(pos);
  });

  // Reset isWindowOpen immediately when user closes via X button
  reminderWindow!.setWindowClosingCallback(() => {
    isWindowOpen = false;
    reminderManager?.setWindowOpen(false);
  });

  // Register desktop commands & menu items
  await registerDesktopCommands();
}

/**
 * Decide whether to open/close/update the window (runs serially via
 * runDesktopTaskUpdate to prevent duplicate windows after system resume,
 * when setInterval fires all accumulated callbacks at once)
 */
async function doHandleDesktopTaskUpdate(tasks: TaskList) {
  const hasDueTasks = tasks.tasks.length > 0;
  const windowAlive = reminderWindow?.isWindowAlive() ?? false;

  // Sync state: if window was closed via X button, reset our flag
  if (isWindowOpen && !windowAlive) {
    isWindowOpen = false;
  }

  const enableOverlay = (await joplin.settings.value(
    "privacyOverlay",
  )) as boolean;

  if (hasDueTasks && !isWindowOpen) {
    // Open window when due tasks appear (pass the already-fetched tasks so
    // open() doesn't need a second full fetch)
    try {
      const savedPos = await loadWindowPosition();
      await reminderWindow?.open(savedPos, enableOverlay, tasks);
      reminderManager?.setWindowOpen(true);
      previousTaskCount = tasks.tasks.length;
      isWindowOpen = true;
    } catch (error) {
      console.error("[On-Deck] Failed to open window:", error);
    }
  } else if (!hasDueTasks && isWindowOpen) {
    // Close window when all tasks are cleared
    const position = await reminderWindow?.close();
    if (position) await saveWindowPosition(position);
    reminderManager?.setWindowOpen(false);
    previousTaskCount = 0;
    isWindowOpen = false;
  } else if (hasDueTasks && isWindowOpen) {
    // Update tasks in existing window (position saved via callback)
    const hadNewTasks = tasks.tasks.length > previousTaskCount;
    previousTaskCount = tasks.tasks.length;
    if (hadNewTasks && (await shouldAutoFocus())) {
      // Reopen to bring to foreground — window.open naturally focuses
      await reminderWindow?.reopen(enableOverlay, tasks);
    } else {
      await reminderWindow?.sendTasks(tasks);
    }
  }
}

/**
 * Register plugin commands
 */
async function registerDesktopCommands() {
  await joplin.commands.register({
    name: "commandShowOnDeck",
    label: "Show On-Deck Reminders",
    iconName: "fa-clock",
    execute: async () => {
      await showDesktopWindow();
    },
  });

  await joplin.views.menuItems.create(
    "onDeckShowMenuItem",
    "commandShowOnDeck",
    MenuItemLocation.View,
  );
}

/**
 * Show the window — if it is already open, close and re-open it
 * so it reloads with fresh task data
 */
async function showDesktopWindow() {
  if (isWindowOpen && !reminderWindow?.isWindowAlive()) {
    isWindowOpen = false;
  }

  if (isWindowOpen) {
    // Reopen closes the window and opens a fresh one at the same position,
    // behaving the same as a first open via the menu (no privacy overlay —
    // that is only shown for timer-triggered auto-opens)
    await reminderWindow?.reopen();
    return;
  }

  try {
    const savedPos = await loadWindowPosition();
    // open() fetches and sends the initial tasks itself
    const sent = await reminderWindow?.open(savedPos);
    reminderManager?.setWindowOpen(true);
    previousTaskCount = sent?.tasks.length ?? 0;
    isWindowOpen = true;
  } catch (error) {
    console.error("[On-Deck] Failed to open window:", error);
  }
}

async function loadWindowPosition(): Promise<WindowPosition | undefined> {
  try {
    const values = (await joplin.settings.values([
      "windowX",
      "windowY",
      "windowWidth",
      "windowHeight",
    ])) as Record<string, number | null>;
    return {
      x: values.windowX,
      y: values.windowY,
      width: (values.windowWidth as number) ?? DEFAULT_WINDOW_WIDTH,
      height: (values.windowHeight as number) ?? DEFAULT_WINDOW_HEIGHT,
    };
  } catch (error) {
    console.error("[On-Deck] Failed to load window position:", error);
    return undefined;
  }
}

async function saveWindowPosition(pos: WindowPosition) {
  try {
    await joplin.settings.setValue("windowX", pos.x);
    await joplin.settings.setValue("windowY", pos.y);
    await joplin.settings.setValue("windowWidth", pos.width);
    await joplin.settings.setValue("windowHeight", pos.height);
  } catch (error) {
    console.error("[On-Deck] Failed to save window position:", error);
  }
}

async function shouldAutoFocus(): Promise<boolean> {
  try {
    return (await joplin.settings.value("autoFocus")) as boolean;
  } catch {
    return false;
  }
}

async function initMobile() {
  mobilePanelHandle = await joplin.views.panels.create("onDeckPanel");

  if (!mobilePanelHandle) {
    throw new Error(
      "[On-Deck] Cannot send tasks: mobile panel not initialized",
    );
  }

  // Set inline HTML content (no fs available)
  await joplin.views.panels.setHtml(mobilePanelHandle, MOBILE_PANEL_HTML);

  // Load the webview script
  await joplin.views.panels.addScript(mobilePanelHandle, "./mobile-webview.js");

  // Mark panel as opened so it appears as a tab in the panels dialog
  await joplin.views.panels.show(mobilePanelHandle);

  await setupMobileMessageHandler();

  // Register toolbar command
  await joplin.commands.register({
    name: "onDeckToolbarCommand",
    label: "Toggle On-Deck Panel",
    iconName: "fa-clock",
    execute: async () => {
      await toggleMobilePanel();
    },
  });

  // EditorToolbar works on all platforms; NoteToolbar is desktop-only
  await joplin.views.toolbarButtons.create(
    "onDeckToolbarButton",
    "onDeckToolbarCommand",
    ToolbarButtonLocation.EditorToolbar,
  );

  // The mobile panel is the persistent consumer of task updates — mark the
  // window as open so the manager never skips updates for it (the desktop
  // skip optimization only makes sense when a real window may be closed)
  reminderManager!.setWindowOpen(true);

  // Set up task update callback
  reminderManager!.setWindowCallback(async (tasks: TaskList) => {
    await runMobileTaskUpdate(tasks);
  });
}

async function setupMobileMessageHandler() {
  if (!mobilePanelHandle) return;

  joplin.views.panels.onMessage(
    mobilePanelHandle,
    async (message: WindowToPluginMessage) => {
      if (!message || !message.type) return;

      try {
        switch (message.type) {
          case "ready":
            // Always flush on ready — webview reconnects after panel close/reopen
            mobileWebViewReady = true;
            if (mobilePendingTasks) {
              await sendMobileTasks(mobilePendingTasks);
              mobilePendingTasks = null;
            } else {
              // No cached tasks — fetch fresh ones
              await sendMobileTasks();
            }
            // Reset heartbeat — webview is alive
            resetMobileHeartbeat();
            break;
          case "heartbeat":
            // Keep-alive from webview
            resetMobileHeartbeat();
            break;
          case "openNote":
            await reminderManager?.openNote(message.taskId);
            break;
          case "snoozeTask":
            await reminderManager?.snoozeTask(message.taskId, message.snooze);
            break;
          case "bulkSnooze":
            await reminderManager?.snoozeTaskBulk(
              message.taskIds,
              message.snooze,
            );
            break;
          case "refresh":
            await sendMobileTasks();
            break;
          case "toggleLookAhead":
            await toggleMobileLookAhead();
            break;
          case "requestSettings":
            await sendMobileSettings();
            break;
        }
      } catch (error) {
        console.error(
          `[On-Deck] Error handling message ${message.type}:`,
          error,
        );
      }
    },
  );
}

async function doHandleMobileTaskUpdate(tasks: TaskList) {
  // Always cache latest tasks — they'll be flushed when webview becomes ready
  mobilePendingTasks = tasks;

  // If webview is mounted and ready, send immediately
  if (mobileWebViewReady) {
    await sendMobileTasks(tasks);
  }
}

async function sendMobileTasks(tasks?: TaskList) {
  if (!mobilePanelHandle) {
    throw new Error(
      "[On-Deck] Cannot send tasks: mobile panel not initialized",
    );
  }

  if (!tasks) {
    tasks = await reminderManager?.getDueTasks();
  }
  if (!tasks) return;

  let showLookAhead = false;
  let snoozeUntilTomorrowHour = 9;
  let snoozeUntilTomorrowMinute = 0;
  try {
    const values = (await joplin.settings.values([
      "showLookAhead",
      "snoozeUntilTomorrowHour",
      "snoozeUntilTomorrowMinute",
    ])) as {
      showLookAhead: boolean | null;
      snoozeUntilTomorrowHour: number | null;
      snoozeUntilTomorrowMinute: number | null;
    };
    showLookAhead = Boolean(values.showLookAhead);
    snoozeUntilTomorrowHour = values.snoozeUntilTomorrowHour ?? 9;
    snoozeUntilTomorrowMinute = values.snoozeUntilTomorrowMinute ?? 0;
  } catch {
    /* defaults */
  }

  joplin.views.panels.postMessage(mobilePanelHandle, {
    type: "updateTasks",
    tasks,
    showLookAhead,
    snoozeUntilTomorrowHour,
    snoozeUntilTomorrowMinute,
    lastCustomSnoozeDays: reminderManager?.getLastCustomSnoozeDays() ?? null,
  });
}

async function sendMobileSettings() {
  if (!mobilePanelHandle) return;

  let snoozeUntilTomorrowHour = 9;
  let snoozeUntilTomorrowMinute = 0;
  try {
    const values = (await joplin.settings.values([
      "snoozeUntilTomorrowHour",
      "snoozeUntilTomorrowMinute",
    ])) as Record<string, number | null>;
    snoozeUntilTomorrowHour = values.snoozeUntilTomorrowHour ?? 9;
    snoozeUntilTomorrowMinute = values.snoozeUntilTomorrowMinute ?? 0;
  } catch {
    /* defaults */
  }

  joplin.views.panels.postMessage(mobilePanelHandle, {
    type: "settingsUpdated",
    snoozeUntilTomorrowHour,
    snoozeUntilTomorrowMinute,
    lastCustomSnoozeDays: reminderManager?.getLastCustomSnoozeDays() ?? null,
  });
}

async function toggleMobileLookAhead() {
  let currentValue = false;
  try {
    currentValue = (await joplin.settings.value("showLookAhead")) as boolean;
  } catch {
    /* default */
  }
  await joplin.settings.setValue("showLookAhead", !currentValue);
  await sendMobileTasks();
}

async function toggleMobilePanel() {
  if (!mobilePanelHandle) return;

  // On mobile, the panels dialog can only be opened via the built-in
  // puzzle-piece button in the app header. This toolbar button is inside
  // the note editor and cannot open the dialog.
  // So we use it as a refresh + ensure-visible toggle instead.
  const isVisible = await joplin.views.panels.visible(mobilePanelHandle);

  if (!isVisible) {
    // Panel is hidden — mark it opened so it shows when the dialog opens
    // (if it's already visible the user can dismiss it via the dialog itself)
    await joplin.views.panels.show(mobilePanelHandle);
  }

  // Always refresh tasks
  const tasks = await reminderManager?.getDueTasks();
  mobilePendingTasks = tasks || { tasks: [] };
  if (mobileWebViewReady && mobilePendingTasks) {
    await sendMobileTasks(mobilePendingTasks);
  }
}
