import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { DeviceInfo, InspectorSession } from '@astur-mobile/core';
import { startInspectorServer, type InspectorServerHandle } from '../packages/cli/src/inspectorServer.js';

const DEVICE: DeviceInfo = { id: 'emulator-5554', name: 'Pixel', platform: 'android', kind: 'emulator', state: 'online' };

function fakeInspector(): InspectorSession {
  return {
    subscribeTree: async function* () {},
    webSnapshot: vi.fn(async () => undefined),
    hitTest: vi.fn(async () => undefined),
    executeAction: vi.fn(async () => undefined),
    webAct: vi.fn(async () => undefined)
  } as unknown as InspectorSession;
}

interface Started {
  handle: InspectorServerHandle;
  port: number;
  token: string;
  installApp: ReturnType<typeof vi.fn>;
}

async function start(): Promise<Started> {
  const installApp = vi.fn(async () => undefined);
  let url = '';
  const handle = await startInspectorServer(fakeInspector(), DEVICE, {
    captureScreenshot: async () => undefined,
    installApp,
    onListen: (_port, pageUrl) => {
      url = pageUrl;
    }
  });
  const token = /#token=([^&]+)/.exec(url)?.[1] ?? '';
  return { handle, port: handle.port, token, installApp };
}

function httpStatus(port: number, path: string, headers: Record<string, string>, method = 'GET'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end(method === 'POST' ? 'payload' : undefined);
  });
}

function openSocket(port: number, path: string, origin: string): Promise<{ opened: boolean; firstMessage?: string; socket: WebSocket }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin });
    socket.once('message', (data) => resolve({ opened: true, firstMessage: String(data), socket }));
    socket.once('unexpected-response', () => resolve({ opened: false, socket }));
    socket.once('error', () => resolve({ opened: false, socket }));
  });
}

describe('inspector server access control', () => {
  let started: Started | undefined;

  afterEach(() => {
    started?.handle.close();
    started = undefined;
  });

  it('gives the page its token in the URL fragment, which browsers never send to servers', async () => {
    started = await start();

    expect(started.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it('accepts the inspector page with its token', async () => {
    started = await start();
    const origin = `http://localhost:${started.port}`;

    const result = await openSocket(started.port, `/?token=${started.token}`, origin);
    result.socket.close();

    expect(result.opened).toBe(true);
    expect(JSON.parse(result.firstMessage ?? '{}').type).toBe('bootstrap');
  });

  it('refuses a socket without the token', async () => {
    started = await start();

    const result = await openSocket(started.port, '/', `http://localhost:${started.port}`);

    expect(result.opened).toBe(false);
  });

  it('refuses a socket opened by another site, even one that learned the token', async () => {
    started = await start();

    const result = await openSocket(started.port, `/?token=${started.token}`, 'https://attacker.example');

    expect(result.opened).toBe(false);
  });

  it('refuses an app upload without the token, before installing anything', async () => {
    started = await start();

    const status = await httpStatus(started.port, '/api/upload-app?filename=x.apk', {
      host: `localhost:${started.port}`,
      'content-type': 'text/plain'
    }, 'POST');

    expect(status).toBe(401);
    expect(started.installApp).not.toHaveBeenCalled();
  });

  it('refuses a request addressed to another host name, as DNS rebinding would send', async () => {
    started = await start();

    const status = await httpStatus(started.port, '/', { host: `attacker.example:${started.port}` });

    expect(status).toBe(403);
  });

  it('closes a socket that sends an oversized message', async () => {
    started = await start();
    const { socket } = await openSocket(started.port, `/?token=${started.token}`, `http://localhost:${started.port}`);

    const code = await new Promise<number>((resolve) => {
      socket.once('close', (closeCode) => resolve(closeCode));
      socket.send('x'.repeat(4 * 1024 * 1024));
    });

    expect(code).toBe(1009);
  });
});
