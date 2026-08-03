#!/usr/bin/env node
//
// Fails if any internal link in the built site points at a page that does not
// exist.
//
// Worth automating because the failure mode is invisible locally: Starlight
// serves every page at `/<slug>/`, so a markdown link written as `./other/`
// resolves to `/<slug>/other/` — a 404 that only shows up once the site is
// deployed and someone clicks it. Sibling pages must be linked as `../other/`.
//
// Usage: node docs-site/scripts/check-links.mjs [distDir]
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv[2] ?? join(here, '..', 'dist'));

if (!existsSync(dist)) {
  console.error(`No build output at ${dist}. Run the docs build first.`);
  process.exit(1);
}

/** Every .html file under the build output. */
function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? htmlFiles(full) : name.endsWith('.html') ? [full] : [];
  });
}

const pages = htmlFiles(dist);
const broken = [];

for (const file of pages) {
  // The URL this page is served at, so relative hrefs resolve the way a
  // browser would rather than the way the filesystem is laid out.
  const rel = file.slice(dist.length).replace(/\\/g, '/');
  const pageUrl = rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel;

  for (const [, href] of readFileSync(file, 'utf8').matchAll(/href="([^"#?]+)/g)) {
    if (!href || /^(https?:|mailto:|data:|\/\/)/.test(href)) {
      continue;
    }
    const target = new URL(href, `http://x${pageUrl}`).pathname.replace(/^\/+/, '');
    const asDir = join(dist, target, 'index.html');
    const asFile = join(dist, target);
    if (!existsSync(asDir) && !existsSync(asFile)) {
      broken.push({ page: pageUrl, href });
    }
  }
}

if (broken.length) {
  console.error(`${broken.length} broken internal link(s):`);
  for (const { page, href } of broken) {
    console.error(`  ${page} -> ${href}`);
  }
  console.error('\nSibling pages need ../slug/, not ./slug/ — Starlight serves each page at /slug/.');
  process.exit(1);
}

console.log(`Checked ${pages.length} pages: no broken internal links.`);
