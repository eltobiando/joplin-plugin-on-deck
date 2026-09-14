import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import joplinMock from "./mocks/api";
import { ReminderManager } from "../src/ReminderManager";
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  ReminderWindow,
} from "../src/ReminderWindow";
import type { TaskList, WindowPosition } from "../src/types";

// Fake window returned by window.open()
const winStub = {
  closed: false,
  outerWidth: 620,
  outerHeight: 500,
  screenX: 100,
  screenY: 100,
  postMessage: vi.fn(),
  close: () => {
    winStub.closed = true;
  },
};

// When true, the next window.open() returns null (simulated pop-up blocker)
let blockNextOpen = false;

// Stand-in for the global window object provided by Joplin's host
const windowStub = {
  listener: null as ((event: { data: unknown }) => void) | null,
  screen: {
    availLeft: 0,
    availTop: 0,
    availWidth: 1920,
    availHeight: 1080,
  },
  open: vi.fn(() => (blockNextOpen ? null : winStub)),
  addEventListener: vi.fn(
    (type: string, handler: (event: { data: unknown }) => void) => {
      if (type === "message") windowStub.listener = handler;
    },
  ),
  removeEventListener: vi.fn(
    (type: string, handler: (event: { data: unknown }) => void) => {
      if (type === "message" && windowStub.listener === handler)
        windowStub.listener = null;
    },
  ),
};

// What the webview's webviewApi.postMessage would deliver to the listener
function emitFromWebview(message: Record<string, unknown>) {
  windowStub.listener?.({ data: { message } });
}

// Yield to the microtask queue so the (never clock-advanced) open() promise
// progresses through its awaits. Plain awaits, never setTimeout — the latter
// would deadlock under fake timers.
async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const taskList: TaskList = {
  tasks: [
    {
      id: "t1",
      title: "Task 1",
      todo_due: 1700000000000,
      parent_id: "p1",
      urgency: "overdue-low",
    },
  ],
};

function assertUpdateTasksSentOnce() {
  expect(winStub.postMessage).toHaveBeenCalledTimes(1);
  expect(
    (winStub.postMessage.mock.calls[0][0] as { message: unknown }).message,
  ).toMatchObject({ type: "updateTasks", tasks: taskList });
}

let warnSpy: ReturnType<typeof vi.spyOn>;

// Shared stub/mock reset for all describes in this file
function resetStubs() {
  vi.useFakeTimers();
  (globalThis as any).window = windowStub;
  if (typeof (globalThis as any).navigator?.userAgent !== "string") {
    (globalThis as any).navigator = { userAgent: "on-deck-test" };
  }
  blockNextOpen = false;
  winStub.closed = false;
  winStub.postMessage.mockClear();
  windowStub.open.mockClear();
  windowStub.addEventListener.mockClear();
  windowStub.removeEventListener.mockClear();
  windowStub.listener = null;
  joplinMock.plugins.installationDir = vi.fn(async () => "/tmp/on-deck");
  joplinMock.settings.value = vi.fn(async (key: string) =>
    key === "showLookAhead" ? false : key === "snoozeUntilTomorrowHour" ? 9 : 0,
  );
  joplinMock.settings.globalValues = vi.fn(async () => ["DD/MM/YYYY", "HH:mm"]);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
}

// open() + ready handshake as one step for the message-handling tests
async function openWindow(rw: ReminderWindow, savedPosition?: WindowPosition) {
  const p = rw.open(savedPosition, false, taskList);
  await drainMicrotasks();
  emitFromWebview({ type: "ready" });
  await vi.advanceTimersByTimeAsync(200);
  return p;
}

describe("ReminderWindow.open ready handshake", () => {
  beforeEach(() => {
    resetStubs();
  });

  afterEach(() => {
    vi.useRealTimers();
    warnSpy.mockRestore();
  });

  it("resolves via the ready signal (not the 3s fallback) and sends tasks once", async () => {
    const rw = new ReminderWindow(new ReminderManager());
    const p = rw.open(undefined, false, taskList);

    // open() must reach setupMessageListener() without any clock advance
    await drainMicrotasks();
    expect(windowStub.listener).not.toBeNull();

    emitFromWebview({ type: "ready" });
    await vi.advanceTimersByTimeAsync(200);

    let settled = false;
    p.then(() => {
      settled = true;
    });
    await drainMicrotasks();
    // Red if open() could only settle via the 3s fallback
    expect(settled).toBe(true);

    const sent = await p;
    expect(sent).toBe(taskList);
    // No clock was advanced past 200ms, so the 3s fallback cannot have fired
    expect(warnSpy).not.toHaveBeenCalled();
    assertUpdateTasksSentOnce();
  });

  it("falls back after 3s when the webview never signals ready, and still sends tasks", async () => {
    const rw = new ReminderWindow(new ReminderManager());
    const p = rw.open(undefined, false, taskList);
    await drainMicrotasks();
    expect(windowStub.listener).not.toBeNull();

    // No ready signal — the 3s fallback must carry the open through
    await vi.advanceTimersByTimeAsync(3100);

    let settled = false;
    p.then(() => {
      settled = true;
    });
    await drainMicrotasks();
    // Red if the fallback timer was removed
    expect(settled).toBe(true);

    const sent = await p;
    expect(sent).toBe(taskList);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    assertUpdateTasksSentOnce();
  });

  it("close() releases a pending ready-wait so open() settles", async () => {
    const rw = new ReminderWindow(new ReminderManager());
    const p = rw.open(undefined, false, taskList);
    await drainMicrotasks();
    expect(windowStub.listener).not.toBeNull();

    await rw.close();

    let settled = false;
    p.then(() => {
      settled = true;
    });
    await drainMicrotasks();
    // Red if close() no longer releases the pending ready-wait
    expect(settled).toBe(true);

    // The window was closed before tasks could be sent
    expect(winStub.postMessage).not.toHaveBeenCalled();
  });

  it("closes the window when the post-ready task fetch fails (no orphan)", async () => {
    // Manual-open path: no initialTasks, so open() fetches inside and the
    // search query rejects with a transient data-API failure
    joplinMock.data.get = vi.fn(async () => {
      throw new Error("transient data-API failure");
    });

    const rw = new ReminderWindow(new ReminderManager());
    const p = rw.open(undefined, false);
    await drainMicrotasks();
    expect(windowStub.listener).not.toBeNull();
    emitFromWebview({ type: "ready" });

    await expect(p).rejects.toThrow("transient data-API failure");
    // The window must actually close — otherwise it sits on
    // "Loading tasks..." forever and the next open spawns a second window
    expect(winStub.closed).toBe(true);
    expect(winStub.postMessage).not.toHaveBeenCalled();
  });

  it("the pop-up-blocker arm rejects without touching a (nonexistent) window", async () => {
    blockNextOpen = true;
    const rw = new ReminderWindow(new ReminderManager());
    await expect(rw.open(undefined, false)).rejects.toThrow("Pop-up blocker");
    // No window was ever created; the conditional close must be a no-op
    expect(winStub.closed).toBe(false);
  });
});

describe("ReminderWindow message handling, settings cache and position", () => {
  beforeEach(() => {
    resetStubs();
  });

  afterEach(() => {
    vi.useRealTimers();
    warnSpy.mockRestore();
  });

  it("caches settings for 30s and re-reads them after expiry", async () => {
    const rw = new ReminderWindow(new ReminderManager());
    await openWindow(rw);
    await rw.sendTasks(taskList);
    const readsAfterFirst = joplinMock.settings.value.mock.calls.length;

    // Within the TTL: no new settings reads
    await rw.sendTasks(taskList);
    expect(joplinMock.settings.value).toHaveBeenCalledTimes(readsAfterFirst);

    // After the 30s TTL: re-read
    await vi.advanceTimersByTimeAsync(31000);
    await rw.sendTasks(taskList);
    expect(joplinMock.settings.value.mock.calls.length).toBeGreaterThan(
      readsAfterFirst,
    );

    // The payload carries the global date/time formats
    const last = winStub.postMessage.mock.calls.at(-1)![0] as {
      message: any;
    };
    expect(last.message).toMatchObject({
      type: "updateTasks",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "HH:mm",
    });
  });

  it("toggleLookAhead flips the setting, invalidates the cache, and sends the new flag", async () => {
    let stored = false;
    joplinMock.settings.value = vi.fn(async (key: string) =>
      key === "showLookAhead"
        ? stored
        : key === "snoozeUntilTomorrowHour"
          ? 9
          : 0,
    );
    joplinMock.settings.setValue = vi.fn(
      async (_key: string, value: unknown) => {
        stored = value as boolean;
      },
    );
    joplinMock.data.get = vi.fn(async () => ({ items: [], has_more: false }));

    const rw = new ReminderWindow(new ReminderManager());
    await openWindow(rw);
    const readsBefore = joplinMock.settings.value.mock.calls.length;

    emitFromWebview({ type: "toggleLookAhead" });
    await vi.advanceTimersByTimeAsync(200);
    await drainMicrotasks();

    expect(joplinMock.settings.setValue).toHaveBeenCalledWith(
      "showLookAhead",
      true,
    );
    // The cache is invalidated despite being well within the TTL
    expect(joplinMock.settings.value.mock.calls.length).toBeGreaterThan(
      readsBefore,
    );
    const last = winStub.postMessage.mock.calls.at(-1)![0] as {
      message: any;
    };
    expect(last.message).toMatchObject({
      type: "updateTasks",
      showLookAhead: true,
    });
  });

  it("restores an on-screen saved position and centers off-screen or degenerate ones", async () => {
    const rw = new ReminderWindow(new ReminderManager());

    await openWindow(rw, { x: 100, y: 100, width: 620, height: 500 });
    await rw.close();
    winStub.closed = false;

    await openWindow(rw, { x: -3000, y: -3000, width: 620, height: 500 });
    await rw.close();
    winStub.closed = false;

    await openWindow(rw, { x: 100, y: 100, width: 0, height: 0 });

    const features = windowStub.open.mock.calls.map((c) => c[2] as string);
    expect(features[0]).toContain("left=100");
    expect(features[0]).toContain("top=100");
    // Off-screen (disconnected monitor): position dropped, centered
    expect(features[1]).not.toContain("left=");
    expect(features[1]).not.toContain("top=");
    // Degenerate (locked-screen) dimensions: replaced by the defaults
    expect(features[2]).toContain(`width=${DEFAULT_WINDOW_WIDTH}`);
    expect(features[2]).toContain(`height=${DEFAULT_WINDOW_HEIGHT}`);
  });

  it("routes openNote / snoozeTask / refresh / requestSettings to the manager and the window", async () => {
    joplinMock.data.get = vi.fn(async (target: string[]) =>
      target[0] === "search" ? { items: [], has_more: false } : {},
    );
    joplinMock.data.put = vi.fn(async () => ({}));
    joplinMock.commands.execute = vi.fn(async () => undefined);

    const rw = new ReminderWindow(new ReminderManager());
    await openWindow(rw);

    emitFromWebview({ type: "openNote", taskId: "t9" });
    await drainMicrotasks();
    expect(joplinMock.commands.execute).toHaveBeenCalledWith("openNote", "t9");

    const now = Date.now();
    emitFromWebview({ type: "snoozeTask", taskId: "t1", snooze: "15min" });
    await vi.advanceTimersByTimeAsync(200);
    await drainMicrotasks();
    expect(joplinMock.data.put).toHaveBeenCalledWith(["notes", "t1"], null, {
      todo_due: now + 15 * 60 * 1000,
    });

    emitFromWebview({ type: "refresh" });
    await vi.advanceTimersByTimeAsync(200);
    const lastPost = winStub.postMessage.mock.calls.at(-1)![0] as {
      message: any;
    };
    expect(lastPost.message).toMatchObject({
      type: "updateTasks",
      tasks: { tasks: [] },
    });

    emitFromWebview({ type: "requestSettings" });
    // Full async flush — the handler may take several await hops
    // (a cold settings cache re-reads values before posting)
    await vi.advanceTimersByTimeAsync(200);
    const settingsPost = winStub.postMessage.mock.calls.at(-1)![0] as {
      message: any;
    };
    expect(settingsPost.message).toMatchObject({
      type: "settingsUpdated",
      snoozeUntilTomorrowHour: 9,
      snoozeUntilTomorrowMinute: 0,
      lastCustomSnoozeDays: null,
    });
  });

  it("windowClosing saves the reported position and detaches the listener", async () => {
    const positions: WindowPosition[] = [];
    let closingCalls = 0;
    const rw = new ReminderWindow(new ReminderManager());
    rw.setPositionCallback((p) => positions.push(p));
    rw.setWindowClosingCallback(() => {
      closingCalls += 1;
    });

    await openWindow(rw);
    const reportsBefore = positions.length; // sendTasks during open already reported one
    emitFromWebview({
      type: "windowClosing",
      x: 50,
      y: 60,
      width: 640,
      height: 520,
    });
    await drainMicrotasks();

    expect(positions.at(-1)).toEqual({ x: 50, y: 60, width: 640, height: 520 });
    expect(positions.length).toBe(reportsBefore + 1);
    expect(closingCalls).toBe(1);
    // The listener is removed when the window was closed via the X button
    expect(windowStub.listener).toBeNull();
  });

  it("windowClosing ignores zero-dimension positions (locked screen)", async () => {
    const positions: WindowPosition[] = [];
    let closingCalls = 0;
    const rw = new ReminderWindow(new ReminderManager());
    rw.setPositionCallback((p) => positions.push(p));
    rw.setWindowClosingCallback(() => {
      closingCalls += 1;
    });

    await openWindow(rw);
    const reportsBefore = positions.length; // sendTasks during open
    emitFromWebview({ type: "windowClosing", x: 0, y: 0, width: 0, height: 0 });
    await drainMicrotasks();

    // The zero-dimension report must not reach the position callback
    expect(positions).toHaveLength(reportsBefore);
    expect(closingCalls).toBe(0);
  });
});
