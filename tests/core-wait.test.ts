import { describe, expect, it } from 'vitest';
import { TimeoutError, waitFor } from '@astur-mobile/core';

describe('waitFor', () => {
  it('resolves once the predicate returns a truthy value', async () => {
    let attempts = 0;

    const value = await waitFor(
      async () => {
        attempts += 1;
        return attempts === 3 ? 'ready' : undefined;
      },
      { timeout: 100, interval: 1 }
    );

    expect(value).toBe('ready');
    expect(attempts).toBe(3);
  });

  it('lets an in-flight predicate finish rather than interrupting it', async () => {
    // Pins the contract that makes driver-side deadlines mandatory: `timeout`
    // gates when a NEW attempt may start, it does not abort one already
    // running. A predicate with no internal bound therefore turns a short
    // timeout into a long hang, which is exactly how an unbounded Flutter VM
    // retry loop made `snapshot({ timeout: 400 })` block for minutes.
    let completed = false;

    const started = Date.now();
    const value = await waitFor(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        completed = true;
        return 'done';
      },
      { timeout: 1, interval: 1 }
    );

    expect(value).toBe('done');
    expect(completed).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('throws TimeoutError and keeps the last predicate error in details', async () => {
    await expect(waitFor(
      async () => {
        throw new Error('not yet');
      },
      { timeout: 5, interval: 1, message: 'custom timeout' }
    )).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'TIMEOUT',
      message: 'custom timeout',
      details: {
        lastError: expect.any(Error)
      }
    } satisfies Partial<TimeoutError>);
  });
});
