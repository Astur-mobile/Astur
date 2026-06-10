import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneStaleIosAgentDerivedData } from '@astur/ios';

describe('pruneStaleIosAgentDerivedData', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'astur-prune-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function seed(name: string): Promise<void> {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    // A real DerivedData dir holds build products; ensure recursive removal works.
    await writeFile(join(dir, 'Build.marker'), 'x');
  }

  it('removes prior source-stamp builds for the device but keeps the current one', async () => {
    await seed('emulator-5554-oldstampA');
    await seed('emulator-5554-oldstampB');
    await seed('emulator-5554-current');

    const keepPath = join(root, 'emulator-5554-current');
    await pruneStaleIosAgentDerivedData('emulator-5554', keepPath, root);

    expect((await readdir(root)).sort()).toEqual(['emulator-5554-current']);
  });

  it('never touches builds belonging to other devices or unrelated entries', async () => {
    await seed('emulator-5554-old');
    await seed('emulator-5554-current');
    await seed('emulator-5556-current');
    await seed('unrelated-cache');

    const keepPath = join(root, 'emulator-5554-current');
    await pruneStaleIosAgentDerivedData('emulator-5554', keepPath, root);

    expect((await readdir(root)).sort()).toEqual([
      'emulator-5554-current',
      'emulator-5556-current',
      'unrelated-cache'
    ]);
  });

  it('is a no-op when the derived-data root does not exist', async () => {
    const missingRoot = join(root, 'does-not-exist');
    await expect(
      pruneStaleIosAgentDerivedData('emulator-5554', join(missingRoot, 'emulator-5554-current'), missingRoot)
    ).resolves.toBeUndefined();
  });
});
