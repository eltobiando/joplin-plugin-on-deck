import { describe, it, expect } from "vitest";
import { JOPLIN_THEME_IDS, THEME_PALETTES, themeCssForId } from "../src/themes";

describe("themes", () => {
  it("covers all 8 built-in Joplin theme IDs", () => {
    expect(
      Object.keys(THEME_PALETTES)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 22]);
    expect(JOPLIN_THEME_IDS).toEqual({
      light: 1,
      dark: 2,
      solarizedLight: 3,
      solarizedDark: 4,
      dracula: 5,
      nord: 6,
      aritimDark: 7,
      oledDark: 22,
    });
  });

  it("emits a :root block with dashed Joplin variable names", () => {
    const css = themeCssForId(JOPLIN_THEME_IDS.dark);
    expect(css.startsWith(":root{")).toBe(true);
    expect(css.endsWith("}")).toBe(true);
    expect(css).toContain("--joplin-background-color:#1D2024;");
    expect(css).toContain("--joplin-background-color3:#2E3138;");
    expect(css).toContain("--joplin-background-color-hover3:#4E4E4E;");
    expect(css).toContain("--joplin-color-faded:#999999;");
    expect(css).toContain("--joplin-divider-color:#555555;");
  });

  it("ships no CSS block for the light theme (keeps its original values)", () => {
    // The reminder UIs keep their original hand-picked light colors as
    // var() fallbacks, so the light theme must not be overridden by
    // Joplin's own light palette
    expect(themeCssForId(JOPLIN_THEME_IDS.light)).toBe("");
    // The light palette is still the source of truth in the map
    const light = THEME_PALETTES[JOPLIN_THEME_IDS.light];
    expect(light.backgroundColor).toBe("#ffffff");
    expect(light.backgroundColor3).toBe("#F4F5F6");
    expect(light.backgroundColorHover3).toBe("#CBDAF1");
    expect(light.colorFaded).toBe("#627184");
    expect(light.dividerColor).toBe("#dddddd");
  });

  it("carries the right base colors per theme", () => {
    expect(themeCssForId(JOPLIN_THEME_IDS.dark)).toContain(
      "--joplin-background-color:#1D2024;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.oledDark)).toContain(
      "--joplin-background-color:#000000;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.solarizedLight)).toContain(
      "--joplin-background-color:#fdf6e3;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.solarizedDark)).toContain(
      "--joplin-background-color:#002b36;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.dracula)).toContain(
      "--joplin-background-color:#282a36;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.nord)).toContain(
      "--joplin-background-color:#2e3440;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.aritimDark)).toContain(
      "--joplin-background-color:#10151a;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.nord)).toContain(
      "--joplin-url-color:#88c0d0;",
    );
  });

  it("dark-based themes inherit dark values they do not override", () => {
    // dracula and oledDark do not override backgroundColor3 or colorCorrect
    // -> the dark base values must win
    expect(themeCssForId(JOPLIN_THEME_IDS.dracula)).toContain(
      "--joplin-background-color3:#2E3138;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.dracula)).toContain(
      "--joplin-color-correct:#72b972;",
    );
    expect(themeCssForId(JOPLIN_THEME_IDS.oledDark)).toContain(
      "--joplin-color-correct:#72b972;",
    );
  });

  it("falls back to the light look (no block) for unknown or missing IDs", () => {
    expect(themeCssForId(999)).toBe("");
    expect(themeCssForId(undefined)).toBe("");
    expect(themeCssForId(null)).toBe("");
    expect(themeCssForId("dark")).toBe("");
  });

  it("every themed (non-light) palette emits a balanced :root block", () => {
    for (const id of Object.keys(THEME_PALETTES)) {
      const themeId = Number(id);
      if (themeId === JOPLIN_THEME_IDS.light) continue; // ships no block
      const css = themeCssForId(themeId);
      const palette = THEME_PALETTES[themeId];
      expect(css.split("{").length).toBe(2);
      expect(css.split("}").length).toBe(2);
      expect(css.split("--joplin-").length - 1).toBe(
        Object.keys(palette).length,
      );
    }
  });

  it("every palette contains only non-empty values", () => {
    for (const id of Object.keys(THEME_PALETTES)) {
      for (const value of Object.values(THEME_PALETTES[Number(id)])) {
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
