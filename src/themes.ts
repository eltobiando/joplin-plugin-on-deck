// Joplin's built-in theme palettes, resolved to the CSS custom properties
// the reminder UIs consume. Values are copied from
// joplin-src/packages/lib/themes/*.ts with Joplin's theme inheritance
// (dark-based themes spread the dark base) already applied, keeping only
// the keys the UI uses.
//
// Theme IDs match Joplin's Setting.THEME_* constants
// (joplin-src/packages/lib/models/Setting.ts): the global "theme" setting
// always holds the currently effective theme (auto-detect rewrites it at
// runtime), so reading it via joplin.settings.globalValues(["theme"])
// yields the theme Joplin is actually rendering.

export const JOPLIN_THEME_IDS = {
  light: 1,
  dark: 2,
  solarizedLight: 3,
  solarizedDark: 4,
  dracula: 5,
  nord: 6,
  aritimDark: 7,
  oledDark: 22,
} as const;

type Palette = Record<string, string>;

const light: Palette = {
  backgroundColor: "#ffffff",
  backgroundColor2: "#313640",
  backgroundColor3: "#F4F5F6",
  backgroundColor4: "#ffffff",
  backgroundColorHover3: "#CBDAF1",
  color: "#32373F",
  color2: "#ffffff",
  color3: "#627284",
  colorFaded: "#627184",
  colorError: "red",
  colorWarn: "rgb(228,86,0)",
  colorCorrect: "green",
  dividerColor: "#dddddd",
  selectedColor: "#e5e5e5",
  shadowColor: "rgba(0,0,0,0.15)",
  urlColor: "#155BDA",
  raisedBackgroundColor: "#e5e5e5",
  headerBackgroundColor: "#F0F0F0",
};

const dark: Palette = {
  backgroundColor: "#1D2024",
  backgroundColor2: "#181A1D",
  backgroundColor3: "#2E3138",
  backgroundColor4: "#1D2024",
  backgroundColorHover3: "#4E4E4E",
  color: "#dddddd",
  color2: "#ffffff",
  color3: "#dddddd",
  colorFaded: "#999999",
  colorError: "#ff4444",
  colorWarn: "#9A5B00",
  colorCorrect: "#72b972",
  dividerColor: "#555555",
  selectedColor: "#616161",
  shadowColor: "rgba(0,0,0,0.15)",
  urlColor: "rgb(166,166,255)",
  raisedBackgroundColor: "#474747",
  headerBackgroundColor: "#2D3136",
};

// Only the keys each theme overrides relative to its base are listed —
// mirroring how Joplin's theme files are written, so keeping these in sync
// with a Joplin release is a small diff against the base palettes above.
export const THEME_PALETTES: Record<number, Palette> = {
  [JOPLIN_THEME_IDS.light]: light,
  [JOPLIN_THEME_IDS.dark]: dark,
  [JOPLIN_THEME_IDS.solarizedLight]: {
    ...light,
    backgroundColor: "#fdf6e3",
    color: "#657b83",
    colorError: "#dc322f",
    colorWarn: "#cb4b16",
    colorFaded: "#839496",
    dividerColor: "#eee8d5",
    selectedColor: "#eee8d5",
    urlColor: "#268bd2",
    backgroundColor2: "#002b36",
    color2: "#eee8d5",
    raisedBackgroundColor: "#eee8d5",
  },
  [JOPLIN_THEME_IDS.solarizedDark]: {
    ...dark,
    backgroundColor: "#002b36",
    color: "#839496",
    colorError: "#dc322f",
    colorWarn: "#cb4b16",
    colorFaded: "#657b83",
    dividerColor: "#586e75",
    selectedColor: "#073642",
    urlColor: "#268bd2",
    backgroundColor2: "#073642",
    color2: "#eee8d5",
    backgroundColor3: "#012732",
    backgroundColorHover3: "#2aa19870",
    color3: "#93a1a1",
    backgroundColor4: "#073642",
    raisedBackgroundColor: "#073642",
  },
  [JOPLIN_THEME_IDS.dracula]: {
    ...dark,
    backgroundColor: "#282a36",
    color: "#f8f8f2",
    colorError: "#ff5555",
    colorWarn: "#a65a2e",
    colorFaded: "#6272a4",
    dividerColor: "#bd93f9",
    selectedColor: "#44475a",
    urlColor: "#8be9fd",
    backgroundColor2: "#21222C",
    color2: "#bd93f9",
    raisedBackgroundColor: "#44475a",
  },
  [JOPLIN_THEME_IDS.nord]: {
    ...dark,
    backgroundColor: "#2e3440",
    color: "#e5e9f0",
    colorError: "#bf616a",
    colorWarn: "#d08770",
    colorFaded: "#d8dee9",
    dividerColor: "#5e81ac",
    selectedColor: "#81a1c1",
    urlColor: "#88c0d0",
    backgroundColor2: "#434c5e",
    color2: "#88c0d0",
    raisedBackgroundColor: "#434c5e",
  },
  [JOPLIN_THEME_IDS.aritimDark]: {
    ...dark,
    backgroundColor: "#10151a",
    color: "#d3dae3",
    colorError: "#4a2608",
    colorWarn: "#d66500",
    colorFaded: "#666a73",
    dividerColor: "#141a21",
    selectedColor: "#2b5278",
    urlColor: "#5a95c5",
    backgroundColor2: "#141a21",
    color2: "#d3dae3",
    raisedBackgroundColor: "#2b5278",
  },
  [JOPLIN_THEME_IDS.oledDark]: {
    ...dark,
    backgroundColor: "#000000",
    colorFaded: "#777777",
    dividerColor: "#3D444E",
    urlColor: "rgb(166,166,255)",
    raisedBackgroundColor: "#0F2051",
  },
};

function toCssVarName(key: string): string {
  return `--joplin-${key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

/**
 * Build the `:root { --joplin-*: ... }` CSS block for a theme ID.
 *
 * The light theme (and unknown/missing IDs, which fall back to it) returns
 * an empty string: the reminder UIs' CSS uses the original hand-picked light
 * values as `var(--joplin-*, fallback)` defaults, so shipping no block keeps
 * the light look identical to how it always was, while Joplin's own light
 * palette only applies inside the Joplin app itself.
 */
export function themeCssForId(themeId: unknown): string {
  const id = typeof themeId === "number" ? themeId : JOPLIN_THEME_IDS.light;
  if (id === JOPLIN_THEME_IDS.light) return "";
  const palette = THEME_PALETTES[id];
  if (!palette) return "";
  const decls = Object.entries(palette).map(
    ([key, value]) => `${toCssVarName(key)}:${value};`,
  );
  return `:root{${decls.join("")}}`;
}
