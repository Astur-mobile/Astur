import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFlutterAppBundle } from '../packages/ios/src/flutterDetect.js';

async function makeBundle(...dirs: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'astur-app-'));
  const app = join(root, 'Runner.app');
  await mkdir(app, { recursive: true });
  for (const dir of dirs) {
    await mkdir(join(app, dir), { recursive: true });
  }
  await writeFile(join(app, 'Info.plist'), '<plist/>');
  return app;
}

describe('iOS Flutter bundle detection', () => {
  // This is the only signal there is: XCUITest serves the same native
  // accessibility tree for a Flutter app as for a React Native one, so nothing
  // at runtime distinguishes them. Screenshot baselines depend on getting it
  // right, or a Flutter build silently compares against React Native pixels.
  it('detects a bundle carrying the Flutter engine', async () => {
    expect(await isFlutterAppBundle(await makeBundle('Frameworks/Flutter.framework'))).toBe(true);
  });

  it('detects a bundle carrying flutter_assets', async () => {
    expect(await isFlutterAppBundle(await makeBundle('Frameworks/App.framework/flutter_assets'))).toBe(true);
  });

  it('treats a React Native bundle as not Flutter', async () => {
    expect(await isFlutterAppBundle(await makeBundle('Frameworks/hermes.framework'))).toBe(false);
  });

  it('treats a bundle with no frameworks as not Flutter', async () => {
    expect(await isFlutterAppBundle(await makeBundle())).toBe(false);
  });

  it('answers false rather than throwing for a missing path', async () => {
    // A path that does not exist must degrade to "native", never fail the run —
    // detection is an optimisation for baselines, not a precondition.
    expect(await isFlutterAppBundle('/no/such/App.app')).toBe(false);
    expect(await isFlutterAppBundle(undefined)).toBe(false);
  });
});
