import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import joplinMock from "./mocks/api";
import { ReminderManager } from "../src/ReminderManager";
import type { SnoozePreset } from "../src/types";

// Fixed clock: Saturday, May 30, 2026, 10:00 (local)
const FIXED = new Date(2026, 4, 30, 10, 0, 0).getTime();
// Original due time preserved by day-based snoozes: May 25, 14:30
const ORIGINAL_DUE = new Date(2026, 4, 25, 14, 30, 0).getTime();

describe("ReminderManager.calculateSnoozeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED });
    joplinMock.settings.values = vi.fn(async () => ({
      snoozeUntilTomorrowHour: 9,
      snoozeUntilTomorrowMinute: 0,
    }));
    joplinMock.data.get = vi.fn(async (target: string[]) =>
      target[0] === "notes"
        ? { todo_due: ORIGINAL_DUE }
        : { items: [], has_more: false },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("instant presets offset from now", async () => {
    const manager = new ReminderManager();
    const cases: Array<[SnoozePreset, number]> = [
      ["15min", 15 * 60 * 1000],
      ["30min", 30 * 60 * 1000],
      ["1hr", 60 * 60 * 1000],
      ["2hr", 2 * 60 * 60 * 1000],
      ["3hr", 3 * 60 * 60 * 1000],
    ];
    for (const [preset, offset] of cases) {
      expect(await manager.calculateSnoozeTime(preset, "t1")).toBe(
        FIXED + offset,
      );
    }
  });

  it("day-based presets add days and preserve the original due time (incl. month rollover)", async () => {
    const manager = new ReminderManager();
    // May 30 + 1 = May 31; + 3 = June 2; + 7 = June 6 (crosses month end)
    expect(await manager.calculateSnoozeTime("1day", "t1")).toBe(
      new Date(2026, 4, 31, 14, 30).getTime(),
    );
    expect(await manager.calculateSnoozeTime("3day", "t1")).toBe(
      new Date(2026, 5, 2, 14, 30).getTime(),
    );
    expect(await manager.calculateSnoozeTime("7day", "t1")).toBe(
      new Date(2026, 5, 6, 14, 30).getTime(),
    );
  });

  it("day-based presets fall back to the current time when the task has no due date", async () => {
    joplinMock.data.get = vi.fn(async () => ({ todo_due: undefined }));
    const manager = new ReminderManager();
    expect(await manager.calculateSnoozeTime("1day", "t1")).toBe(
      new Date(2026, 4, 31, 10, 0).getTime(),
    );
  });

  it('"tomorrow" snoozes until the configured time the next day', async () => {
    const manager = new ReminderManager();
    expect(await manager.calculateSnoozeTime("tomorrow", "t1")).toBe(
      new Date(2026, 4, 31, 9, 0).getTime(),
    );
  });

  it('"tomorrow" keeps zero-valued hour/minute settings (not clobbered to 9:00)', async () => {
    joplinMock.settings.values = vi.fn(async () => ({
      snoozeUntilTomorrowHour: 0,
      snoozeUntilTomorrowMinute: 0,
    }));
    const manager = new ReminderManager();
    expect(await manager.calculateSnoozeTime("tomorrow", "t1")).toBe(
      new Date(2026, 4, 31, 0, 0).getTime(),
    );
  });

  it("custom snoozes in minutes and hours offset from now", async () => {
    const manager = new ReminderManager();
    expect(
      await manager.calculateSnoozeTime({ value: 30, unit: "minutes" }, "t1"),
    ).toBe(FIXED + 30 * 60 * 1000);
    expect(
      await manager.calculateSnoozeTime({ value: 2, unit: "hours" }, "t1"),
    ).toBe(FIXED + 2 * 60 * 60 * 1000);
  });

  it("custom snooze in days preserves the original due time", async () => {
    const manager = new ReminderManager();
    // May 30 + 5 days = June 4
    expect(
      await manager.calculateSnoozeTime({ value: 5, unit: "days" }, "t1"),
    ).toBe(new Date(2026, 5, 4, 14, 30).getTime());
  });
});

describe("ReminderManager.snoozeTask", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED });
    joplinMock.data.put = vi.fn(async () => ({}));
    joplinMock.data.get = vi.fn(async (target: string[]) =>
      target[0] === "notes"
        ? { todo_due: ORIGINAL_DUE }
        : { items: [], has_more: false },
    );
    joplinMock.settings.value = vi.fn(async (key: string) =>
      key === "lookAheadDays" ? 7 : false,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the computed due date and triggers a single refresh", async () => {
    const manager = new ReminderManager();
    let refreshCount = 0;
    manager.setWindowCallback(() => {
      refreshCount += 1;
    });

    await manager.snoozeTask("t1", "15min");

    expect(joplinMock.data.put).toHaveBeenCalledTimes(1);
    expect(joplinMock.data.put).toHaveBeenCalledWith(["notes", "t1"], null, {
      todo_due: FIXED + 15 * 60 * 1000,
    });
    expect(refreshCount).toBe(1);
  });

  it("remembers custom day snoozes for the session but not other units", async () => {
    const manager = new ReminderManager();
    expect(manager.getLastCustomSnoozeDays()).toBeNull();

    await manager.snoozeTask("t1", { value: 5, unit: "days" });
    expect(manager.getLastCustomSnoozeDays()).toBe(5);

    const minutesManager = new ReminderManager();
    await minutesManager.snoozeTask("t1", { value: 90, unit: "minutes" });
    expect(minutesManager.getLastCustomSnoozeDays()).toBeNull();
  });
});

describe("ReminderManager.openNote", () => {
  it("delegates to the Joplin openNote command", async () => {
    joplinMock.commands.execute = vi.fn(async () => undefined);
    const manager = new ReminderManager();
    await manager.openNote("t42");
    expect(joplinMock.commands.execute).toHaveBeenCalledWith("openNote", "t42");
  });
});
