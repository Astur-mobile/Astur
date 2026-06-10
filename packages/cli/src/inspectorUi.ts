import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bounds, DeviceInfo, LocatorSuggestion, MobileElementSnapshot } from '@astur-mobile/protocol';

export interface InspectorUiModel {
  device: DeviceInfo;
  launched: boolean;
  launchWarning?: string;
  tree: MobileElementSnapshot;
  treeNodeCount: number;
  visibleNodeCount: number;
  suggestions: LocatorSuggestion[];
  screenshotDataUri?: string;
}

interface InspectorUiNode {
  uid: string;
  parentUid?: string;
  depth: number;
  title: string;
  type: string;
  id?: string;
  label?: string;
  text?: string;
  value?: string;
  visible: boolean;
  enabled: boolean;
  bounds: Bounds;
}

interface InspectorUiPayload {
  generatedAt: string;
  device: {
    id: string;
    name: string;
    platform: string;
    kind: string;
    state: string;
  };
  app: {
    launched: boolean;
    warning?: string;
  };
  tree: {
    nodes: number;
    visibleNodes: number;
  };
  nodes: InspectorUiNode[];
  suggestions: Array<{ code: string; score: number }>;
  initialSelectionUid?: string;
  viewport: {
    width: number;
    height: number;
  };
  screenshotDataUri?: string;
  logoDataUri?: string;
}

export interface InspectorUiLaunchResult {
  filePath: string;
  opened: boolean;
}

export async function launchInspectorUi(model: InspectorUiModel): Promise<InspectorUiLaunchResult> {
  const payload = await buildPayload(model);
  const tempDir = await mkdtemp(join(tmpdir(), 'astur-inspector-'));
  const filePath = join(tempDir, 'index.html');
  const html = renderInspectorHtml(payload);

  await writeFile(filePath, html, 'utf8');
  const opened = openExternal(filePath);

  return {
    filePath,
    opened
  };
}

async function buildPayload(model: InspectorUiModel): Promise<InspectorUiPayload> {
  const nodes = flattenTree(model.tree);
  const initialSelection = pickInitialSelection(nodes);

  return {
    generatedAt: new Date().toISOString(),
    device: {
      id: model.device.id,
      name: model.device.name,
      platform: model.device.platform,
      kind: model.device.kind,
      state: model.device.state
    },
    app: {
      launched: model.launched,
      warning: model.launchWarning
    },
    tree: {
      nodes: model.treeNodeCount,
      visibleNodes: model.visibleNodeCount
    },
    nodes,
    suggestions: model.suggestions.map((suggestion) => ({
      code: suggestion.code,
      score: suggestion.score
    })),
    initialSelectionUid: initialSelection?.uid,
    viewport: estimateViewport(nodes),
    screenshotDataUri: model.screenshotDataUri,
    logoDataUri: await readAsturLogoDataUri()
  };
}

function flattenTree(root: MobileElementSnapshot): InspectorUiNode[] {
  const nodes: InspectorUiNode[] = [];

  const visit = (
    node: MobileElementSnapshot,
    depth: number,
    uid: string,
    parentUid?: string
  ): void => {
    nodes.push({
      uid,
      parentUid,
      depth,
      title: node.label ?? node.text ?? node.id ?? node.type,
      type: node.type,
      id: node.id,
      label: node.label,
      text: node.text,
      value: node.value,
      visible: node.visible,
      enabled: node.enabled,
      bounds: node.bounds
    });

    for (const [index, child] of node.children.entries()) {
      visit(child, depth + 1, `${uid}.${index}`, uid);
    }
  };

  visit(root, 0, '0');
  return nodes;
}

function pickInitialSelection(nodes: InspectorUiNode[]): InspectorUiNode | undefined {
  return nodes.find((node) => {
    return node.visible
      && node.enabled
      && !node.type.endsWith('.root')
      && Boolean(node.id || node.label || node.text);
  }) ?? nodes[0];
}

function estimateViewport(nodes: InspectorUiNode[]): { width: number; height: number } {
  const visible = nodes.filter((node) => node.visible && node.bounds.width > 0 && node.bounds.height > 0);
  const right = Math.max(0, ...visible.map((node) => node.bounds.x + node.bounds.width));
  const bottom = Math.max(0, ...visible.map((node) => node.bounds.y + node.bounds.height));

  return {
    width: Math.max(1, right),
    height: Math.max(1, bottom)
  };
}

async function readAsturLogoDataUri(): Promise<string | undefined> {
  const candidates = [
    fileURLToPath(new URL('../assets/brand/astur-logo-dark.png', import.meta.url)),
    fileURLToPath(new URL('../assets/brand/astur-logo-light.png', import.meta.url)),
    resolve(process.cwd(), 'packages/cli/assets/brand/astur-logo-dark.png'),
    resolve(process.cwd(), 'packages/cli/assets/brand/astur-logo-light.png')
  ];

  for (const candidate of candidates) {
    if (!(await exists(candidate))) {
      continue;
    }

    const file = await readFile(candidate);
    return `data:image/png;base64,${file.toString('base64')}`;
  }

  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function openExternal(target: string): boolean {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }

    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }

    spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

function renderInspectorHtml(payload: InspectorUiPayload): string {
  const payloadJson = JSON.stringify(payload).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Astur Inspector</title>
  <style>
    :root {
      --bg: #040914;
      --bg-soft: #0b162b;
      --panel: rgba(12, 27, 49, 0.84);
      --panel-strong: rgba(15, 34, 62, 0.96);
      --line: rgba(104, 180, 255, 0.26);
      --text: #e9f2ff;
      --muted: #91a7cc;
      --accent: #38bdf8;
      --accent-strong: #0ea5e9;
      --good: #22c55e;
      --warn: #fb923c;
      --danger: #ef4444;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(1100px 600px at 20% -10%, rgba(37, 99, 235, 0.24), transparent 70%),
        radial-gradient(900px 500px at 95% 5%, rgba(14, 165, 233, 0.18), transparent 70%),
        linear-gradient(150deg, #050b18, #030814 54%, #071326);
      font-family: 'Space Grotesk', 'Avenir Next', 'Segoe UI Variable', 'Segoe UI', sans-serif;
      padding: 14px;
    }

    .toolbar {
      height: 62px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(11, 24, 43, 0.9), rgba(8, 19, 36, 0.9));
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      backdrop-filter: blur(8px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-logo {
      width: 96px;
      height: 34px;
      border-radius: 0;
      object-fit: contain;
      background: transparent;
      border: 0;
      padding: 0;
    }

    .brand-fallback {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: linear-gradient(160deg, #0ea5e9, #1d4ed8);
      font-weight: 700;
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.35);
    }

    .brand-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }

    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
    }

    .badge {
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 6px 10px;
      background: rgba(15, 32, 56, 0.7);
    }

    .badge.live {
      color: #a7f3d0;
      border-color: rgba(16, 185, 129, 0.36);
    }

    .layout {
      margin-top: 12px;
      display: grid;
      grid-template-columns: 280px 420px 320px 1fr;
      gap: 12px;
      min-height: calc(100vh - 100px);
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, var(--panel-strong), var(--panel));
      backdrop-filter: blur(8px);
      overflow: hidden;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .panel-header {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(133, 187, 255, 0.18);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #b7cbeb;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .panel-body {
      padding: 12px;
      overflow: auto;
    }

    .nav-strip {
      display: grid;
      grid-template-columns: 42px 1fr;
      height: 100%;
    }

    .nav-icons {
      border-right: 1px solid rgba(133, 187, 255, 0.16);
      padding: 12px 8px;
      display: grid;
      gap: 10px;
      align-content: start;
    }

    .icon-btn {
      height: 34px;
      border-radius: 10px;
      border: 1px solid rgba(133, 187, 255, 0.24);
      display: grid;
      place-items: center;
      color: #cae0ff;
      font-size: 11px;
      background: rgba(17, 36, 64, 0.8);
    }

    .icon-btn.active {
      background: linear-gradient(160deg, rgba(29, 78, 216, 0.75), rgba(14, 165, 233, 0.35));
      border-color: rgba(125, 211, 252, 0.62);
    }

    .inspector-main {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .hint {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 14px;
    }

    .best-card {
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(18, 45, 78, 0.74), rgba(14, 31, 57, 0.74));
      padding: 10px;
      margin-bottom: 10px;
    }

    .best-card .label {
      font-size: 11px;
      color: #93c5fd;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 6px;
    }

    .mono {
      font-family: 'IBM Plex Mono', 'JetBrains Mono', 'SFMono-Regular', Menlo, monospace;
      font-size: 12px;
      color: #dbeafe;
      word-break: break-word;
    }

    .score {
      margin-top: 8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid rgba(34, 197, 94, 0.4);
      color: #bbf7d0;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      background: rgba(22, 101, 52, 0.22);
    }

    .alternative-list {
      display: grid;
      gap: 8px;
      margin-bottom: 14px;
    }

    .alternative-item {
      border: 1px solid rgba(133, 187, 255, 0.24);
      border-radius: 10px;
      padding: 8px;
      background: rgba(15, 34, 59, 0.7);
    }

    .details-grid {
      border: 1px solid rgba(133, 187, 255, 0.2);
      border-radius: 10px;
      overflow: hidden;
    }

    .detail-row {
      display: grid;
      grid-template-columns: 112px 1fr;
      border-bottom: 1px solid rgba(133, 187, 255, 0.15);
      font-size: 12px;
    }

    .detail-row:last-child {
      border-bottom: none;
    }

    .detail-row > div {
      padding: 7px 9px;
    }

    .detail-key {
      color: #a0b9de;
      background: rgba(13, 27, 47, 0.8);
      border-right: 1px solid rgba(133, 187, 255, 0.15);
    }

    .mirror-panel {
      justify-content: space-between;
    }

    .mirror-wrap {
      height: 100%;
      display: grid;
      place-items: center;
      padding: 16px;
    }

    .phone-shell {
      width: min(100%, 340px);
      height: min(100%, 720px);
      border-radius: 34px;
      border: 1px solid rgba(133, 187, 255, 0.24);
      padding: 10px;
      background: linear-gradient(180deg, rgba(11, 23, 41, 0.96), rgba(5, 13, 24, 0.96));
      position: relative;
      box-shadow: 0 18px 70px rgba(2, 8, 23, 0.8);
    }

    .phone-notch {
      position: absolute;
      top: 8px;
      left: 50%;
      width: 92px;
      height: 16px;
      transform: translateX(-50%);
      border-radius: 999px;
      background: rgba(3, 10, 20, 0.95);
      border: 1px solid rgba(141, 201, 255, 0.2);
      z-index: 3;
    }

    .mirror-stage {
      width: 100%;
      height: 100%;
      border-radius: 24px;
      overflow: hidden;
      border: 1px solid rgba(133, 187, 255, 0.18);
      background: radial-gradient(circle at 50% 8%, rgba(29, 78, 216, 0.4), rgba(3, 10, 22, 0.95) 70%);
      position: relative;
      display: grid;
      place-items: center;
    }

    .mirror-image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: none;
    }

    .mirror-empty {
      text-align: center;
      max-width: 250px;
      color: #c6d9f5;
      font-size: 13px;
      line-height: 1.6;
      padding: 12px;
      border-radius: 12px;
      background: rgba(8, 21, 40, 0.62);
      border: 1px solid rgba(133, 187, 255, 0.2);
    }

    .highlight {
      position: absolute;
      border: 2px solid rgba(125, 211, 252, 0.96);
      border-radius: 10px;
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2), 0 0 30px rgba(56, 189, 248, 0.45);
      pointer-events: none;
      display: none;
      animation: pulse 1.6s ease-in-out infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2), 0 0 22px rgba(56, 189, 248, 0.4); }
      50% { box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.26), 0 0 30px rgba(56, 189, 248, 0.62); }
      100% { box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2), 0 0 22px rgba(56, 189, 248, 0.4); }
    }

    .tree-search {
      width: 100%;
      border-radius: 9px;
      border: 1px solid rgba(133, 187, 255, 0.26);
      background: rgba(7, 18, 35, 0.9);
      color: var(--text);
      padding: 9px 10px;
      margin-bottom: 10px;
      font-size: 13px;
    }

    .tree-list {
      display: grid;
      gap: 4px;
    }

    .tree-item {
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 6px 8px;
      cursor: pointer;
      color: #d5e5ff;
      font-size: 12px;
      background: rgba(10, 22, 40, 0.5);
      transition: 120ms ease;
    }

    .tree-item:hover {
      border-color: rgba(125, 211, 252, 0.34);
      background: rgba(17, 38, 66, 0.85);
    }

    .tree-item.active {
      border-color: rgba(125, 211, 252, 0.68);
      background: linear-gradient(150deg, rgba(37, 99, 235, 0.5), rgba(14, 165, 233, 0.38));
    }

    .code-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pill-btn {
      border: 1px solid rgba(133, 187, 255, 0.24);
      background: rgba(13, 29, 50, 0.8);
      color: #dbeafe;
      padding: 6px 9px;
      border-radius: 999px;
      font-size: 12px;
      cursor: pointer;
    }

    .pill-btn.active {
      border-color: rgba(125, 211, 252, 0.6);
      background: rgba(14, 165, 233, 0.2);
    }

    .code-block {
      border: 1px solid rgba(133, 187, 255, 0.22);
      border-radius: 10px;
      background: rgba(4, 11, 22, 0.92);
      color: #d8ebff;
      padding: 12px;
      min-height: 220px;
      max-height: 380px;
      overflow: auto;
      white-space: pre;
      line-height: 1.6;
      font-size: 12px;
      margin-bottom: 10px;
    }

    .action-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    .recording-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      border: 1px solid rgba(133, 187, 255, 0.2);
      border-radius: 10px;
      overflow: hidden;
    }

    .recording-table th,
    .recording-table td {
      border-bottom: 1px solid rgba(133, 187, 255, 0.16);
      padding: 7px 8px;
      text-align: left;
    }

    .recording-table th {
      color: #9fbae1;
      background: rgba(13, 26, 46, 0.9);
      font-weight: 600;
    }

    .recording-table tr:last-child td {
      border-bottom: none;
    }

    .status {
      color: #a5c3ea;
      font-size: 12px;
      margin-top: 8px;
    }

    @media (max-width: 1680px) {
      .layout {
        grid-template-columns: 260px 1fr 320px;
      }

      .tree-panel {
        grid-column: 1 / 3;
      }
    }

    @media (max-width: 1180px) {
      body {
        padding: 10px;
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .tree-panel {
        grid-column: auto;
      }
    }
  </style>
</head>
<body>
  <header class="toolbar">
    <div class="brand">
      ${payload.logoDataUri
    ? '<img class="brand-logo" src="' + payload.logoDataUri + '" alt="Astur logo" />'
    : '<div class="brand-fallback">A</div>'}
      <div>
        <div class="brand-title">Astur Inspector</div>
        <div style="font-size: 11px; color: var(--muted);">Playwright-style native codegen UI</div>
      </div>
    </div>
    <div class="toolbar-right">
      <div class="badge">${payload.device.name} (${payload.device.platform})</div>
      <div class="badge live">Live tree: ${payload.tree.visibleNodes}/${payload.tree.nodes}</div>
      <div class="badge" id="recordBadge">Recording: ON</div>
    </div>
  </header>

  <main class="layout">
    <section class="panel">
      <div class="nav-strip">
        <div class="nav-icons">
          <div class="icon-btn active">INS</div>
          <div class="icon-btn">REC</div>
          <div class="icon-btn">SES</div>
          <div class="icon-btn">DEV</div>
          <div class="icon-btn">SET</div>
        </div>
        <div class="inspector-main">
          <div class="panel-header">Inspector</div>
          <div class="panel-body">
            <div class="hint">
              Tap on the mirror or pick a node in the tree. Locators and generated
              Astur code stay in sync with the same runtime selector semantics.
            </div>

            <div class="best-card">
              <div class="label">Automatic Best Locator</div>
              <div id="bestLocator" class="mono"></div>
              <div id="bestScore" class="score"></div>
            </div>

            <div style="font-size: 11px; color: #96b7df; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 7px;">Alternatives</div>
            <div id="alternativeList" class="alternative-list"></div>

            <div style="font-size: 11px; color: #96b7df; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 7px;">Element Details</div>
            <div id="detailsGrid" class="details-grid"></div>
          </div>
        </div>
      </div>
    </section>

    <section class="panel mirror-panel">
      <div class="panel-header">
        <span>Device Mirror</span>
        <span style="color: var(--muted); font-size: 11px;">${payload.device.id}</span>
      </div>
      <div class="mirror-wrap">
        <div class="phone-shell">
          <div class="phone-notch"></div>
          <div class="mirror-stage" id="mirrorStage">
            <img id="mirrorImage" class="mirror-image" alt="Device screenshot" />
            <div id="mirrorEmpty" class="mirror-empty">
              No screenshot was captured for this session.<br />
              Use a running app target to show the live frame.
            </div>
            <div id="highlightBox" class="highlight"></div>
          </div>
        </div>
      </div>
    </section>

    <section class="panel tree-panel">
      <div class="panel-header">
        <span>UI Tree</span>
        <span style="font-size: 11px; color: var(--muted);">${payload.generatedAt}</span>
      </div>
      <div class="panel-body">
        <input id="treeSearch" class="tree-search" placeholder="Search element text, id, or type" />
        <div id="treeList" class="tree-list"></div>
      </div>
    </section>

    <section class="panel code-panel">
      <div class="panel-header">
        <div class="code-head">
          <button class="pill-btn active" data-lang="typescript">TypeScript</button>
          <button class="pill-btn" data-lang="javascript">JavaScript</button>
          <button class="pill-btn" data-lang="python">Python</button>
        </div>
        <button class="pill-btn" id="exportCodeBtn">Export Code</button>
      </div>
      <div class="panel-body">
        <pre id="codeBlock" class="code-block"></pre>

        <div class="action-row">
          <button class="pill-btn" id="recordToggleBtn">Pause Recording</button>
          <button class="pill-btn" id="addTapBtn">Add Tap</button>
          <button class="pill-btn" id="addFillBtn">Add Fill</button>
          <button class="pill-btn" id="addExpectBtn">Add Expect Visible</button>
          <button class="pill-btn" id="clearStepsBtn">Clear</button>
        </div>

        <table class="recording-table">
          <thead>
            <tr>
              <th style="width: 42px;">#</th>
              <th style="width: 90px;">Action</th>
              <th>Locator</th>
            </tr>
          </thead>
          <tbody id="stepsBody"></tbody>
        </table>
        <div id="statusText" class="status"></div>
      </div>
    </section>
  </main>

  <script id="astur-bootstrap" type="application/json">${payloadJson}</script>
  <script>
    (() => {
      const payload = JSON.parse(document.getElementById('astur-bootstrap').textContent || '{}');
      const state = {
        language: 'typescript',
        selectedUid: payload.initialSelectionUid,
        steps: [],
        recording: true
      };

      const treeSearch = document.getElementById('treeSearch');
      const treeList = document.getElementById('treeList');
      const bestLocator = document.getElementById('bestLocator');
      const bestScore = document.getElementById('bestScore');
      const alternativeList = document.getElementById('alternativeList');
      const detailsGrid = document.getElementById('detailsGrid');
      const codeBlock = document.getElementById('codeBlock');
      const stepsBody = document.getElementById('stepsBody');
      const statusText = document.getElementById('statusText');
      const mirrorImage = document.getElementById('mirrorImage');
      const mirrorEmpty = document.getElementById('mirrorEmpty');
      const highlightBox = document.getElementById('highlightBox');
      const mirrorStage = document.getElementById('mirrorStage');
      const recordToggleBtn = document.getElementById('recordToggleBtn');
      const recordBadge = document.getElementById('recordBadge');

      if (payload.screenshotDataUri) {
        mirrorImage.src = payload.screenshotDataUri;
        mirrorImage.style.display = 'block';
        mirrorEmpty.style.display = 'none';
      }

      mirrorImage.addEventListener('load', () => {
        renderSelection();
      });

      for (const button of document.querySelectorAll('[data-lang]')) {
        button.addEventListener('click', () => {
          state.language = button.getAttribute('data-lang');
          for (const candidate of document.querySelectorAll('[data-lang]')) {
            candidate.classList.toggle('active', candidate === button);
          }
          renderCode();
        });
      }

      recordToggleBtn.addEventListener('click', () => {
        state.recording = !state.recording;
        recordToggleBtn.textContent = state.recording ? 'Pause Recording' : 'Resume Recording';
        recordBadge.textContent = state.recording ? 'Recording: ON' : 'Recording: OFF';
      });

      document.getElementById('addTapBtn').addEventListener('click', () => {
        addStep('Tap');
      });

      document.getElementById('addFillBtn').addEventListener('click', () => {
        const value = prompt('Fill value', 'qa@example.com');
        if (value === null) {
          return;
        }
        addStep('Fill', value);
      });

      document.getElementById('addExpectBtn').addEventListener('click', () => {
        addStep('Expect');
      });

      document.getElementById('clearStepsBtn').addEventListener('click', () => {
        state.steps = [];
        renderCode();
        renderSteps();
      });

      document.getElementById('exportCodeBtn').addEventListener('click', async () => {
        const code = codeBlock.textContent || '';
        const copied = await copyText(code);
        statusText.textContent = copied
          ? 'Code copied to clipboard.'
          : 'Copy failed in this browser; use manual copy from the code panel.';
      });

      treeSearch.addEventListener('input', () => {
        renderTree();
      });

      if (!state.selectedUid && payload.nodes.length > 0) {
        state.selectedUid = payload.nodes[0].uid;
      }

      renderTree();
      renderSelection();
      renderCode();
      renderSteps();

      function currentNode() {
        return payload.nodes.find((node) => node.uid === state.selectedUid);
      }

      function inferRole(node) {
        const type = String(node.type || '').toLowerCase();
        if (type.includes('button')) return 'button';
        if (type.includes('checkbox')) return 'checkbox';
        if (type.includes('switch')) return 'switch';
        if (type.includes('radio')) return 'radio';
        if (type.includes('edittext') || type.includes('textfield') || type.includes('textinput')) return 'textbox';
        if (type.includes('text')) return 'text';
        return undefined;
      }

      function escapeSingle(value) {
        return String(value).replaceAll('\\\\', '\\\\\\\\').replaceAll("'", "\\\\'");
      }

      function scoreTag(score) {
        return Math.round(Number(score || 0) * 100);
      }

      function locatorCandidates(node) {
        if (!node) {
          return [];
        }

        const candidates = [];
        const role = inferRole(node);
        const name = node.label || node.text || node.value;

        if (node.id) {
          candidates.push({ code: "device.getByTestId('" + escapeSingle(node.id) + "')", score: 0.99 });
          candidates.push({ code: "device.getById('" + escapeSingle(node.id) + "')", score: 0.96 });
        }

        if (role && name) {
          candidates.push({
            code: "device.getByRole('" + escapeSingle(role) + "', { name: '" + escapeSingle(name) + "' })",
            score: 0.92
          });
        }

        if (node.label) {
          candidates.push({ code: "device.getByLabel('" + escapeSingle(node.label) + "')", score: 0.89 });
        }

        if (node.text) {
          candidates.push({ code: "device.getByText('" + escapeSingle(node.text) + "')", score: 0.84 });
        }

        if (node.type) {
          candidates.push({ code: "device.getByType('" + escapeSingle(node.type) + "')", score: 0.58 });
        }

        const unique = [];
        const seen = new Set();
        for (const candidate of candidates) {
          if (!seen.has(candidate.code)) {
            unique.push(candidate);
            seen.add(candidate.code);
          }
        }

        return unique;
      }

      function selectionCandidates(node) {
        if (!node) {
          return [];
        }

        if (node.uid === payload.initialSelectionUid && Array.isArray(payload.suggestions) && payload.suggestions.length > 0) {
          return payload.suggestions;
        }

        return locatorCandidates(node);
      }

      function renderTree() {
        const query = String(treeSearch.value || '').trim().toLowerCase();
        const rows = payload.nodes.filter((node) => {
          if (!query) {
            return true;
          }

          return [node.title, node.id, node.label, node.text, node.type]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
        });

        treeList.innerHTML = '';
        for (const node of rows) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'tree-item' + (node.uid === state.selectedUid ? ' active' : '');
          item.style.paddingLeft = (8 + node.depth * 13) + 'px';
          item.textContent = node.title;
          item.title = node.type;
          item.addEventListener('click', () => {
            state.selectedUid = node.uid;
            renderTree();
            renderSelection();
            renderCode();
          });
          treeList.appendChild(item);
        }
      }

      function renderSelection() {
        const node = currentNode();
        const candidates = selectionCandidates(node);
        const best = candidates[0];

        bestLocator.textContent = best ? best.code : 'No locator available for selected node';
        bestScore.textContent = best ? 'Score ' + scoreTag(best.score) : 'Score 0';

        alternativeList.innerHTML = '';
        for (const candidate of candidates.slice(1, 5)) {
          const row = document.createElement('div');
          row.className = 'alternative-item';
          row.innerHTML = '<div class="mono">' + sanitize(candidate.code) + '</div>'
            + '<div style="margin-top:6px;color:#9ab8de;font-size:11px;">Score ' + scoreTag(candidate.score) + '</div>';
          alternativeList.appendChild(row);
        }

        if (alternativeList.children.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'alternative-item';
          empty.textContent = 'No alternative locators for this node yet.';
          alternativeList.appendChild(empty);
        }

        detailsGrid.innerHTML = '';
        const rows = [
          ['Type', node?.type ?? '-'],
          ['Text', node?.text ?? '-'],
          ['Label', node?.label ?? '-'],
          ['Resource id', node?.id ?? '-'],
          ['Enabled', String(node?.enabled ?? false)],
          ['Visible', String(node?.visible ?? false)],
          ['Bounds', node ? formatBounds(node.bounds) : '-']
        ];

        for (const [key, value] of rows) {
          const row = document.createElement('div');
          row.className = 'detail-row';
          row.innerHTML = '<div class="detail-key">' + sanitize(key) + '</div><div>' + sanitize(value) + '</div>';
          detailsGrid.appendChild(row);
        }

        updateHighlight(node);
      }

      function formatBounds(bounds) {
        if (!bounds) {
          return '-';
        }

        const right = bounds.x + bounds.width;
        const bottom = bounds.y + bounds.height;
        return '[' + bounds.x + ',' + bounds.y + '][' + right + ',' + bottom + ']';
      }

      function updateHighlight(node) {
        if (!node || !payload.viewport || !payload.screenshotDataUri) {
          highlightBox.style.display = 'none';
          return;
        }

        const viewportWidth = Number(payload.viewport.width || 1);
        const viewportHeight = Number(payload.viewport.height || 1);
        if (viewportWidth <= 0 || viewportHeight <= 0) {
          highlightBox.style.display = 'none';
          return;
        }

        const imageWidth = mirrorImage.clientWidth;
        const imageHeight = mirrorImage.clientHeight;
        if (!imageWidth || !imageHeight) {
          highlightBox.style.display = 'none';
          return;
        }

        const stageWidth = mirrorStage.clientWidth;
        const stageHeight = mirrorStage.clientHeight;
        const offsetX = (stageWidth - imageWidth) / 2;
        const offsetY = (stageHeight - imageHeight) / 2;

        const scaleX = imageWidth / viewportWidth;
        const scaleY = imageHeight / viewportHeight;

        highlightBox.style.display = 'block';
        highlightBox.style.left = (offsetX + node.bounds.x * scaleX) + 'px';
        highlightBox.style.top = (offsetY + node.bounds.y * scaleY) + 'px';
        highlightBox.style.width = Math.max(2, node.bounds.width * scaleX) + 'px';
        highlightBox.style.height = Math.max(2, node.bounds.height * scaleY) + 'px';
      }

      function addStep(action, value) {
        if (!state.recording) {
          statusText.textContent = 'Recording is paused.';
          return;
        }

        const node = currentNode();
        const candidate = selectionCandidates(node)[0];
        if (!candidate) {
          statusText.textContent = 'No locator available for this node.';
          return;
        }

        state.steps.push({
          action,
          locator: candidate.code,
          value: value || undefined
        });

        renderSteps();
        renderCode();
        statusText.textContent = action + ' step added.';
      }

      function renderSteps() {
        stepsBody.innerHTML = '';

        if (state.steps.length === 0) {
          const row = document.createElement('tr');
          row.innerHTML = '<td colspan="3" style="color:#97afd2;">No recorded steps yet. Select a node and add actions.</td>';
          stepsBody.appendChild(row);
          return;
        }

        for (const [index, step] of state.steps.entries()) {
          const row = document.createElement('tr');
          row.innerHTML = '<td>' + (index + 1) + '</td>'
            + '<td>' + sanitize(step.action) + '</td>'
            + '<td class="mono">' + sanitize(step.locator) + '</td>';
          stepsBody.appendChild(row);
        }
      }

      function renderCode() {
        const lines = [];

        if (state.language === 'python') {
          lines.push('from astur_test import expect, test');
          lines.push('');
          lines.push('def test_recorded_flow(device):');
          if (state.steps.length === 0) {
            const node = currentNode();
            const candidate = selectionCandidates(node)[0];
            if (candidate) {
              lines.push('    await ' + toPythonAction('Tap', candidate.code));
            } else {
              lines.push('    pass');
            }
          } else {
            for (const step of state.steps) {
              lines.push('    await ' + toPythonAction(step.action, step.locator, step.value));
            }
          }
        } else {
          lines.push("import { expect, test } from '@astur-mobile/test';");
          lines.push('');
          lines.push("test('recorded flow', async ({ device }) => {");

          if (state.steps.length === 0) {
            const node = currentNode();
            const candidate = selectionCandidates(node)[0];
            if (candidate) {
              lines.push('  await ' + toJsAction('Tap', candidate.code) + ';');
            } else {
              lines.push('  // Select an element and record an action.');
            }
          } else {
            for (const step of state.steps) {
              lines.push('  await ' + toJsAction(step.action, step.locator, step.value) + ';');
            }
          }

          lines.push('});');
        }

        codeBlock.textContent = lines.join('\n');
      }

      function toJsAction(action, locator, value) {
        if (action === 'Fill') {
          return locator + '.fill(' + JSON.stringify(value || '') + ')';
        }

        if (action === 'Expect') {
          return 'expect(' + locator + ').toBeVisible()';
        }

        return locator + '.tap()';
      }

      function toPythonAction(action, locator, value) {
        if (action === 'Fill') {
          return locator + '.fill(' + JSON.stringify(value || '') + ')';
        }

        if (action === 'Expect') {
          return 'expect(' + locator + ').to_be_visible()';
        }

        return locator + '.tap()';
      }

      async function copyText(value) {
        if (navigator.clipboard && window.isSecureContext) {
          try {
            await navigator.clipboard.writeText(value);
            return true;
          } catch {
            return false;
          }
        }

        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.left = '-1000px';
        document.body.appendChild(area);
        area.focus();
        area.select();

        try {
          return document.execCommand('copy');
        } catch {
          return false;
        } finally {
          document.body.removeChild(area);
        }
      }

      function sanitize(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }
    })();
  </script>
</body>
</html>`;
}
