import { createHash } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';
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
  WebElementSnapshot,
  WebLocatorDescriptor,
  WebTreeSnapshot,
} from '@astur-mobile/protocol';

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
  | { type: 'status'; message: string }
  | { type: 'terminated'; message: string };

export type AssertionKind = 'visible' | 'text' | 'containsText' | 'value' | 'label' | 'type';
export type InspectorDeviceAction =
  | 'refresh'
  | 'tree.refresh'
  | 'orientation.portrait'
  | 'orientation.landscape'
  | 'keyboard.dismiss'
  | 'device.lock'
  | 'device.unlock'
  | 'navigation.back'
  | 'navigation.home'
  | 'navigation.recents';

export type InspectorDirectActionKind = 'tap' | 'fill';

export type ClientEvent =
  | { type: 'click'; x: number; y: number; record?: boolean; perform?: boolean }
  | { type: 'select'; uid: string }
  | { type: 'list_devices' }
  | { type: 'switch_device'; deviceId: string }
  | { type: 'app_action'; action: InspectorAppActionKind; identifier?: string; permission?: string }
  | { type: 'swipe'; gesture: SwipeGesture; record?: boolean }
  | { type: 'record_toggle' }
  | { type: 'add_step'; action: 'tap' | 'fill' | 'expect'; locator: string; value?: string; assertion?: AssertionKind }
  | { type: 'direct_action'; action: InspectorDirectActionKind; selector: ElementSelector; value?: string }
  | { type: 'device_action'; action: InspectorDeviceAction }
  | { type: 'clear_steps' }
  | { type: 'export'; lang: 'typescript' | 'javascript' }
  | { type: 'terminate_session' }
  | { type: 'release_session' };

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
  /** Set on DOM nodes spliced in from a WebView; carries the web DOM locator. */
  web?: WebLocatorDescriptor;
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
  /**
   * Set when a requested switch could not be honored but the session recovered
   * onto another (usually the previous) device. The server rebinds to the
   * returned device and shows this as an error, instead of "Switched to ...".
   */
  notice?: string;
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
  /**
   * Terminate the inspector session: close the active device session (kill the
   * native agent / XCUITest runner so host memory is released) and power off
   * the emulator/simulator. Real devices are left running.
   */
  terminateSession?: () => Promise<void>;
  /**
   * Release the inspector session: close the active device session (kill the
   * native agent / XCUITest runner) but leave the emulator/simulator running so
   * it can be reused without a cold boot.
   */
  releaseSession?: () => Promise<void>;
}

export interface InspectorServerHandle {
  port: number;
  close(): void;
}

type InspectorRefreshResult = 'updated' | 'busy' | 'failed' | 'reported';

const INSPECTOR_VERSION = readInspectorVersion();

// ─── Main export ─────────────────────────────────────────────────────────────

export function startInspectorServer(
  inspector: InspectorSession,
  device: DeviceInfo,
  options: InspectorServerOptions
): Promise<InspectorServerHandle> {
  return new Promise((resolveHandle, rejectHandle) => {
    const baseFrameIntervalMs = options.frameIntervalMs ?? 750;
    const baseTreeIntervalMs = options.treeIntervalMs ?? 1200;
    // When the screen/tree stays unchanged we back off polling up to this cap to
    // reduce device load (slow adb dumps, simulator screenshots) while idle. The
    // interval snaps back to the base value as soon as something changes or an
    // action runs, so responsiveness is preserved during active inspection.
    const maxIdleIntervalMs = 4_000;

    // ── State ──────────────────────────────────────────────────────────────
    let activeInspector = inspector;
    let frameIdleStreak = 0;
    let treeIdleStreak = 0;
    let lastTreeSignature: string | undefined;
    let lastFrameBuffer: Buffer | undefined;
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
    const bundleUploads = new Map<string, string>();

    // ── WebView DOM probe ──────────────────────────────────────────────────────
    // Pulling a WebView's DOM means opening a remote-debugging transport, which is
    // far heavier than a native tree read — so probe it on its own adaptive cadence
    // (fast while a WebView is present, slow while absent) and cache the raw DOM.
    // Each native tree push re-splices the cached DOM against the *current* native
    // nodes (cheap, in-memory) so coordinates track the live host node.
    let cachedWebTree: WebTreeSnapshot | undefined;
    let webProbeNextAt = 0;
    let webProbeInFlight = false;
    const WEB_PROBE_PRESENT_MS = 1_500;
    const WEB_PROBE_ABSENT_MS = 6_000;

    function maybeProbeWebTree(): void {
      if (!activeInspector.webSnapshot || webProbeInFlight || Date.now() < webProbeNextAt) {
        return;
      }
      webProbeInFlight = true;
      void (async () => {
        try {
          const web = await activeInspector.webSnapshot?.();
          const had = Boolean(cachedWebTree);
          cachedWebTree = web ?? undefined;
          webProbeNextAt = Date.now() + (cachedWebTree ? WEB_PROBE_PRESENT_MS : WEB_PROBE_ABSENT_MS);
          // Surface a newly found (or newly lost) WebView DOM promptly.
          if (Boolean(cachedWebTree) !== had) {
            void pushTree({ reportFirstError: false }).catch(() => undefined);
          }
        } catch {
          cachedWebTree = undefined;
          webProbeNextAt = Date.now() + WEB_PROBE_ABSENT_MS;
        } finally {
          webProbeInFlight = false;
        }
      })();
    }

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

      if (url.startsWith('/api/upload-app-file')) {
        handleAppBundleFileUpload(req, res).catch((error) => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(formatActionError(error));
        });
        return;
      }

      if (url.startsWith('/api/upload-app-bundle')) {
        handleAppBundleFinalize(req, res).catch((error) => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(formatActionError(error));
        });
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
      try {
        const payload = await readRequestBuffer(req);
        await writeFile(path, payload);
        await options.installApp(path);
        await syncInspectorState();
        broadcast({ type: 'status', message: `Action OK: Installed ${name}` });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path }));
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    async function handleAppBundleFileUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      const uploadId = normalizeUploadId(params.get('uploadId'));
      const relativePath = normalizeClientUploadPath(params.get('relativePath'));
      if (!uploadId || !relativePath) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('uploadId and relativePath are required for bundle uploads.');
        return;
      }

      const dir = await getBundleUploadDir(uploadId);
      const targetPath = resolveBundleUploadPath(dir, relativePath);
      const payload = await readRequestBuffer(req);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, payload);
      if (looksLikeExecutableBinary(payload)) {
        await chmod(targetPath, 0o755).catch(() => undefined);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: relativePath }));
    }

    async function handleAppBundleFinalize(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      const uploadId = normalizeUploadId(params.get('uploadId'));
      const rootName = basename(params.get('rootName') || '').trim();
      if (!uploadId || !rootName) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('uploadId and rootName are required to finalize a bundle upload.');
        return;
      }

      if (!rootName.toLowerCase().endsWith('.app')) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bundle uploads must finalize to a .app root.');
        return;
      }

      const dir = bundleUploads.get(uploadId);
      if (!dir) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('No bundle upload exists for this uploadId.');
        return;
      }

      const installPath = resolveBundleUploadPath(dir, rootName);

      try {
        await options.installApp(installPath);
        await syncInspectorState();
        broadcast({ type: 'status', message: `Action OK: Installed ${rootName}` });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: installPath }));
      } finally {
        bundleUploads.delete(uploadId);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    async function getBundleUploadDir(uploadId: string): Promise<string> {
      const existing = bundleUploads.get(uploadId);
      if (existing) {
        return existing;
      }

      const dir = await mkdtemp(join(tmpdir(), `astur-inspector-bundle-${uploadId}-`));
      bundleUploads.set(uploadId, dir);
      return dir;
    }

    async function readRequestBuffer(req: IncomingMessage): Promise<Buffer> {
      const chunks: Buffer[] = [];

      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    }

    function normalizeUploadId(value: string | null): string | undefined {
      const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
      return normalized || undefined;
    }

    function normalizeClientUploadPath(value: string | null): string | undefined {
      const normalized = normalize(String(value ?? '').replace(/\\/g, '/')).replace(/^\/+/, '');
      if (!normalized || normalized === '.' || normalized.startsWith('..')) {
        return undefined;
      }

      return normalized.replace(/\\/g, '/');
    }

    function resolveBundleUploadPath(rootDir: string, relativePath: string): string {
      const target = resolve(rootDir, relativePath);
      const root = resolve(rootDir);
      if (target !== root && !target.startsWith(root + sep)) {
        throw new Error(`Invalid upload path: ${relativePath}`);
      }

      return target;
    }

    function looksLikeExecutableBinary(payload: Buffer): boolean {
      if (payload.length < 4) {
        return false;
      }

      const magic = payload.subarray(0, 4).toString('hex');
      return [
        'feedface',
        'feedfacf',
        'cefaedfe',
        'cffaedfe',
        'cafebabe',
        'bebafeca',
        'cafebabf',
        'bfbabeca'
      ].includes(magic);
    }

    // ── WebSocket server ───────────────────────────────────────────────────
    const wss = new WebSocketServer({ server });
    const clients = new Set<WebSocket>();
    let lastFrameDataUri: string | undefined;
    let lastFrameTimestamp = 0;

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
      if (lastFrameDataUri) {
        ws.send(JSON.stringify({
          type: 'frame',
          dataUri: lastFrameDataUri,
          timestamp: lastFrameTimestamp,
        } satisfies ServerEvent), () => { /* ignore send errors */ });
      }

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
          const shouldPerformTap = event.perform === true && !shouldRecordTap;

          const localNode = findUiNodeAtPoint(currentNodes, { x: event.x, y: event.y }, {
            preferActionable: shouldRecordTap
          });
          if (localNode) {
            uid = localNode.uid;
            node = localNode;
            suggestions = suggestLocatorsForNode(localNode, currentNodes);
          }

          if (!node && currentNodes.length > 0 && !shouldRecordTap && !shouldPerformTap) {
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
            if (shouldPerformTap) {
              await performInspectorCoordinateTap({ x: event.x, y: event.y }, ws);
            } else if (shouldRecordTap) {
              await recordInspectorCoordinateTap({ x: event.x, y: event.y }, ws);
            } else {
              ws.send(JSON.stringify({
                type: 'status',
                message: 'Action Pending: UI tree is still loading. Use Interact mode to tap by coordinate until elements are inspectable.'
              }));
            }
            return;
          }

          selectedUid = uid;
          const selectionEvent: ServerEvent = { type: 'selection', uid, node, suggestions };
          ws.send(JSON.stringify(selectionEvent));

          if (shouldPerformTap) {
            await performInspectorCoordinateTap({ x: event.x, y: event.y }, ws);
            break;
          }

          if (shouldRecordTap && !suggestions[0]) {
            await recordInspectorCoordinateTap({ x: event.x, y: event.y }, ws);
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

        case 'direct_action': {
          // The fill/tap buttons act on the currently selected node. When that is a
          // spliced WebView DOM node, drive it by its DOM locator (in-page JS)
          // instead of the native driver.
          const selectedWebNode = selectedUid
            ? currentNodes.find((node) => node.uid === selectedUid && node.web)
            : undefined;
          try {
            if (selectedWebNode?.web && activeInspector.webAct) {
              await activeInspector.webAct(
                selectedWebNode.web,
                event.action === 'fill' ? 'fill' : 'tap',
                event.value
              );
            } else if (event.action === 'fill') {
              await activeInspector.executeAction({
                kind: 'fill',
                selector: event.selector,
                value: event.value ?? '',
                options: { timeout: 2_000 }
              });
            } else {
              await activeInspector.executeAction({
                kind: 'tap',
                selector: event.selector,
                options: { timeout: 2_000 }
              });
            }

            await syncInspectorState();
            broadcast({ type: 'status', message: `Action OK: ${event.action === 'fill' ? 'Filled' : 'Tapped'}${selectedWebNode ? ' (web)' : ''}` });
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'status',
              message: `Action Error: ${event.action === 'fill' ? 'Fill' : 'Tap'} failed: ${formatActionError(error)}`
            }));
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
            if (binding.notice) {
              broadcast({ type: 'status', message: `Action Error: ${binding.notice}` });
            } else {
              broadcast({ type: 'status', message: `Action OK: Switched to ${activeDevice.name}` });
            }
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'status',
              message: `Action Error: Device switch failed: ${formatActionError(error)}`
            }));
          }
          break;
        }

        case 'terminate_session': {
          if (!options.terminateSession) {
            ws.send(JSON.stringify({ type: 'status', message: 'Action Error: Terminate is unavailable in this session.' }));
            break;
          }

          broadcast({ type: 'status', message: 'Action Pending: Terminating session...' });
          try {
            await options.terminateSession();
          } catch (error) {
            broadcast({
              type: 'status',
              message: `Action Error: Terminate failed: ${formatActionError(error)}`
            });
            break;
          }

          broadcast({
            type: 'terminated',
            message: 'Session terminated. The device session was closed and any emulator/simulator was shut down. You can close this tab.'
          });
          // Let the terminated event flush to clients, then stop the CLI — the
          // inspector cannot continue once its device session is gone.
          setTimeout(() => process.exit(0), 300);
          break;
        }

        case 'release_session': {
          if (!options.releaseSession) {
            ws.send(JSON.stringify({ type: 'status', message: 'Action Error: Release is unavailable in this session.' }));
            break;
          }

          broadcast({ type: 'status', message: 'Action Pending: Releasing session...' });
          try {
            await options.releaseSession();
          } catch (error) {
            broadcast({
              type: 'status',
              message: `Action Error: Release failed: ${formatActionError(error)}`
            });
            break;
          }

          broadcast({
            type: 'terminated',
            message: 'Session released. The device session was closed; the emulator/simulator was left running. You can close this tab.'
          });
          setTimeout(() => process.exit(0), 300);
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
            const result = await pushFrame();
            if (result === 'updated') {
              broadcast({ type: 'status', message: 'Action OK: Screen refreshed' });
            } else if (result === 'busy') {
              broadcast({ type: 'status', message: 'Action Pending: Screen refresh already running' });
            } else {
              broadcast({ type: 'status', message: 'Action Error: Screen refresh failed' });
            }
            break;
          }

          if (event.action === 'tree.refresh') {
            const result = await pushTree({ reportFirstError: true });
            if (result === 'updated') {
              broadcast({ type: 'status', message: 'Action OK: UI tree refreshed' });
            } else if (result === 'busy') {
              broadcast({ type: 'status', message: 'Action Pending: UI tree refresh already running' });
            } else if (result === 'failed') {
              broadcast({ type: 'status', message: 'Action Error: UI tree refresh did not return an update' });
            }
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

    async function performInspectorCoordinateTap(point: Coordinates, ws: WebSocket): Promise<void> {
      if (!options.performTap) {
        ws.send(JSON.stringify({ type: 'status', message: 'Action Error: Tap is unavailable in this session.' }));
        return;
      }

      try {
        await options.performTap(point);
        await syncInspectorState();
        broadcast({ type: 'status', message: 'Action OK: Tapped' });
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'status',
          message: `Action Error: Tap failed: ${formatActionError(error)}`
        }));
      }
    }

    async function recordInspectorCoordinateTap(point: Coordinates, ws: WebSocket): Promise<void> {
      if (!options.performTap) {
        ws.send(JSON.stringify({
          type: 'status',
          message: 'Action Error: Tap could not be recorded because coordinate tapping is unavailable in this session.'
        }));
        return;
      }

      try {
        await options.performTap(point);
        const step: RecordingStep = {
          index: steps.length,
          action: 'tapPoint',
          locator: '',
          point
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

    // ── Frame streaming loop ────────────────────────────────────────────────
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    let frameInFlight = false;

    async function pushFrame(): Promise<InspectorRefreshResult> {
      if (clients.size === 0 || frameInFlight) {
        return 'busy';
      }

      frameInFlight = true;
      try {
        const buf = await options.captureScreenshot();
        if (buf && buf.length > 0) {
          // Skip re-encoding and re-broadcasting identical frames (common on
          // static screens such as forms); this saves base64 work and socket
          // bandwidth and lets the poll loop back off while the screen is idle.
          if (lastFrameBuffer && buf.equals(lastFrameBuffer)) {
            frameIdleStreak += 1;
            return 'updated';
          }

          lastFrameBuffer = buf;
          lastFrameDataUri = `data:image/png;base64,${buf.toString('base64')}`;
          lastFrameTimestamp = Date.now();
          frameIdleStreak = 0;
          broadcast({
            type: 'frame',
            dataUri: lastFrameDataUri,
            timestamp: lastFrameTimestamp,
          });
          return 'updated';
        }
        return 'failed';
      } catch {
        // device may be busy
        return 'failed';
      } finally {
        frameInFlight = false;
      }
    }

    function scheduleFrame(): void {
      const interval = clients.size === 0
        ? maxIdleIntervalMs
        : nextPollInterval(baseFrameIntervalMs, frameIdleStreak, maxIdleIntervalMs);
      frameTimer = setTimeout(async () => {
        await pushFrame();
        scheduleFrame();
      }, interval);
    }

    // ── Tree polling loop ──────────────────────────────────────────────────
    let treeTimer: ReturnType<typeof setTimeout> | undefined;
    let treeInFlight = false;
    let lastTreeErrorMessage: string | undefined;
    let lastTreeErrorAt = 0;
    let consecutiveTreeErrors = 0;

    async function pushTree(options: { reportFirstError?: boolean } = {}): Promise<InspectorRefreshResult> {
      if (treeInFlight) {
        return 'busy';
      }

      // Avoid expensive UI-tree reads (e.g. adb `uiautomator dump`, broad XCUI
      // queries) when nobody is watching. Bootstrap/manual refreshes pass
      // reportFirstError and are always honoured.
      if (clients.size === 0 && !options.reportFirstError) {
        return 'busy';
      }

      treeInFlight = true;
      try {
        for await (const update of activeInspector.subscribeTree({ maxUpdates: 1 })) {
          const nodes = flattenSnapshot(update.root);
          // Splice any WebView DOM (cached from the adaptive probe) under its native
          // host so its elements appear in the tree with real DOM locators.
          maybeProbeWebTree();
          if (cachedWebTree) {
            try {
              nodes.push(...buildWebNodes(cachedWebTree, nodes));
            } catch {
              // Best-effort: never let WebView DOM block the native tree.
            }
          }
          const viewport = estimateViewport(nodes);
          currentNodes = nodes;
          currentViewport = viewport;
          consecutiveTreeErrors = 0;
          lastTreeErrorMessage = undefined;

          const signature = computeTreeSignature(nodes);
          if (signature === lastTreeSignature && !options.reportFirstError) {
            // Tree is unchanged: keep the freshly captured nodes for hit-testing
            // but skip the broadcast and suggestion recompute, and let the poll
            // loop back off.
            treeIdleStreak += 1;
            return 'updated';
          }

          lastTreeSignature = signature;
          treeIdleStreak = 0;
          revision += 1;
          const initialUid = selectedUid ?? pickInitialUid(currentNodes);
          const initialNode = initialUid
            ? currentNodes.find((node) => node.uid === initialUid)
            : undefined;
          initialSuggestions = initialNode ? suggestLocatorsForNode(initialNode, currentNodes) : [];
          broadcast({ type: 'tree', nodes, viewport, revision });
          return 'updated';
        }
        return 'failed';
      } catch (error) {
        consecutiveTreeErrors += 1;
        const message = formatActionError(error);
        const now = Date.now();
        if (!options.reportFirstError && consecutiveTreeErrors < 2 && currentNodes.length > 0) {
          return 'failed';
        }

        if (options.reportFirstError || message !== lastTreeErrorMessage || now - lastTreeErrorAt > 8_000) {
          lastTreeErrorMessage = message;
          lastTreeErrorAt = now;
          const prefix = currentNodes.length > 0 ? 'Action Pending' : 'Action Error';
          const label = currentNodes.length > 0 ? 'UI tree refresh delayed' : 'UI tree unavailable';
          broadcast({
            type: 'status',
            message: `${prefix}: ${label}: ${message}`
          });
          return 'reported';
        }

        return 'failed';
      } finally {
        treeInFlight = false;
      }
    }

    async function syncInspectorState(): Promise<{ frame: InspectorRefreshResult; tree: InspectorRefreshResult }> {
      // An action just ran: snap polling back to the responsive base interval so
      // the resulting screen/tree change surfaces immediately.
      frameIdleStreak = 0;
      treeIdleStreak = 0;
      const frame = await pushFrame();
      void pushTree({ reportFirstError: true }).catch(() => undefined);
      return { frame, tree: 'busy' };
    }

    function scheduleTree(): void {
      // Back off hard when the tree read keeps failing/timing out — e.g. XCUITest
      // stalling on a heavy WebView snapshot. Retrying every interval just piles
      // commands onto an already-stuck agent; poll slowly until it recovers (a
      // successful read resets consecutiveTreeErrors and snaps back to base).
      const stalled = consecutiveTreeErrors >= 3;
      const interval = clients.size === 0 || stalled
        ? maxIdleIntervalMs
        : nextPollInterval(baseTreeIntervalMs, treeIdleStreak, maxIdleIntervalMs);
      treeTimer = setTimeout(async () => {
        await pushTree();
        scheduleTree();
      }, interval);
    }

    // ── Startup ────────────────────────────────────────────────────────────
    // Bind to loopback only: the inspector grants full device control (tap,
    // fill, swipe, app install) over an unauthenticated socket and must never be
    // reachable from other hosts on the network.
    server.listen(options.port ?? 0, '127.0.0.1', () => {
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
          for (const dir of bundleUploads.values()) {
            void rm(dir, { recursive: true, force: true }).catch(() => undefined);
          }
          bundleUploads.clear();
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

/**
 * Back off a polling interval the longer the device stays idle, capped at
 * maxMs. The interval returns to the base value (streak 0) the moment a change
 * or action is observed, keeping active inspection responsive while idle
 * sessions stop hammering slow device transports.
 */
function nextPollInterval(baseMs: number, idleStreak: number, maxMs: number): number {
  if (idleStreak <= 1) {
    return baseMs;
  }

  const factor = 1 + Math.min(3, (idleStreak - 1) * 0.5);
  return Math.min(maxMs, Math.round(baseMs * factor));
}

/**
 * Compact, order-sensitive fingerprint of the visible UI tree used to detect
 * whether anything changed between polls. Hashing keeps the stored value small
 * and the comparison O(1) regardless of tree size.
 */
function computeTreeSignature(nodes: UiNode[]): string {
  const hash = createHash('sha1');
  for (const node of nodes) {
    hash.update(node.uid);
    hash.update('|');
    hash.update(node.type);
    hash.update('|');
    hash.update(`${node.bounds.x},${node.bounds.y},${node.bounds.width},${node.bounds.height}`);
    hash.update('|');
    hash.update(node.visible ? '1' : '0');
    hash.update(node.enabled ? '1' : '0');
    hash.update('|');
    hash.update(node.id ?? '');
    hash.update('|');
    hash.update(node.label ?? '');
    hash.update('|');
    hash.update(node.text ?? '');
    hash.update('|');
    hash.update(node.value ?? '');
    hash.update('\n');
  }
  return hash.digest('hex');
}

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

function webLocatorCode(descriptor: WebLocatorDescriptor): string {
  switch (descriptor.strategy) {
    case 'testid': return `device.getByTestId(${JSON.stringify(descriptor.value)})`;
    case 'id': return `device.getById(${JSON.stringify(descriptor.value)})`;
    case 'role': return `device.getByRole(${JSON.stringify(descriptor.value)}${descriptor.name ? `, { name: ${JSON.stringify(descriptor.name)} }` : ''})`;
    case 'text': return `device.getByText(${JSON.stringify(descriptor.value)})`;
    default: return `device.locator(${JSON.stringify(descriptor.value)})`;
  }
}

function webLocatorSuggestion(descriptor: WebLocatorDescriptor): LocatorSuggestion {
  const code = webLocatorCode(descriptor);
  // Web actions are routed by the DOM locator (node.web), not this selector, so it
  // only needs to be a valid placeholder for display/typing.
  const selector: ElementSelector =
    descriptor.strategy === 'role' ? { strategy: 'role', value: descriptor.value, name: descriptor.name }
    : descriptor.strategy === 'text' ? { strategy: 'text', value: descriptor.value }
    : { strategy: 'id', value: descriptor.value };
  return { code, selector, score: 0.96, uniqueness: 1, stability: 0.9, readable: code.length <= 88, crossPlatform: true };
}

function webNodeTitle(node: WebElementSnapshot): string {
  const tag = node.tag.toLowerCase();
  const handle = node.testId ? `[testid=${node.testId}]` : node.id ? `#${node.id}` : '';
  const name = (node.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `<${tag}>${handle ? ` ${handle}` : ''}${name ? ` ${name}` : ''}`.trim();
}

/**
 * Locate the native node that hosts the WebView surface: the one whose device-px
 * bounds best match the web viewport scaled by the device pixel ratio. Used to
 * map DOM (CSS px) coordinates onto the device screen for overlays/hit-testing.
 */
function findWebHostNode(web: WebTreeSnapshot, nativeNodes: UiNode[]): UiNode | undefined {
  const dpr = web.devicePixelRatio || 1;
  const targetW = web.viewport.width * dpr;
  const targetH = web.viewport.height * dpr;
  if (targetW < 8 || targetH < 8) {
    return undefined;
  }
  let best: UiNode | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const node of nativeNodes) {
    if (!node.visible || node.bounds.width < 8 || node.bounds.height < 8) {
      continue;
    }
    const dw = Math.abs(node.bounds.width - targetW);
    const dh = Math.abs(node.bounds.height - targetH);
    if (dw <= targetW * 0.25 && dh <= targetH * 0.25 && dw + dh < bestScore) {
      best = node;
      bestScore = dw + dh;
    }
  }
  return best;
}

/**
 * Flatten a WebView DOM snapshot into UiNodes spliced under its native host. DOM
 * actions run by locator (engine JS), so even when the host can't be matched the
 * nodes stay browsable/fillable — only the screenshot overlay needs the bounds.
 */
function buildWebNodes(web: WebTreeSnapshot, nativeNodes: UiNode[]): UiNode[] {
  if (!web.root) {
    return [];
  }
  const host = findWebHostNode(web, nativeNodes);
  const dpr = web.devicePixelRatio || 1;
  const mapBounds = (b: WebElementSnapshot['bounds']): Bounds =>
    host
      ? {
        x: Math.round(host.bounds.x + b.x * dpr),
        y: Math.round(host.bounds.y + b.y * dpr),
        width: Math.round(b.width * dpr),
        height: Math.round(b.height * dpr)
      }
      : { x: 0, y: 0, width: 0, height: 0 };

  const out: UiNode[] = [];
  const visit = (node: WebElementSnapshot, depth: number, uid: string, parentUid?: string): void => {
    out.push({
      uid,
      parentUid,
      depth,
      title: webNodeTitle(node),
      type: `web:${node.tag.toLowerCase()}`,
      id: node.id,
      label: node.name,
      text: node.role ? undefined : node.name,
      value: node.value,
      visible: node.visible,
      enabled: node.enabled,
      bounds: mapBounds(node.bounds),
      web: node.locator
    });
    node.children.forEach((child, index) => visit(child, depth + 1, `${uid}/${index}`, uid));
  };

  visit(web.root, host ? host.depth + 1 : 1, 'web', host?.uid);
  return out;
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
  if (node.web) {
    // DOM nodes carry the in-page best locator; the native ranking doesn't apply.
    return [webLocatorSuggestion(node.web)];
  }
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
  // WebView DOM nodes are already their own best target — never re-resolve them to
  // a native ancestor, or selection/action routing would lose the DOM locator.
  if (node.web) {
    return node;
  }
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
    ? `import { test, expect } from '@astur-mobile/test';`
    : `const { test, expect } = require('@astur-mobile/test');`;

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
  { id: 'refresh', label: 'Refresh Screen', group: 'device' },
  { id: 'tree.refresh', label: 'Refresh UI Tree', group: 'device' },
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
    case 'tree.refresh':
      return iconSvg('<path d="M21 12a9 9 0 0 1-9 9 8.7 8.7 0 0 1-6.2-2.6"/><path d="M3 12a9 9 0 0 1 15.2-6.5"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/><path d="M12 7v4"/><path d="M9 11h6"/><path d="M8 16h8"/>');
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
  buildInspectorHtml,
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
#device-controls{position:relative;display:flex;align-items:center;gap:8px}
#device-menu-btn{padding:6px 12px;border-radius:var(--radius);border:1px solid var(--border);font-size:12px;font-weight:600;cursor:pointer;background:var(--surface2);color:var(--text);transition:all .15s}
#device-menu-btn:hover,#device-controls.open #device-menu-btn{border-color:var(--accent);color:var(--accent-hover)}
#device-status{flex:1;min-width:0;font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;padding:0 12px}
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
.device-action-btn.danger{color:var(--red);border-color:#4a1414}
.device-action-btn.danger:hover{border-color:var(--red);color:var(--red);background:rgba(248,81,73,.08)}
.device-action-btn.danger:disabled{opacity:.55;cursor:not-allowed}
#terminated-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(7,17,31,.82);backdrop-filter:blur(4px)}
#terminated-overlay .terminated-card{max-width:420px;margin:24px;padding:28px 32px;border-radius:12px;border:1px solid var(--border);background:var(--surface);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.45)}
#terminated-overlay h2{margin:0 0 10px;font-size:18px;color:var(--text)}
#terminated-overlay p{margin:0;font-size:13px;line-height:1.5;color:var(--text-muted)}
.device-action-btn.icon{width:32px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center}
.device-action-btn.icon svg{width:15px;height:15px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
.device-row{display:flex;gap:6px;align-items:center}
.device-row.upload-zone.drag-active .device-input,.device-row.upload-zone.drag-active .device-action-btn{border-color:var(--accent);background:rgba(31,111,235,.08)}
.device-help{font-size:10px;line-height:1.45;color:var(--text-muted);padding:0 2px}
#app-upload-selection{min-height:14px;color:var(--text-dim)}
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
#action-section{display:flex;flex-direction:column;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0}
.action-mode-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.mode-btn,.element-action-btn{min-height:30px;padding:5px 10px;border-radius:var(--radius);border:1px solid var(--border);font-size:11px;font-weight:700;cursor:pointer;background:var(--surface2);color:var(--text);transition:border-color .15s,color .15s,background .15s}
.mode-btn:hover,.element-action-btn:hover{border-color:var(--accent);color:var(--accent-hover)}
.mode-btn.active{border-color:var(--accent);color:var(--accent-hover);background:rgba(31,111,235,.12)}
.element-action-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px;align-items:center}
.element-action-input{min-width:0;height:30px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:5px 8px;font:11px var(--font);color:var(--text);outline:none}
.element-action-input:focus{border-color:var(--accent)}
.mode-btn:disabled,.element-action-btn:disabled,.element-action-input:disabled{opacity:.45;cursor:not-allowed;color:var(--text-muted)}
.mode-btn:disabled:hover,.element-action-btn:disabled:hover{border-color:var(--border);color:var(--text-muted)}
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
#inspector-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--border);flex-shrink:0}
#legal-note{font-size:10px;color:var(--text-muted);line-height:1.4}
/* Center mirror */
#center-panel{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px 18px 16px;overflow:hidden;background:var(--bg)}
#phone-shell{position:relative;background:transparent;border:none;padding:0;box-shadow:none;flex-shrink:0}
#phone-notch{display:none}
#mirror-stage{position:relative;cursor:crosshair;overflow:hidden;border-radius:28px;background:#0a0a0f;box-shadow:0 24px 64px rgba(0,0,0,.48),0 0 0 1px rgba(255,255,255,.08);width:360px;height:720px;max-width:calc(100vw - 420px);max-height:calc(100vh - 96px)}
#mirror-stage[data-mode="interact"]{cursor:pointer}
#mirror-stage.dragging{cursor:grabbing}
#mirror-img{display:block;max-width:100%;user-select:none;pointer-events:none;border-radius:inherit}
#mirror-img.placeholder{opacity:.15}
#highlight-overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
.el-highlight{position:absolute;border:2px solid var(--purple);background:rgba(139,92,246,.12);border-radius:2px;transition:all .1s}
.el-label{position:absolute;top:-18px;left:0;background:var(--purple);color:#fff;font:10px/18px var(--mono);padding:0 5px;border-radius:3px;white-space:nowrap}
#mirror-status{margin-top:12px;font-size:11px;color:var(--text-muted);text-align:center}
#busy-overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(13,17,23,.72);z-index:5;text-align:center;padding:24px}
#busy-overlay.active{display:flex}
.spinner{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.18);border-top-color:var(--accent-hover);animation:spin .8s linear infinite}
.busy-label{font-size:12px;font-weight:600;color:var(--text)}
.busy-subtitle{font-size:11px;color:var(--text-muted);max-width:220px}
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
#tree-list{flex:1;overflow:auto;padding:4px 0}
.tree-empty{padding:16px 12px;font-size:12px;color:var(--text-muted);text-align:center}
.tree-node{display:flex;align-items:center;gap:4px;padding:2px 8px;cursor:pointer;border-left:2px solid transparent;transition:background .1s;min-width:100%;width:max-content}
.tree-node:hover{background:var(--surface2)}
.tree-node.selected{background:rgba(31,111,235,.15);border-left-color:var(--accent)}
.tree-node.hidden{opacity:.35}
.tree-expander{width:14px;flex-shrink:0;font-size:10px;color:var(--text-muted);cursor:pointer;user-select:none}
.tree-type{font:10px/1 var(--mono);color:var(--text-muted);flex-shrink:0;white-space:nowrap}
.tree-title{font-size:11px;color:var(--text-dim);flex:0 0 auto;white-space:nowrap}
/* Code panel */
#code-panel{display:flex;flex-direction:column;overflow:hidden;min-height:0}
#code-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
.code-tab{padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;transition:all .1s}
.code-tab:hover{color:var(--text)}
.code-tab.active{color:var(--accent-hover);border-bottom-color:var(--accent-hover)}
#code-view{flex:1;display:flex;flex-direction:column;overflow:hidden}
#code-lang-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);flex-shrink:0;align-items:center;padding-right:8px}
#code-script-copy-btn{margin-left:auto}
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
    <span id="device-status" aria-live="polite"></span>
    <div id="device-controls">
      <button id="device-menu-btn" type="button" aria-haspopup="true" aria-expanded="false">Controls</button>
      <div id="device-menu">
        <div class="device-menu-section">
          <div class="device-menu-label">App</div>
          <div class="device-row">
            <input id="app-identifier-input" class="device-input" placeholder="package or bundle id"/>
            <button type="button" class="device-action-btn" id="launch-app-btn">Launch</button>
          </div>
          <div id="app-upload-row" class="device-row upload-zone">
            <input id="app-upload-input" class="device-input" type="file" accept=".apk,.ipa,.app"/>
            <button type="button" class="device-action-btn" id="install-app-btn">Install</button>
          </div>
          <div id="app-upload-hint" class="device-help">Android installs use .apk. iOS Simulator uses a simulator-built .app from Xcode. Real iPhone/iPad installs use a signed .ipa.</div>
          <div id="app-upload-selection" class="device-help"></div>
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
        <div class="device-menu-section">
          <div class="device-menu-label">Session</div>
          <div class="device-menu-actions">
            <button type="button" class="device-action-btn icon" id="release-session-btn" title="Release session" aria-label="Release session">${iconSvg('<path d="M5 17h14"/><path d="M12 4 5 13h14z"/>')}</button>
            <button type="button" class="device-action-btn icon danger" id="terminate-session-btn" title="Terminate session" aria-label="Terminate session">${iconSvg('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>')}</button>
          </div>
          <div class="device-help"><strong>Release</strong> closes the device session but leaves the emulator/simulator running for reuse. <strong>Terminate</strong> also powers it off to free memory. Real devices stay on.</div>
        </div>
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
        <div id="action-section">
          <div class="action-mode-row" role="group" aria-label="Mirror click mode">
            <button type="button" id="inspect-mode-btn" class="mode-btn active" title="Select elements in the mirror">Inspect</button>
            <button type="button" id="interact-mode-btn" class="mode-btn" title="Tap the device without recording">Interact</button>
          </div>
          <div class="element-action-row">
            <button type="button" id="element-tap-btn" class="element-action-btn" disabled>Tap</button>
            <input id="element-fill-input" class="element-action-input" placeholder="text" disabled/>
            <button type="button" id="element-fill-btn" class="element-action-btn" disabled>Fill</button>
          </div>
        </div>
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
          <span id="legal-note">© ${new Date().getFullYear()} Astur · Open source, Apache-2.0</span>
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
          <div id="busy-overlay" class="active" aria-live="polite" aria-busy="true">
            <div class="spinner"></div>
            <div id="busy-label" class="busy-label">Inspector is not ready yet</div>
            <div id="busy-subtitle" class="busy-subtitle">Astur is preparing the device, screen stream, and UI tree. This can take a few minutes on first real-device runs.</div>
          </div>
        </div>
      </div>
      <div id="mirror-status">Waiting for device…</div>
    </div>

    <div id="right-column-splitter" title="Drag to resize the UI Tree panel"></div>

    <!-- Right: Tree + Code -->
    <div id="right-panel">
      <!-- Tree -->
      <div id="tree-panel">
        <div class="panel-header" style="display:flex;align-items:center;gap:8px">
          <span>UI Tree</span>
          <span id="tree-badge" style="font-weight:400;color:var(--text-muted)"></span>
          <button type="button" class="device-action-btn icon" id="tree-refresh-btn" title="Refresh UI tree" aria-label="Refresh UI tree" style="margin-left:auto;width:26px;height:24px">${inspectorDeviceActionIcon('tree.refresh')}</button>
        </div>
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
          <div id="code-lang-tabs">
            <button class="code-tab active" data-lang="typescript">TypeScript</button>
            <button class="code-tab" data-lang="javascript">JavaScript</button>
            <button id="code-script-copy-btn" class="copy-btn" type="button" title="Copy script" aria-label="Copy script"></button>
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
let activeSelector = null;
let recording = false;
let mirrorMode = 'inspect';
let steps = [];
let codeLang = 'typescript';
let activeTab = 'code';
let currentDevice = ${JSON.stringify(toBootstrapDevice(device))};
let devices = [currentDevice];
let busyCount = 0;
let busyWatchdog = null;
// Hard ceiling on how long the "Running action…" overlay may stay up. If the
// device/agent stops responding (e.g. XCUITest stalls while snapshotting a heavy
// WebView), no status ever comes back and the overlay would otherwise spin
// forever, bricking the session. The watchdog force-clears it so the user can
// keep working (switch screens, terminate, etc.).
const BUSY_WATCHDOG_MS = 15000;
let socketConnected = false;
let hasFrame = false;
let hasTree = false;
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
const busyLabel = $('busy-label');
const busySubtitle = $('busy-subtitle');
const centerPanel = $('center-panel');
const highlightOverlay = $('highlight-overlay');
const inspectorHint = $('inspector-hint');
const inspectModeBtn = $('inspect-mode-btn');
const interactModeBtn = $('interact-mode-btn');
const elementTapBtn = $('element-tap-btn');
const elementFillInput = $('element-fill-input');
const elementFillBtn = $('element-fill-btn');
const bestLocatorCode = $('best-locator-code');
const alternativesList = $('alternatives-list');
const detailsBody = $('details-body');
const treeList = $('tree-list');
const treeSearch = $('tree-search');
const treeBadge = $('tree-badge');
const codeBlock = $('code-block');
const codeScriptCopyBtn = $('code-script-copy-btn');
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
const appUploadRow = $('app-upload-row');
const appUploadInput = $('app-upload-input');
const appUploadHint = $('app-upload-hint');
const appUploadSelection = $('app-upload-selection');
const permissionInput = $('permission-input');
const launchAppBtn = $('launch-app-btn');
const installAppBtn = $('install-app-btn');
const grantPermissionBtn = $('grant-permission-btn');
const revokePermissionBtn = $('revoke-permission-btn');
const clearDataBtn = $('clear-data-btn');
const clearCacheBtn = $('clear-cache-btn');
const terminateSessionBtn = $('terminate-session-btn');
const releaseSessionBtn = $('release-session-btn');
const treeRefreshBtn = $('tree-refresh-btn');
const main = $('main');
const leftColumnSplitter = $('left-column-splitter');
const rightColumnSplitter = $('right-column-splitter');
const rightPanel = $('right-panel');
const rightSplitter = $('right-splitter');
let deviceStatusTimer;
let pendingInstallSelection = null;

// ── WebSocket ──────────────────────────────────────────────────────────────
let ws;
function connectWs() {
  ws = new WebSocket('ws://' + location.host);
  ws.onopen = () => {
    socketConnected = true;
    updateDeviceReadiness();
  };
  ws.onclose = () => {
    socketConnected = false;
    liveBadge.textContent = 'Disconnected';
    liveBadge.className = 'connecting';
    updateDeviceReadiness('Connection lost. Reconnecting…');
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

function sessionTerminated(message) {
  // The server exits on purpose after terminating, so stop the auto-reconnect
  // loop (otherwise the socket close handler would spam "Reconnecting…").
  if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { /* ignore */ } }
  if (document.getElementById('terminated-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'terminated-overlay';
  const card = document.createElement('div');
  card.className = 'terminated-card';
  const heading = document.createElement('h2');
  heading.textContent = 'Session terminated';
  const body = document.createElement('p');
  body.textContent = message;
  card.appendChild(heading);
  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ── Server event handler ───────────────────────────────────────────────────
function handleServerEvent(ev) {
  switch (ev.type) {
    case 'bootstrap':
      resetDeviceReadiness('Inspector is not ready yet');
      currentDevice = ev.device || currentDevice;
      devices = mergeDevices(devices, currentDevice);
      renderDeviceHeader();
      renderDeviceList();
      if (ev.logoDataUri) { logo.src = ev.logoDataUri; logo.style.display = ''; }
      nodes = ev.nodes || [];
      viewport = ev.viewport || { width: 1, height: 1 };
      hasTree = nodes.length > 0;
      if (ev.suggestions) currentSuggestions = ev.suggestions;
      renderTree();
      if (ev.initialUid) selectUid(ev.initialUid, ev.suggestions || [], false);
      updateDeviceReadiness();
      break;

    case 'devices':
      devices = ev.devices || [];
      renderDeviceList();
      break;

    case 'frame':
      hasFrame = true;
      mirrorImg.src = ev.dataUri;
      mirrorImg.classList.remove('placeholder');
      $('mirror-status').textContent = '';
      sizeMirror();
      updateDeviceReadiness();
      break;

    case 'tree':
      nodes = ev.nodes || [];
      viewport = ev.viewport || viewport;
      sizeMirror();
      hasTree = nodes.length > 0;
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
      updateDeviceReadiness();
      break;

    case 'selection':
      nodes = updateNodeInList(nodes, ev.uid, ev.node);
      selectUid(ev.uid, ev.suggestions || [], true);
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

    case 'terminated':
      sessionTerminated(ev.message || 'Session terminated.');
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
  if (busyWatchdog) {
    clearTimeout(busyWatchdog);
    busyWatchdog = null;
  }
  if (busyCount > 0) {
    busyWatchdog = setTimeout(onBusyWatchdogExpired, BUSY_WATCHDOG_MS);
  }
  updateDeviceReadiness();
}

// Fires when an action's overlay has been up too long with no response. Clears
// the overlay and tells the user the session is still live so they can recover
// (common when a native+web hybrid screen leaves XCUITest mid-snapshot).
function onBusyWatchdogExpired() {
  busyWatchdog = null;
  if (busyCount === 0) return;
  busyCount = 0;
  releaseGestureLock();
  showDeviceStatus('Action timed out — the device is slow to respond (a heavy web view can stall the UI tree). The session is still live; try again or switch screens.', 'error');
  updateDeviceReadiness();
}

function resetDeviceReadiness(message) {
  hasFrame = false;
  hasTree = false;
  selectedUid = null;
  currentSuggestions = [];
  activeLocator = '';
  activeSelector = null;
  mirrorImg.src = '';
  mirrorImg.classList.add('placeholder');
  highlightOverlay.innerHTML = '';
  renderLocators([]);
  detailsBody.innerHTML = '';
  updateDeviceReadiness(message);
}

function updateDeviceReadiness(message) {
  const screenReady = socketConnected && hasFrame;
  const overlayActive = busyCount > 0 || !screenReady;
  busyOverlay.classList.toggle('active', overlayActive);
  busyOverlay.setAttribute('aria-busy', overlayActive ? 'true' : 'false');

  if (!socketConnected) {
    liveBadge.textContent = 'Connecting…';
    liveBadge.className = 'connecting';
    busyLabel.textContent = message || 'Connecting to Inspector…';
    busySubtitle.textContent = 'Waiting for the local Inspector session. The device is not ready yet.';
    $('mirror-status').textContent = message || 'Connecting to Inspector…';
    return;
  }

  if (!hasFrame) {
    liveBadge.textContent = 'Preparing';
    liveBadge.className = 'connecting';
    busyLabel.textContent = message || 'Preparing device…';
    busySubtitle.textContent = 'Astur is waiting for the first screen frame. If this is the first real-device run, Xcode/agent setup may take a few minutes.';
    $('mirror-status').textContent = message || 'Waiting for device…';
    return;
  }

  if (!hasTree) {
    liveBadge.textContent = 'Live';
    liveBadge.className = '';
    busyLabel.textContent = busyCount > 0 ? 'Running action…' : 'Screen ready';
    busySubtitle.textContent = busyCount > 0
      ? 'Waiting for device response.'
      : 'The screen is visible. The UI tree is still loading, so inspection and locator ranking may lag behind the mirror.';
    if (busyCount === 0 && !$('device-status').textContent) {
      $('mirror-status').textContent = 'UI tree still loading…';
    }
    return;
  }

  liveBadge.textContent = 'Live';
  liveBadge.className = '';
  busyLabel.textContent = busyCount > 0 ? 'Running action…' : 'Ready';
  busySubtitle.textContent = busyCount > 0 ? 'Waiting for device response.' : '';
  if (busyCount === 0) {
    $('mirror-status').textContent = '';
  }
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
  applyDeviceInstallSpec(currentDevice);
}

function deviceInstallSpec(device) {
  if (device && device.platform === 'android') {
    return {
      installKind: 'file',
      accept: '.apk',
      extensions: ['.apk'],
      identifierPlaceholder: 'package id, e.g. com.example.app',
      hint: 'Android installs use .apk files. You can choose a file or drag one into this area.',
      emptyMessage: 'Choose an .apk to install on Android.',
      invalidMessage: 'Android installs require an .apk file.'
    };
  }

  if (device && device.platform === 'ios' && device.kind === 'simulator') {
    return {
      installKind: 'bundle',
      accept: '.app',
      extensions: ['.app'],
      identifierPlaceholder: 'bundle id, e.g. com.example.app',
      hint: 'iOS Simulator installs use a simulator-built .app bundle from Xcode. Choose the .app bundle directory or drag it into this area.',
      emptyMessage: 'Choose a simulator-built .app bundle for iOS Simulator.',
      invalidMessage: 'iOS Simulator installs require a simulator-built .app bundle from Xcode.'
    };
  }

  if (device && device.platform === 'ios') {
    return {
      installKind: 'file',
      accept: '.ipa',
      extensions: ['.ipa'],
      identifierPlaceholder: 'bundle id, e.g. com.example.app',
      hint: 'Real iPhone and iPad installs use a signed .ipa with a valid provisioning profile trusted on the device. You can choose a file or drag one into this area.',
      emptyMessage: 'Choose a signed .ipa to install on iPhone or iPad.',
      invalidMessage: 'Real iPhone and iPad installs require a signed .ipa.'
    };
  }

  return {
    installKind: 'file',
    accept: '.apk,.app,.ipa',
    extensions: ['.apk', '.app', '.ipa'],
    identifierPlaceholder: 'package or bundle id',
    hint: 'Android installs use .apk. iOS Simulator uses a simulator-built .app from Xcode. Real iPhone and iPad installs use a signed .ipa.',
    emptyMessage: 'Choose an install artifact.',
    invalidMessage: 'Choose a valid install artifact for the current device.'
  };
}

function applyDeviceInstallSpec(device) {
  const spec = deviceInstallSpec(device);
  appIdentifierInput.placeholder = spec.identifierPlaceholder;
  if (spec.installKind === 'bundle') {
    appUploadInput.removeAttribute('accept');
    appUploadInput.setAttribute('webkitdirectory', '');
    appUploadInput.setAttribute('directory', '');
    appUploadInput.multiple = true;
  } else {
    appUploadInput.accept = spec.accept;
    appUploadInput.removeAttribute('webkitdirectory');
    appUploadInput.removeAttribute('directory');
    appUploadInput.multiple = false;
  }
  appUploadInput.title = '';
  const specKey = spec.installKind + ':' + spec.accept;
  if (appUploadInput.dataset.acceptSpec !== specKey) {
    appUploadInput.value = '';
    appUploadInput.dataset.acceptSpec = specKey;
    pendingInstallSelection = null;
  }
  if (appUploadHint) {
    appUploadHint.textContent = spec.hint;
  }
  renderInstallSelection();
}

function isAllowedInstallArtifact(file, spec) {
  const name = String(file && file.name || '').toLowerCase();
  return spec.extensions.some((extension) => name.endsWith(extension));
}

function renderInstallSelection() {
  if (!appUploadSelection) return;
  if (!pendingInstallSelection) {
    appUploadSelection.textContent = '';
    return;
  }

  if (pendingInstallSelection.kind === 'bundle') {
    appUploadSelection.textContent = 'Selected bundle: ' + pendingInstallSelection.rootName + ' (' + pendingInstallSelection.files.length + ' files)';
    return;
  }

  appUploadSelection.textContent = 'Selected file: ' + pendingInstallSelection.file.name;
}

function setPendingInstallSelection(selection) {
  pendingInstallSelection = selection;
  renderInstallSelection();
}

function clearPendingInstallSelection() {
  pendingInstallSelection = null;
  renderInstallSelection();
}

function normalizeBundleEntries(files) {
  return Array.from(files || []).map((file) => ({
    file,
    relativePath: String(file.webkitRelativePath || file.name).replace(/\\\\/g, '/')
  }));
}

function inferBundleRootName(entries) {
  const roots = [...new Set(entries.map((entry) => String(entry.relativePath || '').split('/')[0]).filter(Boolean))];
  return roots.length === 1 ? roots[0] : undefined;
}

function createInstallSelectionFromFiles(files, spec) {
  const list = Array.from(files || []);
  if (!list.length) {
    return null;
  }

  if (spec.installKind === 'bundle') {
    const entries = normalizeBundleEntries(list);
    const rootName = inferBundleRootName(entries);
    if (!rootName || !rootName.toLowerCase().endsWith('.app')) {
      throw new Error(spec.invalidMessage);
    }

    return {
      kind: 'bundle',
      rootName,
      files: entries
    };
  }

  const file = list[0];
  if (!isAllowedInstallArtifact(file, spec)) {
    throw new Error(spec.invalidMessage);
  }

  return {
    kind: 'file',
    file
  };
}

function readDirectoryEntries(reader) {
  return new Promise((resolve) => {
    const entries = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, () => resolve(entries));
    };
    readBatch();
  });
}

async function readDroppedEntry(entry, prefix) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        resolve([{ file, relativePath: prefix + file.name }]);
      }, () => resolve([]));
    });
  }

  if (!entry.isDirectory) {
    return [];
  }

  const nextPrefix = prefix + entry.name + '/';
  const children = await readDirectoryEntries(entry.createReader());
  const nested = await Promise.all(children.map((child) => readDroppedEntry(child, nextPrefix)));
  return nested.flat();
}

async function createInstallSelectionFromDrop(dataTransfer, spec) {
  if (spec.installKind !== 'bundle') {
    return createInstallSelectionFromFiles(dataTransfer.files, spec);
  }

  const items = Array.from(dataTransfer.items || []);
  const nested = await Promise.all(items.map(async (item) => {
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      return readDroppedEntry(entry, '');
    }
    const file = item.getAsFile ? item.getAsFile() : null;
    return file ? [{ file, relativePath: file.name }] : [];
  }));
  const entries = nested.flat();

  if (entries.length) {
    const rootName = inferBundleRootName(entries);
    if (!rootName || !rootName.toLowerCase().endsWith('.app')) {
      throw new Error(spec.invalidMessage);
    }

    return {
      kind: 'bundle',
      rootName,
      files: entries
    };
  }

  return createInstallSelectionFromFiles(dataTransfer.files, spec);
}

async function uploadInstallSelection(selection) {
  if (!selection) {
    return;
  }

  if (selection.kind === 'bundle') {
    const uploadId = self.crypto && self.crypto.randomUUID
      ? self.crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);

    for (const entry of selection.files) {
      const response = await fetch('/api/upload-app-file?uploadId=' + encodeURIComponent(uploadId) + '&relativePath=' + encodeURIComponent(entry.relativePath), {
        method: 'POST',
        body: entry.file
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    }

    const finalize = await fetch('/api/upload-app-bundle?uploadId=' + encodeURIComponent(uploadId) + '&rootName=' + encodeURIComponent(selection.rootName), {
      method: 'POST'
    });
    if (!finalize.ok) {
      throw new Error(await finalize.text());
    }
    return;
  }

  const response = await fetch('/api/upload-app?filename=' + encodeURIComponent(selection.file.name), {
    method: 'POST',
    body: selection.file
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
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
  if (!nodes.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = socketConnected ? 'Reading UI tree…' : 'Connecting to Inspector…';
    treeList.innerHTML = '';
    treeList.appendChild(empty);
    return;
  }
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
  const list = suggestions || [];
  currentSuggestions = list;
  const best = list[0];
  activeLocator = best ? best.code : '';
  activeSelector = best ? best.selector : null;
  renderBestLocator();
  alternativesList.innerHTML = '';
  for (const s of list.slice(1, 5)) {
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
      activeSelector = s.selector;
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
    activeSelector = null;
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
  const canRunAction = hasLocator && !!activeSelector;
  const canFill = canRunAction && isFillableSelectedNode();
  addTapBtn.disabled = !hasLocator;
  addExpectBtn.disabled = !hasLocator;
  addFillBtn.disabled = !hasLocator || !isFillableSelectedNode();
  addFillBtn.title = addFillBtn.disabled && hasLocator
    ? 'Fill is only available for text input elements'
    : '';
  elementTapBtn.disabled = !canRunAction;
  elementFillInput.disabled = !canFill;
  elementFillBtn.disabled = !canFill;
  elementFillBtn.title = !canFill && canRunAction
    ? 'Fill is only available for text input elements'
    : '';
}

function setMirrorMode(mode) {
  mirrorMode = mode;
  const interacting = mode === 'interact';
  inspectModeBtn.classList.toggle('active', !interacting);
  interactModeBtn.classList.toggle('active', interacting);
  mirrorStage.dataset.mode = mode;
  inspectorHint.textContent = interacting
    ? 'Tap the screen to interact with the device without recording.'
    : 'Tap on the screen or select an element in the tree to generate locators.';
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
function resolveMirrorSourceSize() {
  // Size the stage to the screenshot's own pixels first: those are exactly what
  // gets drawn, and the image is sized with explicit width/height (no
  // object-fit), so any aspect-ratio mismatch stretches it. On rotation the
  // landscape frame arrives a tick before the tree's viewport updates — if we
  // trusted the (still portrait) viewport here, the landscape image would be
  // squeezed into a portrait stage. Fall back to the viewport, then a square,
  // until the first frame has loaded.
  const naturalWidth = Number(mirrorImg.naturalWidth || 0);
  const naturalHeight = Number(mirrorImg.naturalHeight || 0);
  if (naturalWidth > 1 && naturalHeight > 1) {
    return { width: naturalWidth, height: naturalHeight };
  }

  const viewportWidth = Number(viewport.width || 0);
  const viewportHeight = Number(viewport.height || 0);
  if (viewportWidth > 1 && viewportHeight > 1) {
    return { width: viewportWidth, height: viewportHeight };
  }

  return { width: 1, height: 1 };
}

function sizeMirror() {
  const source = resolveMirrorSourceSize();
  const sourceW = source.width;
  const sourceH = source.height;
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

mirrorImg.addEventListener('load', () => {
  sizeMirror();
  if (selectedUid) updateHighlight(selectedUid);
});

mirrorStage.addEventListener('click', e => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  const point = mirrorEventPoint(e);
  const performTap = mirrorMode === 'interact' && !recording;
  if (recording || performTap) setBusy(true);
  send({ type: 'click', x: point.x, y: point.y, record: recording, perform: performTap });
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

if (codeScriptCopyBtn) {
  codeScriptCopyBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const text = codeBlock.textContent || '';
    const copied = await copyText(text);
    if (!copied) return;
    codeScriptCopyBtn.classList.add('copied');
    codeScriptCopyBtn.title = 'Copied';
    clearTimeout(codeScriptCopyBtn._copyResetTimer);
    codeScriptCopyBtn._copyResetTimer = setTimeout(() => {
      codeScriptCopyBtn.classList.remove('copied');
      codeScriptCopyBtn.title = 'Copy script';
    }, 1200);
  });
}

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
    ? "import { test, expect } from '@astur-mobile/test';"
    : "const { test, expect } = require('@astur-mobile/test');";
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

// ── Direct Actions ────────────────────────────────────────────────────────
function runSelectedElementTap() {
  if (!activeSelector) return;
  showDeviceStatus('Tapping selected element...', 'pending');
  setBusy(true);
  send({ type: 'direct_action', action: 'tap', selector: activeSelector });
}

function runSelectedElementFill() {
  if (!activeSelector || !isFillableSelectedNode()) return;
  showDeviceStatus('Filling selected element...', 'pending');
  setBusy(true);
  send({
    type: 'direct_action',
    action: 'fill',
    selector: activeSelector,
    value: elementFillInput.value
  });
}

inspectModeBtn.addEventListener('click', () => setMirrorMode('inspect'));
interactModeBtn.addEventListener('click', () => setMirrorMode('interact'));
elementTapBtn.addEventListener('click', runSelectedElementTap);
elementFillBtn.addEventListener('click', runSelectedElementFill);
elementFillInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || elementFillBtn.disabled) return;
  event.preventDefault();
  runSelectedElementFill();
});
setMirrorMode('inspect');

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
  const spec = deviceInstallSpec(currentDevice);
  let selection;
  try {
    selection = pendingInstallSelection || createInstallSelectionFromFiles(appUploadInput.files, spec);
  } catch (error) {
    return showDeviceStatus((error && error.message) || spec.invalidMessage, 'error');
  }
  if (!selection) return showDeviceStatus(spec.emptyMessage, 'error');
  closeDeviceMenu();
  setBusy(true);
  try {
    await uploadInstallSelection(selection);
    appUploadInput.value = '';
    clearPendingInstallSelection();
  } catch (error) {
    setBusy(false);
    showDeviceStatus((error && error.message) || String(error), 'error');
  }
});

appUploadInput.addEventListener('change', () => {
  const spec = deviceInstallSpec(currentDevice);
  try {
    const selection = createInstallSelectionFromFiles(appUploadInput.files, spec);
    if (!selection) {
      clearPendingInstallSelection();
      return;
    }
    setPendingInstallSelection(selection);
    appUploadInput.value = '';
  } catch (error) {
    appUploadInput.value = '';
    clearPendingInstallSelection();
    showDeviceStatus((error && error.message) || spec.invalidMessage, 'error');
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  appUploadRow.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    appUploadRow.classList.add('drag-active');
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  });
});

['dragleave', 'dragend'].forEach((eventName) => {
  appUploadRow.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    appUploadRow.classList.remove('drag-active');
  });
});

appUploadRow.addEventListener('drop', async (event) => {
  event.preventDefault();
  event.stopPropagation();
  appUploadRow.classList.remove('drag-active');
  const spec = deviceInstallSpec(currentDevice);
  try {
    const selection = await createInstallSelectionFromDrop(event.dataTransfer, spec);
    if (!selection) {
      throw new Error(spec.emptyMessage);
    }
    appUploadInput.value = '';
    setPendingInstallSelection(selection);
  } catch (error) {
    clearPendingInstallSelection();
    showDeviceStatus((error && error.message) || spec.invalidMessage, 'error');
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

terminateSessionBtn.addEventListener('click', () => {
  if (!confirm('Terminate this inspector session?\\n\\nThe device session will be closed and any emulator or simulator will be powered off. Real devices stay on.')) return;
  closeDeviceMenu();
  terminateSessionBtn.disabled = true;
  releaseSessionBtn.disabled = true;
  send({ type: 'terminate_session' });
});

releaseSessionBtn.addEventListener('click', () => {
  if (!confirm('Release this inspector session?\\n\\nThe device session will be closed, but the emulator or simulator will stay running so it can be reused without a cold boot.')) return;
  closeDeviceMenu();
  releaseSessionBtn.disabled = true;
  terminateSessionBtn.disabled = true;
  send({ type: 'release_session' });
});

treeRefreshBtn.addEventListener('click', () => {
  showDeviceStatus('Refreshing UI tree...', 'pending');
  send({ type: 'device_action', action: 'tree.refresh' });
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
