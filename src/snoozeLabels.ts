// Shared snooze preset + label logic, used by the desktop window, the mobile
// panel, and ReminderManager. Web-safe: no Node or Joplin imports (both
// webview bundles run with webpack target:"web").
import type { SnoozePreset } from "./types";

/** Instant snooze presets — offset from now (ms). */
export const INSTANT_PRESET_OFFSETS: Partial<Record<SnoozePreset, number>> = {
  "15min": 15 * 60 * 1000,
  "30min": 30 * 60 * 1000,
  "1hr": 60 * 60 * 1000,
  "2hr": 2 * 60 * 60 * 1000,
  "3hr": 3 * 60 * 60 * 1000,
};

/** Day-based presets — add N days, preserving the original due time. */
export const DAY_PRESET_DAYS: Partial<Record<SnoozePreset, number>> = {
  "1day": 1,
  "3day": 3,
  "7day": 7,
};

// English weekday names — the fallback for localized names when the runtime
// cannot resolve the requested locale.
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Localized weekday name for a date, following Joplin's configured `locale`
 * (e.g. "de_DE" → "Samstag", "en_GB" → "Saturday"). Joplin stores the locale
 * in underscore form; Intl wants BCP-47 (hyphens), so we normalize `_` → `-`.
 * Returns the English name for an empty locale or a tag the runtime can't
 * resolve.
 */
export function weekdayName(date: Date, locale: string = "en"): string {
  const fallback = WEEKDAY_NAMES[date.getDay()];
  const tag = locale.trim().replace(/_/g, "-");
  if (!tag) return fallback;
  try {
    return new Intl.DateTimeFormat(tag, { weekday: "long" }).format(date);
  } catch {
    return fallback;
  }
}

/** moment-style tokens (a subset) for a date. */
export function dateTimeTokens(d: Date): Record<string, string> {
  return {
    YYYY: `${d.getFullYear()}`,
    YY: `${d.getFullYear()}`.slice(-2),
    MM: `${d.getMonth() + 1}`.padStart(2, "0"),
    DD: `${d.getDate()}`.padStart(2, "0"),
    HH: `${d.getHours()}`.padStart(2, "0"),
    h: `${d.getHours() % 12 || 12}`,
    mm: `${d.getMinutes()}`.padStart(2, "0"),
    A: d.getHours() >= 12 ? "PM" : "AM",
  };
}

/** Replace moment-style tokens in a format string (Joplin date/time formats). */
export function replaceTokens(
  format: string,
  tokens: Record<string, string>,
): string {
  return format.replace(/YYYY|YY|MM|DD|HH|h|mm|A/g, (m) => tokens[m] ?? m);
}

/** Format clock time only using a Joplin time format (e.g. "12:00"). */
export function formatClockTime(timestamp: number, timeFormat: string): string {
  return replaceTokens(timeFormat, dateTimeTokens(new Date(timestamp)));
}

/**
 * Compact target for day presets: `<day>. <time> <weekday>` (e.g. "19. 14:30
 * Saturday"), using Joplin's time format. Day of month only — the weekday
 * disambiguates the month, so the month and year are omitted. The day is
 * suffixed with a dot: Joplin's configured date format (moment tokens such as
 * DD/MM/YYYY) carries no locale, so there is no locale-specific ordinal to
 * follow — the dot (German/European convention) is the simple default. The
 * weekday name follows Joplin's configured `locale`.
 */
export function formatDayTarget(
  timestamp: number,
  timeFormat: string,
  locale: string = "en",
): string {
  const d = new Date(timestamp);
  const day = d.getDate().toString().padStart(2, "0");
  return `${day}. ${formatClockTime(timestamp, timeFormat)} ${weekdayName(
    d,
    locale,
  )}`;
}

/**
 * Target time (ms) for a snooze preset — mirrors
 * ReminderManager.calculateSnoozeTime. Instant presets are now + offset. Day
 * presets land on now + N days at the task's original clock time (null when
 * there is no single task due time, e.g. bulk mode). "tomorrow" returns null
 * (it uses the configured hour:minute, shown in the preset name).
 */
export function presetTargetTime(
  now: number,
  preset: SnoozePreset,
  taskDue: number | null,
): number | null {
  const offset = INSTANT_PRESET_OFFSETS[preset];
  if (offset !== undefined) return now + offset;

  const days = DAY_PRESET_DAYS[preset];
  if (days !== undefined) {
    if (taskDue === null) return null;
    const target = new Date(now + days * 24 * 60 * 60 * 1000);
    const src = new Date(taskDue);
    target.setHours(src.getHours(), src.getMinutes(), 0, 0);
    return target.getTime();
  }

  return null; // "tomorrow"
}
