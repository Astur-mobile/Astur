import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';

interface BundleEntry {
  path: string;
  /** File size, or the target for a symlink. Cheap to compare before hashing. */
  shape: string;
}

/**
 * Whether two `.app` bundles are byte for byte the same build.
 *
 * A simulator install copies the bundle unchanged (checked on iOS 26.5), so the
 * installed copy of the requested build matches exactly. Every file counts: a
 * React Native JavaScript-only change replaces main.jsbundle without relinking
 * the native binary, so the executable alone cannot identify a build.
 *
 * File lists and sizes are compared first, since a stale build usually differs
 * there already; contents are hashed only when everything else agrees.
 */
export async function appBundlesMatch(local: string, installed: string): Promise<boolean> {
  const [left, right] = await Promise.all([listBundle(local), listBundle(installed)]);
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index].path !== right[index].path || left[index].shape !== right[index].shape) {
      return false;
    }
  }

  for (const entry of left) {
    if (entry.shape.startsWith('link:')) {
      continue;
    }

    const [a, b] = await Promise.all([hashFile(join(local, entry.path)), hashFile(join(installed, entry.path))]);
    if (a !== b) {
      return false;
    }
  }

  return true;
}

async function listBundle(root: string, dir = '', out: BundleEntry[] = []): Promise<BundleEntry[]> {
  const names = (await readdir(join(root, dir))).sort();
  for (const name of names) {
    const path = dir ? `${dir}/${name}` : name;
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink()) {
      out.push({ path, shape: `link:${await readlink(join(root, path))}` });
    } else if (info.isDirectory()) {
      await listBundle(root, path, out);
    } else {
      out.push({ path, shape: `size:${info.size}` });
    }
  }
  return out;
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => digest.update(chunk))
      .on('end', () => resolve(digest.digest('hex')));
  });
}
