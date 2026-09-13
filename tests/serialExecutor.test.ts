import { describe, it, expect, vi } from "vitest";
import { serialExecutor } from "../src/serialExecutor";

describe("serialExecutor", () => {
  it("serializes overlapping calls: the second starts only after the first completes", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const run = vi.fn(async (arg: string) => {
      order.push(`start-${arg}`);
      if (arg === "1") await gate; // first run stays in flight
      order.push(`end-${arg}`);
    });

    const execute = serialExecutor(run);
    const p1 = execute("1");
    const p2 = execute("2"); // overlapping call

    // Yield to the microtask queue: the first run started and is in flight
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["start-1"]);

    releaseFirst!();
    await Promise.all([p1, p2]);

    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("a rejected update does not poison the chain: the caller gets the rejection and the next update still runs", async () => {
    const calls: string[] = [];
    const run = vi.fn(async (arg: string) => {
      calls.push(arg);
      if (arg === "a") throw new Error("transient failure");
    });

    const execute = serialExecutor(run);
    const p1 = execute("a");
    const p2 = execute("b");

    // The first caller still receives the rejection
    const err = await p1.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);

    // Pinned on the chain, not on any caller-side catch: if one rejected
    // update poisoned tail, p2 itself would reject and this await would fail
    await p2;
    expect(calls).toEqual(["a", "b"]);
  });
});
