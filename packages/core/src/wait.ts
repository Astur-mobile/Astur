import { TimeoutError } from './errors.js';

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  message?: string;
}

/**
 * Polls `predicate` until it returns a truthy value or `timeout` elapses.
 *
 * `timeout` bounds when a *new* attempt may start — it does not interrupt an
 * attempt already in flight, so every predicate is always allowed to finish.
 * That keeps a slow-but-successful probe from being thrown away, but it means
 * the effective wall-clock ceiling is `timeout + <slowest single predicate>`.
 *
 * Drivers must therefore bound their own I/O. A predicate with no internal
 * deadline turns a short `timeout` into a silent hang rather than a timeout
 * error — a retry loop that can block for minutes makes `{ timeout: 400 }`
 * meaningless. See `FlutterVmService.evaluateStringStable` for the pattern:
 * a wall-clock budget threaded down into each request.
 */
export async function waitFor<T>(
  predicate: () => Promise<T | undefined | false | null>,
  options: WaitOptions = {}
): Promise<T> {
  const timeout = options.timeout ?? 10_000;
  const interval = options.interval ?? 250;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt <= timeout) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(interval);
  }

  throw new TimeoutError(options.message ?? `Timed out after ${timeout} ms`, { lastError });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
