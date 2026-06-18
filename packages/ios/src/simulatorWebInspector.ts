import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Discovers the `com.apple.webinspectord_sim.socket` Unix socket for a booted
 * iOS Simulator so its WKWebView Web Inspector can be driven on the simulator —
 * not just on real devices.
 *
 * Why this exists: `ios-webkit-debug-proxy` bridges *real* devices over usbmux
 * and cannot see the Simulator's WKWebView. The simulator instead exposes Web
 * Inspector on a per-simulator Unix socket owned by that simulator's
 * `launchd_sim` process, and iwdp ≥ 1.9 can target it via
 * `-s unix:<socket>`. There is no public API for the socket path, so we map it
 * the way Appium does: find the `launchd_sim` process whose open files include
 * the target device's data dir (its UDID appears in the path), then read the
 * webinspectord_sim socket from that same process.
 *
 * Returns `undefined` (never throws) when the socket cannot be found, so callers
 * degrade to the existing real-device / no-devices behavior instead of breaking.
 */
export async function findSimulatorWebInspectorSocket(udid: string): Promise<string | undefined> {
  if (!udid) {
    return undefined;
  }

  // launchd_sim PIDs that hold Unix sockets (one such process per booted sim).
  const pidOutput = await runLsof(['-aUc', 'launchd_sim', '-F', 'p']);
  const pids = [...new Set(
    pidOutput
      .split('\n')
      .filter((line) => line.startsWith('p'))
      .map((line) => line.slice(1).trim())
      .filter(Boolean)
  )];

  for (const pid of pids) {
    // `-F n` prints one `n<name>` line per open file: both the simulator's data
    // dir paths (which contain the UDID) and the webinspectord_sim socket path.
    const names = (await runLsof(['-p', pid, '-F', 'n']))
      .split('\n')
      .filter((line) => line.startsWith('n'))
      .map((line) => line.slice(1));

    if (!names.some((name) => name.includes(udid))) {
      continue;
    }

    const socket = names.find((name) => name.endsWith('com.apple.webinspectord_sim.socket'));
    if (socket) {
      return socket;
    }
  }

  return undefined;
}

async function runLsof(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('lsof', args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    // lsof exits non-zero when it cannot stat some descriptors, yet still prints
    // the rest on stdout — that partial output is exactly what we need.
    const stdout = (error as { stdout?: unknown }).stdout;
    return typeof stdout === 'string' ? stdout : '';
  }
}
