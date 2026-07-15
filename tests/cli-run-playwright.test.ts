import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const resolveMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock
}));

vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: resolveMock })
}));

import { __testing } from '@astur-mobile/cli';

const CLI_PATH = '/project/node_modules/@playwright/test/cli.js';

class FakeChild extends EventEmitter {}

describe('astur test -> Playwright invocation', () => {
  afterEach(() => {
    spawnMock.mockReset();
    resolveMock.mockReset();
  });

  it('resolves the Playwright CLI via the "./cli" export subpath (not "./cli.js", which is not in the exports map)', () => {
    resolveMock.mockReturnValue(CLI_PATH);

    expect(__testing.resolvePlaywrightCliPath()).toBe(CLI_PATH);
    expect(resolveMock).toHaveBeenCalledWith('@playwright/test/cli');
  });

  it('throws a clear, actionable error when @playwright/test cannot be resolved', () => {
    resolveMock.mockImplementation(() => {
      throw new Error("Cannot find module '@playwright/test/cli'");
    });

    expect(() => __testing.resolvePlaywrightCliPath()).toThrow(/Could not resolve @playwright\/test/);
  });

  it('spawns the resolved cli.js directly under process.execPath, never through npx', async () => {
    // The old implementation spawned the `npx` executable (`npx.cmd` on
    // Windows) — a shell/batch-file indirection layer that chains into a
    // SECOND `#!/usr/bin/env node` shebang re-exec for Playwright's own bin.
    // That double indirection is the documented source of the reported
    // `spawn EINVAL` on Node 22/24 (works on Node 20). Spawning the resolved
    // .js file directly under process.execPath removes npx from the process
    // tree entirely — this test pins that invariant so it can't regress.
    resolveMock.mockReturnValue(CLI_PATH);
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const runPromise = __testing.runPlaywright(['--config', 'playwright.config.ts']);
    child.emit('exit', 0, null);
    await runPromise;

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [CLI_PATH, 'test', '--config', 'playwright.config.ts'],
      { stdio: 'inherit', shell: false }
    );
    expect(spawnMock).not.toHaveBeenCalledWith('npx', expect.anything(), expect.anything());
    expect(spawnMock).not.toHaveBeenCalledWith('npx.cmd', expect.anything(), expect.anything());
  });

  it('propagates the spawned process exit code', async () => {
    resolveMock.mockReturnValue(CLI_PATH);
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const originalExitCode = process.exitCode;

    const runPromise = __testing.runPlaywright([]);
    child.emit('exit', 1, null);
    await runPromise;

    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  it('rejects when the spawned process is terminated by a signal', async () => {
    resolveMock.mockReturnValue(CLI_PATH);
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const runPromise = __testing.runPlaywright([]);
    child.emit('exit', null, 'SIGTERM');

    await expect(runPromise).rejects.toThrow(/terminated by SIGTERM/);
  });

  it('rejects when spawn itself errors (the EINVAL failure mode)', async () => {
    resolveMock.mockReturnValue(CLI_PATH);
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const runPromise = __testing.runPlaywright([]);
    const spawnError = Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' });
    child.emit('error', spawnError);

    await expect(runPromise).rejects.toThrow('spawn EINVAL');
  });
});
