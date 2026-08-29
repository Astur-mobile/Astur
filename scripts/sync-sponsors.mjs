#!/usr/bin/env node
/**
 * Regenerates the README's sponsors block from sponsors.json.
 *
 * The docs site reads sponsors.json directly, so adding a sponsor is one edit
 * there plus one run of this script — the two never drift because neither is
 * hand-maintained. With no sponsors the block collapses to the invitation
 * alone, so the README never shows an empty "Sponsors" heading.
 *
 * Usage: npm run sync:sponsors        (rewrites README.md)
 *        npm run sync:sponsors -- --check   (fails if the README is stale)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = resolve(root, 'README.md');
const START = '<!-- sponsors:start -->';
const END = '<!-- sponsors:end -->';

const sponsors = JSON.parse(await readFile(resolve(root, 'sponsors.json'), 'utf8'));
const logo = sponsors.logo ?? [];
const name = sponsors.name ?? [];

const lines = [];

if (logo.length > 0) {
  lines.push('<p align="center">');
  for (const sponsor of logo) {
    requireFields(sponsor, ['name', 'url', 'logo']);
    lines.push(
      `  <a href="${sponsor.url}" title="${escapeAttr(sponsor.name)}"><img src="${sponsor.logo}" alt="${escapeAttr(sponsor.name)}" height="40"></a>`
    );
  }
  lines.push('</p>');
}

if (name.length > 0) {
  if (lines.length > 0) lines.push('');
  lines.push(name.map((sponsor) => {
    requireFields(sponsor, ['name', 'url']);
    return `[${escapeText(sponsor.name)}](${sponsor.url})`;
  }).join(' · '));
}

if (lines.length === 0) {
  lines.push('Astur is built in the open and has no sponsors yet — [be the first](https://github.com/sponsors/Astur-mobile).');
} else {
  lines.push('');
  lines.push('[Become a sponsor](https://github.com/sponsors/Astur-mobile) to appear here.');
}

const block = `${START}\n\n${lines.join('\n')}\n\n${END}`;
const readme = await readFile(readmePath, 'utf8');

const startIndex = readme.indexOf(START);
const endIndex = readme.indexOf(END);
if (startIndex === -1 || endIndex === -1) {
  throw new Error(`README.md is missing the ${START} / ${END} markers.`);
}

const next = readme.slice(0, startIndex) + block + readme.slice(endIndex + END.length);

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('README sponsors block is out of date. Run `npm run sync:sponsors`.');
    process.exitCode = 1;
  } else {
    console.log('README sponsors block is up to date.');
  }
} else {
  await writeFile(readmePath, next, 'utf8');
  console.log(`README sponsors block updated (${logo.length} logo, ${name.length} name).`);
}

function requireFields(sponsor, fields) {
  for (const field of fields) {
    if (!sponsor?.[field]) {
      throw new Error(`sponsors.json entry ${JSON.stringify(sponsor)} is missing "${field}".`);
    }
  }
}

/** The README is rendered as HTML by GitHub, so attribute values need escaping. */
function escapeAttr(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/** Markdown link text: only the characters that would break the link syntax. */
function escapeText(value) {
  return String(value).replaceAll('[', '\\[').replaceAll(']', '\\]');
}
