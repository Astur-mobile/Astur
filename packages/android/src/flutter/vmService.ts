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
  // `cnt` assigns each emitted node a sequential id; `parent` threads the nearest
  // emitted ancestor's id down the walk so the flat output can be rebuilt into a
  // tree. Levels that don't emit (no id/text/label) are transparent — their
  // children attach to the same ancestor — so geometry that reads a card's
  // subtree (e.g. counters under a tap-lab card) matches the native nested tree.
  'int cnt=0;' +
  'void visit(Element el,int parent){' +
  'final wd=el.widget;' +
  'if(wd is Offstage && wd.offstage)return;' +
  'if(wd is Visibility && !wd.visible)return;' +
  'if(wd is Opacity && wd.opacity==0.0)return;' +
  'final ro=el.renderObject;' +
  'String? sid;String? lbl;String? txt;' +
  'int self=parent;' +
  'if(wd is Semantics){final p=wd.properties;if(p.identifier!=null)sid=p.identifier;if(p.label!=null)lbl=p.label;}' +
  'if(wd is Text && wd.data!=null)txt=wd.data;' +
  'if((sid!=null||txt!=null||lbl!=null) && ro is RenderBox && ro.attached && ro.hasSize){' +
  'final o=ro.localToGlobal(Offset.zero);' +
  'if(o.dx.isFinite && o.dy.isFinite){' +
  'final x=(o.dx*dpr).round();final y=(o.dy*dpr).round();final w=(ro.size.width*dpr).round();final h=(ro.size.height*dpr).round();' +
  'final on=(w>0 && h>0 && x+w>0 && y+h>0 && x<sw && y<sh);' +
  'if(on){' +
  'self=++cnt;' +
  // An id-bearing node that directly wraps a text field (AsturId/Semantics around
  // a TextField -> EditableText) is reported as "TextField" so the inspector
  // recognises it as fillable. The search stops at nested id-bearing Semantics so
  // a container (e.g. screen-login) that merely *contains* inputs isn't flagged.
  'String kind=wd.runtimeType.toString();String val="";' +
  // Walk into an id-bearing node to (a) classify it as a text field and (b) read
  // its value. A Material TextField exposes both the typed text (controller.text)
  // and, when empty, its placeholder (decoration.hintText) — mirroring Android's
  // native behaviour where an empty EditText reports its hint as text, so
  // toHaveValue works the same on both builds. EditableText is the universal
  // fallback (every field type embeds one) for the typed value.
  'if(sid!=null){bool ed=false;void ck(Element c){if(ed)return;final cw=c.widget;if(cw is Semantics && cw.properties.identifier!=null)return;if(cw is TextField){final t=cw.controller?.text;final hint=cw.decoration?.hintText;val=(t!=null && t.isNotEmpty)?t:(hint??"");ed=true;return;}if(cw is EditableText){val=cw.controller.text;ed=true;return;}c.visitChildren(ck);}el.visitChildren(ck);if(ed)kind="TextField";}' +
  'sb.write(self.toString());sb.writeCharCode(1);sb.write(parent.toString());sb.writeCharCode(1);' +
  'sb.write(sid??"");sb.writeCharCode(1);sb.write(txt??"");sb.writeCharCode(1);sb.write(lbl??"");sb.writeCharCode(1);' +
  'sb.write(kind);sb.writeCharCode(1);' +
  'sb.write(x.toString());sb.writeCharCode(1);sb.write(y.toString());sb.writeCharCode(1);' +
  'sb.write(w.toString());sb.writeCharCode(1);sb.write(h.toString());sb.writeCharCode(1);sb.write("1");sb.writeCharCode(1);sb.write(val);sb.writeCharCode(10);' +
  '}' +
  '}}' +
  'el.visitChildren((c){visit(c,self);});' +
  '}' +
  'visit(WidgetsBinding.instance.rootElement!,0);' +
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

// Clears the Flutter primary focus, which unfocuses the active text field and
// asks the engine to hide the soft keyboard. This is the deterministic way to
// dismiss the IME on the no-agent driver: unlike a Back press, it can never pop
// a route or background the app, so the widget tree stays intact afterwards.
const UNFOCUS_EXPR =
  '(){FocusManager.instance.primaryFocus?.unfocus();return "1";}()';

interface RpcResult {
  [key: string]: unknown;
}

/** A parsed extractor row: the snapshot plus the ids used to rebuild nesting. */
interface ParsedRow {
  nodeId: number;
  parentId: number;
  node: MobileElementSnapshot;
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
  /**
   * Total wall-clock budget for retrying an on-device tree walk that lands
   * mid-build (transient build-lock errors).
   *
   * This is deliberately a time budget rather than an attempt count. Each
   * attempt can itself block for up to `requestTimeoutMs`, so `N retries`
   * bounds the worst case at `N * requestTimeoutMs` — with a handful of
   * retries that is already minutes, which silently blows past the caller's
   * own timeout (see `evaluateStringStable`).
   *
   * Defaults to `requestTimeoutMs + 10s`. Setting it below `requestTimeoutMs`
   * caps the first attempt at less than a full request, turning a slow-but-fine
   * tree walk into a timeout.
   */
  evalBudgetMs?: number;
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
  private readonly evalBudgetMs: number;
  private readonly evalRetryDelayMs: number;

  constructor(options: FlutterVmServiceOptions) {
    this.url = options.url;
    this.timeoutMs = options.requestTimeoutMs ?? 20_000;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.readyPollMs = options.readyPollMs ?? 150;
    this.readySettleMs = options.readySettleMs ?? 500;
    // Derived from the request timeout, never a bare constant: the budget has to
    // leave room for at least one full-length request plus a retry, or it
    // truncates the very first attempt and reports a timeout for a tree walk
    // that was merely slow (a large widget tree can take many seconds).
    this.evalBudgetMs = options.evalBudgetMs ?? this.timeoutMs + 10_000;
    this.evalRetryDelayMs = options.evalRetryDelayMs ?? 250;
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

    await this.resolveIsolate();

    // Wait for the first frame so the tree walk doesn't race app startup and so
    // we capture a real screen size (physicalSize is 0x0 until the view lays out).
    await this.waitForReady();
  }

  /**
   * Re-binds to the isolate created by a hot restart. `flutter run`'s `R` tears
   * down the running isolate and starts a *new* one. The old isolate lingers in
   * `getVM` for a moment — and is still readable but FROZEN at its last frame —
   * so binding to it makes tree reads return stale UI (taps reach the live app
   * but the tree never reflects them) or, once it dies, an empty tree. Excluding
   * the pre-restart id is what makes resets land on the live isolate.
   */
  async reattach(): Promise<boolean> {
    await this.resolveIsolate(this.isolateId);
    return this.waitForReady();
  }

  /**
   * Re-checks readiness on the already-bound isolate without re-resolving it.
   * Used by the reset path to re-wait after re-foregrounding a surfaceless engine
   * (a hot restart can come back with a 0x0 view), so callers can retry cheaply
   * instead of paying the isolate-resolution grace window again.
   */
  async ensureReady(): Promise<boolean> {
    return this.waitForReady();
  }

  /**
   * Binds {@link isolateId}/{@link rootLibId} to a live, evaluable isolate.
   *
   * When `previousIsolateId` is given (a hot-restart reattach), an isolate with a
   * *different* id is strongly preferred — that's the replacement; the old one is
   * the frozen/dying predecessor. We only fall back to the same id after a short
   * grace window (covers the rare case where a restart reuses the id) so we don't
   * grab the predecessor before its replacement has registered. Each candidate is
   * validated with a trivial eval, since a dying isolate can still be listed yet
   * reject evaluations.
   */
  private async resolveIsolate(previousIsolateId?: string): Promise<void> {
    const deadline = Date.now() + this.readyTimeoutMs;
    const reuseGraceUntil = Date.now() + 1_500;
    let lastReason = 'no Dart isolate was reported';

    const tryBind = async (candidates: Array<{ id: string }>): Promise<boolean> => {
      for (const candidate of candidates) {
        const isolate = await this.call('getIsolate', { isolateId: candidate.id }, deadline).catch(() => undefined);
        const pauseKind = (isolate?.pauseEvent as { kind?: string } | undefined)?.kind;
        if (pauseKind === 'PauseExit' || pauseKind === 'Exit' || isolate?.runnable === false) {
          lastReason = 'the isolate had already exited';
          continue;
        }
        const rootLibId = (isolate?.rootLib as { id?: string } | undefined)?.id;
        if (!rootLibId) {
          lastReason = 'the isolate exposed no root library for evaluation';
          continue;
        }
        this.isolateId = candidate.id;
        this.rootLibId = rootLibId;
        try {
          await this.evaluateString(READY_EXPR, deadline);
          return true;
        } catch {
          lastReason = 'the candidate isolate did not accept evaluations yet';
        }
      }
      return false;
    };

    for (;;) {
      // Bounded by the same deadline the loop below enforces. Without it a
      // single unresponsive request blocks for the full request timeout and
      // overruns the deadline it is supposed to be respecting.
      const vm = await this.call('getVM', {}, deadline);
      const isolates = (vm.isolates as Array<{ id: string }> | undefined) ?? [];
      // VM service lists isolates in creation order. Multiple frozen isolates can
      // linger after repeated hot restarts and still accept read-only evaluations,
      // so trying the oldest first can bind a perfectly readable but stale tree.
      // Prefer the most recently created replacement.
      const newestFirst = [...isolates].reverse();
      const fresh = previousIsolateId
        ? newestFirst.filter((iso) => iso.id !== previousIsolateId)
        : newestFirst;

      if (await tryBind(fresh)) {
        return;
      }
      // No replacement isolate yet: only reconsider the previous id after the
      // grace window, in case this restart reused it.
      if (previousIsolateId
        && fresh.length === 0
        && Date.now() >= reuseGraceUntil
        && (await tryBind(newestFirst))) {
        return;
      }

      if (Date.now() > deadline) {
        throw new AsturError('FLUTTER_VM_NO_ISOLATE', `Could not bind to the Flutter Dart isolate (${lastReason}).`);
      }
      await this.sleep(this.readyPollMs);
    }
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

  /**
   * Runs the on-device tree walk and rebuilds the flat, parent-annotated output
   * into a nested snapshot tree. Nesting matters because page logic reads a
   * container's subtree (e.g. the counters under a tap-lab card) — a flat list
   * would leave every container childless. Rows are emitted in pre-order, so a
   * parent always precedes its children and the map is fully populated by the
   * time we wire up links.
   */
  private async extractChildren(): Promise<MobileElementSnapshot[]> {
    const raw = await this.evaluateStringStable(EXTRACT_EXPR);
    const rows = raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => this.parseRow(line))
      .filter((row): row is ParsedRow => row !== undefined);

    const byId = new Map<number, MobileElementSnapshot>();
    for (const row of rows) {
      byId.set(row.nodeId, row.node);
    }
    const roots: MobileElementSnapshot[] = [];
    for (const row of rows) {
      const parent = byId.get(row.parentId);
      if (parent) {
        parent.children.push(row.node);
      } else {
        // parentId 0 (the synthetic root) or a pruned ancestor → top level.
        roots.push(row.node);
      }
    }
    return roots;
  }

  /** Dismisses the soft keyboard by clearing the Flutter primary focus. */
  async unfocus(): Promise<void> {
    await this.evaluateStringStable(UNFOCUS_EXPR);
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

  private parseRow(line: string): ParsedRow | undefined {
    const cols = line.split(SEP);
    if (cols.length < 11) {
      return undefined;
    }
    const [nodeId, parentId, id, text, label, type, x, y, w, h, vis, fieldValue] = cols;
    const bounds: Bounds = {
      x: Number.parseInt(x, 10) || 0,
      y: Number.parseInt(y, 10) || 0,
      width: Number.parseInt(w, 10) || 0,
      height: Number.parseInt(h, 10) || 0
    };
    return {
      nodeId: Number.parseInt(nodeId, 10) || 0,
      parentId: Number.parseInt(parentId, 10) || 0,
      node: {
        id: id || undefined,
        text: text || undefined,
        label: label || undefined,
        // Text-field value (typed text, or placeholder when empty); falls back to a
        // Text widget's data so plain labels still expose a value.
        value: fieldValue || text || undefined,
        type: type || 'FlutterWidget',
        enabled: true,
        visible: vis === '1',
        bounds,
        children: [],
        platform: 'android'
      }
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
  private async waitForReady(): Promise<boolean> {
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
        // Never captured a real screen size: the engine is surfaceless (a 0x0
        // view after a hot restart). Report it so the reset path can re-foreground
        // and retry instead of serving an unlaid-out tree.
        return false;
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
          return true;
        }
      } else {
        settleStart = 0;
        previous = fingerprint;
      }
      if (Date.now() >= deadline) {
        // The view reported a real size (Phase 1 passed); the laid-out set just
        // never fully settled. That is still usable, so treat it as ready.
        return true;
      }
      await this.sleep(this.readyPollMs);
    }
  }

  /** Identity of the laid-out, labelled nodes — present-and-sized, ignoring exact position so animations still settle. Walks the (now nested) tree. */
  private layoutFingerprint(roots: MobileElementSnapshot[]): string {
    const parts: string[] = [];
    const walk = (node: MobileElementSnapshot): void => {
      if (node.bounds.width > 0 && node.bounds.height > 0) {
        parts.push(`${node.id ?? ''}#${node.text ?? ''}#${node.label ?? ''}`);
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    for (const root of roots) {
      walk(root);
    }
    return parts.sort().join('|');
  }

  /**
   * Evaluates the on-device tree walk, retrying transient build-lock failures.
   *
   * The walk uses `visitChildren`, which throws if it runs while Flutter is mid-build
   * (app startup, route transitions, animations). Those settle within a frame or two,
   * so a short bounded retry makes reads reliable without callers having to sleep.
   */
  private async evaluateStringStable(expression: string): Promise<string> {
    // Bound the whole retry sequence by wall clock, and hand the same deadline
    // down to each RPC so a single hung request cannot consume the budget on
    // its own. Callers poll this through `waitFor`, which only re-checks its
    // own deadline *between* attempts — an unbounded evaluate here therefore
    // reads as a frozen test rather than a timeout, no matter how short the
    // caller's timeout is.
    const deadline = Date.now() + this.evalBudgetMs;
    let lastError: unknown;
    let attempts = 0;

    for (;;) {
      attempts += 1;
      try {
        return await this.evaluateString(expression, deadline);
      } catch (err) {
        const transientCompilationError = err instanceof AsturError
          && err.code === 'FLUTTER_VM_RPC_ERROR'
          && /expression compilation error/i.test(err.message);
        if (!(err instanceof AsturError)
          || (err.code !== 'FLUTTER_VM_EVAL_FAILED' && !transientCompilationError)) {
          throw err;
        }
        lastError = err;
        if (Date.now() + this.evalRetryDelayMs >= deadline) {
          break;
        }
        await this.sleep(this.evalRetryDelayMs);
      }
    }

    const expressionName = expression === EXTRACT_EXPR
      ? 'Flutter tree extraction'
      : expression === UNFOCUS_EXPR
        ? 'Flutter keyboard unfocus'
        : 'Flutter expression';
    throw new AsturError(
      'FLUTTER_VM_EVAL_FAILED',
      `${expressionName} failed after ${attempts} attempt(s) within ${this.evalBudgetMs} ms: ${
        lastError instanceof Error ? lastError.message : 'unknown evaluation error'
      }`,
      { cause: lastError }
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Evaluates a Dart expression and returns its full String result (handles VM
   * string truncation). `deadline` caps every RPC this makes, so paging a large
   * tree cannot outlive the caller's retry budget.
   */
  private async evaluateString(expression: string, deadline?: number): Promise<string> {
    const result = await this.call('evaluate', {
      isolateId: this.isolateId,
      targetId: this.rootLibId,
      expression
    }, deadline);

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
      const obj = await this.call('getObject', { isolateId: this.isolateId, objectId, offset, count }, deadline);
      const chunk = (obj.valueAsString as string) ?? '';
      if (chunk.length === 0) {
        break;
      }
      out += chunk;
      offset += chunk.length;
    }
    return out;
  }

  /**
   * Turns on the Dart VM's HTTP profiler for this isolate.
   *
   * Off by default: with it on the VM retains every request (and its body) for
   * the life of the isolate, so it is enabled only when a test asks to observe,
   * and the buffer is cleared between tests.
   */
  async enableHttpProfiling(): Promise<void> {
    await this.call('ext.dart.io.httpEnableTimelineLogging', {
      isolateId: this.isolateId,
      enabled: true
    });
  }

  /** Drops everything the profiler has buffered so far. */
  async clearHttpProfile(): Promise<void> {
    await this.call('ext.dart.io.clearHttpProfile', { isolateId: this.isolateId });
  }

  /**
   * Returns the profiler's buffered requests, newest state included.
   *
   * The response shape is owned by the Dart SDK and has changed between
   * versions, so callers must treat every field as optional rather than
   * trusting a schema — see `toNetworkRecords` in the Android driver.
   */
  async getHttpProfile(): Promise<RpcResult> {
    return this.call('ext.dart.io.getHttpProfile', { isolateId: this.isolateId });
  }

  /** Full detail (including the response body) for one profiled request. */
  async getHttpProfileRequest(id: string): Promise<RpcResult> {
    return this.call('ext.dart.io.getHttpProfileRequest', { isolateId: this.isolateId, id });
  }

  /**
   * Whether this isolate actually registered the dart:io HTTP profiler
   * extensions. They are absent in some builds, so capability is detected at
   * runtime rather than assumed from the platform.
   */
  async supportsHttpProfiling(): Promise<boolean> {
    const isolate = await this.call('getIsolate', { isolateId: this.isolateId }).catch(() => undefined);
    const extensions = (isolate?.extensionRPCs as string[] | undefined) ?? [];
    return extensions.includes('ext.dart.io.getHttpProfile');
  }

  private call(method: string, params: Record<string, unknown> = {}, deadline?: number): Promise<RpcResult> {
    const ws = this.ws;
    if (!ws) {
      return Promise.reject(new AsturError('FLUTTER_VM_NOT_CONNECTED', 'Flutter VM service is not connected.'));
    }
    // Never exceed the caller's remaining budget, but always allow a small floor
    // so an almost-expired deadline still issues a real request rather than a
    // guaranteed-zero-timeout one.
    const timeoutMs = deadline === undefined
      ? this.timeoutMs
      : Math.max(250, Math.min(this.timeoutMs, deadline - Date.now()));
    const id = this.nextId++;
    return new Promise<RpcResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AsturError('FLUTTER_VM_TIMEOUT', `Flutter VM service request '${method}' timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
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
      const detail = message.error.data === undefined
        ? ''
        : `: ${typeof message.error.data === 'string'
          ? message.error.data
          : JSON.stringify(message.error.data)}`;
      entry.reject(new AsturError(
        'FLUTTER_VM_RPC_ERROR',
        `${message.error.message ?? 'Flutter VM service returned an error'}${detail}`,
        { data: message.error.data }
      ));
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
