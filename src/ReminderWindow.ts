import { posix as posixPath } from "path";
import joplin from "api";
import {
  TaskList,
  WindowToPluginMessage,
  PluginToWindowMessage,
  SnoozeOption,
  WindowPosition,
} from "./types";
import { ReminderManager } from "./ReminderManager";

export const DEFAULT_WINDOW_WIDTH = 715;
export const DEFAULT_WINDOW_HEIGHT = 520;

export class ReminderWindow {
  private win: Window | undefined = undefined;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private readyResolve: (() => void) | null = null;
  private reminderManager: ReminderManager | null = null;
  private positionCallback: ((pos: WindowPosition) => void) | null = null;
  private windowClosingCallback: (() => void) | null = null;
  private isWindows: boolean = false;
  private settingsCache: {
    showLookAhead: boolean;
    snoozeUntilTomorrowHour: number;
    snoozeUntilTomorrowMinute: number;
    dateFormat: string;
    timeFormat: string;
    cachedAt: number;
  } | null = null;
  private readonly SETTINGS_TTL_MS = 30 * 1000; // 30 seconds

  constructor(manager: ReminderManager) {
    this.reminderManager = manager;
    this.isWindows = /win32|win64/i.test(navigator.userAgent);
  }

  /**
   * Default window size, accounting for platform frame offset
   */
  private get defaults(): { width: number; height: number } {
    const frameWidth = this.isWindows ? 14 : 0;
    const frameHeight = this.isWindows ? 39 : 0;
    return {
      width: DEFAULT_WINDOW_WIDTH + frameWidth,
      height: DEFAULT_WINDOW_HEIGHT + frameHeight,
    };
  }

  /**
   * Set a callback that fires periodically with current window position
   */
  public setPositionCallback(cb: (pos: WindowPosition) => void) {
    this.positionCallback = cb;
  }

  /**
   * Set a callback that fires when the window is closed via the X button
   */
  public setWindowClosingCallback(cb: () => void) {
    this.windowClosingCallback = cb;
  }

  /**
   * Check if the window is actually still open (handles X button close)
   */
  public isWindowAlive(): boolean {
    return this.win !== undefined && !this.win.closed;
  }

  /**
   * Validate that a window position is within visible screen bounds.
   * Returns null/defaults if position is off-screen (e.g. disconnected monitor).
   */
  private validatePosition(pos: WindowPosition): WindowPosition {
    const { width: defaultWidth, height: defaultHeight } = this.defaults;
    const minWidth = 200;
    const minHeight = 150;

    // Reject zero or tiny dimensions — can happen when window opens on a locked screen
    let width = pos.width;
    let height = pos.height;
    if (width < minWidth || height < minHeight) {
      width = defaultWidth;
      height = defaultHeight;
    }

    const screen = window.screen as any;
    const availLeft = screen.availLeft ?? 0;
    const availTop = screen.availTop ?? 0;
    const availRight = availLeft + (screen.availWidth ?? screen.width);
    const availBottom = availTop + (screen.availHeight ?? screen.height);

    const x = pos.x ?? null;
    const y = pos.y ?? null;

    // Check if at least partially visible on screen
    if (x !== null && y !== null) {
      const winRight = x + width;
      const winBottom = y + height;
      const isVisible =
        winRight > availLeft &&
        winBottom > availTop &&
        x < availRight &&
        y < availBottom;
      if (isVisible) {
        return { x, y, width, height };
      }
    }

    return { x: null, y: null, width, height };
  }

  /**
   * Get current window position
   * Returns null if window is closed or has zero dimensions (e.g. opened on locked screen)
   */
  public getWindowPosition(): WindowPosition | null {
    if (!this.win || this.win.closed) return null;
    const width = this.win.outerWidth;
    const height = this.win.outerHeight;
    if (width === 0 || height === 0) return null;
    return {
      x: this.win.screenX,
      y: this.win.screenY,
      width,
      height,
    };
  }

  /**
   * Check if window is open
   */
  public async isOpen(): Promise<boolean> {
    return this.win !== undefined && this.win.closed === false;
  }

  /**
   * Open the reminder window and send it the initial task list.
   * @param savedPosition - Saved position to restore, or undefined to center on screen
   * @param autoOpen - If true, show privacy overlay (auto-opened by timer)
   * @param initialTasks - Tasks to send; fetched if omitted
   * @returns The task list that was sent to the window
   */
  public async open(
    savedPosition?: WindowPosition,
    autoOpen = false,
    initialTasks?: TaskList,
  ): Promise<TaskList | undefined> {
    if (await this.isOpen()) return undefined;

    try {
      const installationDir = await joplin.plugins.installationDir();
      // Cache-busting to force fresh load on each open
      const cacheBust = `?t=${Date.now()}${autoOpen ? "&auto=1" : ""}`;

      // Use saved position if valid, otherwise center on screen
      const { width: defaultWidth, height: defaultHeight } = this.defaults;
      const pos = savedPosition
        ? this.validatePosition(savedPosition)
        : { x: null, y: null, width: defaultWidth, height: defaultHeight };
      const features = `width=${pos.width},height=${pos.height}${pos.x !== null ? `,left=${pos.x}` : ""}${pos.y !== null ? `,top=${pos.y}` : ""},autoHideMenuBar=true`;

      this.win = window.open(
        `file://${posixPath.normalize(installationDir)}/dialog/window/index.html${cacheBust}`,
        "_blank",
        features,
      );

      if (!this.win) {
        throw new Error(
          "Failed to open window. Pop-up blocker may be blocking it.",
        );
      }

      // Attach the message listener before waiting, so the ready signal
      // from the webview cannot be missed
      this.setupMessageListener();
      await this.waitForReady();

      // Send initial tasks
      const tasks = initialTasks ?? (await this.reminderManager!.getDueTasks());
      await this.sendTasks(tasks);
      return tasks;
    } catch (error) {
      console.error("[On-Deck] Error opening window:", error);
      // Abandon nothing: a post-ready failure (e.g. a transient data-API
      // error) must not leave an orphaned window stuck on "Loading tasks..."
      // Conditional: the pop-up-blocker arm throws while this.win is undefined
      if (this.win && !this.win.closed) {
        this.win.close();
      }
      this.win = undefined;
      throw error;
    }
  }

  /**
   * Wait until the window's webview signals ready.
   * Falls back after 3s so a broken window cannot block the open flow.
   */
  private waitForReady(): Promise<void> {
    // Resolve any pending ready-wait from a previous open — a dangling
    // wait would hang the serialized task-update chain
    if (this.readyResolve) {
      const resolveReady = this.readyResolve;
      this.readyResolve = null;
      resolveReady();
    }

    return new Promise<void>((resolve) => {
      this.readyResolve = resolve;
      setTimeout(() => {
        if (this.readyResolve !== resolve) return;
        this.readyResolve = null;
        console.warn(
          "[On-Deck] Window did not signal ready within 3s; continuing anyway",
        );
        resolve();
      }, 3000);
    });
  }

  /**
   * Setup message listener from window
   * Removes any prior listener first to prevent leaks when the window was
   * closed via the X button (which bypasses close() / reopen()).
   */
  private setupMessageListener() {
    if (!this.win) return;

    // Remove stale listener from a previous open() that wasn't cleaned up
    if (this.messageListener) {
      window.removeEventListener("message", this.messageListener);
    }

    this.messageListener = async (event: MessageEvent) => {
      // webviewApi.postMessage wraps in { message: {...}, id: "..." }
      const message = event.data?.message as WindowToPluginMessage | undefined;

      if (!message || !message.type) return;

      switch (message.type) {
        case "ready":
          if (this.readyResolve) {
            const resolveReady = this.readyResolve;
            this.readyResolve = null;
            resolveReady();
          }
          break;
        case "openNote":
          await this.handleOpenNote(message.taskId);
          break;
        case "snoozeTask":
          await this.handleSnoozeTask(message.taskId, message.snooze);
          break;
        case "bulkSnooze":
          await this.handleBulkSnooze(message.taskIds, message.snooze);
          break;
        case "refresh":
          await this.handleRefresh();
          break;
        case "toggleLookAhead":
          await this.handleToggleLookAhead();
          break;
        case "requestSettings":
          await this.handleRequestSettings();
          break;
        case "windowClosing":
          // To be sure, let's remove the listener on close:
          if (this.messageListener) {
            window.removeEventListener("message", this.messageListener);
          }
          this.handleWindowClosing(message);
          break;
      }
    };

    window.addEventListener("message", this.messageListener);
  }

  /**
   * Close the window, returns position to save
   */
  public async close(): Promise<WindowPosition | null> {
    const position = this.getWindowPosition();

    if (this.messageListener && this.win) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }

    // Release any pending ready-wait (e.g. from a reopen race)
    if (this.readyResolve) {
      const resolveReady = this.readyResolve;
      this.readyResolve = null;
      resolveReady();
    }

    if (this.win && !this.win.closed) {
      this.win.close();
    }
    this.win = undefined;

    return position;
  }

  /**
   * Reopen the window to bring it to foreground (window.open naturally focuses)
   * @param autoOpen - If true, show privacy overlay on reopen
   * @param initialTasks - Tasks to send; fetched if omitted
   */
  public async reopen(
    autoOpen = false,
    initialTasks?: TaskList,
  ): Promise<TaskList | undefined> {
    if (!this.win || this.win.closed) return undefined;

    // Save current position before closing
    const pos = this.getWindowPosition();

    // Close existing window
    if (this.messageListener && this.win) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
    if (this.win && !this.win.closed) {
      this.win.close();
    }
    this.win = undefined;

    // Reopen with saved position — window.open naturally focuses
    return this.open(pos, autoOpen, initialTasks);
  }

  private async getCachedSettings() {
    const now = Date.now();
    if (
      this.settingsCache &&
      now - this.settingsCache.cachedAt < this.SETTINGS_TTL_MS
    ) {
      return this.settingsCache;
    }
    let showLookAhead = false;
    let snoozeUntilTomorrowHour = 9;
    let snoozeUntilTomorrowMinute = 0;
    // Joplin built-in display formats (General settings)
    let dateFormat = "DD/MM/YYYY";
    let timeFormat = "HH:mm";
    try {
      showLookAhead = (await joplin.settings.value("showLookAhead")) as boolean;
      snoozeUntilTomorrowHour =
        ((await joplin.settings.value("snoozeUntilTomorrowHour")) as number) ??
        9;
      snoozeUntilTomorrowMinute =
        ((await joplin.settings.value(
          "snoozeUntilTomorrowMinute",
        )) as number) ?? 0;
      const globals = (await joplin.settings.globalValues([
        "dateFormat",
        "timeFormat",
      ])) as string[];
      if (typeof globals[0] === "string" && globals[0]) dateFormat = globals[0];
      if (typeof globals[1] === "string" && globals[1]) timeFormat = globals[1];
    } catch {
      // defaults
    }
    this.settingsCache = {
      showLookAhead,
      snoozeUntilTomorrowHour,
      snoozeUntilTomorrowMinute,
      dateFormat,
      timeFormat,
      cachedAt: now,
    };
    return this.settingsCache;
  }

  /**
   * Send tasks to window
   */
  public async sendTasks(tasks: TaskList) {
    if (!this.win || this.win.closed) return;

    const settings = await this.getCachedSettings();

    const message: PluginToWindowMessage = {
      type: "updateTasks",
      tasks,
      showLookAhead: settings.showLookAhead,
      snoozeUntilTomorrowHour: settings.snoozeUntilTomorrowHour,
      snoozeUntilTomorrowMinute: settings.snoozeUntilTomorrowMinute,
      lastCustomSnoozeDays: this.reminderManager.getLastCustomSnoozeDays(),
      dateFormat: settings.dateFormat,
      timeFormat: settings.timeFormat,
    };

    try {
      this.win.postMessage({ message }, "*");
    } catch (error) {
      console.error("[On-Deck] Failed to send tasks to window:", error);
    }

    // Notify position callback so plugin can persist window position
    if (this.positionCallback) {
      const pos = this.getWindowPosition();
      if (pos) this.positionCallback(pos);
    }
  }

  /**
   * Handle open note message
   */
  private async handleOpenNote(taskId: string) {
    try {
      await this.reminderManager.openNote(taskId);
    } catch (error) {
      console.error(`[On-Deck] Error opening note ${taskId}:`, error);
    }
  }

  /**
   * Handle snooze task message
   */
  private async handleSnoozeTask(taskId: string, snooze: SnoozeOption) {
    try {
      await this.reminderManager.snoozeTask(taskId, snooze);
    } catch (error) {
      console.error(`[On-Deck] Error snoozing task ${taskId}:`, error);
    }
  }

  /**
   * Handle bulk snooze message
   */
  private async handleBulkSnooze(taskIds: string[], snooze: SnoozeOption) {
    try {
      await this.reminderManager.snoozeTaskBulk(taskIds, snooze);
    } catch (error) {
      console.error(`[On-Deck] Error bulk snoozing tasks:`, error);
    }
  }

  /**
   * Handle refresh message
   */
  private async handleRefresh() {
    const tasks = await this.reminderManager.getDueTasks();
    await this.sendTasks(tasks);
  }

  /**
   * Handle toggle look-ahead message
   */
  private async handleToggleLookAhead() {
    let currentValue = false;
    try {
      currentValue = (await joplin.settings.value("showLookAhead")) as boolean;
    } catch {
      // default false
    }
    await joplin.settings.setValue("showLookAhead", !currentValue);
    this.settingsCache = null; // invalidate cache
    const tasks = await this.reminderManager.getDueTasks();
    await this.sendTasks(tasks);
  }

  /**
   * Handle request settings message
   */
  private async handleRequestSettings() {
    if (!this.win || this.win.closed) return;

    const settings = await this.getCachedSettings();

    const message: PluginToWindowMessage = {
      type: "settingsUpdated",
      snoozeUntilTomorrowHour: settings.snoozeUntilTomorrowHour,
      snoozeUntilTomorrowMinute: settings.snoozeUntilTomorrowMinute,
      lastCustomSnoozeDays: this.reminderManager.getLastCustomSnoozeDays(),
    };

    this.win.postMessage({ message }, "*");
  }

  /**
   * Handle window closing message — saves position from the window-side beforeunload
   */
  private handleWindowClosing(message: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) {
    if (message.width === 0 || message.height === 0) return;
    const pos: WindowPosition = {
      x: message.x,
      y: message.y,
      width: message.width,
      height: message.height,
    };
    if (this.positionCallback) {
      this.positionCallback(pos);
    }
    if (this.windowClosingCallback) {
      this.windowClosingCallback();
    }
  }
}
