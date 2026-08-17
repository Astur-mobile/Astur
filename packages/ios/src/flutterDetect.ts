import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Markers a Flutter `.app` bundle always carries, whatever the build mode.
 *
 * `Flutter.framework` is the engine itself and `flutter_assets` its bundled
 * resources; a release, profile or debug build has both. Deliberately not the
 * JIT-only markers (`kernel_blob.bin`, `Runner.debug.dylib`) — those answer
 * "is this debuggable", which is a different question from "is this Flutter".
 */
const MARKERS = ['Frameworks/Flutter.framework', 'Frameworks/App.framework/flutter_assets'];

/**
 * Whether an installed `.app` bundle is a Flutter app.
 *
 * iOS gives Astur no runtime signal for this: XCUITest serves the same native
 * accessibility tree for a Flutter app as for a React Native one, so the only
 * place the difference is visible is the bundle on disk. It matters for
 * screenshot baselines, which must not be shared between two builds that render
 * the same screen differently.
 *
 * Answers `false` rather than throwing when the path is missing or unreadable —
 * an undetectable app is treated as native, which is the status quo.
 */
export async function isFlutterAppBundle(appPath: string | undefined): Promise<boolean> {
  if (!appPath) {
    return false;
  }

  for (const marker of MARKERS) {
    const found = await stat(join(appPath, marker)).then(() => true).catch(() => false);
    if (found) {
      return true;
    }
  }

  return false;
}
