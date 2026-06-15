import { AsturError } from '@astur-mobile/core';
import type { Bounds, MobileElementSnapshot } from '@astur-mobile/protocol';

/**
 * Reads a running Flutter app's UI through the Dart VM service.
 *
 * On Android, Flutter does not publish its widget tree to the OS accessibility
 * layer, so the UIAutomator path sees an opaque FlutterView. Instead we evaluate
 * a one-shot Dart walk of the element tree on-device, which returns every node's
 * `Semantics(identifier)` (the same ids the app exposes for iOS), its text, and
 * its GLOBAL bounds in physical pixels via `renderObject.localToGlobal()`.
 *
 * Evaluating source requires the Dart expression compiler, which is attached
 * only when the app is launched through the Flutter tool (`flutter run`/`attach`)
 * — see {@link FlutterProcess}.
 */

// Field separator (SOH) between columns; rows are newline-separated. Neither
// character can appear in widget ids/text/types, so parsing is unambiguous.
const SEP = '';

// Single-line Dart expression (the debug expression compiler rejects multi-line
// bodies). Walks the element tree depth-first and emits one row per node that
// carries an identifier, text, or label and has laid-out bounds.
//
// It skips subtrees that aren't actually painted so the tree matches what's on
// screen. This matters most for IndexedStack (the common "keep every tab
// mounted" pattern): it wraps every inactive child in an Offstage/Visibility so
// only the selected screen is shown. Skipping Offstage / Visibility(false) /
// Opacity(0) subtrees drops those inactive screens (and e.g. a closed drawer's
// backdrop) — otherwise every screen's widgets show up at once, overlapping and
// mostly not interactable. Only nodes actually on screen are emitted.
const EXTRACT_EXPR =
  '(){' +
  'final sb=StringBuffer();' +
  'final view=WidgetsBinding.instance.platformDispatcher.views.first;' +
  'final dpr=view.devicePixelRatio;final sw=view.physicalSize.width;final sh=view.physicalSize.height;' +
  'void visit(Element el){' +
  'final wd=el.widget;' +
  'if(wd is Offstage && wd.offstage)return;' +
  'if(wd is Visibility && !wd.visible)return;' +
  'if(wd is Opacity && wd.opacity==0.0)return;' +
  'final ro=el.renderObject;' +
  'String? sid;String? lbl;String? txt;' +
  'if(wd is Semantics){final p=wd.properties;if(p.identifier!=null)sid=p.identifier;if(p.label!=null)lbl=p.label;}' +
  'if(wd is Text && wd.data!=null)txt=wd.data;' +
  'if((sid!=null||txt!=null||lbl!=null) && ro is RenderBox && ro.attached && ro.hasSize){' +
  'final o=ro.localToGlobal(Offset.zero);' +
  'if(o.dx.isFinite && o.dy.isFinite){' +
  'final x=(o.dx*dpr).round();final y=(o.dy*dpr).round();final w=(ro.size.width*dpr).round();final h=(ro.size.height*dpr).round();' +
  'final on=(w>0 && h>0 && x+w>0 && y+h>0 && x<sw && y<sh);' +
  'if(on){' +
  'sb.write(sid??"");sb.writeCharCode(1);sb.write(txt??"");sb.writeCharCode(1);sb.write(lbl??"");sb.writeCharCode(1);' +
  'sb.write(wd.runtimeType.toString());sb.writeCharCode(1);' +
  'sb.write(x.toString());sb.writeCharCode(1);sb.write(y.toString());sb.writeCharCode(1);' +
  'sb.write(w.toString());sb.writeCharCode(1);sb.write(h.toString());sb.writeCharCode(1);sb.write("1");sb.writeCharCode(10);' +
  '}' +
  '}}' +
  'el.visitChildren(visit);' +
  '}' +
  'visit(WidgetsBinding.instance.rootElement!);' +
  'return sb.toString();' +
  '}()';

// Readiness probe: reports "<idle>:<w>:<h>" where idle is 1 once a frame has
// fully completed (scheduler back to idle, root element attached) and w/h is the
// physical screen size. The physical size becomes non-zero BEFORE the first
// layout pass finishes, so gating on size alone yields render objects with zero
// bounds; waiting for an idle (completed) frame guarantees the tree is laid out.
// It only reads scalars (no tree walk), so it is safe to evaluate mid-build —
// unlike EXTRACT_EXPR, which can hit Flutter's build lock.
const READY_EXPR =
  '(){final r=WidgetsBinding.instance.rootElement;' +
  'final v=WidgetsBinding.instance.platformDispatcher.views.first;' +
  'final w=v.physicalSize.width.round();final h=v.physicalSize.height.round();' +
  'final idle=(r!=null && WidgetsBinding.instance.schedulerPhase.name=="idle")?1:0;' +
  'return idle.toString()+":"+w.toString()+":"+h.toString();}()';

interface RpcResult {
  [key: string]: unknown;
}

export interface FlutterVmServiceOptions {
  /** WebSocket URL of the Dart VM service, e.g. ws://127.0.0.1:PORT/TOKEN/ws */
  url: string;
  requestTimeoutMs?: number;
  /** How long to wait for the first completed frame before serving trees. */
  readyTimeoutMs?: number;
  /** Poll interval while waiting for the first completed frame. */
  readyPollMs?: number;
  /** How long the laid-out element set must stay unchanged before the UI is considered settled. */
  readySettleMs?: number;
  /** Retries for the on-device tree walk when it lands mid-build (transient build-lock errors). */
  evalRetries?: number;
  /** Delay between tree-walk retries. */
  evalRetryDelayMs?: number;
}

export class FlutterVmService {
  private ws?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: RpcResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private isolateId?: string;
  private rootLibId?: string;
  private screen: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly readyTimeoutMs: number;
  private readonly readyPollMs: number;
  private readonly readySettleMs: number;
  private readonly evalRetries: number;
  private readonly evalRetryDelayMs: number;

  constructor(options: FlutterVmServiceOptions) {
    this.url = options.url;
    this.timeoutMs = options.requestTimeoutMs ?? 20_000;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.readyPollMs = options.readyPollMs ?? 150;
    this.readySettleMs = options.readySettleMs ?? 500;
    this.evalRetries = options.evalRetries ?? 6;
    this.evalRetryDelayMs = options.evalRetryDelayMs ?? 200;
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const onError = () => reject(new AsturError('FLUTTER_VM_CONNECT_FAILED', `Failed to connect to the Flutter Dart VM service at ${this.url}.`));
      ws.addEventListener('open', () => { ws.removeEventListener('error', onError); resolve(); }, { once: true });
      ws.addEventListener('error', onError, { once: true });
      ws.addEventListener('message', (event: MessageEvent) => this.onMessage(event));
      ws.addEventListener('close', () => this.failAllPending('Flutter VM service connection closed.'));
      this.ws = ws;
    });

    const vm = await this.call('getVM');
    const isolates = vm.isolates as Array<{ id: string }> | undefined;
    if (!isolates?.length) {
      throw new AsturError('FLUTTER_VM_NO_ISOLATE', 'The Flutter app exposed no Dart isolate over the VM service.');
    }
    this.isolateId = isolates[0].id;
    const isolate = await this.call('getIsolate', { isolateId: this.isolateId });
    this.rootLibId = (isolate.rootLib as { id?: string } | undefined)?.id;
    if (!this.rootLibId) {
      throw new AsturError('FLUTTER_VM_NO_ROOT_LIB', 'The Flutter isolate did not expose a root library for evaluation.');
    }

    // Wait for the first frame so the tree walk doesn't race app startup and so
    // we capture a real screen size (physicalSize is 0x0 until the view lays out).
    await this.waitForReady();
  }

  async getTree(): Promise<MobileElementSnapshot> {
    if (this.screen.width === 0 || this.screen.height === 0) {
      // connect() timed out before the first frame, or the view was resized to
      // zero; re-establish a stable frame before reading.
      await this.waitForReady();
    }
    const children = await this.extractChildren();
    return {
      type: 'FlutterView',
      enabled: true,
      visible: true,
      bounds: this.screen,
      children,
      platform: 'android'
    };
  }

  /** Runs the on-device tree walk and parses it into snapshot children. */
  private async extractChildren(): Promise<MobileElementSnapshot[]> {
    const raw = await this.evaluateStringStable(EXTRACT_EXPR);
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => this.parseRow(line))
      .filter((node): node is MobileElementSnapshot => node !== undefined);
  }

  async dispose(): Promise<void> {
    this.failAllPending('Flutter VM service disposed.');
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = undefined;
  }

  private parseRow(line: string): MobileElementSnapshot | undefined {
    const cols = line.split(SEP);
    if (cols.length < 9) {
      return undefined;
    }
    const [id, text, label, type, x, y, w, h, vis] = cols;
    const bounds: Bounds = {
      x: Number.parseInt(x, 10) || 0,
      y: Number.parseInt(y, 10) || 0,
      width: Number.parseInt(w, 10) || 0,
      height: Number.parseInt(h, 10) || 0
    };
    return {
      id: id || undefined,
      text: text || undefined,
      label: label || undefined,
      value: text || undefined,
      type: type || 'FlutterWidget',
      enabled: true,
      visible: vis === '1',
      bounds,
      children: [],
      platform: 'android'
    };
  }

  /**
   * Blocks until the app's UI has settled, so the first read returns fully
   * laid-out bounds rather than zeros.
   *
   * Two phases:
   *  1. Wait for a completed frame (scheduler idle) with a non-zero screen size —
   *     captures the real physical size, which is 0x0 until the view lays out.
   *  2. Wait for the laid-out element set to stop changing across consecutive
   *     polls. This is necessary because parts of the tree (e.g. a bottom
   *     navigation bar) can lay out a frame or two after the first frame, so they
   *     report zero bounds immediately after step 1 — tapping such a node would
   *     hit the wrong coordinates. The fingerprint keys on which nodes are present
   *     and laid out, not their exact bounds, so a continuously-animating app
   *     still settles instead of polling until the timeout.
   */
  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.readyTimeoutMs;

    // Phase 1 — a known screen size (physicalSize is 0x0 until the view lays out).
    // Idle is not required here: a continuously-animating app never reports idle,
    // and phase 2 provides the real layout guarantee.
    for (;;) {
      let raw = '0:0:0';
      try {
        raw = await this.evaluateString(READY_EXPR);
      } catch {
        // Transient during isolate warm-up; retry until the deadline.
      }
      const [, wRaw, hRaw] = raw.split(':');
      const w = Number.parseInt(wRaw, 10);
      const h = Number.parseInt(hRaw, 10);
      if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        this.screen = { x: 0, y: 0, width: w, height: h };
        break;
      }
      if (Date.now() >= deadline) {
        return;
      }
      await this.sleep(this.readyPollMs);
    }

    // Phase 2 — wait for the laid-out element set to stabilize.
    let previous: string | undefined;
    let settleStart = 0;
    for (;;) {
      let fingerprint = '';
      try {
        fingerprint = this.layoutFingerprint(await this.extractChildren());
      } catch {
        // Mid-build; retry until the deadline.
      }
      if (fingerprint && fingerprint === previous) {
        if (settleStart === 0) {
          settleStart = Date.now();
        }
        if (Date.now() - settleStart >= this.readySettleMs) {
          return;
        }
      } else {
        settleStart = 0;
        previous = fingerprint;
      }
      if (Date.now() >= deadline) {
        return;
      }
      await this.sleep(this.readyPollMs);
    }
  }

  /** Identity of the laid-out, labelled nodes — present-and-sized, ignoring exact position so animations still settle. */
  private layoutFingerprint(children: MobileElementSnapshot[]): string {
    return children
      .filter((node) => node.bounds.width > 0 && node.bounds.height > 0)
      .map((node) => `${node.id ?? ''}#${node.text ?? ''}#${node.label ?? ''}`)
      .sort()
      .join('|');
  }

  /**
   * Evaluates the on-device tree walk, retrying transient build-lock failures.
   *
   * The walk uses `visitChildren`, which throws if it runs while Flutter is mid-build
   * (app startup, route transitions, animations). Those settle within a frame or two,
   * so a short bounded retry makes reads reliable without callers having to sleep.
   */
  private async evaluateStringStable(expression: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.evalRetries; attempt += 1) {
      try {
        return await this.evaluateString(expression);
      } catch (err) {
        if (!(err instanceof AsturError) || err.code !== 'FLUTTER_VM_EVAL_FAILED') {
          throw err;
        }
        lastError = err;
        if (attempt < this.evalRetries) {
          await this.sleep(this.evalRetryDelayMs);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new AsturError('FLUTTER_VM_EVAL_FAILED', 'Flutter VM expression evaluation failed after retries.');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Evaluates a Dart expression and returns its full String result (handles VM string truncation). */
  private async evaluateString(expression: string): Promise<string> {
    const result = await this.call('evaluate', {
      isolateId: this.isolateId,
      targetId: this.rootLibId,
      expression
    });

    if (result.kind === 'Error' || result.type === '@Error') {
      throw new AsturError('FLUTTER_VM_EVAL_FAILED', 'Flutter VM expression evaluation failed.', { result });
    }
    if (result.kind !== 'String') {
      return '';
    }
    if (!result.valueAsStringIsTruncated) {
      return (result.valueAsString as string) ?? '';
    }

    // Large result: page the full string in via getObject.
    const objectId = result.id as string;
    let out = '';
    let offset = 0;
    const count = 100_000;
    // The total length is reported on the (truncated) instance.
    const total = typeof result.length === 'number' ? (result.length as number) : Number.MAX_SAFE_INTEGER;
    while (out.length < total) {
      const obj = await this.call('getObject', { isolateId: this.isolateId, objectId, offset, count });
      const chunk = (obj.valueAsString as string) ?? '';
      if (chunk.length === 0) {
        break;
      }
      out += chunk;
      offset += chunk.length;
    }
    return out;
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<RpcResult> {
    const ws = this.ws;
    if (!ws) {
      return Promise.reject(new AsturError('FLUTTER_VM_NOT_CONNECTED', 'Flutter VM service is not connected.'));
    }
    const id = this.nextId++;
    return new Promise<RpcResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AsturError('FLUTTER_VM_TIMEOUT', `Flutter VM service request '${method}' timed out.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private onMessage(event: MessageEvent): void {
    let message: { id?: number; result?: RpcResult; error?: { message?: string; data?: unknown } };
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
      entry.reject(new AsturError('FLUTTER_VM_RPC_ERROR', message.error.message ?? 'Flutter VM service returned an error.', { data: message.error.data }));
      return;
    }
    entry.resolve(message.result ?? {});
  }

  private failAllPending(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new AsturError('FLUTTER_VM_DISCONNECTED', reason));
    }
    this.pending.clear();
  }
}
