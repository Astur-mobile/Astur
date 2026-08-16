import type {
  NetworkCapabilities,
  NetworkRedactionOptions,
  NetworkRequestRecord
} from '@astur-mobile/protocol';

import { applyBodyLimit, redactHeaders, resolveRedactionOptions } from '../flutter/network.js';

/**
 * Network observation for React Native, backed by the CDP `Network` domain that
 * RN's own DevTools ("Fusebox") uses. The reporter lives in `ReactCommon` — the
 * shared C++ layer — so one client covers Android and iOS identically.
 *
 * Astur is a plain CDP client here. It does not stand in for Metro: the app
 * dials out to the dev server, the dev server proxies debugger sessions, and
 * Astur connects to that proxy the same way React Native DevTools does.
 *
 * ## What is covered
 *
 * Whatever goes through RN's `XMLHttpRequest` — which is RN's own `fetch`
 * polyfill, `axios`, and most HTTP libraries in the ecosystem, because they all
 * bottom out there. Clients that bypass it are invisible, and the important
 * case in practice is **Expo's native `fetch`** (`expo/fetch`, installed as the
 * global `fetch` from SDK 52): it is implemented in native code and never
 * touches RN's networking module, so it emits no CDP events at all. This was
 * measured, not assumed — see `coverage` on {@link REACT_NATIVE_NETWORK_CAPABILITIES}.
 *
 * ## Why a dev build is required
 *
 * The reporter is behind a compile-time `REACT_NATIVE_DEBUGGER_ENABLED` flag; in
 * a release build the code is not present and `isDebuggingEnabled()` returns
 * false. There is nothing to attach to, exactly as with Flutter's release AOT
 * builds. This cannot be worked around from outside the app.
 */

/** Metro's default port, and the default the app itself dials out to. */
export const DEFAULT_METRO_URL = 'http://127.0.0.1:8081';

export const REACT_NATIVE_NETWORK_CAPABILITIES: NetworkCapabilities = {
  observe: true,
  intercept: false,
  transports: ['http'],
  responseBodies: true,
  coverage:
    "React Native XMLHttpRequest traffic (RN's fetch polyfill and axios included) via the CDP Network domain; "
    + "excludes Expo's native fetch, WebView, and native SDK requests, and needs a debug build attached to Metro",
  adapterRequired: true
};

interface InspectorTarget {
  webSocketDebuggerUrl?: string;
  appId?: string;
  title?: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/** One in-flight or completed exchange, assembled from four separate events. */
interface Exchange {
  id: string;
  method: string;
  url: string;
  requestHeaders: Record<string, unknown>;
  /** Epoch seconds. `requestWillBeSent` carries no timestamp of its own. */
  startedAtSeconds?: number;
  status?: number;
  responseHeaders?: Record<string, unknown>;
  endedAtSeconds?: number;
  body?: string;
  error?: string;
}

/**
 * Lists debuggable targets on a Metro dev server, newest last.
 *
 * Returns `[]` rather than throwing when the server is absent — "no dev server"
 * is the normal case for a release build and must read as unsupported, not as
 * a failure.
 */
export async function listInspectorTargets(
  devServerUrl: string,
  timeoutMs = 2_000
): Promise<InspectorTarget[]> {
  try {
    const response = await fetch(new URL('/json/list', devServerUrl), {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return [];
    }
    const targets: unknown = await response.json();
    return Array.isArray(targets) ? (targets as InspectorTarget[]) : [];
  } catch {
    return [];
  }
}

/**
 * Picks the target belonging to `appId`. Metro keys targets by application id,
 * which is the package name on Android and the bundle id on iOS — the same
 * value Astur already knows as the app under test.
 *
 * When `appId` is known the match is required, never best-effort. A dev server
 * left running for a different project would otherwise hand a native or Flutter
 * session someone else's app, and it would report that app's traffic as its
 * own — a wrong answer is worse here than "unsupported". Only a session that
 * cannot name its app falls back to the newest target.
 */
export function selectInspectorTarget(
  targets: InspectorTarget[],
  appId?: string
): InspectorTarget | undefined {
  const connectable = targets.filter((target) => Boolean(target.webSocketDebuggerUrl));
  if (connectable.length === 0) {
    return undefined;
  }
  if (appId) {
    return connectable.filter((target) => target.appId === appId).at(-1);
  }
  return connectable.at(-1);
}

/**
 * A CDP client that keeps a live `Network` subscription against a React Native
 * app and buffers what it sees.
 *
 * Reconnects on its own. Every JS reload replaces the inspector page and closes
 * the debugger socket with `CONNECTION_LOST`; a test that relaunches the app
 * between specs would otherwise observe traffic once and silently nothing after
 * — the same failure mode the Flutter backend hit with per-isolate state.
 */
export class ReactNativeNetworkObserver {
  private socket?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, (message: CdpMessage) => void>();
  private readonly exchanges = new Map<string, Exchange>();
  private closed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  /**
   * Whether a debuggable target was ever found.
   *
   * Reconnecting is only correct for a session that had one: a release build
   * has none and never will, and retrying there would poll the dev server
   * forever for a session that can never observe anything.
   */
  private everAttached = false;

  constructor(
    private readonly devServerUrl: string,
    private readonly appId?: string
  ) {}

  /**
   * Connects and subscribes. Resolves `false` when there is no debuggable
   * target — a release build, or Metro not running — so the caller can report
   * `observe: false` with a reason instead of throwing.
   */
  async attach(): Promise<boolean> {
    const target = selectInspectorTarget(await listInspectorTargets(this.devServerUrl), this.appId);
    if (!target?.webSocketDebuggerUrl) {
      return false;
    }
    return this.open(target.webSocketDebuggerUrl);
  }

  private async open(url: string): Promise<boolean> {
    const connected = await new Promise<boolean>((resolve) => {
      let socket: WebSocket;
      try {
        // The Origin header is mandatory and must equal the dev server's own
        // base URL. React Native's proxy rejects a missing Origin with 401, and
        // Expo's dev server terminates any socket whose Origin host differs
        // from its own — so "no header" and "close enough" both fail, in two
        // different ways, several layers apart.
        socket = new WebSocket(url, {
          headers: { Origin: new URL(this.devServerUrl).origin }
        } as unknown as string[]);
      } catch {
        resolve(false);
        return;
      }

      const settle = (value: boolean) => { resolve(value); };
      socket.addEventListener('open', () => settle(true), { once: true });
      socket.addEventListener('error', () => settle(false), { once: true });
      socket.addEventListener('message', (event: MessageEvent) => this.onMessage(event));
      socket.addEventListener('close', () => {
        if (this.socket === socket) {
          this.socket = undefined;
          this.scheduleReconnect();
        }
        settle(false);
      });
      this.socket = socket;
    });

    if (connected) {
      this.everAttached = true;
      this.send('Network.enable');
    }
    return connected;
  }

  /**
   * Waits until the subscription is live again, up to `timeoutMs`.
   *
   * Relaunching the app tears the inspector page down and stands a new one up,
   * and for a moment in between the dev server lists no target at all. A
   * fire-and-forget reconnect loses that race and observes nothing for the rest
   * of the test — so the one caller that can afford to wait, `clear()`, waits,
   * and thereby guarantees that traffic caused after it returns is seen.
   */
  private async ensureAttached(timeoutMs = 5_000): Promise<boolean> {
    if (this.socket?.readyState === 1) {
      return true;
    }
    if (this.closed || !this.everAttached) {
      return false;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.closed) {
      if (await this.attach().catch(() => false)) {
        return true;
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 250);
        timer.unref?.();
      });
    }
    return false;
  }

  /**
   * Re-attaches after a reload. Buffered records are deliberately kept: they
   * describe traffic the test already caused, and dropping them would make
   * observation depend on whether the app happened to reload mid-test.
   */
  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer || !this.everAttached) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closed && !this.socket) {
        // Retry rather than attach once: right after a relaunch the dev server
        // lists no target for a beat, and giving up there would silently end
        // observation for the rest of the session.
        void this.ensureAttached().catch(() => undefined);
      }
    }, 500);
    this.reconnectTimer.unref?.();
  }

  private send(method: string, params: Record<string, unknown> = {}): number {
    const id = this.nextId++;
    try {
      this.socket?.send(JSON.stringify({ id, method, params }));
    } catch {
      // A send on a socket that just closed is not an error worth surfacing —
      // the reconnect path will re-enable the domain.
    }
    return id;
  }

  private request(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    return new Promise((resolve) => {
      const id = this.send(method, params);
      const timer = setTimeout(() => { this.pending.delete(id); resolve({}); }, 5_000);
      timer.unref?.();
      this.pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    });
  }

  private onMessage(event: MessageEvent): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(String(event.data)) as CdpMessage;
    } catch {
      return;
    }

    if (message.id !== undefined) {
      this.pending.get(message.id)?.(message);
      this.pending.delete(message.id);
      return;
    }
    if (!message.method?.startsWith('Network.')) {
      return;
    }
    this.consume(message.method, message.params ?? {});
  }

  private consume(method: string, params: Record<string, unknown>): void {
    const id = typeof params.requestId === 'string' ? params.requestId : undefined;
    if (!id) {
      return;
    }

    if (method === 'Network.requestWillBeSent') {
      const request = (params.request ?? {}) as Record<string, unknown>;
      this.exchanges.set(id, {
        id,
        method: typeof request.method === 'string' ? request.method.toUpperCase() : 'GET',
        url: typeof request.url === 'string' ? request.url : '',
        requestHeaders: (request.headers ?? {}) as Record<string, unknown>
      });
      return;
    }

    const exchange = this.exchanges.get(id);
    if (!exchange) {
      return;
    }

    if (method === 'Network.requestWillBeSentExtraInfo') {
      // The only start time RN reports. `requestWillBeSent` carries no
      // timestamp at all, so without this event a record has no `startedAt`.
      const timing = (params.connectTiming ?? {}) as Record<string, unknown>;
      const requestTime = Number(timing.requestTime);
      if (Number.isFinite(requestTime)) {
        exchange.startedAtSeconds = requestTime;
      }
      return;
    }

    if (method === 'Network.responseReceived') {
      const response = (params.response ?? {}) as Record<string, unknown>;
      exchange.status = Number(response.status);
      exchange.responseHeaders = (response.headers ?? {}) as Record<string, unknown>;
      return;
    }

    if (method === 'Network.loadingFinished') {
      exchange.endedAtSeconds = Number(params.timestamp);
      // Bodies must be pulled now, while the request is still retained. After a
      // reload the requestId is gone and the body with it, so deferring this to
      // read time would return nothing for exactly the traffic a test cares about.
      void this.captureBody(exchange);
      return;
    }

    if (method === 'Network.loadingFailed') {
      exchange.endedAtSeconds = Number(params.timestamp);
      exchange.error = typeof params.errorText === 'string' ? params.errorText : 'Request failed';
    }
  }

  private async captureBody(exchange: Exchange): Promise<void> {
    const message = await this.request('Network.getResponseBody', { requestId: exchange.id });
    const body = message.result?.body;
    if (typeof body !== 'string') {
      return;
    }
    exchange.body = message.result?.base64Encoded === true
      ? Buffer.from(body, 'base64').toString('utf8')
      : body;
  }

  /** Everything observed so far, oldest first, redacted per `options`. */
  records(options?: NetworkRedactionOptions): NetworkRequestRecord[] {
    const resolved = resolveRedactionOptions(options);
    return [...this.exchanges.values()].map((exchange) => ({
      id: exchange.id,
      transport: 'http' as const,
      method: exchange.method,
      url: exchange.url,
      requestHeaders: redactHeaders(exchange.requestHeaders, resolved.redactHeaders),
      ...(exchange.responseHeaders
        ? { responseHeaders: redactHeaders(exchange.responseHeaders, resolved.redactHeaders) }
        : {}),
      ...(exchange.status === undefined || Number.isNaN(exchange.status)
        ? {}
        : { status: exchange.status }),
      // CDP reports epoch seconds as a float; the public contract is epoch ms.
      startedAt: Math.round((exchange.startedAtSeconds ?? 0) * 1000),
      ...(exchange.startedAtSeconds !== undefined
        && exchange.endedAtSeconds !== undefined
        && exchange.endedAtSeconds >= exchange.startedAtSeconds
        ? { durationMs: Math.round((exchange.endedAtSeconds - exchange.startedAtSeconds) * 1000) }
        : {}),
      ...(exchange.status === undefined
        ? {}
        : applyBodyLimit(exchange.body, resolved.maxBodyBytes)),
      ...(exchange.error ? { error: exchange.error } : {})
    }));
  }

  /**
   * Drops the buffer and re-enables the domain.
   *
   * Re-enabling matters for the same reason it does on Flutter: a reload
   * replaces the runtime and takes the subscription with it. Enabling here —
   * which the fixture calls between tests — is what keeps observation working
   * past the first spec.
   */
  async clear(): Promise<void> {
    this.exchanges.clear();
    if (await this.ensureAttached()) {
      this.send('Network.enable');
    }
  }

  dispose(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    try {
      this.socket?.close();
    } catch {
      // Already gone; nothing to release.
    }
    this.socket = undefined;
    this.exchanges.clear();
  }
}
