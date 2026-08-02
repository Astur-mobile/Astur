import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AsturError } from '@astur-mobile/core';

/**
 * Manages the `flutter run` process that backs a Flutter Android session.
 *
 * Launching the app through the Flutter tool (rather than `adb am start`) is what
 * attaches the Dart expression compiler to the VM service, which {@link
 * FlutterVmService} needs to evaluate the on-device tree walk. The process is
 * started once per session, hot-restarted for test resets, and stopped on close.
 */

export interface FlutterProcessOptions {
  /** Path to the Flutter app's source project (cwd for `flutter run`; required for expression compilation). */
  projectPath: string;
  /** Prebuilt debug APK to install/run via `--use-application-binary`. */
  apkPath: string;
  /** Target device/emulator id (adb serial). */
  deviceId: string;
  /** Resolved `flutter` binary path. */
  flutterPath?: string;
  launchTimeoutMs?: number;
  restartTimeoutMs?: number;
}

const VM_URI_PATTERN = /A Dart VM Service[^\n]*available at:\s*(http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_=-]+\/)/;

/**
 * Turns a `flutter run` early-exit into an actionable message by mining the
 * captured output for the underlying `adb install` failure, which `flutter`
 * otherwise hides behind a generic "Error launching application".
 */
function describeRunExit(code: number | null, signal: NodeJS.Signals | null, tail: string): string {
  const base = `'flutter run' exited before the app exposed its Dart VM service (code ${code ?? signal}).`;
  const withOutput = (message: string): string => {
    const excerpt = tail.trim();
    return excerpt ? `${message}\n\nFlutter output tail:\n${excerpt}` : message;
  };
  if (/INSTALL_FAILED_INSUFFICIENT_STORAGE/i.test(tail)) {
    return withOutput(
      `${base} The device ran out of storage while installing the app (INSTALL_FAILED_INSUFFICIENT_STORAGE). ` +
      `Free space on the emulator/device (uninstall unused apps, or wipe & recreate the AVD with a larger data partition). ` +
      `A debug APK that bundles every ABI is large — a single-ABI debug build (e.g. android-arm64) installs in far less space.`
    );
  }
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(tail)) {
    return withOutput(`${base} The app is already installed with a different signature (INSTALL_FAILED_UPDATE_INCOMPATIBLE). Uninstall the existing app and retry.`);
  }
  const installFailure = tail.match(/INSTALL_FAILED_[A-Z_]+/);
  if (installFailure) {
    return withOutput(`${base} The app failed to install (${installFailure[0]}).`);
  }
  return withOutput(`${base} This usually means the install or launch failed — check the device has free storage and the APK is a debug build.`);
}

export function resolveFlutterPath(explicit?: string): string {
  const home = homedir();
  const candidates = [
    explicit,
    process.env.ASTUR_FLUTTER_PATH,
    process.env.FLUTTER_ROOT ? join(process.env.FLUTTER_ROOT, 'bin', 'flutter') : undefined,
    // Common install locations, so the tool usually works without ASTUR_FLUTTER_PATH
    // even when `flutter` isn't on the (often minimal) PATH of an npm-script shell.
    join(home, 'development', 'flutter', 'bin', 'flutter'),
    join(home, 'flutter', 'bin', 'flutter'),
    join(home, 'fvm', 'default', 'bin', 'flutter'),
    '/opt/homebrew/bin/flutter',
    '/usr/local/bin/flutter'
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  // Last resort: rely on PATH resolution (start() reports a clear error if missing).
  return 'flutter';
}

export class FlutterProcess {
  private child?: ChildProcessWithoutNullStreams;
  private vmWsUrl?: string;
  private stdoutBuffer = '';
  private readonly listeners = new Set<(chunk: string) => void>();
  private readonly options: Required<Omit<FlutterProcessOptions, 'flutterPath'>> & { flutterPath: string };

  constructor(options: FlutterProcessOptions) {
    this.options = {
      projectPath: options.projectPath,
      apkPath: options.apkPath,
      deviceId: options.deviceId,
      flutterPath: resolveFlutterPath(options.flutterPath),
      launchTimeoutMs: options.launchTimeoutMs ?? 180_000,
      restartTimeoutMs: options.restartTimeoutMs ?? 60_000
    };
  }

  /** Spawns `flutter run` and resolves with the VM service WebSocket URL once the app is attached. */
  async start(): Promise<string> {
    if (this.vmWsUrl) {
      return this.vmWsUrl;
    }

    const args = [
      'run',
      `--use-application-binary=${this.options.apkPath}`,
      '-d',
      this.options.deviceId,
      '--no-devtools'
    ];
    const child = spawn(this.options.flutterPath, args, {
      cwd: this.options.projectPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;

    // Convert a spawn failure (e.g. flutter not found) into a clear AsturError
    // instead of an unhandled 'error' event that crashes the process.
    const spawnFailure = new Promise<never>((_, reject) => {
      child.once('error', (err: NodeJS.ErrnoException) => {
        const hint =
          err.code === 'ENOENT'
            ? ` Could not find the Flutter tool at '${this.options.flutterPath}'. Install Flutter and add it to PATH, or set ASTUR_FLUTTER_PATH to the flutter binary.`
            : '';
        reject(
          new AsturError('FLUTTER_LAUNCH_FAILED', `Failed to launch 'flutter run'.${hint}`, {
            flutterPath: this.options.flutterPath,
            code: err.code,
            cause: err.message
          })
        );
      });
      // If `flutter run` exits before the VM service appears (e.g. a failed
      // install — insufficient storage, signature mismatch), fail fast with the
      // real output instead of waiting out the launch timeout. After start()
      // resolves this rejection is harmless (Promise.race has already settled).
      child.once('exit', (code, signal) => {
        const tail = this.stdoutBuffer.slice(-1500);
        reject(
          new AsturError('FLUTTER_RUN_EXITED', describeRunExit(code, signal, tail), { code, signal, tail })
        );
      });
    });

    const onChunk = (data: Buffer) => {
      const text = data.toString();
      this.stdoutBuffer += text;
      if (process.env.ASTUR_FLUTTER_TRACE === '1') {
        process.stderr.write(text);
      }
      for (const listener of this.listeners) {
        listener(text);
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);

    const httpUri = await Promise.race([
      this.waitForOutput(
        VM_URI_PATTERN,
        this.options.launchTimeoutMs,
        'Timed out waiting for the Flutter app to start and expose its Dart VM service.'
      ),
      spawnFailure
    ]);
    // http://127.0.0.1:PORT/TOKEN/  ->  ws://127.0.0.1:PORT/TOKEN/ws
    this.vmWsUrl = `${httpUri.replace(/^http:/, 'ws:')}ws`;
    return this.vmWsUrl;
  }

  /** Hot-restarts the app (re-runs main()) — the fast, clean way to reset state between tests. */
  async hotRestart(): Promise<void> {
    const child = this.child;
    if (!child) {
      throw new AsturError('FLUTTER_PROCESS_NOT_STARTED', 'Cannot hot-restart: the Flutter process is not running.');
    }
    // Only consider output that arrives AFTER we issue the restart. stdoutBuffer
    // accumulates across the whole session and is never cleared, so matching the
    // whole buffer would find a *previous* restart's "Restarted application" line
    // and resolve immediately — proceeding to reattach before the new isolate
    // exists, which binds the dying old isolate and reads an empty tree.
    const fromIndex = this.stdoutBuffer.length;
    const done = this.waitForOutput(
      /Restarted application/i,
      this.options.restartTimeoutMs,
      'Timed out waiting for Flutter hot restart.',
      fromIndex
    );
    child.stdin.write('R\n');
    await done;
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.vmWsUrl = undefined;
    if (!child) {
      return;
    }
    try {
      child.stdin.write('q\n');
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private waitForOutput(
    pattern: RegExp,
    timeoutMs: number,
    timeoutMessage: string,
    fromIndex = 0
  ): Promise<string> {
    const search = (): RegExpMatchArray | null => this.stdoutBuffer.slice(fromIndex).match(pattern);
    const existing = search();
    if (existing) {
      return Promise.resolve(existing[1] ?? existing[0]);
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new AsturError('FLUTTER_PROCESS_TIMEOUT', timeoutMessage, { tail: this.stdoutBuffer.slice(-1200) }));
      }, timeoutMs);
      const listener = () => {
        const match = search();
        if (match) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(match[1] ?? match[0]);
        }
      };
      this.listeners.add(listener);
    });
  }
}
