# AGENTS.md

## Project Overview

**on-deck** is a Joplin plugin that shows a standalone window (desktop) or panel (mobile) with tasks that are due or overdue. It auto-opens when tasks need attention, auto-closes when all clear. Supports opening notes and snoozing tasks.

User has 2000+ todos — **performance matters**

## Build & Verify

```bash
npm run dist          # Full build (TypeScript compile + webpack bundle + .jpl archive)
npm test              # Unit tests (vitest) — tests/ dir, `api` aliased to tests/mocks/api.ts
npm run release       # Release: bump version, update CHANGELOG.md, commit, git tag
```

Tests live in `tests/` (outside `src/`, so `tsconfig.json` and webpack never touch them). The real `api` module only works inside Joplin's host, so vitest aliases it to `tests/mocks/api.ts` — a plain object of `vi.fn()` stubs that tests reconfigure per-test.

Build output lands in `publish/joplin-plugin-on-deck.jpl`. Run this before any commit touching source files.

## Architecture

```
src/
  index.ts              # Plugin entry — registration, settings, commands, window orchestration
  manifest.json         # Plugin identity & version (bumped by npm run release)
  types.ts              # Shared types: Task, SnoozePreset, IPC messages
  ReminderManager.ts    # Business logic: fetch, snooze, urgency scoring
  ReminderWindow.ts     # Window manager: open/close, postMessage IPC, position persistence
  serialExecutor.ts     # Shared helper: serialize async updates, failure-proof chain (unit tested)
  dialog/window/
    index.html          # Standalone window HTML (inline CSS, no framework)
    window.ts           # Window bootstrap: webviewApi shim, footer buttons, privacy overlay
    webview.ts          # UI rendering: task cards, snooze dropdown, relative time
  mobile-panel-html.ts  # Mobile panel HTML template (inline CSS, Joplin CSS vars)
  mobile-webview.ts     # Mobile panel UI: task cards, snooze dropdown (separate from desktop webview)
```

### Three files, two contexts

| File                       | Runs in             | Responsibility                                                          |
| -------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `ReminderWindow.ts`        | Plugin main process | `window.open()`, `window.addEventListener('message')`, message dispatch |
| `dialog/window/window.ts`  | Standalone window   | `webviewApi` shim (wraps `window.opener.postMessage`), footer buttons   |
| `dialog/window/webview.ts` | Standalone window   | Pure UI — renders task cards, snooze modal, listens for `updateTasks`   |

### IPC Flow

```
Plugin  --win.postMessage()-->  Window  --window.opener.postMessage()-->  Plugin
```

Messages are typed via `PluginToWindowMessage` and `WindowToPluginMessage` in `types.ts`.

## Key Conventions

- **Releases via `npm run release`** — `commit-and-tag-version` bumps `version` in `src/manifest.json` and `package.json` (feat → minor, fix → patch, breaking → major), updates `CHANGELOG.md`, commits `chore(release): X.Y.Z`, and tags `vX.Y.Z`. No manual per-commit version bumps. Run `npm run dist` after a release before shipping the `.jpl`
- **Build before commit** — run `npm run dist` to produce `publish/joplin-plugin-on-deck.jpl`
- **No React/Vue** — pure DOM manipulation with inline event handlers
- **No strict mode** — `tsconfig.json` does not set `strict` (defaults to off, generator style)
- **Target ES2017**, module CommonJS
- **Extra scripts** (`dialog/window/window.ts`, `dialog/window/webview.ts`, `mobile-webview.ts`) are compiled as `target: "web"` by webpack — they run in browser context, not Node
- **Snooze presets** — the `SnoozePreset` union in `types.ts` is the single source of truth, imported (type-only) by `ReminderManager.ts` (time mapping) and both webview UIs (labels). The mobile UI intentionally offers a different set (omits `3day`) — when adding a preset, keep the union, the manager's mapping, and the relevant UI label lists in sync
- **Window/webview types are shared** — `types.ts` is type-only, so web-target scripts use `import type { ... } from "…/types"` (erased at compile time, no runtime import)
- **Search-based query** — uses `joplin.data.get(['search'], { query: 'type:todo iscompleted:0', fields: '...' })` with pagination (never N+1)
- **Commit messages** — Conventional Commits: `feat:`, `fix:`, `perf:`, `refactor:`, `chore:` (lowercase, imperative, no trailing period). `feat:` and `fix:` drive the changelog and version bumps

## Joplin API Surface Used

- `joplin.plugins.register()` / `installationDir()`
- `joplin.settings.registerSection()` / `registerSettings()` / `value()` / `setValue()`
- `joplin.data.get()` (search with pagination) / `joplin.data.put()` (update todo fields)
- `joplin.commands.register()` / `execute('openNote', id)`
- `joplin.views.menuItems.create()` (View menu location)

Full API types are in `api/` (from generator-joplin).

## Nuances & Gotchas

- Window position is persisted via Joplin settings and validated against `screen` bounds on restore (handles disconnected monitors)
- Privacy overlay is shown only when `?auto=1` URL param is present (timer-triggered open)
- Cache-busting query param (`?t=${Date.now()}`) forces fresh load on each window open
- `is_todo` is an independent database column, not derived from `body`
- Joplin REST API silently ignores `filter` query param — use `search` endpoint with `fields` instead

## Test on Android Emulator

1. **Build** (see above).

2. **Push to emulator** (replace `$ANDROID_SDK_ROOT` if your SDK isn't in `~/.android`):

   ```bash
   $HOME/Android/Sdk/platform-tools/adb push publish/joplin-plugin-on-deck.jpl /sdcard/Download/
   ```

3. **Install in Joplin mobile**: Settings → Plugins → `+` → File → pick `joplin-plugin-on-deck.jpl` from Downloads.

4. **Open panel**: Tap the puzzle-piece icon → "On-Deck Reminders" tab.

### Useful ADB commands

```bash
$HOME/Android/Sdk/platform-tools/adb devices     # verify emulator is connected
$HOME/Android/Sdk/platform-tools/adb logcat      # view logs (filter with | grep On-Deck)
```
