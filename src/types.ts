// Task data structure
export interface Task {
  id: string;
  title: string;
  todo_due: number; // Timestamp in milliseconds
  parent_id?: string; // Parent notebook/folder
  is_conflict?: boolean; // Is this a conflicted copy?
  deleted_time?: number; // If in trash
  urgency?: string; // CSS urgency class (computed by ReminderManager)
}

// Window position for persistence
export interface WindowPosition {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
}

// Task list
export interface TaskList {
  tasks: Task[];
}

// Snooze options
export type SnoozePreset =
  | "15min"
  | "30min"
  | "1hr"
  | "2hr"
  | "3hr"
  | "tomorrow"
  | "1day"
  | "3day"
  | "7day";

export interface CustomSnooze {
  value: number;
  unit: "minutes" | "hours" | "days";
}

export type SnoozeOption = SnoozePreset | CustomSnooze;

// Messages from plugin to window
export type PluginToWindowMessage =
  | {
      type: "updateTasks";
      tasks: TaskList;
      showLookAhead: boolean;
      snoozeUntilTomorrowHour: number;
      snoozeUntilTomorrowMinute: number;
      lastCustomSnoozeDays: number | null;
      dateFormat?: string;
      timeFormat?: string;
      locale?: string;
    }
  | {
      type: "settingsUpdated";
      snoozeUntilTomorrowHour: number;
      snoozeUntilTomorrowMinute: number;
      lastCustomSnoozeDays: number | null;
    };

// Messages from window to plugin
export type WindowToPluginMessage =
  | { type: "ready" }
  | { type: "heartbeat" }
  | { type: "openNote"; taskId: string }
  | { type: "snoozeTask"; taskId: string; snooze: SnoozeOption }
  | { type: "bulkSnooze"; taskIds: string[]; snooze: SnoozeOption }
  | { type: "refresh" }
  | { type: "toggleLookAhead" }
  | { type: "requestSettings" }
  | {
      type: "windowClosing";
      x: number;
      y: number;
      width: number;
      height: number;
    };
