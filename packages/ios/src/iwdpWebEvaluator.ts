import { spawn, type ChildProcess } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { AsturError, CdpWebEvaluator, delay, type WebEvaluator, type WebViewSelector } from '@astur-mobile/core';

/**
 * iOS WebView (WKWebView) transport behind {@link AsturDevice.webContext}.
 *
 * WKWebView speaks Apple's WebKit Remote Web Inspector (RWI) protocol, not CDP.
 * `ios-webkit-debug-proxy` (iwdp) bridges RWI to a CDP-like HTTP listing + a
 * per-page WebSocket, so the same {@link CdpWebEvaluator} + injected JS bridge
 * that drive Chromium WebViews on Android drive WKWebViews here too — WebKit just
 * needs `Runtime.enable` first.
 *
 * Requirements (surfaced as actionable errors):
 *  - `ios-webkit-debug-proxy` installed (brew install ios-webkit-debug-proxy).
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
  bundleId?: string;
  selector?: WebViewSelector;
  timeoutMs?: number;
}

// One shared proxy per process: iwdp is a long-lived daemon, so reuse it across
// web contexts rather than spawning one per connection.
let sharedProxy: ChildProcess | undefined;

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

async function ensureProxy(binary: string, basePort: number, timeoutMs: number): Promise<void> {
  if (await isProxyUp(basePort)) {
    return;
  }

  try {
    sharedProxy = spawn(
      binary,
      ['-c', `null:${basePort},:${basePort + 1}-${basePort + 100}`],
      { stdio: 'ignore', detached: true }
    );
    sharedProxy.unref();
    sharedProxy.on('error', () => undefined);
  } catch (error) {
    throw iwdpMissingError(binary, error);
  }

  // The process can spawn yet fail immediately (e.g. ENOENT surfaces async).
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sharedProxy?.exitCode !== null && sharedProxy?.exitCode !== undefined) {
      throw iwdpMissingError(binary);
    }
    if (await isProxyUp(basePort)) {
      return;
    }
    await delay(300);
  }

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
    // iwdp bridges *real* devices over usbmux. The iOS Simulator's WKWebView is
    // exposed through webinspectord_sim, which iwdp does not surface — so a sim
    // yields an empty device list here.
    throw new AsturError('IOS_WEBVIEW_PROXY_NO_DEVICES',
      'ios-webkit-debug-proxy reported no inspectable iOS devices. It bridges physical devices over usbmux; the iOS Simulator’s WKWebView is not exposed to it. Use a real device (with Settings ▸ Safari ▸ Advanced ▸ Web Inspector = ON), or drive the simulator WebView via Safari’s Develop menu until simulator support lands.');
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

  await ensureProxy(binary, basePort, timeoutMs);
  const { wsUrl } = await findPage(basePort, options);

  // WebKit answers Runtime.evaluate only after Runtime.enable.
  const evaluator = new CdpWebEvaluator(wsUrl, 10_000, ['Runtime']);
  await evaluator.connect();
  return evaluator;
}
