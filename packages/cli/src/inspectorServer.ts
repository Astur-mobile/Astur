import { constants, readFileSync } from 'node:fs';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  Bounds,
  Coordinates,
  DeviceInfo,
  ElementSelector,
  InspectorSession,
  LocatorSuggestion,
  MobileElementSnapshot,
  MobileRole,
  SwipeGesture,
} from '@astur/protocol';

// ─── WebSocket protocol ───────────────────────────────────────────────────────

export type ServerEvent =
  | { type: 'bootstrap'; device: DeviceBootstrapInfo; viewport: Viewport; nodes: UiNode[]; suggestions: LocatorSuggestion[]; initialUid?: string; logoDataUri?: string }
  | { type: 'devices'; devices: DeviceBootstrapInfo[] }
  | { type: 'frame'; dataUri: string; timestamp: number }
  | { type: 'gesture_ack' }
  | { type: 'tree'; nodes: UiNode[]; viewport: Viewport; revision: number }
  | { type: 'selection'; uid: string; node: UiNode; suggestions: LocatorSuggestion[] }
  | { type: 'step'; index: number; action: string; locator: string; value?: string; assertion?: AssertionKind; gesture?: SwipeGesture; point?: Coordinates }
  | { type: 'steps'; steps: RecordingStep[] }
  | { type: 'status'; message: string };

export type AssertionKind = 'visible' | 'text' | 'containsText' | 'value' | 'label' | 'type';
export type InspectorDeviceAction =
  | 'refresh'
  | 'orientation.portrait'
  | 'orientation.landscape'
  | 'keyboard.dismiss'
  | 'device.lock'
  | 'device.unlock'
  | 'navigation.back'
  | 'navigation.home'
  | 'navigation.recents';

export type ClientEvent =
  | { type: 'click'; x: number; y: number; record?: boolean }
  | { type: 'select'; uid: string }
  | { type: 'list_devices' }
  | { type: 'switch_device'; deviceId: string }
  | { type: 'app_action'; action: InspectorAppActionKind; identifier?: string; permission?: string }
  | { type: 'swipe'; gesture: SwipeGesture; record?: boolean }
  | { type: 'record_toggle' }
  | { type: 'add_step'; action: 'tap' | 'fill' | 'expect'; locator: string; value?: string; assertion?: AssertionKind }
  | { type: 'device_action'; action: InspectorDeviceAction }
  | { type: 'clear_steps' }
  | { type: 'export'; lang: 'typescript' | 'javascript' };

export type InspectorAppActionKind =
  | 'launch'
  | 'clearData'
  | 'clearCache'
  | 'grantPermission'
  | 'revokePermission';

export interface DeviceBootstrapInfo {
  id: string;
  name: string;
  platform: string;
  kind: string;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface UiNode {
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

export interface RecordingStep {
  index: number;
  action: string;
  locator: string;
  value?: string;
  assertion?: AssertionKind;
  gesture?: SwipeGesture;
  point?: Coordinates;
}

export interface InspectorSessionBinding {
  device: DeviceInfo;
  inspector: InspectorSession;
}

// ─── Server options ───────────────────────────────────────────────────────────

export interface InspectorServerOptions {
  /** Port to listen on. Picks a free port when 0 or omitted. */
  port?: number;
  /** How often to push screenshots to clients (ms). Default 500. */
  frameIntervalMs?: number;
  /** How often to poll the UI tree (ms). Default 500. */
  treeIntervalMs?: number;
  /** Callback when the server starts. Receives the actual port. */
  onListen?: (port: number) => void;
  /** Capture screenshot for a device. */
  captureScreenshot: () => Promise<Buffer | undefined>;
  /** Perform a device action from the inspector UI. */
  performDeviceAction?: (action: InspectorDeviceAction) => Promise<void>;
  /** Perform a coordinate tap; used by recording mode for responsive mirror clicks. */
  performTap?: (point: Coordinates) => Promise<void>;
  /** Perform a swipe gesture from the mirror. */
  performSwipe?: (gesture: SwipeGesture) => Promise<void>;
  /** Install an uploaded app artifact. */
  installApp?: (path: string) => Promise<void>;
  /** Launch or manage an app by package/bundle identifier. */
  performAppAction?: (action: InspectorAppActionKind, options: { identifier?: string; permission?: string }) => Promise<InspectorSessionBinding | void>;
  /** List switchable devices. */
  listDevices?: () => Promise<DeviceInfo[]>;
  /** Switch the active inspector session to another device. */
  switchDevice?: (deviceId: string) => Promise<InspectorSessionBinding>;
}

export interface InspectorServerHandle {
  port: number;
  close(): void;
}

const INSPECTOR_VERSION = readInspectorVersion();

// ─── Main export ─────────────────────────────────────────────────────────────

export function startInspectorServer(
  inspector: InspectorSession,
  device: DeviceInfo,
  options: InspectorServerOptions
): Promise<InspectorServerHandle> {
  return new Promise((resolveHandle, rejectHandle) => {
    const frameIntervalMs = options.frameIntervalMs ?? 750;
    const treeIntervalMs = options.treeIntervalMs ?? 1200;

    // ── State ──────────────────────────────────────────────────────────────
    let activeInspector = inspector;
    let activeDevice = device;
    let currentNodes: UiNode[] = [];
    let currentViewport: Viewport = { width: 1, height: 1 };
    let revision = 0;
    let recording = false;
    let selectedUid: string | undefined;
    const steps: RecordingStep[] = [];
    let logoDataUri: string | undefined;
    let initialSuggestions: LocatorSuggestion[] = [];
    let gestureCommandInFlight = false;
    let lastGestureCommandAt = 0;

    // ── HTTP server ────────────────────────────────────────────────────────
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';

      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildInspectorHtml(activeDevice));
        return;
      }

      if (url === '/api/bootstrap') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          device: {
            id: activeDevice.id,
            name: activeDevice.name,
            platform: activeDevice.platform,
            kind: activeDevice.kind,
          },
          nodes: currentNodes,
          viewport: currentViewport,
          logoDataUri,
          initialUid: pickInitialUid(currentNodes),
          suggestions: initialSuggestions,
        }));
        return;
      }

      if (url.startsWith('/api/upload-app')) {
        handleAppUpload(req, res).catch((error) => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(formatActionError(error));
        });
        return;
      }

      if (url.startsWith('/api/export')) {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const lang = params.get('lang') === 'javascript' ? 'javascript' : 'typescript';
        const code = generateTestCode(steps, lang);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(code);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    async function handleAppUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      if (!options.installApp) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('App install is unavailable in this inspector session.');
        return;
      }

      const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const name = basename(params.get('filename') || 'astur-uploaded-app');
      const dir = await mkdtemp(join(tmpdir(), 'astur-inspector-upload-'));
      const path = join(dir, name);
      const chunks: Buffer[] = [];

      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      await writeFile(path, Buffer.concat(chunks));
      await options.installApp(path);
      await syncInspectorState();
      broadcast({ type: 'status', message: `Action OK: Installed ${name}` });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path }));
    }

    // ── WebSocket server ───────────────────────────────────────────────────
    const wss = new WebSocketServer({ server });
    const clients = new Set<WebSocket>();

    function broadcast(event: ServerEvent): void {
      const data = JSON.stringify(event);
      for (const client of clients) {
        if (client.readyState === 1 /* OPEN */) {
          client.send(data, () => { /* ignore send errors */ });
        }
      }
    }

    wss.on('connection', (ws: WebSocket) => {
      clients.add(ws);
      ws.on('error', () => { /* swallow per-socket errors */ });

      // Send full bootstrap on connect
      const bootstrapEvent: ServerEvent = {
        type: 'bootstrap',
        device: toBootstrapDevice(activeDevice),
        viewport: currentViewport,
        nodes: currentNodes,
        suggestions: initialSuggestions,
        initialUid: pickInitialUid(currentNodes),
        logoDataUri,
      };
      ws.send(JSON.stringify(bootstrapEvent), () => { /* ignore send errors */ });

      ws.on('close', () => clients.delete(ws));

      ws.on('message', (raw) => {
        let event: ClientEvent;
        try {
          event = JSON.parse(raw.toString()) as ClientEvent;
        } catch {
          return;
        }

        handleClientEvent(event, ws).catch(() => undefined);
      });
    });

    async function handleClientEvent(event: ClientEvent, ws: WebSocket): Promise<void> {
      switch (event.type) {
        case 'click': {
          let uid: string | undefined;
          let node: UiNode | undefined;
          let suggestions: LocatorSuggestion[] = [];
          const shouldRecordTap = recording && event.record !== false;

          const localNode = findUiNodeAtPoint(currentNodes, { x: event.x, y: event.y }, {
            preferActionable: shouldRecordTap
          });
          if (localNode) {
            uid = localNode.uid;
            node = localNode;
            suggestions = suggestLocatorsForNode(localNode, currentNodes);
          }

          if (!node) {
            const hit = await activeInspector.hitTest({ x: event.x, y: event.y });
            if (!hit) {
              return;
            }

            uid = nodeUid(hit, currentNodes);
            node = uid
              ? currentNodes.find((candidate) => candidate.uid === uid)
              : flattenNode(hit, 0, '0');
            node = node ? resolveInspectableNode(node, currentNodes, {
              preferActionable: shouldRecordTap
            }) : undefined;
            uid = node?.uid ?? uid;
            suggestions = node ? suggestLocatorsForNode(node, currentNodes) : [];
          }

          if (!node || !uid) {
            return;
          }

          selectedUid = uid;
          const selectionEvent: ServerEvent = { type: 'selection', uid, node, suggestions };
          ws.send(JSON.stringify(selectionEvent));

          if (shouldRecordTap && !suggestions[0]) {
            if (!options.performTap) {
              ws.send(JSON.stringify({
                type: 'status',
                message: 'Action Error: Tap could not be recorded because the selected element has no stable locator.'
              }));
              break;
            }

            try {
              await options.performTap({ x: event.x, y: event.y });
              const step: RecordingStep = {
                index: steps.length,
                action: 'tapPoint',
                locator: '',
                point: { x: event.x, y: event.y }
              };
              steps.push(step);
              broadcast({ type: 'step', ...step });
              await syncInspectorState();
              broadcast({ type: 'status', message: 'Action OK: Coordinate tap recorded' });
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'status',
                message: `Action Error: Tap failed: ${formatActionError(error)}`
              }));
            }
          }

          if (shouldRecordTap && suggestions[0]) {
            try {
              if (options.performTap) {
                await options.performTap({ x: event.x, y: event.y });
              } else {
                await activeInspector.executeAction({
                  kind: 'tap',
                  selector: suggestions[0].selector,
                  options: { timeout: 2_000 }
                });
              }
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'status',
                message: `Action Error: Tap failed: ${formatActionError(error)}`
              }));
              return;
            }

            const step: RecordingStep = {
              index: steps.length,
              action: 'tap',
              locator: normalizeRecordingLocator(suggestions[0].code),
            };
            steps.push(step);
            broadcast({ type: 'step', ...step });
            await syncInspectorState();
            broadcast({ type: 'status', message: 'Action OK: Tap recorded' });
          }
          break;
        }

        case 'select': {
          const rawNode = currentNodes.find((n) => n.uid === event.uid);
          const node = rawNode ? resolveInspectableNode(rawNode, currentNodes) : undefined;
          if (!node) {
            return;
          }

          const suggestions = suggestLocatorsForNode(node, currentNodes);
          selectedUid = node.uid;
          const selectionEvent: ServerEvent = { type: 'selection', uid: node.uid, node, suggestions };
          ws.send(JSON.stringify(selectionEvent));
          break;
        }

        case 'list_devices': {
          if (!options.listDevices) {
            ws.send(JSON.stringify({ type: 'devices', devices: [toBootstrapDevice(activeDevice)] }));
            break;
          }

          const devices = await options.listDevices();
          ws.send(JSON.stringify({ type: 'devices', devices: devices.map(toBootstrapDevice) }));
          break;
        }

        case 'switch_device': {
          if (!options.switchDevice) {
            ws.send(JSON.stringify({ type: 'status', message: 'Action Error: Device switching is unavailable in this session.' }));
            break;
          }

          try {
            broadcast({ type: 'status', message: 'Action Pending: Switching device...' });
            const binding = await options.switchDevice(event.deviceId);
            activeDevice = binding.device;
            activeInspector = binding.inspector;
            currentNodes = [];
            currentViewport = { width: 1, height: 1 };
            selectedUid = undefined;
            initialSuggestions = [];
            revision += 1;
            broadcast({
              type: 'bootstrap',
              device: toBootstrapDevice(activeDevice),
              viewport: currentViewport,
              nodes: currentNodes,
              suggestions: [],
              logoDataUri
            });
            await syncInspectorState();
            broadcast({ type: 'status', message: `Action OK: Switched to ${activeDevice.name}` });
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'status',
              message: `Action Error: Device switch failed: ${formatActionError(error)}`
            }));
          }
          break;
        }

        case 'app_action': {
          if (!options.performAppAction) {
            ws.send(JSON.stringify({ type: 'status', message: 'Action Error: App actions are unavailable in this session.' }));
            break;
          }

          try {
            const binding = await options.performAppAction(event.action, {
              identifier: event.identifier,
              permission: event.permission
            });
            if (binding) {
              activeDevice = binding.device;
              activeInspector = binding.inspector;
              currentNodes = [];
              currentViewport = { width: 1, height: 1 };
              selectedUid = undefined;
              initialSuggestions = [];
              revision += 1;
              broadcast({
                type: 'bootstrap',
                device: toBootstrapDevice(activeDevice),
                viewport: currentViewport,
                nodes: currentNodes,
                suggestions: [],
                logoDataUri
              });
            }
            await syncInspectorState();
            broadcast({ type: 'status', message: `Action OK: ${inspectorAppActionLabel(event.action)}` });
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'status',
              message: `Action Error: ${inspectorAppActionLabel(event.action)} failed: ${formatActionError(error)}`
            }));
          }
          break;
        }

        case 'swipe': {
          if (!options.performSwipe) {
            ws.send(JSON.stringify({ type: 'status', message: 'Action Error: Swipe is unavailable in this session.' }));
            break;
          }

          const now = Date.now();
          if (gestureCommandInFlight || now - lastGestureCommandAt < 350) {
            ws.send(JSON.stringify({ type: 'gesture_ack' }));
            break;
          }

          gestureCommandInFlight = true;
          lastGestureCommandAt = now;
          try {
            await options.performSwipe(event.gesture);
            if (recording && event.record !== false) {
              const step: RecordingStep = {
                index: steps.length,
                action: 'swipe',
                locator: '',
                gesture: event.gesture
              };
              steps.push(step);
              broadcast({ type: 'step', ...step });
            }
            await syncInspectorState();
            broadcast({ type: 'status', message: recording ? 'Action OK: Swipe recorded' : 'Action OK: Swiped' });
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'status',
              message: `Action Error: Swipe failed: ${formatActionError(error)}`
            }));
          } finally {
            gestureCommandInFlight = false;
          }
          break;
        }

        case 'record_toggle': {
          recording = !recording;
          broadcast({ type: 'status', message: recording ? 'Recording ON' : 'Recording OFF' });
          break;
        }

        case 'add_step': {
          const step: RecordingStep = {
            index: steps.length,
            action: event.action,
            locator: normalizeRecordingLocator(event.locator),
            value: event.value,
            assertion: event.assertion,
          };
          steps.push(step);
          broadcast({ type: 'step', ...step });
          break;
        }

        case 'device_action': {
          if (event.action === 'refresh') {
            await syncInspectorState();
            broadcast({ type: 'status', message: 'Action OK: Refreshed screen and tree' });
            break;
          }

          if (!options.performDeviceAction) {
            ws.send(JSON.stringify({ type: 'status', message: 'Action Error: Device actions are unavailable in this session.' }));
            break;
          }

          try {
            await options.performDeviceAction(event.action);
            await syncInspectorState();
            broadcast({ type: 'status', message: `Action OK: ${inspectorDeviceActionLabel(event.action)}` });
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'status',
              message: `Action Error: ${inspectorDeviceActionLabel(event.action)} failed: ${formatActionError(error)}`
            }));
          }
          break;
        }

        case 'clear_steps': {
          steps.length = 0;
          broadcast({ type: 'steps', steps: [] });
          break;
        }

        case 'export': {
          const code = generateTestCode(steps, event.lang);
          ws.send(JSON.stringify({ type: 'status', message: `Export:\n${code}` }));
          break;
        }
      }
    }

    // ── Frame streaming loop ────────────────────────────────────────────────
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    let frameInFlight = false;

    async function pushFrame(): Promise<void> {
      if (clients.size === 0 || frameInFlight) {
        return;
      }

      frameInFlight = true;
      try {
        const buf = await options.captureScreenshot();
        if (buf && buf.length > 0) {
          broadcast({
            type: 'frame',
            dataUri: `data:image/png;base64,${buf.toString('base64')}`,
            timestamp: Date.now(),
          });
        }
      } catch {
        // device may be busy
      } finally {
        frameInFlight = false;
      }
    }

    function scheduleFrame(): void {
      frameTimer = setTimeout(async () => {
        await pushFrame();
        scheduleFrame();
      }, frameIntervalMs);
    }

    // ── Tree polling loop ──────────────────────────────────────────────────
    let treeTimer: ReturnType<typeof setTimeout> | undefined;
    let treeInFlight = false;
    let lastTreeErrorMessage: string | undefined;
    let lastTreeErrorAt = 0;
    let consecutiveTreeErrors = 0;

    async function pushTree(): Promise<void> {
      if (treeInFlight) {
        return;
      }

      treeInFlight = true;
      try {
        for await (const update of activeInspector.subscribeTree({ maxUpdates: 1 })) {
          const nodes = flattenSnapshot(update.root);
          const viewport = estimateViewport(nodes);
          currentNodes = nodes;
          currentViewport = viewport;
          consecutiveTreeErrors = 0;
          lastTreeErrorMessage = undefined;
          revision += 1;
          const initialUid = selectedUid ?? pickInitialUid(currentNodes);
          const initialNode = initialUid
            ? currentNodes.find((node) => node.uid === initialUid)
            : undefined;
          initialSuggestions = initialNode ? suggestLocatorsForNode(initialNode, currentNodes) : [];
          broadcast({ type: 'tree', nodes, viewport, revision });
          break;
        }
      } catch (error) {
        consecutiveTreeErrors += 1;
        const message = formatActionError(error);
        const now = Date.now();
        if (consecutiveTreeErrors < 2 && currentNodes.length > 0) {
          return;
        }

        if (message !== lastTreeErrorMessage || now - lastTreeErrorAt > 8_000) {
          lastTreeErrorMessage = message;
          lastTreeErrorAt = now;
          const prefix = currentNodes.length > 0 ? 'Action Pending' : 'Action Error';
          const label = currentNodes.length > 0 ? 'UI tree refresh delayed' : 'UI tree unavailable';
          broadcast({
            type: 'status',
            message: `${prefix}: ${label}: ${message}`
          });
        }
      } finally {
        treeInFlight = false;
      }
    }

    async function syncInspectorState(): Promise<void> {
      await Promise.allSettled([pushFrame(), pushTree()]);
    }

    function scheduleTree(): void {
      treeTimer = setTimeout(async () => {
        await pushTree();
        scheduleTree();
      }, treeIntervalMs);
    }

    // ── Startup ────────────────────────────────────────────────────────────
    server.listen(options.port ?? 0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      // Resolve the handle immediately — browser opens now, data streams in
      scheduleFrame();
      scheduleTree();
      void syncInspectorState();

      options.onListen?.(port);
      resolveHandle({
        port,
        close() {
          clearTimeout(frameTimer);
          clearTimeout(treeTimer);
          wss.close();
          server.close();
        },
      });

      // Load logo asynchronously and push to any connected clients
      readAsturLogoDataUri().then((uri) => {
        logoDataUri = uri;
      }).catch(() => undefined);
    });

    server.on('error', rejectHandle);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flattenSnapshot(root: MobileElementSnapshot): UiNode[] {
  const nodes: UiNode[] = [];

  const visit = (node: MobileElementSnapshot, depth: number, uid: string, parentUid?: string): void => {
    nodes.push(flattenNode(node, depth, uid, parentUid));
    for (const [i, child] of node.children.entries()) {
      visit(child, depth + 1, `${uid}.${i}`, uid);
    }
  };

  visit(root, 0, '0');
  return nodes;
}

function flattenNode(node: MobileElementSnapshot, depth: number, uid: string, parentUid?: string): UiNode {
  return {
    uid,
    parentUid,
    depth,
    title: titleForNode({
      id: node.id,
      label: node.label,
      text: node.text,
      value: node.value,
      type: node.type,
    }),
    type: node.type,
    id: node.id,
    label: node.label,
    text: node.text,
    value: node.value,
    visible: node.visible,
    enabled: node.enabled,
    bounds: node.bounds,
  };
}

function estimateViewport(nodes: UiNode[]): Viewport {
  const root = nodes[0];
  if (root?.bounds && root.bounds.width > 0 && root.bounds.height > 0) {
    return {
      width: Math.max(1, root.bounds.x + root.bounds.width),
      height: Math.max(1, root.bounds.y + root.bounds.height)
    };
  }

  const visible = nodes.filter((n) => n.visible && n.bounds.width > 0 && n.bounds.height > 0);
  const right = Math.max(1, ...visible.map((n) => n.bounds.x + n.bounds.width));
  const bottom = Math.max(1, ...visible.map((n) => n.bounds.y + n.bounds.height));
  return { width: right, height: bottom };
}

function pickInitialUid(nodes: UiNode[]): string | undefined {
  return [...nodes]
    .filter((node) => node.visible && node.enabled && !isRootNode(node))
    .sort((left, right) => scoreInspectableNode(right, { preferActionable: true })
      - scoreInspectableNode(left, { preferActionable: true }))[0]?.uid ?? nodes[0]?.uid;
}

function findUiNodeAtPoint(
  nodes: UiNode[],
  point: { x: number; y: number },
  options: { preferActionable?: boolean } = {}
): UiNode | undefined {
  let best: UiNode | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    if (!node.visible || node.bounds.width <= 0 || node.bounds.height <= 0) {
      continue;
    }

    if (!containsPoint(node.bounds, point)) {
      continue;
    }

    const score = scoreInspectableNode(node, options);
    if (!best || score > bestScore) {
      best = node;
      bestScore = score;
      continue;
    }

    const bestArea = best.bounds.width * best.bounds.height;
    const nodeArea = node.bounds.width * node.bounds.height;
    if (score === bestScore && (node.depth > best.depth || (node.depth === best.depth && nodeArea <= bestArea))) {
      best = node;
    }
  }

  return best ? resolveInspectableNode(best, nodes, options) : undefined;
}

function nodeUid(hit: MobileElementSnapshot, nodes: UiNode[]): string | undefined {
  // Try to find by bounds + type match in the flattened tree
  return nodes.find((n) =>
    n.type === hit.type &&
    n.bounds.x === hit.bounds.x &&
    n.bounds.y === hit.bounds.y &&
    n.bounds.width === hit.bounds.width &&
    n.bounds.height === hit.bounds.height
  )?.uid;
}

interface LocalLocatorCandidate {
  selector: ElementSelector;
  code: string;
  baseScore: number;
  crossPlatform: boolean;
  stabilityHint: number;
}

const INSPECTOR_ROLES: readonly MobileRole[] = [
  'button',
  'checkbox',
  'image',
  'img',
  'link',
  'menuitem',
  'radio',
  'slider',
  'switch',
  'tab',
  'text',
  'textbox'
];

function suggestLocatorsForNode(node: UiNode, nodes: UiNode[]): LocatorSuggestion[] {
  const target = resolveInspectableNode(node, nodes);
  const candidates = buildLocalLocatorCandidates(target);
  const suggestions: LocatorSuggestion[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const code = normalizeRecordingLocator(candidate.code);
    if (seen.has(code)) {
      continue;
    }

    seen.add(code);
    const matched = nodes.filter((candidateNode) => uiNodeMatchesSelector(candidateNode, candidate.selector));
    const uniqueness = matched.length > 0 ? 1 / matched.length : 0;
    const stability = clampScore(candidate.stabilityHint);
    const readable = code.length <= 88;
    const score = scoreLocatorCandidate(candidate.baseScore, uniqueness, stability, readable);

    suggestions.push({
      code,
      selector: candidate.selector,
      score,
      uniqueness: roundScore(uniqueness),
      stability: roundScore(stability),
      readable,
      crossPlatform: candidate.crossPlatform,
    });
  }

  return suggestions
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.code.length - right.code.length;
    })
    .slice(0, 8);
}

function buildLocalLocatorCandidates(node: UiNode): LocalLocatorCandidate[] {
  const candidates: LocalLocatorCandidate[] = [];
  const id = normalizeLocatorToken(node.id);
  const label = normalizeLocatorToken(node.label);
  const text = normalizeLocatorToken(node.text);
  const value = normalizeLocatorToken(node.value);
  const name = label ?? text ?? value;
  const role = inferUiRole(node, name);

  if (id) {
    candidates.push({
      selector: { strategy: 'id', value: id, exact: true },
      code: `getByTestId('${escapeSingleQuotes(id)}')`,
      baseScore: 0.99,
      crossPlatform: true,
      stabilityHint: scoreStableToken(id, 'id')
    });

    candidates.push({
      selector: { strategy: 'id', value: id, exact: true },
      code: `getById('${escapeSingleQuotes(id)}')`,
      baseScore: 0.96,
      crossPlatform: true,
      stabilityHint: scoreStableToken(id, 'id')
    });
  }

  if (role && name) {
    candidates.push({
      selector: { strategy: 'role', value: role, name, exact: true },
      code: `getByRole('${escapeSingleQuotes(role)}', { name: '${escapeSingleQuotes(name)}' })`,
      baseScore: 0.92,
      crossPlatform: true,
      stabilityHint: scoreStableToken(name, 'text')
    });
  }

  if (label) {
    candidates.push({
      selector: { strategy: 'accessibility', value: label, exact: true },
      code: `getByLabel('${escapeSingleQuotes(label)}')`,
      baseScore: 0.89,
      crossPlatform: true,
      stabilityHint: scoreStableToken(label, 'accessibility')
    });
  }

  if (text) {
    candidates.push({
      selector: { strategy: 'text', value: text, exact: true },
      code: `getByText('${escapeSingleQuotes(text)}')`,
      baseScore: 0.84,
      crossPlatform: true,
      stabilityHint: scoreStableToken(text, 'text')
    });
  }

  const type = normalizeLocatorToken(node.type);
  if (type && candidates.length === 0) {
    candidates.push({
      selector: { strategy: 'type', value: type, exact: true },
      code: `getByType('${escapeSingleQuotes(type)}')`,
      baseScore: 0.45,
      crossPlatform: false,
      stabilityHint: 0.45
    });
  }

  return candidates;
}

function resolveInspectableNode(
  node: UiNode,
  nodes: UiNode[],
  options: { preferActionable?: boolean } = {}
): UiNode {
  const targetIsUsable = hasUsableLocator(node) && !isDecorativeNode(node);
  const targetIsActionable = targetIsUsable && isActionableNode(node);

  if (!options.preferActionable && targetIsUsable) {
    return node;
  }

  if (options.preferActionable && targetIsActionable) {
    return node;
  }

  for (const ancestor of ancestorsOf(node, nodes)) {
    if (!hasUsableLocator(ancestor) || isDecorativeNode(ancestor)) {
      continue;
    }

    if (!options.preferActionable || isActionableNode(ancestor) || !targetIsUsable) {
      return ancestor;
    }
  }

  return targetIsUsable ? node : nearestUsableDescendant(node, nodes) ?? node;
}

function ancestorsOf(node: UiNode, nodes: UiNode[]): UiNode[] {
  const ancestors: UiNode[] = [];
  let parentUid = node.parentUid;

  while (parentUid) {
    const parent = nodes.find((candidate) => candidate.uid === parentUid);
    if (!parent) {
      break;
    }

    ancestors.push(parent);
    parentUid = parent.parentUid;
  }

  return ancestors;
}

function nearestUsableDescendant(node: UiNode, nodes: UiNode[]): UiNode | undefined {
  return nodes
    .filter((candidate) => candidate.uid.startsWith(`${node.uid}.`) && hasUsableLocator(candidate))
    .sort((left, right) => left.depth - right.depth)[0];
}

function scoreInspectableNode(node: UiNode, options: { preferActionable?: boolean } = {}): number {
  if (!node.visible || node.bounds.width <= 0 || node.bounds.height <= 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (normalizeLocatorToken(node.id)) score += 80;
  if (normalizeLocatorToken(node.label)) score += 70;
  if (normalizeLocatorToken(node.text)) score += 42;
  if (normalizeLocatorToken(node.value)) score += 28;
  if (node.enabled) score += 12;
  if (isActionableNode(node)) score += options.preferActionable ? 72 : 24;
  if (isFillableNode(node)) score += 24;
  if (isRootNode(node)) score -= 160;
  if (isGenericContainer(node) && !hasUsableLocator(node)) score -= 50;
  if (isDecorativeNode(node)) score -= 90;

  const area = node.bounds.width * node.bounds.height;
  if (area > 0) {
    score -= Math.min(24, Math.log10(area) * 3);
  }

  return score + Math.min(node.depth, 14);
}

function uiNodeMatchesSelector(node: UiNode, selector: ElementSelector): boolean {
  switch (selector.strategy) {
    case 'accessibility':
      return matchSelectorValue(node.label, selector) || matchSelectorValue(node.id, selector);
    case 'id':
      return matchSelectorValue(node.id, selector);
    case 'role':
      return rolesForNode(node).includes(normalizeRole(selector.value)) && matchAccessibleName(node, selector);
    case 'text':
      return matchSelectorValue(node.text, selector) || matchSelectorValue(node.label, selector);
    case 'type':
      return selector.value.trim().toLowerCase() === 'any' || matchSelectorValue(node.type, selector);
    case 'coordinates':
    case 'xpath':
      return false;
  }
}

function matchAccessibleName(node: UiNode, selector: ElementSelector): boolean {
  if (selector.name === undefined) {
    return true;
  }

  return [node.label, node.text, node.value, node.id]
    .some((value) => matchExpected(value, selector.name!, selector.exact));
}

function matchSelectorValue(actual: string | undefined, selector: ElementSelector): boolean {
  return matchExpected(actual, selector.value, selector.exact);
}

function matchExpected(actual: string | undefined, expected: string | RegExp, exact = true): boolean {
  if (!actual) {
    return false;
  }

  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    const result = expected.test(actual);
    expected.lastIndex = 0;
    return result;
  }

  return exact === false ? actual.includes(expected) : actual === expected;
}

function inferUiRole(node: UiNode, name?: string): MobileRole | undefined {
  return INSPECTOR_ROLES.find((role) => {
    if (!rolesForNode(node).includes(role)) {
      return false;
    }

    return name ? matchAccessibleName(node, { strategy: 'role', value: role, name, exact: true }) : true;
  });
}

function rolesForNode(node: UiNode): MobileRole[] {
  const type = node.type.toLowerCase();
  const roles = new Set<MobileRole>();

  if (type.includes('button')) roles.add('button');
  if (type.includes('checkbox')) roles.add('checkbox');
  if (type.includes('image')) {
    roles.add('image');
    roles.add('img');
  }
  if (type.includes('link')) roles.add('link');
  if (type.includes('menuitem')) roles.add('menuitem');
  if (type.includes('radiobutton') || type.endsWith('.radio') || type.includes('radio')) roles.add('radio');
  if (type.includes('seekbar') || type.includes('slider')) roles.add('slider');
  if (type.includes('switch')) roles.add('switch');
  if (type.includes('tab')) roles.add('tab');
  if (type.includes('edittext') || type.includes('textfield') || type.includes('securetextfield') || type.includes('searchfield') || type.includes('textinput')) roles.add('textbox');
  if (type.includes('textview') || type.includes('statictext') || type.includes('label')) roles.add('text');

  return [...roles];
}

function isActionableNode(node: UiNode): boolean {
  const roles = rolesForNode(node);
  return roles.some((role) => role !== 'text' && role !== 'image' && role !== 'img')
    || node.type.toLowerCase().includes('button');
}

function isFillableNode(node: UiNode): boolean {
  return rolesForNode(node).includes('textbox');
}

function isRootNode(node: UiNode): boolean {
  return node.type.endsWith('.root') || node.type === 'root' || node.uid === '0';
}

function isGenericContainer(node: UiNode): boolean {
  const type = node.type.toLowerCase();
  return type.includes('viewgroup')
    || type.includes('framelayout')
    || type.includes('linearlayout')
    || type.includes('scrollview')
    || type.includes('recyclerview')
    || type.endsWith('.view');
}

function hasUsableLocator(node: UiNode): boolean {
  return Boolean(normalizeLocatorToken(node.id)
    || normalizeLocatorToken(node.label)
    || normalizeLocatorToken(node.text)
    || normalizeLocatorToken(node.value));
}

function isDecorativeNode(node: UiNode): boolean {
  if (normalizeLocatorToken(node.id)
    || normalizeLocatorToken(node.label)
    || normalizeLocatorToken(node.text)
    || normalizeLocatorToken(node.value)) {
    return false;
  }

  return Boolean(
    isDecorativeToken(node.text)
      || isDecorativeToken(node.label)
      || isDecorativeToken(node.value)
  );
}

function titleForNode(node: Pick<UiNode, 'id' | 'label' | 'text' | 'value' | 'type'>): string {
  return normalizeLocatorToken(node.label)
    ?? normalizeLocatorToken(node.text)
    ?? normalizeLocatorToken(node.value)
    ?? shortId(node.id)
    ?? node.type;
}

function shortId(value: string | undefined): string | undefined {
  const id = normalizeLocatorToken(value);
  if (!id) {
    return undefined;
  }

  return id.split('/').pop() ?? id;
}

function normalizeLocatorToken(value: string | undefined): string | undefined {
  const token = value
    ?.replace(/&#x[0-9a-f]+;?/gi, '')
    .replace(/&#\d+;?/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();

  if (!token || isDecorativeToken(token)) {
    return undefined;
  }

  return token;
}

function isDecorativeToken(value: string | undefined): boolean {
  const token = value?.trim();
  if (!token) {
    return false;
  }

  return /^&#(?:x[0-9a-f]+|\d+);?$/i.test(token)
    || (token.length <= 2 && !/[A-Za-z0-9]/.test(token));
}

function scoreLocatorCandidate(baseScore: number, uniqueness: number, stability: number, readable: boolean): number {
  const uniquenessWeight = 0.45 + clampScore(uniqueness) * 0.55;
  const stabilityWeight = 0.6 + clampScore(stability) * 0.4;
  const readabilityWeight = readable ? 1 : 0.92;
  return roundScore(clampScore(baseScore * uniquenessWeight * stabilityWeight * readabilityWeight));
}

function scoreStableToken(value: string, strategy: ElementSelector['strategy']): number {
  let score = 1;

  if (value.length > 72) score -= 0.1;
  if (/\b(tmp|temp|debug|sample|placeholder)\b/i.test(value)) score -= 0.25;
  if (/\d{3,}/.test(value)) score -= strategy === 'id' ? 0.08 : 0.2;
  if (/[a-f0-9]{8,}/i.test(value)) score -= 0.2;
  if (strategy === 'text' && value.length <= 2) score -= 0.2;
  if (strategy === 'type') score = Math.min(score, 0.45);

  return clampScore(score);
}

function normalizeRole(role: string): MobileRole {
  return (role === 'img' ? 'img' : role.trim().toLowerCase()) as MobileRole;
}

function normalizeRecordingLocator(locator: string): string {
  return locator.trim().replace(/^device\./, '');
}

function escapeSingleQuotes(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function containsPoint(bounds: Bounds, point: { x: number; y: number }): boolean {
  return point.x >= bounds.x
    && point.y >= bounds.y
    && point.x <= bounds.x + bounds.width
    && point.y <= bounds.y + bounds.height;
}

async function readAsturLogoDataUri(): Promise<string | undefined> {
  const candidates = [
    fileURLToPath(new URL('../assets/brand/astur-logo-dark.png', import.meta.url)),
    fileURLToPath(new URL('../assets/brand/astur-logo-light.png', import.meta.url)),
    resolve(process.cwd(), 'packages/cli/assets/brand/astur-logo-dark.png'),
    resolve(process.cwd(), 'packages/cli/assets/brand/astur-logo-light.png'),
  ];

  for (const p of candidates) {
    try {
      await access(p, constants.F_OK);
      const buf = await readFile(p);
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      // try next
    }
  }
  return undefined;
}

function readInspectorVersion(): string {
  try {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    return packageJson.version ?? 'dev';
  } catch {
    return 'dev';
  }
}

function generateTestCode(steps: RecordingStep[], lang: 'typescript' | 'javascript'): string {
  if (!steps.length) {
    return '// No steps recorded yet';
  }

  const importLine = lang === 'typescript'
    ? `import { test, expect } from '@astur/test';`
    : `const { test, expect } = require('@astur/test');`;

  const lines = steps.map((s) => generateRecordedStepCode(s));

  return `${importLine}\n\ntest('recorded flow', async ({ device }) => {\n${lines.join('\n')}\n});\n`;
}

function generateRecordedStepCode(step: RecordingStep): string {
  const locator = normalizeRecordingLocator(step.locator);

  if (step.action === 'swipe' && step.gesture) {
    return `  await device.swipe(${JSON.stringify(step.gesture)});`;
  }

  if (step.action === 'tapPoint' && step.point) {
    return `  await device.tap(${JSON.stringify(step.point)});`;
  }

  if (step.action === 'fill') {
    return `  await device.${locator}.fill(${JSON.stringify(step.value ?? '')});`;
  }

  if (step.action === 'expect') {
    const actual = `device.${locator}`;
    switch (step.assertion ?? 'visible') {
      case 'text':
        return `  await expect(${actual}).toHaveText(${JSON.stringify(step.value ?? '')});`;
      case 'containsText':
        return `  await expect(${actual}).toContainText(${JSON.stringify(step.value ?? '')});`;
      case 'value':
        return `  await expect(${actual}).toHaveValue(${JSON.stringify(step.value ?? '')});`;
      case 'label':
        return `  await expect(${actual}).toHaveLabel(${JSON.stringify(step.value ?? '')});`;
      case 'type':
        return `  await expect(${actual}).toHaveType(${JSON.stringify(step.value ?? '')});`;
      case 'visible':
      default:
        return `  await expect(${actual}).toBeVisible();`;
    }
  }

  return `  await device.${locator}.tap();`;
}

export interface InspectorDeviceActionDefinition {
  id: InspectorDeviceAction;
  label: string;
  group: 'device' | 'navigation';
}

const BASE_INSPECTOR_DEVICE_ACTIONS: readonly InspectorDeviceActionDefinition[] = [
  { id: 'refresh', label: 'Refresh', group: 'device' },
  { id: 'orientation.portrait', label: 'Portrait', group: 'device' },
  { id: 'orientation.landscape', label: 'Landscape', group: 'device' },
  { id: 'keyboard.dismiss', label: 'Dismiss Keyboard', group: 'device' },
];

const LOCK_INSPECTOR_DEVICE_ACTIONS: readonly InspectorDeviceActionDefinition[] = [
  { id: 'device.lock', label: 'Lock', group: 'device' },
  { id: 'device.unlock', label: 'Unlock', group: 'device' },
];

const ANDROID_NAVIGATION_ACTIONS: readonly InspectorDeviceActionDefinition[] = [
  { id: 'navigation.back', label: 'Back', group: 'navigation' },
  { id: 'navigation.home', label: 'Home', group: 'navigation' },
  { id: 'navigation.recents', label: 'Recents', group: 'navigation' },
];

const ALL_INSPECTOR_DEVICE_ACTIONS = [
  ...BASE_INSPECTOR_DEVICE_ACTIONS,
  ...LOCK_INSPECTOR_DEVICE_ACTIONS,
  ...ANDROID_NAVIGATION_ACTIONS,
] as const;

function getInspectorDeviceActionDefinitions(device: Pick<DeviceInfo, 'platform' | 'kind'>): InspectorDeviceActionDefinition[] {
  const actions = [...BASE_INSPECTOR_DEVICE_ACTIONS];

  if (device.platform === 'android' || (device.platform === 'ios' && device.kind === 'simulator')) {
    actions.push(...LOCK_INSPECTOR_DEVICE_ACTIONS);
  }

  if (device.platform === 'android') {
    actions.push(...ANDROID_NAVIGATION_ACTIONS);
  }

  return actions;
}

function inspectorDeviceActionLabel(action: InspectorDeviceAction): string {
  return ALL_INSPECTOR_DEVICE_ACTIONS.find((candidate) => candidate.id === action)?.label ?? action;
}

function formatActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderInspectorDeviceActionMenu(device: DeviceInfo): string {
  const actions = getInspectorDeviceActionDefinitions(device);
  const groups = [
    { id: 'device', label: 'Device' },
    { id: 'navigation', label: 'Navigation' },
  ] as const;

  return groups.map((group) => {
    const groupActions = actions.filter((action) => action.group === group.id);
    if (!groupActions.length) {
      return '';
    }

    const items = groupActions.map((action) => (
      `<button type="button" class="device-action-btn icon" data-action="${action.id}" data-label="${escHtml(action.label)}" title="${escHtml(action.label)}" aria-label="${escHtml(action.label)}">${inspectorDeviceActionIcon(action.id)}</button>`
    )).join('');

    return `<div class="device-menu-section"><div class="device-menu-label">${group.label}</div><div class="device-menu-actions">${items}</div></div>`;
  }).join('');
}

function inspectorDeviceActionIcon(action: InspectorDeviceAction): string {
  switch (action) {
    case 'refresh':
      return iconSvg('<path d="M21 12a9 9 0 0 1-9 9 8.7 8.7 0 0 1-6.2-2.6"/><path d="M3 12a9 9 0 0 1 15.2-6.5"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/>');
    case 'orientation.portrait':
      return iconSvg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>');
    case 'orientation.landscape':
      return iconSvg('<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M18 11v2"/>');
    case 'keyboard.dismiss':
      return iconSvg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M19 9h.01M7 13h10"/><path d="m8 21 4-4 4 4"/>');
    case 'device.lock':
      return iconSvg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
    case 'device.unlock':
      return iconSvg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>');
    case 'navigation.back':
      return iconSvg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>');
    case 'navigation.home':
      return iconSvg('<path d="m3 10 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>');
    case 'navigation.recents':
      return iconSvg('<rect x="4" y="5" width="14" height="14" rx="2"/><path d="M8 3h12v12"/>');
  }
}

function iconSvg(paths: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}

function toBootstrapDevice(device: DeviceInfo): DeviceBootstrapInfo {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    kind: device.kind
  };
}

function inspectorAppActionLabel(action: InspectorAppActionKind): string {
  switch (action) {
    case 'launch':
      return 'Launch app';
    case 'clearData':
      return 'Clear app data';
    case 'clearCache':
      return 'Clear app cache';
    case 'grantPermission':
      return 'Grant permission';
    case 'revokePermission':
      return 'Revoke permission';
  }
}

export const __testing = {
  generateTestCode,
  generateRecordedStepCode,
  getInspectorDeviceActionDefinitions,
  inspectorDeviceActionLabel,
  findUiNodeAtPoint,
  normalizeRecordingLocator,
  suggestLocatorsForNode,
};

// ─── Inspector HTML app ───────────────────────────────────────────────────────

function buildInspectorHtml(device: DeviceInfo): string {
  const title = `Astur Inspector — ${device.name}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escHtml(title)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--surface:#161b22;--surface2:#21262d;--border:#30363d;
  --text:#e6edf3;--text-dim:#8b949e;--text-muted:#484f58;
  --accent:#1f6feb;--accent-hover:#388bfd;--green:#3fb950;--red:#f85149;
  --yellow:#d29922;--purple:#8b5cf6;--radius:6px;--font:system-ui,sans-serif;
  --mono:"SFMono-Regular",Consolas,monospace;
}
html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--text);font:13px/1.5 var(--font)}
/* Layout */
#app{display:grid;grid-template-rows:48px 1fr;height:100vh}
#topbar{display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}
#main{display:grid;grid-template-columns:300px 10px minmax(0,1fr) 10px 340px;overflow:hidden}
/* Top bar */
#logo{height:22px;object-fit:contain;flex-shrink:0}
#logo-text{font-weight:700;font-size:14px;color:var(--text);margin-right:4px}
#version-chip{padding:2px 8px;border:1px solid var(--border);border-radius:999px;font-size:11px;line-height:1;color:var(--text-muted);background:rgba(255,255,255,.03)}
.tb-sep{width:1px;height:24px;background:var(--border);margin:0 4px}
#device-switcher{position:relative;display:flex;align-items:center}
#device-chip{display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--surface2);border-radius:var(--radius);font-size:12px;color:var(--text-dim)}
#device-chip{cursor:pointer;border:1px solid transparent}
#device-chip:hover,#device-switcher.open #device-chip{border-color:var(--accent);color:var(--accent-hover)}
#device-list-menu{display:none;position:absolute;top:calc(100% + 8px);left:0;width:min(380px,calc(100vw - 28px));max-height:min(420px,calc(100vh - 70px));overflow:auto;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);box-shadow:0 18px 40px rgba(0,0,0,.35);z-index:35}
#device-switcher.open #device-list-menu{display:flex;flex-direction:column;gap:8px}
#live-badge{padding:3px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#1a3d1a;color:var(--green);border:1px solid #2e6b2e;display:flex;align-items:center;gap:4px}
#live-badge.connecting{background:#3a2a10;color:var(--yellow);border-color:#6a4e20}
#live-badge::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor;flex-shrink:0}
#device-controls{position:relative;display:flex;align-items:center;gap:8px;margin-left:auto}
#device-menu-btn{padding:6px 12px;border-radius:var(--radius);border:1px solid var(--border);font-size:12px;font-weight:600;cursor:pointer;background:var(--surface2);color:var(--text);transition:all .15s}
#device-menu-btn:hover,#device-controls.open #device-menu-btn{border-color:var(--accent);color:var(--accent-hover)}
#device-status{max-width:220px;font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#device-status[data-tone="pending"]{color:var(--yellow)}
#device-status[data-tone="success"]{color:var(--green)}
#device-status[data-tone="error"]{color:var(--red)}
#device-menu{display:none;position:absolute;top:calc(100% + 8px);right:0;width:min(440px,calc(100vw - 28px));max-height:min(620px,calc(100vh - 70px));overflow:auto;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);box-shadow:0 18px 40px rgba(0,0,0,.35);z-index:30}
#device-controls.open #device-menu{display:flex;flex-direction:column;gap:10px}
.device-menu-section{display:flex;flex-direction:column;gap:6px}
.device-menu-label{font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);text-transform:uppercase}
.device-menu-actions{display:flex;flex-wrap:wrap;gap:6px}
.device-action-btn{padding:5px 10px;border-radius:var(--radius);border:1px solid var(--border);font-size:11px;font-weight:600;cursor:pointer;background:var(--surface2);color:var(--text)}
.device-action-btn:hover{border-color:var(--accent);color:var(--accent-hover)}
.device-action-btn.icon{width:32px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center}
.device-action-btn.icon svg{width:15px;height:15px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
.device-row{display:flex;gap:6px;align-items:center}
.device-input{min-width:0;flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:6px 8px;font:11px var(--font);color:var(--text);outline:none}
.device-input:focus{border-color:var(--accent)}
.device-list{display:flex;flex-direction:column;gap:4px;max-height:150px;overflow:auto}
.device-choice{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;padding:7px 8px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:11px}
.device-choice.active{border-color:var(--accent);color:var(--accent-hover)}
.device-choice small{color:var(--text-muted)}
#record-btn{padding:6px 14px;border-radius:var(--radius);border:none;font-size:12px;font-weight:600;cursor:pointer;background:var(--surface2);color:var(--text);border:1px solid var(--border);display:flex;align-items:center;gap:6px;transition:all .15s}
#record-btn.active{background:#3a0a0a;color:var(--red);border-color:#6e1515}
#record-btn::before{content:'';width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0}
#export-btn{padding:6px 14px;border-radius:var(--radius);border:1px solid var(--accent);font-size:12px;font-weight:600;cursor:pointer;background:var(--accent);color:#fff;transition:all .15s}
#export-btn:hover{background:var(--accent-hover)}
/* Left panel */
#left-panel{display:flex;flex-direction:column;overflow:hidden;background:var(--surface);min-width:0}
.panel-header{padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--text-dim);text-transform:uppercase;border-bottom:1px solid var(--border);flex-shrink:0}
#inspector-section{display:flex;flex-direction:column;overflow:hidden;flex:1}
#inspector-hint{padding:12px 14px;font-size:12px;color:var(--text-dim);border-bottom:1px solid var(--border);flex-shrink:0}
#locator-section{padding:12px 14px;flex-shrink:0}
#best-locator-label{font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px}
#best-locator-code{display:flex;align-items:flex-start;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;font:12px/1.4 var(--mono);color:var(--accent-hover);word-break:break-all}
#alternatives-label{font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);text-transform:uppercase;margin:10px 0 6px}
#alternatives-list{display:flex;flex-direction:column;gap:3px}
.alt-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--radius);cursor:pointer;border:1px solid transparent}
.alt-item:hover{background:var(--surface2);border-color:var(--border)}
.locator-code{flex:1;min-width:0}
.alt-code{flex:1;font:11px/1.3 var(--mono);color:var(--text-dim);word-break:break-all}
.alt-score{font-size:10px;padding:1px 5px;border-radius:3px;font-weight:700;background:var(--surface2);color:var(--green);flex-shrink:0}
.copy-btn{position:relative;flex-shrink:0;width:28px;height:28px;border:1px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--text-muted);cursor:pointer;transition:border-color .15s,color .15s,background .15s}
.copy-btn:hover{border-color:var(--accent);color:var(--accent-hover);background:rgba(31,111,235,.08)}
.copy-btn.copied{border-color:var(--green);color:var(--green);background:rgba(63,185,80,.08)}
.copy-btn::before,.copy-btn::after{content:'';position:absolute;border:1.5px solid currentColor;border-radius:2px}
.copy-btn::before{top:7px;left:9px;width:10px;height:12px;background:var(--surface)}
.copy-btn::after{top:10px;left:6px;width:10px;height:12px}
#details-section{flex:1;overflow-y:auto;border-top:1px solid var(--border)}
#details-table{width:100%;border-collapse:collapse;font-size:12px}
#details-table td{padding:5px 14px;border-bottom:1px solid var(--border)}
#details-table td:first-child{color:var(--text-muted);width:40%;font-size:11px}
#details-table td:last-child{color:var(--text);font:11px/1.4 var(--mono);word-break:break-all}
#inspector-footer{display:flex;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--border);flex-shrink:0}
/* Center mirror */
#center-panel{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px 18px 16px;overflow:hidden;background:var(--bg)}
#phone-shell{position:relative;background:transparent;border:none;padding:0;box-shadow:none;flex-shrink:0}
#phone-notch{display:none}
#mirror-stage{position:relative;cursor:crosshair;overflow:hidden;border-radius:28px;background:#0a0a0f;box-shadow:0 24px 64px rgba(0,0,0,.48),0 0 0 1px rgba(255,255,255,.08)}
#mirror-stage.dragging{cursor:grabbing}
#mirror-img{display:block;max-width:100%;user-select:none;pointer-events:none;border-radius:inherit}
#mirror-img.placeholder{opacity:.15}
#highlight-overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
.el-highlight{position:absolute;border:2px solid var(--purple);background:rgba(139,92,246,.12);border-radius:2px;transition:all .1s}
.el-label{position:absolute;top:-18px;left:0;background:var(--purple);color:#fff;font:10px/18px var(--mono);padding:0 5px;border-radius:3px;white-space:nowrap}
#mirror-status{margin-top:12px;font-size:11px;color:var(--text-muted);text-align:center}
#busy-overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(13,17,23,.45);z-index:5}
#busy-overlay.active{display:flex}
.spinner{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.18);border-top-color:var(--accent-hover);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#left-column-splitter,#right-column-splitter{position:relative;cursor:col-resize;background:var(--surface);border-left:1px solid var(--border);border-right:1px solid var(--border)}
#left-column-splitter::before,#right-column-splitter::before{content:'';position:absolute;top:50%;left:50%;width:4px;height:44px;border-radius:999px;background:var(--border);transform:translate(-50%,-50%)}
/* Right panel */
#right-panel{display:grid;grid-template-rows:minmax(240px,1.2fr) 10px minmax(180px,.8fr);overflow:hidden;background:var(--surface);min-width:0}
#right-splitter{position:relative;cursor:row-resize;background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
#right-splitter::before{content:'';position:absolute;top:50%;left:50%;width:44px;height:4px;border-radius:999px;background:var(--border);transform:translate(-50%,-50%)}
/* Tree panel */
#tree-panel{display:flex;flex-direction:column;overflow:hidden;min-height:0}
#tree-search-row{padding:8px 10px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px}
#tree-search{flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:5px 8px;font:12px var(--font);color:var(--text);outline:none}
#tree-search:focus{border-color:var(--accent)}
#tree-list{flex:1;overflow-y:auto;padding:4px 0}
.tree-node{display:flex;align-items:center;gap:4px;padding:2px 8px;cursor:pointer;border-left:2px solid transparent;transition:background .1s}
.tree-node:hover{background:var(--surface2)}
.tree-node.selected{background:rgba(31,111,235,.15);border-left-color:var(--accent)}
.tree-node.hidden{opacity:.35}
.tree-expander{width:14px;flex-shrink:0;font-size:10px;color:var(--text-muted);cursor:pointer;user-select:none}
.tree-type{font:10px/1 var(--mono);color:var(--text-muted);flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-title{font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
/* Code panel */
#code-panel{display:flex;flex-direction:column;overflow:hidden;min-height:0}
#code-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
.code-tab{padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;transition:all .1s}
.code-tab:hover{color:var(--text)}
.code-tab.active{color:var(--accent-hover);border-bottom-color:var(--accent-hover)}
#code-view{flex:1;display:flex;flex-direction:column;overflow:hidden}
#code-block{flex:1;overflow:auto;padding:10px 12px;font:11px/1.6 var(--mono);color:#c9d1d9;background:var(--bg);white-space:pre;tab-size:2}
#steps-view{flex:1;display:flex;flex-direction:column;overflow:hidden}
#steps-toolbar{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border);flex-shrink:0}
.step-btn{padding:4px 10px;font-size:11px;font-weight:600;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer}
.step-btn:hover{border-color:var(--accent);color:var(--accent-hover)}
.step-btn:disabled{opacity:.45;cursor:not-allowed;color:var(--text-muted)}
.step-btn:disabled:hover{border-color:var(--border);color:var(--text-muted)}
#clear-btn{margin-left:auto;color:var(--red);border-color:#4a1414}
#steps-table-wrap{flex:1;overflow-y:auto}
#steps-table{width:100%;border-collapse:collapse;font-size:11px}
#steps-table th{padding:5px 10px;text-align:left;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);background:var(--surface)}
#steps-table td{padding:5px 10px;border-bottom:1px solid var(--border);font:11px/1.4 var(--mono)}
#steps-table td:first-child{color:var(--text-muted);width:30px}
#steps-table td:nth-child(2){color:var(--green)}
#steps-table td:nth-child(3){color:var(--text-dim);word-break:break-all}
#steps-table td:last-child{color:var(--yellow)}
#step-composer{display:none;padding:10px;border-bottom:1px solid var(--border);background:var(--surface)}
#step-composer.active{display:block}
.composer-grid{display:grid;grid-template-columns:1fr;gap:8px}
.composer-row{display:flex;gap:6px}
.composer-input,.composer-select{min-width:0;flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:6px 8px;font:11px var(--font);color:var(--text)}
.composer-actions{display:flex;justify-content:flex-end;gap:6px}
/* Scrollbars */
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
</style>
</head>
<body>
<div id="app">
  <!-- Top bar -->
  <header id="topbar">
    <img id="logo" src="" alt="" onerror="this.style.display='none'"/>
    <span id="logo-text">Inspector</span>
    <div class="tb-sep"></div>
    <div id="device-switcher">
      <button id="device-chip" type="button" title="Switch device" aria-haspopup="true" aria-expanded="false">
        <span id="platform-icon">📱</span>
        <span id="device-name">${escHtml(device.name)}</span>
      </button>
      <div id="device-list-menu">
        <div class="device-menu-label">Devices</div>
        <div id="device-list" class="device-list"></div>
      </div>
    </div>
    <div id="live-badge" class="connecting">Connecting…</div>
    <div id="device-controls">
      <button id="device-menu-btn" type="button" aria-haspopup="true" aria-expanded="false">Controls</button>
      <span id="device-status" aria-live="polite"></span>
      <div id="device-menu">
        <div class="device-menu-section">
          <div class="device-menu-label">App</div>
          <div class="device-row">
            <input id="app-identifier-input" class="device-input" placeholder="package or bundle id"/>
            <button type="button" class="device-action-btn" id="launch-app-btn">Launch</button>
          </div>
          <div class="device-row">
            <input id="app-upload-input" class="device-input" type="file" accept=".apk,.ipa,.app"/>
            <button type="button" class="device-action-btn" id="install-app-btn">Install</button>
          </div>
          <div class="device-row">
            <input id="permission-input" class="device-input" placeholder="permission, e.g. camera"/>
            <button type="button" class="device-action-btn" id="grant-permission-btn">Grant</button>
            <button type="button" class="device-action-btn" id="revoke-permission-btn">Revoke</button>
          </div>
          <div class="device-row">
            <button type="button" class="device-action-btn" id="clear-data-btn">Clear Data</button>
            <button type="button" class="device-action-btn" id="clear-cache-btn">Clear Cache</button>
          </div>
        </div>
        ${renderInspectorDeviceActionMenu(device)}
      </div>
    </div>
    <button id="record-btn" title="Toggle recording">Record</button>
    <button id="export-btn" title="Export test code (Ctrl/Cmd+S)">Export Code</button>
  </header>

  <!-- Main 3-column layout -->
  <div id="main">
    <!-- Left: Inspector panel -->
    <div id="left-panel">
      <div class="panel-header">Inspector</div>
      <div id="inspector-section">
        <div id="inspector-hint">Tap on the screen or select an element in the tree to generate locators.</div>
        <div id="locator-section">
          <div id="best-locator-label">Best Locator</div>
          <div id="best-locator-code">—</div>
          <div id="alternatives-label">Alternatives</div>
          <div id="alternatives-list"></div>
        </div>
        <div id="details-section">
          <table id="details-table">
            <tbody id="details-body"></tbody>
          </table>
        </div>
        <div id="inspector-footer">
          <span id="version-chip">v${escHtml(INSPECTOR_VERSION)}</span>
        </div>
      </div>
    </div>

    <div id="left-column-splitter" title="Drag to resize the Inspector panel"></div>

    <!-- Center: Device mirror -->
    <div id="center-panel">
      <div id="phone-shell">
        <div id="phone-notch"></div>
        <div id="mirror-stage">
          <img id="mirror-img" class="placeholder" src="" alt="Device mirror" draggable="false"/>
          <div id="highlight-overlay"></div>
          <div id="busy-overlay"><div class="spinner"></div></div>
        </div>
      </div>
      <div id="mirror-status">Waiting for device…</div>
    </div>

    <div id="right-column-splitter" title="Drag to resize the UI Tree panel"></div>

    <!-- Right: Tree + Code -->
    <div id="right-panel">
      <!-- Tree -->
      <div id="tree-panel">
        <div class="panel-header">UI Tree <span id="tree-badge" style="font-weight:400;color:var(--text-muted)"></span></div>
        <div id="tree-search-row">
          <input id="tree-search" type="search" placeholder="Search element…"/>
        </div>
        <div id="tree-list"></div>
      </div>
      <div id="right-splitter" title="Drag to resize the UI tree"></div>
      <!-- Code / Steps -->
      <div id="code-panel">
        <div id="code-tabs">
          <div class="code-tab active" data-tab="code">Code</div>
          <div class="code-tab" data-tab="steps">Recording Steps</div>
        </div>
        <div id="code-view">
          <div id="code-lang-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--border);flex-shrink:0">
            <button class="code-tab active" data-lang="typescript">TypeScript</button>
            <button class="code-tab" data-lang="javascript">JavaScript</button>
          </div>
          <pre id="code-block">// No steps recorded yet</pre>
        </div>
        <div id="steps-view" style="display:none">
          <div id="steps-toolbar">
            <button class="step-btn" id="add-tap-btn">+ Tap</button>
            <button class="step-btn" id="add-fill-btn">+ Fill</button>
            <button class="step-btn" id="add-expect-btn">+ Expect</button>
            <button class="step-btn" id="clear-btn">Clear</button>
          </div>
          <div id="step-composer">
            <div class="composer-grid">
              <div class="composer-row">
                <select id="composer-assertion" class="composer-select">
                  <option value="visible">visible</option>
                  <option value="text">text equals</option>
                  <option value="containsText">text contains</option>
                  <option value="value">value equals</option>
                  <option value="label">label equals</option>
                  <option value="type">type equals</option>
                </select>
                <input id="composer-value" class="composer-input" placeholder="value"/>
              </div>
              <div class="composer-actions">
                <button class="step-btn" id="composer-cancel-btn">Cancel</button>
                <button class="step-btn" id="composer-add-btn">Add</button>
              </div>
            </div>
          </div>
          <div id="steps-table-wrap">
            <table id="steps-table">
              <thead><tr><th>#</th><th>Action</th><th>Locator</th><th>Value</th></tr></thead>
              <tbody id="steps-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
(function(){
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let nodes = [];
let viewport = { width: 1, height: 1 };
let selectedUid = null;
let currentSuggestions = [];
let activeLocator = '';
let recording = false;
let steps = [];
let codeLang = 'typescript';
let activeTab = 'code';
let currentDevice = ${JSON.stringify(toBootstrapDevice(device))};
let devices = [currentDevice];
let busyCount = 0;
let composerMode = null;
let dragStart = null;
let suppressNextClick = false;
let gestureInFlight = false;
let gestureReleaseTimer = null;
let nextGestureAllowedAt = 0;

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const logo = $('logo');
const liveBadge = $('live-badge');
const deviceSwitcher = $('device-switcher');
const deviceControls = $('device-controls');
const deviceChip = $('device-chip');
const deviceListMenu = $('device-list-menu');
const deviceMenu = $('device-menu');
const deviceMenuBtn = $('device-menu-btn');
const deviceName = $('device-name');
const deviceList = $('device-list');
const deviceStatus = $('device-status');
const recordBtn = $('record-btn');
const exportBtn = $('export-btn');
const mirrorImg = $('mirror-img');
const mirrorStage = $('mirror-stage');
const busyOverlay = $('busy-overlay');
const centerPanel = $('center-panel');
const highlightOverlay = $('highlight-overlay');
const bestLocatorCode = $('best-locator-code');
const alternativesList = $('alternatives-list');
const detailsBody = $('details-body');
const treeList = $('tree-list');
const treeSearch = $('tree-search');
const treeBadge = $('tree-badge');
const codeBlock = $('code-block');
const stepsBody = $('steps-body');
const codeView = $('code-view');
const stepsView = $('steps-view');
const addTapBtn = $('add-tap-btn');
const addFillBtn = $('add-fill-btn');
const addExpectBtn = $('add-expect-btn');
const clearBtn = $('clear-btn');
const stepComposer = $('step-composer');
const composerAssertion = $('composer-assertion');
const composerValue = $('composer-value');
const composerCancelBtn = $('composer-cancel-btn');
const composerAddBtn = $('composer-add-btn');
const appIdentifierInput = $('app-identifier-input');
const appUploadInput = $('app-upload-input');
const permissionInput = $('permission-input');
const launchAppBtn = $('launch-app-btn');
const installAppBtn = $('install-app-btn');
const grantPermissionBtn = $('grant-permission-btn');
const revokePermissionBtn = $('revoke-permission-btn');
const clearDataBtn = $('clear-data-btn');
const clearCacheBtn = $('clear-cache-btn');
const main = $('main');
const leftColumnSplitter = $('left-column-splitter');
const rightColumnSplitter = $('right-column-splitter');
const rightPanel = $('right-panel');
const rightSplitter = $('right-splitter');
let deviceStatusTimer;

// ── WebSocket ──────────────────────────────────────────────────────────────
let ws;
function connectWs() {
  ws = new WebSocket('ws://' + location.host);
  ws.onopen = () => {
    liveBadge.textContent = 'Live';
    liveBadge.className = '';
    liveBadge.style.cssText = '';
  };
  ws.onclose = () => {
    liveBadge.textContent = 'Disconnected';
    liveBadge.className = 'connecting';
    setTimeout(connectWs, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = e => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    handleServerEvent(ev);
  };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Server event handler ───────────────────────────────────────────────────
function handleServerEvent(ev) {
  switch (ev.type) {
    case 'bootstrap':
      currentDevice = ev.device || currentDevice;
      devices = mergeDevices(devices, currentDevice);
      renderDeviceHeader();
      renderDeviceList();
      if (ev.logoDataUri) { logo.src = ev.logoDataUri; logo.style.display = ''; }
      nodes = ev.nodes || [];
      viewport = ev.viewport || { width: 1, height: 1 };
      if (ev.suggestions) currentSuggestions = ev.suggestions;
      renderTree();
      if (ev.initialUid) selectUid(ev.initialUid, ev.suggestions || [], false);
      break;

    case 'devices':
      devices = ev.devices || [];
      renderDeviceList();
      break;

    case 'frame':
      mirrorImg.src = ev.dataUri;
      mirrorImg.classList.remove('placeholder');
      $('mirror-status').textContent = '';
      sizeMirror();
      break;

    case 'tree':
      nodes = ev.nodes || [];
      viewport = ev.viewport || viewport;
      renderTree();
      if (deviceStatus.textContent.startsWith('UI tree unavailable') || deviceStatus.textContent.startsWith('UI tree refresh delayed')) {
        showDeviceStatus('', '');
      }
      if (selectedUid && nodes.some(n => n.uid === selectedUid)) {
        updateHighlight(selectedUid);
      } else {
        selectedUid = null;
        updateStepControls();
        // Auto-select first interesting node on first tree arrival
        const auto = nodes.find(n => n.visible && n.enabled && !n.type.endsWith('.root') && (n.id || n.label || n.text));
        if (auto) send({ type: 'select', uid: auto.uid });
      }
      break;

    case 'selection':
      nodes = updateNodeInList(nodes, ev.uid, ev.node);
      selectUid(ev.uid, ev.suggestions || [], false);
      break;

    case 'step':
      steps.push(ev);
      renderStep(ev);
      updateCodeBlock();
      break;

    case 'steps':
      steps = ev.steps || [];
      renderAllSteps();
      updateCodeBlock();
      break;

    case 'status':
      if (ev.message.startsWith('Action OK: ') || ev.message.startsWith('Action Error: ')) {
        releaseGestureLock();
      }
      if (ev.message.startsWith('Recording ON')) {
        recording = true;
        recordBtn.classList.add('active');
        recordBtn.textContent = 'Recording';
        showDeviceStatus('Click the mirror to tap and record', 'pending');
      }
      else if (ev.message.startsWith('Recording OFF')) {
        recording = false;
        recordBtn.classList.remove('active');
        recordBtn.textContent = 'Record';
        showDeviceStatus('Recording paused', 'success');
      }
      else if (ev.message.startsWith('Action Pending: ')) {
        showDeviceStatus(ev.message.slice(16), 'pending');
        break;
      }
      else if (ev.message.startsWith('Action OK: ')) { showDeviceStatus(ev.message.slice(11), 'success'); }
      else if (ev.message.startsWith('Action Error: ')) { showDeviceStatus(ev.message.slice(14), 'error'); }
      setBusy(false);
      break;

    case 'gesture_ack':
      releaseGestureLock();
      setBusy(false);
      break;
  }
}

function showDeviceStatus(message, tone) {
  deviceStatus.textContent = message || '';
  deviceStatus.dataset.tone = tone || '';
  clearTimeout(deviceStatusTimer);
  if (!message) {
    return;
  }

  deviceStatusTimer = setTimeout(() => {
    deviceStatus.textContent = '';
    deviceStatus.dataset.tone = '';
  }, tone === 'error' ? 5000 : 2600);
}

function closeDeviceMenu() {
  deviceControls.classList.remove('open');
  deviceMenuBtn.setAttribute('aria-expanded', 'false');
}

function toggleDeviceMenu() {
  const nextOpen = !deviceControls.classList.contains('open');
  closeDeviceSwitcher();
  deviceControls.classList.toggle('open', nextOpen);
  deviceMenuBtn.setAttribute('aria-expanded', String(nextOpen));
}

function closeDeviceSwitcher() {
  deviceSwitcher.classList.remove('open');
  deviceChip.setAttribute('aria-expanded', 'false');
}

function toggleDeviceSwitcher() {
  const nextOpen = !deviceSwitcher.classList.contains('open');
  closeDeviceMenu();
  deviceSwitcher.classList.toggle('open', nextOpen);
  deviceChip.setAttribute('aria-expanded', String(nextOpen));
  if (nextOpen) {
    send({ type: 'list_devices' });
  }
}

function setBusy(active) {
  busyCount = Math.max(0, busyCount + (active ? 1 : -1));
  busyOverlay.classList.toggle('active', busyCount > 0);
}

function releaseGestureLock() {
  gestureInFlight = false;
  if (gestureReleaseTimer) {
    clearTimeout(gestureReleaseTimer);
    gestureReleaseTimer = null;
  }
}

function renderDeviceHeader() {
  deviceName.textContent = currentDevice ? currentDevice.name : 'Device';
}

function mergeDevices(list, device) {
  if (!device) return list;
  const without = list.filter(d => d.id !== device.id);
  return [device, ...without];
}

function renderDeviceList() {
  deviceList.innerHTML = '';
  if (!devices.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-title';
    empty.textContent = 'No devices found';
    deviceList.appendChild(empty);
    return;
  }

  for (const device of devices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'device-choice' + (currentDevice && device.id === currentDevice.id ? ' active' : '');
    button.innerHTML = '<span>' + escHtml(device.name || device.id) + '</span><small>' + escHtml(device.platform + ' ' + device.kind) + '</small>';
    button.addEventListener('click', () => {
      if (currentDevice && device.id === currentDevice.id) return;
      setBusy(true);
      closeDeviceSwitcher();
      send({ type: 'switch_device', deviceId: device.id });
    });
    deviceList.appendChild(button);
  }
}

function updateNodeInList(list, uid, node) {
  const idx = list.findIndex(n => n.uid === uid);
  if (idx >= 0) { const updated = [...list]; updated[idx] = node; return updated; }
  return list;
}

// ── Tree rendering ─────────────────────────────────────────────────────────
function renderTree() {
  const query = treeSearch.value.toLowerCase();
  treeBadge.textContent = nodes.length ? '(' + nodes.length + ')' : '';
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    const haystack = [node.title, node.type, node.id, node.label, node.text, node.value]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (query && !haystack.includes(query)) continue;
    const el = document.createElement('div');
    el.className = 'tree-node' + (!node.visible ? ' hidden' : '') + (node.uid === selectedUid ? ' selected' : '');
    el.style.paddingLeft = (8 + node.depth * 12) + 'px';
    el.dataset.uid = node.uid;

    const expander = document.createElement('span');
    expander.className = 'tree-expander';
    expander.textContent = nodes.some(n => n.parentUid === node.uid) ? '▾' : ' ';

    const type = document.createElement('span');
    type.className = 'tree-type';
    type.textContent = node.type.split('.').pop() || node.type;

    const title = document.createElement('span');
    title.className = 'tree-title';
    title.textContent = node.title !== node.type ? node.title : '';

    el.append(expander, type, title);
    el.addEventListener('click', () => {
      send({ type: 'select', uid: node.uid });
    });
    frag.appendChild(el);
  }
  treeList.innerHTML = '';
  treeList.appendChild(frag);
}

// ── Selection ──────────────────────────────────────────────────────────────
function selectUid(uid, suggestions, scroll) {
  selectedUid = uid;
  currentSuggestions = suggestions;
  renderTree();
  updateHighlight(uid);
  renderLocators(suggestions);
  const node = nodes.find(n => n.uid === uid);
  if (node) renderDetails(node);
  updateStepControls();
  if (scroll !== false) {
    const el = treeList.querySelector('[data-uid="' + uid + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
}

function updateHighlight(uid) {
  highlightOverlay.innerHTML = '';
  const node = nodes.find(n => n.uid === uid);
  if (!node || !node.visible) return;
  const imgW = viewport.width || mirrorImg.naturalWidth || 1;
  const imgH = viewport.height || mirrorImg.naturalHeight || 1;
  const dispW = mirrorImg.clientWidth || 1;
  const dispH = mirrorImg.clientHeight || 1;
  const sx = dispW / imgW;
  const sy = dispH / imgH;
  const div = document.createElement('div');
  div.className = 'el-highlight';
  div.style.left = (node.bounds.x * sx) + 'px';
  div.style.top = (node.bounds.y * sy) + 'px';
  div.style.width = (node.bounds.width * sx) + 'px';
  div.style.height = (node.bounds.height * sy) + 'px';
  const lbl = document.createElement('div');
  lbl.className = 'el-label';
  lbl.textContent = node.type.split('.').pop() || node.type;
  div.appendChild(lbl);
  highlightOverlay.appendChild(div);
}

// ── Locators ──────────────────────────────────────────────────────────────
function renderLocators(suggestions) {
  currentSuggestions = suggestions || [];
  const best = suggestions[0];
  activeLocator = best ? best.code : '';
  renderBestLocator();
  alternativesList.innerHTML = '';
  for (const s of suggestions.slice(1, 5)) {
    const div = document.createElement('div');
    div.className = 'alt-item';
    const code = document.createElement('span');
    code.className = 'alt-code';
    code.textContent = s.code;
    const score = document.createElement('span');
    score.className = 'alt-score';
    score.textContent = Math.round(s.score * 100) + '';
    const copy = createCopyButton(() => s.code, 'Copy alternative locator');
    div.append(code, score, copy);
    div.addEventListener('click', () => {
      activeLocator = s.code;
      renderBestLocator();
    });
    alternativesList.appendChild(div);
  }
}

function renderBestLocator() {
  bestLocatorCode.innerHTML = '';
  bestLocatorCode.dataset.locator = activeLocator;
  if (!activeLocator) {
    bestLocatorCode.textContent = '—';
    updateStepControls();
    return;
  }

  const code = document.createElement('span');
  code.className = 'locator-code';
  code.textContent = activeLocator;
  const copy = createCopyButton(() => activeLocator, 'Copy locator');
  bestLocatorCode.append(code, copy);
  updateStepControls();
}

function createCopyButton(getText, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-btn';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const text = getText();
    if (!text || text === '—') return;
    const copied = await copyText(text);
    if (!copied) return;
    button.classList.add('copied');
    button.title = 'Copied';
    clearTimeout(button._copyResetTimer);
    button._copyResetTimer = setTimeout(() => {
      button.classList.remove('copied');
      button.title = label;
    }, 1200);
  });
  return button;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand fallback
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}

function getSelectedNode() {
  return selectedUid ? nodes.find(n => n.uid === selectedUid) : undefined;
}

function nodeRoles(node) {
  if (!node || !node.type) return [];
  const type = node.type.toLowerCase();
  const roles = [];
  if (type.includes('button')) roles.push('button');
  if (type.includes('checkbox')) roles.push('checkbox');
  if (type.includes('radiobutton') || type.includes('radio')) roles.push('radio');
  if (type.includes('seekbar') || type.includes('slider')) roles.push('slider');
  if (type.includes('switch')) roles.push('switch');
  if (type.includes('tab')) roles.push('tab');
  if (type.includes('edittext') || type.includes('textfield') || type.includes('securetextfield') || type.includes('searchfield') || type.includes('textinput')) roles.push('textbox');
  return roles;
}

function isFillableSelectedNode() {
  return nodeRoles(getSelectedNode()).includes('textbox');
}

function updateStepControls() {
  const hasLocator = !!activeLocator && activeLocator !== '—';
  addTapBtn.disabled = !hasLocator;
  addExpectBtn.disabled = !hasLocator;
  addFillBtn.disabled = !hasLocator || !isFillableSelectedNode();
  addFillBtn.title = addFillBtn.disabled && hasLocator
    ? 'Fill is only available for text input elements'
    : '';
}

// ── Details ────────────────────────────────────────────────────────────────
function renderDetails(node) {
  const fields = [
    ['Type', node.type],
    ['Text', node.text],
    ['Label', node.label],
    ['Resource-id', node.id],
    ['Value', node.value],
    ['Enabled', node.enabled ? 'true' : 'false'],
    ['Visible', node.visible ? 'true' : 'false'],
    ['Bounds', node.bounds ? '[' + node.bounds.x + ', ' + node.bounds.y + '][' + (node.bounds.x+node.bounds.width) + ', ' + (node.bounds.y+node.bounds.height) + ']' : ''],
  ];
  detailsBody.innerHTML = '';
  for (const [k, v] of fields) {
    if (!v && v !== 'false') continue;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + escHtml(k) + '</td><td>' + escHtml(String(v)) + '</td>';
    detailsBody.appendChild(tr);
  }
}

// ── Mirror click ───────────────────────────────────────────────────────────
function sizeMirror() {
  const sourceW = mirrorImg.naturalWidth || viewport.width || 1;
  const sourceH = mirrorImg.naturalHeight || viewport.height || 1;
  const ratio = sourceH / sourceW;
  const availableW = Math.max(240, centerPanel.clientWidth - 44);
  const availableH = Math.max(320, centerPanel.clientHeight - 40);
  const maxW = Math.min(availableW, 520);
  const maxH = Math.min(availableH, window.innerHeight - 88);
  let w = maxW;
  let h = w * ratio;
  if (h > maxH) { h = maxH; w = h / ratio; }
  mirrorStage.style.width = w + 'px';
  mirrorStage.style.height = h + 'px';
  mirrorImg.style.width = w + 'px';
  mirrorImg.style.height = h + 'px';
  if (selectedUid) updateHighlight(selectedUid);
}

mirrorStage.addEventListener('click', e => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  const point = mirrorEventPoint(e);
  if (recording) setBusy(true);
  send({ type: 'click', x: point.x, y: point.y, record: recording });
});

mirrorStage.addEventListener('wheel', e => {
  e.preventDefault();
  sendGesture(wheelSwipeGesture(e));
}, { passive: false });

mirrorStage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  dragStart = {
    pointerId: e.pointerId,
    clientX: e.clientX,
    clientY: e.clientY,
    point: mirrorEventPoint(e)
  };
  mirrorStage.classList.add('dragging');
  mirrorStage.setPointerCapture?.(e.pointerId);
});

mirrorStage.addEventListener('pointerup', e => {
  if (!dragStart || dragStart.pointerId !== e.pointerId) return;
  const start = dragStart;
  dragStart = null;
  mirrorStage.classList.remove('dragging');
  mirrorStage.releasePointerCapture?.(e.pointerId);

  const moved = Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY);
  if (moved < 10) return;

  suppressNextClick = true;
  const end = mirrorEventPoint(e);
  sendGesture({
    start: start.point,
    end,
    durationMs: 350
  });
});

mirrorStage.addEventListener('pointercancel', e => {
  if (!dragStart || dragStart.pointerId !== e.pointerId) return;
  dragStart = null;
  mirrorStage.classList.remove('dragging');
});

function mirrorEventPoint(e) {
  const rect = mirrorStage.getBoundingClientRect();
  const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const py = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
  const dx = Math.round((px / Math.max(1, rect.width)) * (viewport.width || 1));
  const dy = Math.round((py / Math.max(1, rect.height)) * (viewport.height || 1));
  return {
    x: Math.max(0, Math.min(Math.max(0, viewport.width - 1), dx)),
    y: Math.max(0, Math.min(Math.max(0, viewport.height - 1), dy))
  };
}

function sendGesture(gesture) {
  const now = Date.now();
  if (gestureInFlight || now < nextGestureAllowedAt) {
    return false;
  }

  gestureInFlight = true;
  nextGestureAllowedAt = now + 450;
  setBusy(true);
  send({
    type: 'swipe',
    record: recording,
    gesture
  });

  if (gestureReleaseTimer) {
    clearTimeout(gestureReleaseTimer);
  }
  gestureReleaseTimer = setTimeout(() => {
    gestureInFlight = false;
    gestureReleaseTimer = null;
    setBusy(false);
  }, 1800);

  return true;
}

function wheelSwipeGesture(e) {
  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const width = viewport.width || 1;
  const height = viewport.height || 1;
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);

  if (horizontal) {
    const direction = e.deltaX >= 0 ? 1 : -1;
    const distance = Math.round(width * 0.38) * direction;
    const startX = Math.round(width * (direction > 0 ? 0.72 : 0.28));
    const endX = Math.max(10, Math.min(width - 10, startX - distance));
    return {
      start: { x: startX, y: cy },
      end: { x: endX, y: cy },
      durationMs: 350
    };
  }

  const direction = e.deltaY >= 0 ? 1 : -1;
  const distance = Math.round(height * 0.38) * direction;
  const startY = Math.round(height * (direction > 0 ? 0.72 : 0.32));
  const endY = Math.max(10, Math.min(height - 10, startY - distance));
  return {
    start: { x: cx, y: startY },
    end: { x: cx, y: endY },
    durationMs: 350
  };
}

function clampTreePanelHeight(nextHeight) {
  const splitterHeight = 10;
  const minTreeHeight = 220;
  const minCodeHeight = 160;
  const maxTreeHeight = Math.max(minTreeHeight, rightPanel.clientHeight - minCodeHeight - splitterHeight);
  return Math.min(Math.max(nextHeight, minTreeHeight), maxTreeHeight);
}

function setTreePanelHeight(nextHeight) {
  const clamped = clampTreePanelHeight(nextHeight);
  rightPanel.style.gridTemplateRows = clamped + 'px 10px minmax(160px, 1fr)';
}

function syncTreePanelHeight() {
  const current = rightPanel.style.gridTemplateRows;
  if (!current) {
    return;
  }

  const height = Number.parseFloat(current);
  if (Number.isFinite(height)) {
    setTreePanelHeight(height);
  }
}

function readMainColumnWidths() {
  const columns = getComputedStyle(main).gridTemplateColumns.split(' ');
  return {
    left: Number.parseFloat(columns[0]) || 300,
    right: Number.parseFloat(columns[4]) || 340,
  };
}

function clampPanelWidths(leftWidth, rightWidth) {
  const splitterWidth = 20;
  const minLeft = 220;
  const minRight = 280;
  const minCenter = 360;
  const total = main.clientWidth;
  const maxLeft = Math.max(minLeft, total - minCenter - minRight - splitterWidth);
  const clampedLeft = Math.min(Math.max(leftWidth, minLeft), maxLeft);
  const maxRight = Math.max(minRight, total - minCenter - clampedLeft - splitterWidth);
  const clampedRight = Math.min(Math.max(rightWidth, minRight), maxRight);
  return { left: clampedLeft, right: clampedRight };
}

function setMainColumnWidths(leftWidth, rightWidth) {
  const clamped = clampPanelWidths(leftWidth, rightWidth);
  main.style.gridTemplateColumns = clamped.left + 'px 10px minmax(0,1fr) 10px ' + clamped.right + 'px';
}

function syncMainColumnWidths() {
  if (!main.style.gridTemplateColumns) {
    return;
  }

  const widths = readMainColumnWidths();
  setMainColumnWidths(widths.left, widths.right);
}

function installColumnSplitter(splitter, side) {
  splitter.addEventListener('pointerdown', e => {
    e.preventDefault();
    const pointerId = e.pointerId;
    splitter.setPointerCapture(pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startingWidths = readMainColumnWidths();
    const move = event => {
      const rect = main.getBoundingClientRect();
      if (side === 'left') {
        setMainColumnWidths(event.clientX - rect.left, startingWidths.right);
      } else {
        setMainColumnWidths(startingWidths.left, rect.right - event.clientX);
      }
    };

    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (splitter.hasPointerCapture(pointerId)) {
        splitter.releasePointerCapture(pointerId);
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });

  splitter.addEventListener('dblclick', () => {
    const defaults = side === 'left'
      ? { left: 300, right: readMainColumnWidths().right }
      : { left: readMainColumnWidths().left, right: 340 };
    setMainColumnWidths(defaults.left, defaults.right);
  });
}

installColumnSplitter(leftColumnSplitter, 'left');
installColumnSplitter(rightColumnSplitter, 'right');

rightSplitter.addEventListener('pointerdown', e => {
  e.preventDefault();
  const pointerId = e.pointerId;
  rightSplitter.setPointerCapture(pointerId);
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';

  const move = event => {
    const rect = rightPanel.getBoundingClientRect();
    setTreePanelHeight(event.clientY - rect.top);
  };

  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (rightSplitter.hasPointerCapture(pointerId)) {
      rightSplitter.releasePointerCapture(pointerId);
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
});

rightSplitter.addEventListener('dblclick', () => {
  rightPanel.style.gridTemplateRows = '';
});

window.addEventListener('resize', () => {
  sizeMirror();
  syncTreePanelHeight();
  syncMainColumnWidths();
});

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('#code-tabs .code-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#code-tabs .code-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    codeView.style.display = activeTab === 'code' ? 'flex' : 'none';
    stepsView.style.display = activeTab === 'steps' ? 'flex' : 'none';
  });
});

document.querySelectorAll('#code-lang-tabs .code-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#code-lang-tabs .code-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    codeLang = btn.dataset.lang;
    updateCodeBlock();
  });
});

// ── Code block ────────────────────────────────────────────────────────────
function updateCodeBlock() {
  // Generate code client-side from steps for display; actual export goes server-side
  if (!steps.length) { codeBlock.textContent = '// No steps recorded yet'; return; }
  const lines = steps.map(s => {
    const locator = normalizeLocatorCode(s.locator);
    if (s.action === 'swipe' && s.gesture) return '  await device.swipe(' + JSON.stringify(s.gesture) + ');';
    if (s.action === 'tapPoint' && s.point) return '  await device.tap(' + JSON.stringify(s.point) + ');';
    if (s.action === 'fill') return '  await device.' + locator + '.fill(' + JSON.stringify(s.value || '') + ');';
    if (s.action === 'expect') {
      const actual = 'device.' + locator;
      switch (s.assertion || 'visible') {
        case 'text':
          return '  await expect(' + actual + ').toHaveText(' + JSON.stringify(s.value || '') + ');';
        case 'containsText':
          return '  await expect(' + actual + ').toContainText(' + JSON.stringify(s.value || '') + ');';
        case 'value':
          return '  await expect(' + actual + ').toHaveValue(' + JSON.stringify(s.value || '') + ');';
        case 'label':
          return '  await expect(' + actual + ').toHaveLabel(' + JSON.stringify(s.value || '') + ');';
        case 'type':
          return '  await expect(' + actual + ').toHaveType(' + JSON.stringify(s.value || '') + ');';
        default:
          return '  await expect(' + actual + ').toBeVisible();';
      }
    }
    return '  await device.' + locator + '.tap();';
  });
  const imp = codeLang === 'typescript'
    ? "import { test, expect } from '@astur/test';"
    : "const { test, expect } = require('@astur/test');";
  const body = imp + "\\n\\ntest('recorded flow', async ({ device }) => {\\n" + lines.join('\\n') + "\\n});\\n";
  codeBlock.textContent = body;
}

// ── Steps ─────────────────────────────────────────────────────────────────
function renderStep(step) {
  const tr = document.createElement('tr');
  const locator = step.action === 'swipe' && step.gesture
    ? formatGesture(step.gesture)
    : step.action === 'tapPoint' && step.point
    ? formatPoint(step.point)
    : step.locator;
  tr.innerHTML = '<td>' + (step.index+1) + '</td><td>' + escHtml(formatStepAction(step)) + '</td><td>' + escHtml(locator) + '</td><td>' + escHtml(step.value || '') + '</td>';
  stepsBody.appendChild(tr);
}

function formatStepAction(step) {
  if (step.action === 'swipe') return 'swipe';
  if (step.action === 'tapPoint') return 'tap.point';
  if (step.action !== 'expect') return step.action;
  switch (step.assertion || 'visible') {
    case 'text':
      return 'expect.text';
    case 'containsText':
      return 'expect.containsText';
    case 'value':
      return 'expect.value';
    case 'label':
      return 'expect.label';
    case 'type':
      return 'expect.type';
    default:
      return 'expect.visible';
  }
}

function formatGesture(gesture) {
  return '(' + gesture.start.x + ',' + gesture.start.y + ') -> (' + gesture.end.x + ',' + gesture.end.y + ')';
}

function formatPoint(point) {
  return '(' + point.x + ',' + point.y + ')';
}

function renderAllSteps() {
  stepsBody.innerHTML = '';
  for (const s of steps) renderStep(s);
}

addTapBtn.addEventListener('click', () => {
  const locator = activeLocator;
  if (!locator || locator === '—') return;
  send({ type: 'add_step', action: 'tap', locator });
});

addFillBtn.addEventListener('click', () => {
  const locator = activeLocator;
  if (!locator || locator === '—' || !isFillableSelectedNode()) return;
  openStepComposer('fill');
});

addExpectBtn.addEventListener('click', () => {
  const locator = activeLocator;
  if (!locator || locator === '—') return;
  openStepComposer('expect');
});

clearBtn.addEventListener('click', () => send({ type: 'clear_steps' }));

function openStepComposer(mode) {
  composerMode = mode;
  const node = getSelectedNode();
  stepComposer.classList.add('active');
  composerAssertion.style.display = mode === 'expect' ? '' : 'none';
  composerValue.style.display = mode === 'expect' && composerAssertion.value === 'visible' ? 'none' : '';

  if (mode === 'fill') {
    composerValue.placeholder = 'value to fill';
    composerValue.value = '';
  } else {
    const defaultAssertion = node && node.text ? 'text' : node && node.value ? 'value' : node && node.label ? 'label' : 'visible';
    composerAssertion.value = defaultAssertion;
    syncComposerValue();
  }

  composerValue.focus();
}

function closeStepComposer() {
  composerMode = null;
  stepComposer.classList.remove('active');
}

function syncComposerValue() {
  const node = getSelectedNode();
  const assertion = composerAssertion.value;
  const needsValue = assertion !== 'visible';
  composerValue.style.display = needsValue ? '' : 'none';
  composerValue.placeholder = assertion === 'containsText' ? 'expected substring' : 'expected value';
  composerValue.value = needsValue
    ? assertion === 'type'
      ? (node && node.type) || ''
      : assertion === 'label'
      ? ((node && node.label) || (node && node.text) || '')
      : assertion === 'value'
      ? ((node && node.value) || (node && node.text) || '')
      : ((node && node.text) || (node && node.value) || (node && node.label) || '')
    : '';
}

composerAssertion.addEventListener('change', syncComposerValue);
composerCancelBtn.addEventListener('click', closeStepComposer);
composerAddBtn.addEventListener('click', () => {
  const locator = activeLocator;
  if (!locator || locator === '—' || !composerMode) return;
  if (composerMode === 'fill') {
    send({ type: 'add_step', action: 'fill', locator, value: composerValue.value });
  } else {
    const assertion = composerAssertion.value;
    send({
      type: 'add_step',
      action: 'expect',
      locator,
      assertion,
      value: assertion === 'visible' ? undefined : composerValue.value
    });
  }
  closeStepComposer();
});

// ── Record & Export ────────────────────────────────────────────────────────
recordBtn.addEventListener('click', () => send({ type: 'record_toggle' }));

exportBtn.addEventListener('click', () => exportCode());
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); exportCode(); }
});

function exportCode() {
  send({ type: 'export', lang: codeLang });
  // Also trigger download
  const content = codeBlock.textContent;
  const ext = codeLang === 'javascript' ? 'js' : 'ts';
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'astur-test.' + ext;
  a.click();
  URL.revokeObjectURL(a.href);
}

deviceControls.addEventListener('click', event => {
  event.stopPropagation();
});

deviceSwitcher.addEventListener('click', event => {
  event.stopPropagation();
});

deviceChip.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  toggleDeviceSwitcher();
});

deviceMenuBtn.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  toggleDeviceMenu();
});

deviceMenu.addEventListener('click', event => {
  const button = event.target.closest('.device-action-btn');
  if (!button) return;
  const action = button.dataset.action;
  const label = button.dataset.label || 'Action';
  if (!action) return;
  closeDeviceMenu();
  showDeviceStatus('Running ' + label + '...', 'pending');
  send({ type: 'device_action', action });
});

function appIdentifier() {
  return appIdentifierInput.value.trim();
}

launchAppBtn.addEventListener('click', () => {
  const identifier = appIdentifier();
  if (!identifier) return showDeviceStatus('Enter package or bundle id', 'error');
  closeDeviceMenu();
  setBusy(true);
  send({ type: 'app_action', action: 'launch', identifier });
});

installAppBtn.addEventListener('click', async () => {
  const file = appUploadInput.files && appUploadInput.files[0];
  if (!file) return showDeviceStatus('Choose an APK, IPA, or app bundle', 'error');
  closeDeviceMenu();
  setBusy(true);
  try {
    const response = await fetch('/api/upload-app?filename=' + encodeURIComponent(file.name), {
      method: 'POST',
      body: file
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
  } catch (error) {
    setBusy(false);
    showDeviceStatus((error && error.message) || String(error), 'error');
  }
});

clearDataBtn.addEventListener('click', () => {
  const identifier = appIdentifier();
  if (!identifier) return showDeviceStatus('Enter package or bundle id', 'error');
  closeDeviceMenu();
  setBusy(true);
  send({ type: 'app_action', action: 'clearData', identifier });
});

clearCacheBtn.addEventListener('click', () => {
  const identifier = appIdentifier();
  if (!identifier) return showDeviceStatus('Enter package or bundle id', 'error');
  closeDeviceMenu();
  setBusy(true);
  send({ type: 'app_action', action: 'clearCache', identifier });
});

grantPermissionBtn.addEventListener('click', () => {
  const identifier = appIdentifier();
  const permission = permissionInput.value.trim();
  if (!identifier || !permission) return showDeviceStatus('Enter app id and permission', 'error');
  closeDeviceMenu();
  setBusy(true);
  send({ type: 'app_action', action: 'grantPermission', identifier, permission });
});

revokePermissionBtn.addEventListener('click', () => {
  const identifier = appIdentifier();
  const permission = permissionInput.value.trim();
  if (!identifier || !permission) return showDeviceStatus('Enter app id and permission', 'error');
  closeDeviceMenu();
  setBusy(true);
  send({ type: 'app_action', action: 'revokePermission', identifier, permission });
});

document.addEventListener('click', () => {
  closeDeviceMenu();
  closeDeviceSwitcher();
});

// ── Tree search ────────────────────────────────────────────────────────────
treeSearch.addEventListener('input', renderTree);

// ── Utilities ─────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function normalizeLocatorCode(locator) {
  return String(locator || '').trim().replace(/^device\\./, '');
}

// ── Init ───────────────────────────────────────────────────────────────────
sizeMirror();
updateStepControls();
renderDeviceHeader();
renderDeviceList();
connectWs();

})();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
