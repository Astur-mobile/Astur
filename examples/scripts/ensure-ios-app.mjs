#!/usr/bin/env node
// Ensures a .app simulator bundle exists, extracting it from the checked-in
// .zip in assets/ if needed. The zip is the artifact that actually lives in
// git (LFS); the .app is a throwaway build product of unzipping it — this
// keeps `npm run test:ios:*` / `codegen:ios:*` working straight after a
// fresh clone/pull, with no manual `unzip` step, while iOS_APP_PATH overrides
// still work unchanged (an existing override path is left alone).
//
// Usable two ways, so the Playwright configs and the codegen npm scripts share
// one implementation:
//   import { ensureIosApp } from './ensure-ios-app.mjs'
//   node scripts/ensure-ios-app.mjs <appPath> <zipPath>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Makes sure `appPath` holds a current extraction of `zipPath`, and returns
 * `appPath`. Throws (rather than exiting) so a config can fail with a real
 * stack instead of killing the Playwright process.
 */
export function ensureIosApp(appPath, zipPath) {

// A sentinel file recording which zip (mtime + size) produced the current
// extraction. `unzip` restores each entry's ARCHIVED timestamp on extract, not
// "now" — so the extracted directory's own mtime is essentially always <= the
// zip file's mtime, which makes comparing them directly re-extract on every
// single run. The sentinel is the only reliable "is this extraction current"
// signal.
  const sentinelPath = `${appPath}.source-zip.json`;
  const zipFingerprint = () => {
    const stat = statSync(zipPath);
    return JSON.stringify({ mtimeMs: stat.mtimeMs, size: stat.size });
  };

  const appExists = existsSync(appPath);
  const zipExists = existsSync(zipPath);

  if (appExists && zipExists && existsSync(sentinelPath)) {
    if (readFileSync(sentinelPath, 'utf8') === zipFingerprint()) {
      return appPath;
    }
  }

  if (appExists && !zipExists) {
    // No zip to extract from (e.g. LFS pointer not pulled) but a bundle already
    // exists (manually placed, or from a previous pull) — use it as-is.
    return appPath;
  }

  if (!zipExists) {
    throw new Error(
      `Neither ${appPath} nor ${zipPath} exist. Run 'git lfs pull' to fetch assets/, `
      + `or set ASTUR_IOS_APP_PATH to an existing .app bundle.`
    );
  }

  // Remove any existing bundle first: `unzip -o` overlays into the directory,
  // which can leave stale files (removed frameworks, renamed resources) behind
  // from a previous build instead of producing a truly clean extraction.
  if (appExists) {
    rmSync(appPath, { recursive: true, force: true });
  }
  rmSync(sentinelPath, { force: true });

  console.log(`Extracting ${zipPath} -> ${dirname(appPath)}/${basename(appPath)}`);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dirname(appPath)], { stdio: 'inherit' });

  if (!existsSync(appPath)) {
    throw new Error(`Extracted ${zipPath} but ${appPath} still does not exist — check the archive contents.`);
  }

  writeFileSync(sentinelPath, zipFingerprint());
  return appPath;
}

// CLI entry point, used by the codegen scripts which pass --app explicitly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , appPath, zipPath] = process.argv;
  if (!appPath || !zipPath) {
    console.error('Usage: ensure-ios-app.mjs <appPath> <zipPath>');
    process.exit(1);
  }
  try {
    ensureIosApp(appPath, zipPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
