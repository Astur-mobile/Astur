import { AsturError, FlutterVmService } from '@astur-mobile/core';
import type { NetworkCapabilities } from '@astur-mobile/protocol';

/**
 * What an iOS session reports when no Dart VM service was found.
 *
 * The overwhelmingly common reasons are that the app is not Flutter, or is a
 * release build with no VM service compiled in — so the message names both
 * rather than implying something is broken.
 */
export const IOS_NO_NETWORK_CAPABILITIES: NetworkCapabilities = {
  observe: false,
  intercept: false,
  transports: [],
  responseBodies: false,
  adapterRequired: true,
  coverage:
    'Network observation is unavailable for this iOS session. It works today only for a '
    + 'debug Flutter build on the simulator, read through the Dart VM service. A release '
    + '(AOT) Flutter build publishes no VM service, a React Native or native iOS app exposes '
    + 'no equivalent, and on a real device the VM service is not reachable from the host.'
};

/**
 * Finds the Dart VM service a debug Flutter build publishes, and attaches to it
 * for network observation.
 *
 * Unlike Android, nothing here launches the app through the Flutter tool. A
 * debug Flutter build starts its VM service on its own and logs the URL, and on
 * the simulator that URL is already on the host's loopback — so the app can keep
 * being launched and driven through XCUITest exactly as before, and observation
 * is purely additive.
 *
 * A release (AOT) build has no VM service at all, which is why support is
 * detected per session rather than assumed from "this is Flutter".
 */

/** `http://127.0.0.1:PORT/TOKEN/` as logged by the Dart VM. */
const VM_URI_PATTERN = /http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_=-]+\//g;

export function toVmWebSocketUrl(httpUrl: string): string {
  return `${httpUrl.replace(/^http:/, 'ws:').replace(/\/$/, '')}/ws`;
}

/**
 * Every VM service URL in the log, newest first.
 *
 * Reads the log retrospectively rather than streaming it. A stream has to be
 * started before the app launches and then torn down, which races the launch it
 * is trying to observe; one query after the fact cannot.
 *
 * Returns all of them rather than the newest, because a narrow time window is
 * not a reliable way to find the current one: `log show` does not surface the
 * last few seconds dependably, so a window tight enough to exclude a previous
 * run's URL also loses the one just logged. Liveness is settled by connecting
 * instead — a terminated app's VM service is gone, so a stale URL simply fails.
 */
export function extractVmServiceUrls(logOutput: string): string[] {
  const matches = logOutput.match(VM_URI_PATTERN) ?? [];
  return [...new Set(matches)].reverse();
}

export interface FlutterNetworkAttachment {
  vm: FlutterVmService;
  url: string;
}

export interface AttachOptions {
  udid: string;
  /** How far back to search the log. */
  lastWindow?: string;
  runLogShow(udid: string, window: string): Promise<string>;
  requestTimeoutMs?: number;
  /** How many logged URLs to try before giving up. */
  maxCandidates?: number;
  /** Per-candidate bind budget; a dead URL must fail fast. */
  candidateTimeoutMs?: number;
  /** Total budget for finding a live VM service after a launch. */
  discoveryTimeoutMs?: number;
}

/**
 * Returns an attached client, or `undefined` when this build exposes no VM
 * service — the normal case for a release build, and not an error.
 */
export async function attachFlutterNetwork(
  options: AttachOptions
): Promise<FlutterNetworkAttachment | undefined> {
  const window = options.lastWindow ?? '5m';
  const deadline = Date.now() + (options.discoveryTimeoutMs ?? 15_000);

  for (;;) {
    const attachment = await attachOnce(options, window);
    if (attachment || Date.now() >= deadline) {
      return attachment;
    }

    // `log show` does not surface the last few seconds dependably, so a freshly
    // launched app's URL can simply be missing on the first look while every
    // URL that *is* present belongs to a terminated run. Polling is what makes
    // this deterministic instead of a race against the logging subsystem.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function attachOnce(
  options: AttachOptions,
  window: string
): Promise<FlutterNetworkAttachment | undefined> {
  const log = await options.runLogShow(options.udid, window).catch(() => '');
  const candidates = extractVmServiceUrls(log).slice(0, options.maxCandidates ?? 4);

  for (const httpUrl of candidates) {
    const vm = new FlutterVmService({
      url: toVmWebSocketUrl(httpUrl),
      requestTimeoutMs: options.requestTimeoutMs,
      // Short: a dead URL from a previous run must fail fast enough that
      // working through the candidates stays cheap.
      readyTimeoutMs: options.candidateTimeoutMs ?? 4_000
    });

    try {
      if (await vm.connectForNetwork() && await vm.supportsHttpProfiling()) {
        // Enable here, not only on clear(). The setting is scoped to the
        // isolate, and this attachment is what binds one — a test that reads
        // traffic without clearing first would otherwise see nothing, because
        // the fixture's clear() ran against the isolate the relaunch replaced.
        await vm.enableHttpProfiling();
        return { vm, url: httpUrl };
      }
    } catch (error) {
      if (!(error instanceof AsturError)) {
        await vm.dispose().catch(() => undefined);
        throw error;
      }
    }

    await vm.dispose().catch(() => undefined);
  }

  return undefined;
}
