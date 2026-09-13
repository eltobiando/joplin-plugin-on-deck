/**
 * Run async updates serially: each call waits for the previous one to finish
 * before starting, so overlapping invocations never interleave
 * (setInterval fires all accumulated callbacks at once after system resume).
 * A rejected update does not poison the chain — the caller receives the
 * rejection, but later updates still run.
 */
export function serialExecutor<A>(run: (arg: A) => Promise<void>) {
  let tail: Promise<void> = Promise.resolve();
  return (arg: A): Promise<void> => {
    const next = tail.then(() => run(arg));
    // Swallow the error for the chain so a failure can't break later updates
    tail = next.catch(() => {});
    return next;
  };
}
