import type {
  Coordinates,
  ElementSelector,
  InspectorAction,
  InspectorSession,
  LocatorSuggestion,
  MobileElementSnapshot,
  MobileRole,
  UiTreeSubscribeOptions,
  UiTreeUpdate
} from '@astur/protocol';
import { AsturError } from './errors.js';
import { by, findElements, matches, MobileLocator } from './locator.js';
import type { PlatformSession } from './session.js';
import { delay } from './wait.js';

const knownRoles: MobileRole[] = [
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

export interface RuntimeInspectorSessionOptions {
  pollIntervalMs?: number;
}

interface LocatorCandidate {
  selector: ElementSelector;
  code: string;
  baseScore: number;
  crossPlatform: boolean;
  stabilityHint: number;
}

export function createInspectorSession(
  session: PlatformSession,
  options: RuntimeInspectorSessionOptions = {}
): InspectorSession {
  return new RuntimeInspectorSession(session, options);
}

class RuntimeInspectorSession implements InspectorSession {
  private readonly session: PlatformSession;
  private readonly defaultPollIntervalMs: number;
  private revision = 0;

  constructor(session: PlatformSession, options: RuntimeInspectorSessionOptions) {
    this.session = session;
    this.defaultPollIntervalMs = normalizePollInterval(options.pollIntervalMs);
  }

  async *subscribeTree(options: UiTreeSubscribeOptions = {}): AsyncIterable<UiTreeUpdate> {
    const maxUpdates = options.maxUpdates ?? Number.POSITIVE_INFINITY;
    if (maxUpdates <= 0) {
      return;
    }

    if (this.session.subscribeTree) {
      let emitted = 0;
      for await (const update of this.session.subscribeTree(options)) {
        yield update;
        emitted += 1;
        if (emitted >= maxUpdates) {
          return;
        }
      }
      return;
    }

    const pollIntervalMs = normalizePollInterval(options.pollIntervalMs ?? this.defaultPollIntervalMs);
    let emitted = 0;

    while (emitted < maxUpdates) {
      emitted += 1;
      this.revision += 1;

      yield {
        revision: this.revision,
        timestamp: Date.now(),
        reason: emitted === 1 ? 'initial' : 'poll',
        root: await this.session.getTree()
      };

      if (emitted >= maxUpdates) {
        return;
      }

      await delay(pollIntervalMs);
    }
  }

  async hitTest(point: Coordinates): Promise<MobileElementSnapshot | undefined> {
    if (this.session.hitTest) {
      return this.session.hitTest(point);
    }

    const root = await this.session.getTree();
    const hit = findDeepestHit(root, point, true);
    return hit === root ? undefined : hit;
  }

  async highlight(selector: ElementSelector): Promise<void> {
    await this.session.highlightElement?.(selector);
  }

  async clearHighlight(): Promise<void> {
    await this.session.clearHighlight?.();
  }

  async generateLocator(selector: ElementSelector): Promise<LocatorSuggestion[]> {
    const root = await this.session.getTree();
    const target = findElements(root, selector)[0];

    if (!target) {
      throw new AsturError(
        'INSPECTOR_TARGET_NOT_FOUND',
        `Inspector target ${selector.strategy}=${JSON.stringify(selector.value)} was not found in the current tree.`
      );
    }

    return rankLocatorSuggestions(target, root);
  }

  async executeAction(action: InspectorAction): Promise<void> {
    const locator = new MobileLocator(this.session, action.selector);

    switch (action.kind) {
      case 'wait': {
        const state = action.options?.state ?? 'attached';
        if (state === 'hidden') {
          await locator.waitForHidden(action.options);
          return;
        }

        if (state === 'visible') {
          await locator.waitForVisible(action.options);
          return;
        }

        await locator.waitForSnapshot(() => true, action.options);
        return;
      }

      case 'tap':
        await locator.tap(action.options);
        return;

      case 'doubleTap':
        await locator.doubleTap(action.options);
        return;

      case 'longPress':
        await locator.longPress(action.options);
        return;

      case 'fill':
        await locator.fill(action.value, action.options);
        return;

      case 'drag':
        if (isSelectorTarget(action.target)) {
          await locator.dragTo(new MobileLocator(this.session, action.target.selector), action.options);
          return;
        }

        await locator.dragTo(action.target, action.options);
        return;

      default:
        return assertNever(action);
    }
  }
}

function rankLocatorSuggestions(target: MobileElementSnapshot, root: MobileElementSnapshot): LocatorSuggestion[] {
  const candidates = buildCandidates(target);
  const suggestions: LocatorSuggestion[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate.code)) {
      continue;
    }

    seen.add(candidate.code);
    const matched = findElements(root, candidate.selector);
    const uniqueness = matched.length > 0 ? 1 / matched.length : 0;
    const stability = clampScore(candidate.stabilityHint);
    const readable = candidate.code.length <= 88;
    const score = scoreCandidate(candidate.baseScore, uniqueness, stability, readable);

    suggestions.push({
      code: candidate.code,
      selector: candidate.selector,
      score,
      uniqueness: round(uniqueness),
      stability: round(stability),
      readable,
      crossPlatform: candidate.crossPlatform
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

function buildCandidates(target: MobileElementSnapshot): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];
  const id = normalizeToken(target.id);
  const label = normalizeToken(target.label);
  const text = normalizeToken(target.text);
  const name = label ?? text ?? normalizeToken(target.value);
  const role = inferRole(target, name);

  if (id) {
    candidates.push({
      selector: by.testId(id),
      code: `device.getByTestId('${escapeSingleQuotes(id)}')`,
      baseScore: 0.99,
      crossPlatform: true,
      stabilityHint: scoreStableToken(id, 'id')
    });

    candidates.push({
      selector: by.id(id),
      code: `device.getById('${escapeSingleQuotes(id)}')`,
      baseScore: 0.96,
      crossPlatform: true,
      stabilityHint: scoreStableToken(id, 'id')
    });
  }

  if (role && name) {
    candidates.push({
      selector: by.role(role, { name }),
      code: `device.getByRole('${escapeSingleQuotes(role)}', { name: '${escapeSingleQuotes(name)}' })`,
      baseScore: 0.92,
      crossPlatform: true,
      stabilityHint: scoreStableToken(name, 'text')
    });
  }

  if (label) {
    candidates.push({
      selector: by.label(label),
      code: `device.getByLabel('${escapeSingleQuotes(label)}')`,
      baseScore: 0.89,
      crossPlatform: true,
      stabilityHint: scoreStableToken(label, 'accessibility')
    });
  }

  if (text) {
    candidates.push({
      selector: by.text(text),
      code: `device.getByText('${escapeSingleQuotes(text)}')`,
      baseScore: 0.84,
      crossPlatform: true,
      stabilityHint: scoreStableToken(text, 'text')
    });
  }

  const type = normalizeToken(target.type);
  if (type) {
    candidates.push({
      selector: by.type(type),
      code: `device.getByType('${escapeSingleQuotes(type)}')`,
      baseScore: 0.58,
      crossPlatform: false,
      stabilityHint: 0.58
    });
  }

  return candidates;
}

function inferRole(target: MobileElementSnapshot, name?: string): MobileRole | undefined {
  const roleOptions = knownRoles.filter((role) => {
    const selector = name
      ? by.role(role, { name })
      : by.role(role);

    return matches(target, selector);
  });

  return roleOptions[0];
}

function scoreCandidate(baseScore: number, uniqueness: number, stability: number, readable: boolean): number {
  const uniquenessWeight = 0.45 + clampScore(uniqueness) * 0.55;
  const stabilityWeight = 0.6 + clampScore(stability) * 0.4;
  const readabilityWeight = readable ? 1 : 0.92;

  return round(clampScore(baseScore * uniquenessWeight * stabilityWeight * readabilityWeight));
}

function scoreStableToken(value: string, strategy: ElementSelector['strategy']): number {
  let score = 1;

  if (value.length > 72) {
    score -= 0.1;
  }

  if (/\b(tmp|temp|debug|sample|placeholder)\b/i.test(value)) {
    score -= 0.25;
  }

  if (/\d{3,}/.test(value)) {
    score -= strategy === 'id' ? 0.08 : 0.2;
  }

  if (/[a-f0-9]{8,}/i.test(value)) {
    score -= 0.2;
  }

  if (strategy === 'text' && value.length <= 2) {
    score -= 0.2;
  }

  if (strategy === 'type') {
    score = Math.min(score, 0.58);
  }

  return clampScore(score);
}

function normalizeToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token ? token : undefined;
}

function findDeepestHit(
  node: MobileElementSnapshot,
  point: Coordinates,
  ignoreBounds = false
): MobileElementSnapshot | undefined {
  if (!node.visible) {
    return undefined;
  }

  const contains = ignoreBounds || containsPoint(node.bounds, point);
  if (!contains) {
    return undefined;
  }

  const children = [...node.children].reverse();
  for (const child of children) {
    const hit = findDeepestHit(child, point);
    if (hit) {
      return hit;
    }
  }

  return node;
}

function containsPoint(bounds: MobileElementSnapshot['bounds'], point: Coordinates): boolean {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return false;
  }

  return point.x >= bounds.x
    && point.y >= bounds.y
    && point.x <= bounds.x + bounds.width
    && point.y <= bounds.y + bounds.height;
}

function normalizePollInterval(value: number | undefined): number {
  if (!value || value < 40) {
    return 250;
  }

  return value;
}

function isSelectorTarget(target: { selector: ElementSelector } | Coordinates): target is { selector: ElementSelector } {
  return 'selector' in target;
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertNever(value: never): never {
  throw new AsturError('INSPECTOR_ACTION_UNSUPPORTED', `Unsupported inspector action: ${JSON.stringify(value)}`);
}
