import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeAdb {
  path: string;
  calls(): string[];
  dispose(): void;
}

/**
 * An `adb` stand-in that records every call. A call whose arguments contain a
 * key of `responses` prints that value; the first matching key wins, so list
 * longer keys before their prefixes, and give an exit code to make that call
 * fail. Anything else succeeds silently.
 */
export function createFakeAdb(responses: Array<[match: string, stdout: string, exitCode?: number]> = []): FakeAdb {
  const dir = mkdtempSync(join(tmpdir(), 'astur-fake-adb-'));
  const log = join(dir, 'calls.log');
  const path = join(dir, 'adb');
  const cases = responses
    .map(([match, stdout, exitCode = 0]) =>
      `  *${shellQuote(match)}*) printf '%s\\n' ${shellQuote(stdout)}; exit ${exitCode} ;;`)
    .join('\n');
  writeFileSync(path, `#!/bin/sh\necho "$*" >> ${shellQuote(log)}\ncase "$*" in\n${cases}\nesac\nexit 0\n`);
  chmodSync(path, 0o755);

  return {
    path,
    calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [],
    dispose: () => rmSync(dir, { recursive: true, force: true })
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
