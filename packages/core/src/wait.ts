import { TimeoutError } from './errors.js';

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  message?: string;
}

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
