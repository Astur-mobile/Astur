import { execFile, spawn, type ChildProcess, type ExecFileException } from 'node:child_process';
import { AsturError } from '@astur-mobile/core';

export interface CommandResult {
  stdout: Buffer;
  stderr: Buffer;
}

export function run(file: string, args: readonly string[], maxBuffer = 20 * 1024 * 1024): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'buffer', maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        reject(toCommandError(file, args, error, stdout, stderr));
        return;
      }

      resolve({
        stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''),
        stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? '')
      });
    });
  });
}

export async function runText(file: string, args: readonly string[]): Promise<string> {
  const result = await run(file, args);
  return result.stdout.toString('utf8');
}

export function spawnDetached(file: string, args: readonly string[]): ChildProcess {
  const child = spawn(file, [...args], {
    detached: true,
    stdio: 'ignore'
  });
  // A ChildProcess with no 'error' listener throws an uncaught exception when the
  // binary cannot be launched (e.g. ENOENT), which would crash the host process.
  // Keep a default no-op listener so a failed launch is recoverable; callers can
  // attach their own listener to observe the error.
  child.on('error', () => {});
  child.unref();
  return child;
}

export function spawnCommand(file: string, args: readonly string[]): ChildProcess {
  return spawn(file, [...args], {
    stdio: 'ignore'
  });
}

function toCommandError(
  file: string,
  args: readonly string[],
  error: ExecFileException,
  stdout: string | Buffer,
  stderr: string | Buffer
): AsturError {
  const stdoutText = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout;
  const stderrText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr;
  const message = stderrText.trim() || stdoutText.trim() || error.message;

  return new AsturError('COMMAND_FAILED', `${file} ${args.join(' ')} failed: ${message}`, {
    code: error.code,
    stdout: stdoutText,
    stderr: stderrText
  });
}
