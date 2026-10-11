import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appBundlesMatch } from '../packages/ios/src/appBundle.js';

describe('iOS app bundle comparison', () => {
  let dir: string;
  let local: string;
  let installed: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'astur-bundle-'));
    local = join(dir, 'local', 'Demo.app');
    mkdirSync(join(local, 'Frameworks'), { recursive: true });
    writeFileSync(join(local, 'Demo'), 'native binary');
    writeFileSync(join(local, 'main.jsbundle'), 'javascript');
    writeFileSync(join(local, 'Frameworks', 'Lib'), 'library');
    symlinkSync('Lib', join(local, 'Frameworks', 'Current'));
    installed = join(dir, 'installed', 'Demo.app');
    cpSync(local, installed, { recursive: true, verbatimSymlinks: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('matches an identical copy', async () => {
    await expect(appBundlesMatch(local, installed)).resolves.toBe(true);
  });

  it('notices a JavaScript-only change, which leaves the native binary untouched', async () => {
    writeFileSync(join(installed, 'main.jsbundle'), 'javascripu');

    await expect(appBundlesMatch(local, installed)).resolves.toBe(false);
  });

  it('notices a file the other copy lacks', async () => {
    writeFileSync(join(installed, 'Stale.plist'), 'left over');

    await expect(appBundlesMatch(local, installed)).resolves.toBe(false);
  });

  it('notices a symlink that points elsewhere', async () => {
    rmSync(join(installed, 'Frameworks', 'Current'));
    symlinkSync('Other', join(installed, 'Frameworks', 'Current'));

    await expect(appBundlesMatch(local, installed)).resolves.toBe(false);
  });
});
