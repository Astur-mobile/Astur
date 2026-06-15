import { open, stat } from 'node:fs/promises';

/**
 * Decides whether an APK is a Flutter app.
 *
 * A ZIP stores entry names uncompressed in its central directory (at the end of
 * the file), so scanning the tail of the APK for Flutter markers is a fast,
 * dependency-free, cross-platform check. `ASTUR_FLUTTER` forces the result.
 */

const MARKERS = ['libflutter.so', 'flutter_assets/'];
// Flutter APK central directories are well under this; reading the tail keeps the
// check cheap even for large debug APKs.
const TAIL_BYTES = 12 * 1024 * 1024;

export function flutterOverride(): boolean | undefined {
  const raw = process.env.ASTUR_FLUTTER;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return undefined;
}

export async function isFlutterApk(apkPath: string): Promise<boolean> {
  const override = flutterOverride();
  if (override !== undefined) {
    return override;
  }

  try {
    const { size } = await stat(apkPath);
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const handle = await open(apkPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return MARKERS.some((marker) => buffer.includes(marker));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}
