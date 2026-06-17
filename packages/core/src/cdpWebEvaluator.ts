import { AsturError } from './errors.js';
import type { WebEvaluator } from './webBridge.js';

interface CdpResponse {
  id?: number;
  result?: {
    result?: { type?: string; value?: unknown };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  };
  error?: { message?: string };
}

interface Pending {
  resolve: (value: CdpResponse['result']) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A minimal Chrome DevTools Protocol client that ships a single JS expression to
 * a page via `Runtime.evaluate` and returns its value by value. This is the
 * Android (Chromium WebView) transport behind {@link WebContext} — deliberately
 * raw (no Playwright element model) so the same injected-JS bridge drives every
 * engine identically.
 */
export class CdpWebEvaluator implements WebEvaluator {
  private ws?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  /**
   * @param url            page-level CDP/RWI WebSocket URL.
   * @param timeoutMs      per-request timeout.
   * @param enableDomains  domains to `<Domain>.enable` right after connecting.
   *                       Chromium WebView needs none; WebKit (via iwdp) needs
   *                       'Runtime' before it will answer Runtime.evaluate.
   */
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10_000,
    private readonly enableDomains: readonly string[] = []
  ) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const onError = () =>
        reject(new AsturError('WEBVIEW_CDP_CONNECT_FAILED', `Failed to connect to the WebView CDP endpoint at ${this.url}.`));
      ws.addEventListener('open', () => { ws.removeEventListener('error', onError); resolve(); }, { once: true });
      ws.addEventListener('error', onError, { once: true });
      ws.addEventListener('message', (event: MessageEvent) => this.onMessage(event));
      ws.addEventListener('close', () => this.failAll('WebView CDP connection closed.'));
      this.ws = ws;
    });

    for (const domain of this.enableDomains) {
      await this.send(`${domain}.enable`, {}).catch(() => undefined);
    }
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      // The demo WebView (and most app WebViews) allow eval; this keeps the bridge
      // working even when a page sets a restrictive CSP.
      includeCommandLineAPI: false
    });

    const exception = result?.exceptionDetails;
    if (exception) {
      const detail = exception.exception?.description ?? exception.text ?? 'unknown error';
      throw new AsturError('WEB_BRIDGE_EVAL_FAILED', `WebView JS evaluation failed: ${detail}`);
    }

    return result?.result?.value;
  }

  async dispose(): Promise<void> {
    this.failAll('WebView CDP evaluator disposed.');
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = undefined;
  }

  private send(method: string, params: Record<string, unknown>): Promise<CdpResponse['result']> {
    const ws = this.ws;
    if (!ws) {
      return Promise.reject(new AsturError('WEBVIEW_CDP_NOT_CONNECTED', 'WebView CDP evaluator is not connected.'));
    }

    const id = this.nextId++;
    return new Promise<CdpResponse['result']>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AsturError('WEBVIEW_CDP_TIMEOUT', `WebView CDP request '${method}' timed out.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private onMessage(event: MessageEvent): void {
    let message: CdpResponse;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return;
    }
    if (typeof message.id !== 'number') {
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new AsturError('WEBVIEW_CDP_RPC_ERROR', message.error.message ?? 'WebView CDP returned an error.'));
      return;
    }
    entry.resolve(message.result);
  }

  private failAll(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new AsturError('WEBVIEW_CDP_DISCONNECTED', reason));
    }
    this.pending.clear();
  }
}
