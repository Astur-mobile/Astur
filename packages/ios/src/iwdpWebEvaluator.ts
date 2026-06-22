import { spawn, type ChildProcess } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { AsturError, CdpWebEvaluator, delay, type WebEvaluator, type WebViewSelector } from '@astur-mobile/core';
import { findSimulatorWebInspectorSocket } from './simulatorWebInspector.js';

/**
 * iOS WebView (WKWebView) transport behind {@link AsturDevice.webContext}.
 *
 * WKWebView speaks Apple's WebKit Remote Web Inspector (RWI) protocol, not CDP.
 * `ios-webkit-debug-proxy` (iwdp) bridges RWI to a CDP-like HTTP listing + a
 * per-page WebSocket, so the same {@link CdpWebEvaluator} + injected JS bridge
 * that drive Chromium WebViews on Android drive WKWebViews here too — WebKit just
 * needs `Runtime.enable` first, and modern WebKit also wraps page traffic in the
 * `Target` domain (handled by {@link CdpWebEvaluator}'s `webkitTargetFraming`).
 *
 * Works on both real devices (usbmux) and the Simulator: real devices are bridged
 * over usbmux, while the Simulator's WKWebView is reached via iwdp's `-s` mode
 * pointed at the per-simulator `com.apple.webinspectord_sim.socket` (discovered in
 * {@link findSimulatorWebInspectorSocket}).
 *
 * Requirements (surfaced as actionable errors):
 *  - `ios-webkit-debug-proxy` v1.9+ installed (brew install ios-webkit-debug-proxy);
 *    simulator support needs the `-s` flag added in 1.9.
 *  - The app's WKWebView opted into inspection: `webView.isInspectable = true`
 *    (iOS/iPadOS 16.4+). Real devices also need Settings ▸ Safari ▸ Advanced ▸
 *    Web Inspector = ON.
 */

interface IwdpDevice {
  deviceId?: string;
  deviceName?: string;
  url?: string;
}

interface IwdpPage {
  webSocketDebuggerUrl?: string;
  url?: string;
  title?: string;
}

export interface IwdpEvaluatorOptions {
  binaryPath?: string;
  basePort?: number;
  udid?: string;
  /**
   * When 'simulator', drive the Simulator's WKWebView Web Inspector via iwdp's
   * `-s unix:<socket>` mode (usbmux can't see simulators). Anything else uses the
   * default usbmux/real-device mode.
   */
  deviceKind?: string;
  bundleId?: string;
  selector?: WebViewSelector;
  timeoutMs?: number;
}

// One shared proxy per process, keyed by mode: iwdp is a long-lived daemon, so
// reuse it across web contexts rather than spawning one per connection. A
// simulator-mode proxy and a usbmux-mode proxy are different daemons, so we key
// the cache by mode and run simulator mode on a separate port to avoid collision.
let sharedProxy: ChildProcess | undefined;
let sharedProxyKey: string | undefined;
let proxyCleanupRegistered = false;
const SIMULATOR_PORT_OFFSET = 30;

// Kill any ios-webkit-debug-proxy still bound to this port from a previous session.
// iwdp's port config appears in its argv (e.g. "null:9251,:9252-9351"), so we match
// on that. Leaked daemons (from codegen sessions that exited) otherwise hold the port
// and, after a simulator reboot, point at a stale webinspectord socket — starving a
// fresh session of the live WebView page.
function killProxiesOnPort(basePort: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const child = spawn('pkill', ['-f', `null:${basePort},`], { stdio: 'ignore' });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

// Ensure our spawned proxy dies with this process (it is also non-detached, so a
// Ctrl-C to the codegen process group reaches it — this covers clean exits).
function registerProxyCleanup(): void {
  if (proxyCleanupRegistered) {
    return;
  }
  proxyCleanupRegistered = true;
  process.once('exit', () => {
    try {
      sharedProxy?.kill();
    } catch {
      // best effort
    }
  });
}

function httpGetJson<T>(url: string, timeoutMs = 2_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Timed out reading ${url}`)));
  });
}

async function isProxyUp(basePort: number): Promise<boolean> {
  return httpGetJson<IwdpDevice[]>(`http://localhost:${basePort}/json`, 1_000)
    .then(() => true)
    .catch(() => false);
}

async function ensureProxy(
  binary: string,
  requestedBasePort: number,
  timeoutMs: number,
  simulatorSocket?: string
): Promise<number> {
  // Simulator mode runs on its own port so it never collides with a usbmux-mode
  // proxy that may already hold the default port.
  const basePort = simulatorSocket ? requestedBasePort + SIMULATOR_PORT_OFFSET : requestedBasePort;
  const key = simulatorSocket ?? 'usbmux';

  // Reuse only the proxy WE started in this process — same mode, still alive and
  // listening. A foreign proxy from a previous session may hold the port while
  // pointing at a dead socket, so we never trust one we did not spawn.
  if (sharedProxyKey === key && sharedProxy && sharedProxy.exitCode === null && await isProxyUp(basePort)) {
    return basePort;
  }

  // Retire our own stale/other-mode proxy.
  if (sharedProxy) {
    sharedProxy.kill();
    sharedProxy = undefined;
    sharedProxyKey = undefined;
  }

  // Clear leaked proxies holding this port (previous codegen sessions), then let the
  // port settle before rebinding.
  await killProxiesOnPort(basePort);
  await delay(250);

  const portRange = `null:${basePort},:${basePort + 1}-${basePort + 100}`;
  const args = simulatorSocket
    ? ['-s', `unix:${simulatorSocket}`, '-c', portRange]
    : ['-c', portRange];

  try {
    // Not detached: tie the proxy's lifetime to this process so it can't leak.
    sharedProxy = spawn(binary, args, { stdio: 'ignore' });
    sharedProxy.unref();
    sharedProxy.on('error', () => undefined);
    sharedProxyKey = key;
    registerProxyCleanup();
  } catch (error) {
    sharedProxyKey = undefined;
    throw iwdpMissingError(binary, error);
  }

  // The process can spawn yet fail immediately (e.g. ENOENT surfaces async).
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sharedProxy?.exitCode !== null && sharedProxy?.exitCode !== undefined) {
      sharedProxyKey = undefined;
      throw iwdpMissingError(binary);
    }
    if (await isProxyUp(basePort)) {
      return basePort;
    }
    await delay(300);
  }

  sharedProxyKey = undefined;
  throw new AsturError('IOS_WEBKIT_PROXY_UNAVAILABLE',
    `ios-webkit-debug-proxy did not start listening on http://localhost:${basePort}.`);
}

function iwdpMissingError(binary: string, cause?: unknown): AsturError {
  return new AsturError('IOS_WEBKIT_PROXY_MISSING',
    `Could not start '${binary}'. Install it with 'brew install ios-webkit-debug-proxy' (or set ASTUR_IWDP_PATH).`,
    { cause });
}

function parseDevicePort(device: IwdpDevice, basePort: number): number | undefined {
  const match = /:(\d+)\s*$/.exec(device.url ?? '');
  const port = match ? Number(match[1]) : undefined;
  return port && port !== basePort ? port : undefined;
}

async function findPage(basePort: number, options: IwdpEvaluatorOptions): Promise<{ wsUrl: string }> {
  const devices = await httpGetJson<IwdpDevice[]>(`http://localhost:${basePort}/json`).catch(() => []);
  const candidates = devices.filter((device) => parseDevicePort(device, basePort) !== undefined);

  if (candidates.length === 0) {
    // Simulator mode (iwdp `-s`) always lists a SIMULATOR device, so this branch
    // only fires in usbmux/real-device mode: no inspectable physical device.
    throw new AsturError('IOS_WEBVIEW_PROXY_NO_DEVICES',
      'ios-webkit-debug-proxy reported no inspectable iOS devices over usbmux. Connect a real device and enable Settings ▸ Safari ▸ Advanced ▸ Web Inspector = ON. (The iOS Simulator is bridged automatically via the webinspectord_sim socket — pass the simulator device kind so Astur uses iwdp’s -s mode.)');
  }
  // Prefer the device whose id matches the target UDID (the simulator/device we're
  // driving); otherwise probe each until one yields an inspectable page.
  const ordered = options.udid
    ? [...candidates].sort((left, right) =>
        Number((right.deviceId ?? '').includes(options.udid!)) - Number((left.deviceId ?? '').includes(options.udid!)))
    : candidates;

  for (const device of ordered) {
    const devicePort = parseDevicePort(device, basePort)!;
    const pages = await httpGetJson<IwdpPage[]>(`http://localhost:${devicePort}/json`).catch(() => []);
    const inspectable = pages.filter((page) => page.webSocketDebuggerUrl);
    const match = selectPage(inspectable, options) ?? inspectable[0];
    if (match?.webSocketDebuggerUrl) {
      return { wsUrl: match.webSocketDebuggerUrl };
    }
  }

  throw new AsturError('IOS_WEBVIEW_NOT_INSPECTABLE',
    'No inspectable WKWebView was found. Set webView.isInspectable = true (iOS 16.4+) in the app and open a WebView. On a real device also enable Settings ▸ Safari ▸ Advanced ▸ Web Inspector.');
}

function selectPage(pages: IwdpPage[], options: IwdpEvaluatorOptions): IwdpPage | undefined {
  const url = options.selector?.url;
  const title = options.selector?.title;
  return pages.find((page) => {
    if (url) {
      return typeof url === 'string' ? page.url === url : url.test(page.url ?? '');
    }
    if (title) {
      return typeof title === 'string' ? page.title === title : title.test(page.title ?? '');
    }
    return false;
  });
}

export async function createIwdpEvaluator(options: IwdpEvaluatorOptions = {}): Promise<WebEvaluator> {
  const basePort = options.basePort ?? (Number(process.env.ASTUR_IOS_WEBKIT_PROXY_PORT) || 9221);
  const binary = options.binaryPath ?? process.env.ASTUR_IWDP_PATH ?? 'ios_webkit_debug_proxy';
  const timeoutMs = options.timeoutMs ?? 8_000;

  // On the simulator, usbmux can't see the WKWebView — bridge iwdp to the
  // simulator's webinspectord_sim Unix socket instead (iwdp >= 1.9 `-s` mode).
  let simulatorSocket: string | undefined;
  if (options.deviceKind === 'simulator' && options.udid) {
    simulatorSocket = await findSimulatorWebInspectorSocket(options.udid);
    if (!simulatorSocket) {
      throw new AsturError('IOS_WEBVIEW_SIM_SOCKET_NOT_FOUND',
        `Could not find the Web Inspector socket for simulator ${options.udid}. Boot the simulator and launch the app with an open WebView that sets webView.isInspectable = true (iOS 16.4+).`);
    }
  }

  const effectiveBasePort = await ensureProxy(binary, basePort, timeoutMs, simulatorSocket);
  const { wsUrl } = await findPage(effectiveBasePort, options);

  // WebKit answers Runtime.evaluate only after Runtime.enable, and modern WebKit
  // multiplexes page traffic through the Target domain (true → wrap/unwrap).
  const evaluator = new CdpWebEvaluator(wsUrl, 10_000, ['Runtime'], true);
  await evaluator.connect();
  return evaluator;
}
