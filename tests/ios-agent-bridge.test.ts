import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeAgentInfo } from '@astur-mobile/core';
import { IosAgentBridge } from '../packages/ios/src/agentBridge.js';

const INFO: NativeAgentInfo = {
  id: 'astur-ios-xctest',
  platform: 'ios',
  version: '0.1.0',
  protocolVersion: 1,
  capabilities: ['agent.ping', 'tree.get']
};

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return typeof address === 'object' && address ? address.port : 0;
}

function call(bridge: IosAgentBridge, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${bridge.endpoint}${path}`, init);
}

function registration(): string {
  return JSON.stringify({ id: 'register', ok: true, result: INFO, data: INFO });
}

describe('iOS agent bridge', () => {
  const bridges: IosAgentBridge[] = [];

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  });

  async function start(): Promise<IosAgentBridge> {
    const bridge = await IosAgentBridge.start(await freePort(), 2_000);
    bridges.push(bridge);
    return bridge;
  }

  it('hands each session its own token to pass to the agent', async () => {
    const first = await start();
    const second = await start();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(first.token).not.toBe(second.token);
  });

  it('accepts the agent that presents the token', async () => {
    const bridge = await start();

    const response = await call(bridge, '/register', {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.token}` },
      body: registration()
    });

    expect(response.status).toBe(200);
    await expect(bridge.waitForRegistration(500)).resolves.toMatchObject({ platform: 'ios' });
  });

  it('refuses to register an agent without the token', async () => {
    const bridge = await start();

    const response = await call(bridge, '/register', { method: 'POST', body: registration() });

    expect(response.status).toBe(401);
    await expect(bridge.waitForRegistration(200)).rejects.toBeDefined();
  });

  it('does not hand commands to a poller without the token', async () => {
    const bridge = await start();
    await call(bridge, '/register', {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.token}` },
      body: registration()
    });
    const client = bridge.createClient(INFO);
    const command = client.command('tree.get');
    command.catch(() => undefined);

    const stolen = await call(bridge, '/command');

    expect(stolen.status).toBe(401);
  });

  it('refuses a forged result without the token', async () => {
    const bridge = await start();
    const response = await call(bridge, '/response', {
      method: 'POST',
      body: JSON.stringify({ id: 'anything', ok: true, result: {} })
    });

    expect(response.status).toBe(401);
  });
});
