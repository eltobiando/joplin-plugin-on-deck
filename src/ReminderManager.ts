import joplin from "api";
import {
  Task,
  TaskList,
  SnoozeOption,
  SnoozePreset,
  CustomSnooze,
} from "./types";

export class ReminderManager {
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
  private lastCheckedTasks = new Set<string>();
  private windowCallback?: (tasks: TaskList) => void;
  private windowOpen = false;
  // In-memory only: survives window reopens, resets on Joplin restart
  private lastCustomSnoozeDays: number | null = null;

  /** Instant snooze presets — offset from now. */
  private static readonly INSTANT_PRESETS: Partial<
    Record<SnoozePreset, number>
  > = {
    "15min": 15 * 60 * 1000,
    "30min": 30 * 60 * 1000,
    "1hr": 60 * 60 * 1000,
    "2hr": 2 * 60 * 60 * 1000,
    "3hr": 3 * 60 * 60 * 1000,
  };

  /** Day-based presets — add N days, preserving the original due time. */
  private static readonly DAY_PRESETS: Partial<Record<SnoozePreset, number>> = {
    "1day": 1,
    "3day": 3,
    "7day": 7,
  };

  /**
   * Notify the manager whether the window is open.
   * When closed, the periodic check skips the callback if nothing changed.
   */
  public setWindowOpen(open: boolean) {
    this.windowOpen = open;
  }

  /**
   * Last custom snooze day count used in this session, or null if none yet.
   */
  public getLastCustomSnoozeDays(): number | null {
    return this.lastCustomSnoozeDays;
  }

  /**
   * Set callback for when tasks are updated
   */
  public setWindowCallback(callback: (tasks: TaskList) => void) {
    this.windowCallback = callback;
  }

  /**
   * Start background monitoring
   * @param startTimer - If false, only does initial check without starting the interval (mobile mode)
   */
  public async start(startTimer = true) {
    try {
      // Perform initial check
      await this.checkForDueTasks();

      // Set up periodic checks (every 2 minutes) — disabled on mobile
      if (startTimer) {
        this.checkInterval = setInterval(async () => {
          await this.checkForDueTasks();
        }, this.CHECK_INTERVAL_MS);
      }
    } catch (error) {
      console.error("[On-Deck] Failed to start background monitoring:", error);
      throw error;
    }
  }

  /**
   * Check for due tasks and update window
   */
  private async checkForDueTasks() {
    try {
      const result = await this.fetchDueTasks();
      const hasDueTasks = result.tasks.length > 0;
      const taskIds = new Set(result.tasks.map((t) => t.id));

      // Skip callback when window is closed and no new tasks appeared
      // (avoids settings reads + handleDesktopTaskUpdate overhead)
      if (!this.windowOpen && !hasDueTasks && this.lastCheckedTasks.size > 0) {
        this.lastCheckedTasks = taskIds;
        return;
      }

      // Notify window callback if set
      if (this.windowCallback) {
        this.windowCallback(result);
      }

      // Track last checked tasks
      this.lastCheckedTasks = taskIds;
    } catch (error) {
      console.error("[On-Deck] Error checking for due tasks:", error);
    }
  }

  /**
   * Fetch all due tasks (todo_due <= deadline, not completed)
   * Deadline = now + lookAheadDays (configurable)
   * Uses a single paginated search query with fields param to get todo_due directly.
   *
   * The due:19700201 term is a floor on todo_due (Joplin's due: filter means
   * "todo_due >= value"), so only todos with a real due date are returned.
   * order_by todo_due (ASC) delivers them most-overdue-first, so pagination
   * stops at the first row due after the deadline — every later row is further
   * in the future. This shrinks the fetch from the full todo list (~20 pages
   * for 2000+ todos) to the rows actually due (~1-3 pages).
   */
  private async fetchDueTasks(): Promise<TaskList> {
    const now = Date.now();

    // Read settings
    let lookAheadDays = 7;
    let showLookAhead = false;
    try {
      lookAheadDays =
        ((await joplin.settings.value("lookAheadDays")) as number) ?? 7;
      showLookAhead = (await joplin.settings.value("showLookAhead")) as boolean;
    } catch {
      // defaults: lookAheadDays=7, showLookAhead=false
    }

    // When showLookAhead is off, force lookAheadDays to 0 (only today/overdue)
    const effectiveDays = showLookAhead ? lookAheadDays : 0;
    const deadline = now + effectiveDays * 24 * 60 * 60 * 1000;

    try {
      const allTasks: Task[] = [];
      let page = 1;
      let hasMore = true;
      let terminatedEarly = false;
      let pagesFetched = 0;
      let rowsFetched = 0;
      const startedAt = Date.now();

      while (hasMore) {
        const searchResults = await joplin.data.get(["search"], {
          query: `type:todo iscompleted:0 due:19700201`,
          limit: 100,
          page,
          order_by: "todo_due",
          order_dir: "ASC",
          fields: "id,title,todo_due,parent_id,is_conflict,deleted_time",
        });
        pagesFetched++;
        const items = searchResults.items || [];

        for (const note of items) {
          rowsFetched++;
          if (note.todo_due > deadline) {
            // Rows arrive sorted by todo_due ASC: everything after this row
            // is due even later, so there is nothing left to fetch
            terminatedEarly = true;
            break;
          }
          if (note.todo_due > 0 && !note.deleted_time && !note.is_conflict) {
            allTasks.push({
              id: note.id,
              title: note.title,
              todo_due: note.todo_due,
              parent_id: note.parent_id,
              urgency: this.getUrgencyClass(note.todo_due, now),
            });
          }
        }

        if (terminatedEarly) break;
        hasMore = searchResults.has_more && items.length > 0;
        page++;
      }

      // Benchmark log — uncomment to profile search performance
      // (the counters above are kept so re-enabling is a single edit):
      // console.log(
      //   `[On-Deck] search: ${Date.now() - startedAt}ms, ${pagesFetched} page(s), ` +
      //     `${rowsFetched} rows${terminatedEarly ? " (early stop)" : ""}, ` +
      //     `${allTasks.length} due`
      // );

      allTasks.sort((a, b) => a.todo_due - b.todo_due);

      return { tasks: allTasks };
    } catch (error) {
      console.error("[On-Deck] Error fetching due tasks:", error);
      throw error;
    }
  }

  /**
   * Calculate urgency class for a task based on due date
   */
  private getUrgencyClass(todo_due: number, now: number): string {
    const diff = now - todo_due;
    const hours = Math.floor(diff / (60 * 60 * 1000));

    // Future task (not yet due)
    if (diff < 0) {
      return "upcoming";
    }
    // Overdue tasks
    if (hours > 24) {
      return "overdue-high";
    } else if (hours > 2) {
      return "overdue-medium";
    }
    return "overdue-low";
  }

  /**
   * Open a note in the editor
   */
  public async openNote(taskId: string) {
    try {
      await joplin.commands.execute("openNote", taskId);
    } catch (error) {
      console.error(`[On-Deck] Error opening note ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch the current todo_due for a task, or undefined on failure.
   */
  private async fetchTodoDue(taskId: string): Promise<number | undefined> {
    try {
      const noteResult = await joplin.data.get(["notes", taskId], {
        fields: "todo_due",
      });
      return noteResult.todo_due;
    } catch {
      return undefined;
    }
  }

  /**
   * Calculate the new due time for a snooze option.
   * Day-based presets and custom day values preserve the original due time.
   * @param snooze - The snooze preset or custom option
   * @param taskId - The task ID (needed to preserve the original due time)
   */
  public async calculateSnoozeTime(
    snooze: SnoozeOption,
    taskId: string,
  ): Promise<number> {
    const now = Date.now();

    if (typeof snooze !== "string") {
      // Custom snooze — days unit preserves the original due time
      if (snooze.unit === "days") {
        return this.calculateDayBasedDue(now, snooze.value, taskId);
      }
      const unitMap: Record<CustomSnooze["unit"], number> = {
        minutes: 60 * 1000,
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000,
      };
      return now + snooze.value * unitMap[snooze.unit];
    }

    const instantOffset = ReminderManager.INSTANT_PRESETS[snooze];
    if (instantOffset !== undefined) {
      return now + instantOffset;
    }

    const daysToAdd = ReminderManager.DAY_PRESETS[snooze];
    if (daysToAdd !== undefined) {
      return this.calculateDayBasedDue(now, daysToAdd, taskId);
    }

    // "tomorrow" — snooze until the configured time the next day
    const { hour, minute } = await this.getSnoozeTomorrowTime();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(hour, minute, 0, 0);
    return tomorrow.getTime();
  }

  /**
   * Snooze by a whole number of days, preserving the original due time.
   */
  private async calculateDayBasedDue(
    now: number,
    days: number,
    taskId: string,
  ): Promise<number> {
    const newDue = new Date(now);
    newDue.setDate(newDue.getDate() + days);
    const originalDue = await this.fetchTodoDue(taskId);
    if (originalDue) {
      const original = new Date(originalDue);
      newDue.setHours(original.getHours(), original.getMinutes(), 0, 0);
    }
    return newDue.getTime();
  }

  /**
   * The configured "Tomorrow at" hour and minute (default 9:00).
   */
  private async getSnoozeTomorrowTime(): Promise<{
    hour: number;
    minute: number;
  }> {
    let hour = 9;
    let minute = 0;
    try {
      const values = (await joplin.settings.values([
        "snoozeUntilTomorrowHour",
        "snoozeUntilTomorrowMinute",
      ])) as Record<string, number | null>;
      hour = values.snoozeUntilTomorrowHour ?? 9;
      minute = values.snoozeUntilTomorrowMinute ?? 0;
    } catch {
      // default 9:00
    }
    return { hour, minute };
  }

  /**
   * Core snooze logic shared by snoozeTask and snoozeTaskQuiet
   */
  private async snoozeTaskCore(
    taskId: string,
    snooze: SnoozeOption,
  ): Promise<void> {
    const newDueDate = await this.calculateSnoozeTime(snooze, taskId);

    await joplin.data.put(["notes", taskId], null, {
      todo_due: newDueDate,
    });

    // Remember the day count for the next custom snooze dropdown (session only)
    if (
      typeof snooze !== "string" &&
      snooze.unit === "days" &&
      snooze.value > 0
    ) {
      this.lastCustomSnoozeDays = snooze.value;
    }
  }

  /**
   * Snooze a task by updating its due date
   */
  public async snoozeTask(taskId: string, snooze: SnoozeOption) {
    try {
      await this.snoozeTaskCore(taskId, snooze);
      // Trigger immediate refresh
      await this.checkForDueTasks();
    } catch (error) {
      console.error(`[On-Deck] Error snoozing task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Snooze a task without triggering a full refresh (internal, used by snoozeTaskBulk)
   */
  private async snoozeTaskQuiet(taskId: string, snooze: SnoozeOption) {
    await this.snoozeTaskCore(taskId, snooze);
  }

  /**
   * Snooze multiple tasks — writes run in parallel batches of 50 and a
   * single refresh happens at the end (not per-task)
   */
  public async snoozeTaskBulk(taskIds: string[], snooze: SnoozeOption) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
      const batch = taskIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (taskId) => {
          try {
            await this.snoozeTaskQuiet(taskId, snooze);
          } catch (error) {
            console.error(`[On-Deck] Error snoozing task ${taskId}:`, error);
          }
        }),
      );
    }
    // Single refresh after all tasks are snoozed
    await this.checkForDueTasks();
  }

  /**
   * Get current due tasks
   */
  public async getDueTasks(): Promise<TaskList> {
    return this.fetchDueTasks();
  }
}
