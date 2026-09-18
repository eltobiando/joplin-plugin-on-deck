// Unit tests for the shared snooze label + target-time helpers
// (src/snoozeLabels.ts). Pure functions — no DOM or Joplin API needed.
import { describe, it, expect } from "vitest";
import {
  INSTANT_PRESET_OFFSETS,
  DAY_PRESET_DAYS,
  replaceTokens,
  formatClockTime,
  formatDayTarget,
  presetTargetTime,
  weekdayName,
} from "../src/snoozeLabels";

// Deterministic reference: local 2026-09-18 09:00 (a Friday)
const NOW = new Date(2026, 8, 18, 9, 0, 0).getTime();

describe("snoozeLabels", () => {
  describe("preset maps", () => {
    it("instant presets are offsets from now", () => {
      expect(INSTANT_PRESET_OFFSETS["15min"]).toBe(15 * 60 * 1000);
      expect(INSTANT_PRESET_OFFSETS["30min"]).toBe(30 * 60 * 1000);
      expect(INSTANT_PRESET_OFFSETS["1hr"]).toBe(60 * 60 * 1000);
      expect(INSTANT_PRESET_OFFSETS["2hr"]).toBe(2 * 60 * 60 * 1000);
      expect(INSTANT_PRESET_OFFSETS["3hr"]).toBe(3 * 60 * 60 * 1000);
      expect(INSTANT_PRESET_OFFSETS["tomorrow"]).toBeUndefined();
      expect(INSTANT_PRESET_OFFSETS["1day"]).toBeUndefined();
    });

    it("day presets are day counts", () => {
      expect(DAY_PRESET_DAYS["1day"]).toBe(1);
      expect(DAY_PRESET_DAYS["3day"]).toBe(3);
      expect(DAY_PRESET_DAYS["7day"]).toBe(7);
      expect(DAY_PRESET_DAYS["1hr"]).toBeUndefined();
      expect(DAY_PRESET_DAYS["tomorrow"]).toBeUndefined();
    });
  });

  describe("formatClockTime", () => {
    it("renders a 24h time format", () => {
      const ts = new Date(2026, 8, 18, 12, 5).getTime(); // 12:05
      expect(formatClockTime(ts, "HH:mm")).toBe("12:05");
    });

    it("renders a 12h time format with AM/PM", () => {
      const noon = new Date(2026, 8, 18, 12, 5).getTime(); // 12:05
      const morning = new Date(2026, 8, 18, 9, 5).getTime(); // 09:05
      expect(formatClockTime(noon, "h:mm A")).toBe("12:05 PM");
      expect(formatClockTime(morning, "h:mm A")).toBe("9:05 AM");
    });
  });

  describe("formatDayTarget", () => {
    it("is day, time, weekday — no month or year", () => {
      // 2026-09-19 is a Saturday
      const ts = new Date(2026, 8, 19, 14, 30).getTime();
      expect(formatDayTarget(ts, "HH:mm")).toBe("19. 14:30 Saturday");
    });

    it("pads single-digit days and respects the time format", () => {
      // 2026-09-05 is a Saturday
      const ts = new Date(2026, 8, 5, 9, 5).getTime();
      expect(formatDayTarget(ts, "h:mm A")).toBe("05. 9:05 AM Saturday");
    });

    it("localizes the weekday from Joplin's configured locale", () => {
      const ts = new Date(2026, 8, 19, 14, 30).getTime(); // Saturday
      expect(formatDayTarget(ts, "HH:mm", "de_DE")).toBe("19. 14:30 Samstag");
      expect(formatDayTarget(ts, "HH:mm", "fr_FR")).toBe("19. 14:30 samedi");
    });
  });

  describe("weekdayName", () => {
    // 2026-09-19 is a Saturday
    const saturday = new Date(2026, 8, 19);

    it("localizes from Joplin's underscore locale", () => {
      expect(weekdayName(saturday, "de_DE")).toBe("Samstag");
      expect(weekdayName(saturday, "fr_FR")).toBe("samedi");
      expect(weekdayName(saturday, "en_GB")).toBe("Saturday");
    });

    it("accepts BCP-47 hyphens and defaults to English", () => {
      expect(weekdayName(saturday, "de-DE")).toBe("Samstag");
      expect(weekdayName(saturday, "en")).toBe("Saturday");
      expect(weekdayName(saturday)).toBe("Saturday");
    });

    it("falls back to English for empty or unresolvable locales", () => {
      expect(weekdayName(saturday, "")).toBe("Saturday");
      expect(weekdayName(saturday, "xx_XX_!!")).toBe("Saturday");
    });
  });

  describe("replaceTokens", () => {
    it("replaces known tokens and leaves other text untouched", () => {
      const tokens = { DD: "19", MM: "09", YYYY: "2026", HH: "14", mm: "30" };
      expect(replaceTokens("DD-MM-YYYY HH:mm", tokens)).toBe(
        "19-09-2026 14:30",
      );
    });
  });

  describe("presetTargetTime", () => {
    it("instant presets are now + offset", () => {
      expect(presetTargetTime(NOW, "15min", null)).toBe(NOW + 15 * 60 * 1000);
      expect(presetTargetTime(NOW, "3hr", null)).toBe(NOW + 3 * 60 * 60 * 1000);
    });

    it("day presets land on now + N days at the task's original clock time", () => {
      const taskDue = new Date(2026, 8, 10, 23, 13).getTime();
      const target = presetTargetTime(NOW, "1day", taskDue);
      expect(target).not.toBeNull();
      const d = new Date(target!);
      expect(d.getDate()).toBe(19); // 2026-09-18 + 1 day
      expect(d.getHours()).toBe(23);
      expect(d.getMinutes()).toBe(13);
    });

    it("day presets are null without a task due time (bulk mode)", () => {
      expect(presetTargetTime(NOW, "1day", null)).toBeNull();
      expect(presetTargetTime(NOW, "7day", null)).toBeNull();
    });

    it('"tomorrow" is null (its configured hour:minute is shown in the name)', () => {
      expect(presetTargetTime(NOW, "tomorrow", NOW)).toBeNull();
    });
  });
});
