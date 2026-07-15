import { spawn } from 'node:child_process';

/**
 * Best-effort launch of the platform handler for a URL or file path.
 *
 * Must never crash the process: on Windows `start` is a cmd.exe built-in, not
 * an executable, so it has to run through `cmd /c start "" <target>` (the empty
 * argument is the window title — without it, a quoted target is swallowed as
 * the title). Spawn failures also surface as *asynchronous* `error` events
 * that a try/catch around `spawn()` cannot see; without a listener they become
 * an unhandled 'error' event and take the whole CLI down — after the inspector
 * server is already up. The inspector always prints its URL, so a failed
 * auto-open must degrade to "open the link yourself", never to a crash.
 */
export function openExternal(target: string): boolean {
  try {
    const child = process.platform === 'darwin'
      ? spawn('open', [target], { detached: true, stdio: 'ignore' })
      : process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' })
        : spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });

    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
