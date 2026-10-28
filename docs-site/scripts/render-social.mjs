// Renders the social card: the image link previews, GitHub's social preview
// and the README banner show. Drawn from the same astrolabe as the landing page.
//
//   npm run social -w docs-site
//
// Writes public/brand/social.png (1280x640, small enough for GitHub's 1 MB
// social preview limit) and public/brand/social@2x.png (the README banner).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { astrolabeSvg } from '../src/lib/astrolabe.mjs';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(site, '..');
const astrolabeCss = readFileSync(join(site, 'src/styles/astrolabe.css'), 'utf8');
const logo = pathToFileURL(join(repo, 'packages/cli/assets/brand/astur-logo-dark.png')).href;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Mona+Sans:wght@400..700&family=Outfit:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; }
  body {
    background:
      radial-gradient(640px 520px at 79% 52%, rgb(43 196 180 / 0.13), transparent 70%),
      radial-gradient(420px 300px at 86% 30%, rgb(201 165 78 / 0.09), transparent 70%),
      #06101d;
    color: #e6edf5;
    font-family: Outfit, sans-serif;
  }
  .card { position: relative; width: 1280px; height: 640px; box-sizing: border-box; padding: 64px 0 60px 76px; }
  .logo { height: 44px; display: block; }
  h1 { margin: 74px 0 0; font-size: 82px; line-height: 1.0; font-weight: 600; letter-spacing: -0.035em; width: 680px; }
  .sub { margin: 26px 0 0; width: 600px; font-size: 27px; line-height: 1.35; color: rgb(230 237 245 / 0.72); }
  .row { position: absolute; left: 76px; bottom: 60px; display: flex; align-items: center; gap: 24px; }
  .pill { display: inline-flex; align-items: center; gap: 14px; height: 56px; padding: 0 24px; border-radius: 14px; border: 1px solid rgb(43 196 180 / 0.35); background: #0c1a2e; font: 500 21px 'JetBrains Mono', monospace; }
  .pill span { color: #2bc4b4; }
  .art { position: absolute; right: 30px; top: 34px; width: 540px; }
  ${astrolabeCss}
</style>
</head>
<body>
  <div class="card">
    <img class="logo" src="${logo}" alt="Astur">
    <h1>Mobile apps. Playwright API.</h1>
    <p class="sub">Open-source mobile test automation for Android and iOS, on native agents. No Appium server.</p>
    <div class="row">
      <div class="pill"><span>$</span>npm create astur@latest</div>
    </div>
    <div class="art">${astrolabeSvg({ id: 'card', title: 'An astrolabe' })}</div>
  </div>
</body>
</html>`;

const dir = mkdtempSync(join(tmpdir(), 'astur-social-'));
const page = join(dir, 'card.html');
writeFileSync(page, html);

const browser = await chromium.launch();
try {
  for (const [scale, name] of [[1, 'social.png'], [2, 'social@2x.png']]) {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: scale });
    await tab.goto(pathToFileURL(page).href, { waitUntil: 'networkidle' });
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: join(site, 'public/brand', name) });
    await tab.close();
    console.log(`wrote public/brand/${name}`);
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
