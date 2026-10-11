import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndroidDriver } from '@astur-mobile/android';
import {
  AsturError,
  by,
  normalizeCapabilities,
  type DeviceInfo,
  type MobileElementSnapshot,
  type NativeAgentCommandEnvelope,
  type NativeAgentInfo
} from '@astur-mobile/core';
import { createFakeAdb, type FakeAdb } from './support/fake-adb.js';

interface AgentRequest {
  id: string;
  method: string;
  params?: unknown;
  authorization?: string;
}

interface AgentResponse {
  status?: number;
  body?: unknown;
}

interface AgentServer {
  endpoint: string;
  requests: AgentRequest[];
  close(): Promise<void>;
}

const ANDROID_DEVICE: DeviceInfo = {
  id: 'emulator-5554',
  name: 'Pixel 9',
  platform: 'android',
  kind: 'emulator',
  state: 'online'
};

const ANDROID_AGENT_INFO: NativeAgentInfo = {
  id: 'astur-android-uiautomator',
  platform: 'android',
  version: '0.1.0-alpha.0',
  protocolVersion: 1,
  capabilities: ['agent.ping', 'tree.get', 'gesture.tap']
};

const ANDROID_TREE: MobileElementSnapshot = {
  type: 'hierarchy',
  enabled: true,
  visible: true,
  bounds: { x: 0, y: 0, width: 1080, height: 2400 },
  children: []
};

describe('Android native-agent mode', () => {
  const servers: AgentServer[] = [];
  let previousAndroidEndpoint: string | undefined;

  beforeEach(() => {
    previousAndroidEndpoint = process.env.ASTUR_ANDROID_AGENT_ENDPOINT;
    delete process.env.ASTUR_ANDROID_AGENT_ENDPOINT;
  });

  afterEach(async () => {
    if (previousAndroidEndpoint === undefined) {
      delete process.env.ASTUR_ANDROID_AGENT_ENDPOINT;
    } else {
      process.env.ASTUR_ANDROID_AGENT_ENDPOINT = previousAndroidEndpoint;
    }
    vi.restoreAllMocks();
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it('fails when required mode has no endpoint', async () => {
    const driver = createDriver();

    await expect(driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'required',
        install: false
      }
    }))).rejects.toMatchObject({
      code: 'ANDROID_AGENT_ENDPOINT_REQUIRED'
    } satisfies Partial<AsturError>);
  });

  it('fails when required mode endpoint handshake cannot connect', async () => {
    const driver = createDriver();

    await expect(driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: 'http://127.0.0.1:65534',
        launchTimeout: 50,
        commandTimeout: 50
      }
    }))).rejects.toMatchObject({
      code: 'ANDROID_AGENT_CONNECT_FAILED'
    } satisfies Partial<AsturError>);
  });

  it('falls back in auto mode when endpoint handshake cannot connect', async () => {
    const driver = createDriver();

    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'auto',
        endpoint: 'http://127.0.0.1:65534',
        launchTimeout: 50,
        commandTimeout: 50
      }
    }));

    await expect(session.getTree()).rejects.toMatchObject({
      code: 'COMMAND_FAILED'
    } satisfies Partial<AsturError>);
  });

  it('does not contact endpoint when mode is off', async () => {
    const server = await createAgentServer((request) => ({
      body: ok(request.id, ANDROID_AGENT_INFO)
    }));
    servers.push(server);

    const driver = createDriver();
    await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'off',
        endpoint: server.endpoint
      }
    }));

    expect(server.requests).toHaveLength(0);
  });

  it('routes tree.get through endpoint when required mode handshake succeeds', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, ANDROID_AGENT_INFO)
        };
      }

      if (request.method === 'tree.get') {
        return {
          body: ok(request.id, ANDROID_TREE)
        };
      }

      return {
        status: 404,
        body: {
          id: request.id,
          ok: false,
          error: {
            code: 'UNKNOWN_COMMAND',
            message: request.method
          }
        }
      };
    });
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.getTree()).resolves.toEqual(ANDROID_TREE);
    expect(server.requests.map((request) => request.method)).toEqual(['agent.ping', 'tree.get']);
  });

  it('wraps command failures in required mode', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, ANDROID_AGENT_INFO)
        };
      }

      return {
        body: {
          id: request.id,
          ok: false,
          error: {
            code: 'ELEMENT_NOT_FOUND',
            message: `${request.method} failed to resolve target`
          }
        }
      };
    });
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.tap({ x: 100, y: 200 })).rejects.toMatchObject({
      code: 'ANDROID_AGENT_COMMAND_FAILED'
    } satisfies Partial<AsturError>);
  });

  it('fails fast in required mode when command is not advertised by agent capabilities', async () => {
    const pingOnlyInfo: NativeAgentInfo = {
      ...ANDROID_AGENT_INFO,
      capabilities: ['agent.ping']
    };

    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, pingOnlyInfo)
        };
      }

      return {
        status: 404,
        body: {
          id: request.id,
          ok: false,
          error: {
            code: 'UNKNOWN_COMMAND',
            message: request.method
          }
        }
      };
    });
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.tap({ x: 10, y: 20 })).rejects.toMatchObject({
      code: 'ANDROID_AGENT_COMMAND_UNSUPPORTED'
    } satisfies Partial<AsturError>);

    expect(server.requests.filter((request) => request.method === 'gesture.tap')).toHaveLength(0);
  });

  it('marks unsupported command after first failure in auto mode and uses fallback path', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, ANDROID_AGENT_INFO)
        };
      }

      return {
        body: {
          id: request.id,
          ok: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message: `${request.method} is not implemented`
          }
        }
      };
    });
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'auto',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.tap({ x: 10, y: 20 })).rejects.toMatchObject({
      code: 'COMMAND_FAILED'
    } satisfies Partial<AsturError>);

    await expect(session.tap({ x: 30, y: 40 })).rejects.toMatchObject({
      code: 'COMMAND_FAILED'
    } satisfies Partial<AsturError>);

    expect(server.requests.filter((request) => request.method === 'gesture.tap')).toHaveLength(1);
  });

  it('keeps endpoint enabled for command-level failures in auto mode', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, ANDROID_AGENT_INFO)
        };
      }

      return {
        body: {
          id: request.id,
          ok: false,
          error: {
            code: 'ELEMENT_NOT_FOUND',
            message: `${request.method} failed to resolve target`
          }
        }
      };
    });
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'auto',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.tap({ x: 10, y: 20 })).rejects.toMatchObject({
      code: 'COMMAND_FAILED'
    } satisfies Partial<AsturError>);

    await expect(session.tap({ x: 30, y: 40 })).rejects.toMatchObject({
      code: 'COMMAND_FAILED'
    } satisfies Partial<AsturError>);

    expect(server.requests.filter((request) => request.method === 'gesture.tap')).toHaveLength(2);
  });

  it('routes element.findAll and element.findMany through the endpoint when advertised', async () => {
    const info: NativeAgentInfo = {
      ...ANDROID_AGENT_INFO,
      capabilities: ['agent.ping', 'element.findAll', 'element.findMany']
    };
    const match: MobileElementSnapshot = {
      type: 'android.widget.TextView',
      text: 'Welcome',
      enabled: true,
      visible: true,
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      children: []
    };

    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return { body: ok(request.id, info) };
      }

      if (request.method === 'element.findAll') {
        return { body: ok(request.id, [match]) };
      }

      if (request.method === 'element.findMany') {
        return { body: ok(request.id, [match, match]) };
      }

      return {
        status: 404,
        body: {
          id: request.id,
          ok: false,
          error: { code: 'UNKNOWN_COMMAND', message: request.method }
        }
      };
    });
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    const selector = { strategy: 'text', value: 'Welcome', exact: true } as const;

    await expect(session.findElements!(selector)).resolves.toEqual([match]);
    await expect(session.findManyElements!([selector, selector])).resolves.toEqual([match, match]);

    expect(server.requests.map((request) => request.method)).toContain('element.findAll');
    expect(server.requests.map((request) => request.method)).toContain('element.findMany');
    expect(server.requests.filter((request) => request.method === 'tree.get')).toHaveLength(0);
  });

  it('round-trips a by.native() selector to the agent unmodified over the wire', async () => {
    // No new host-side logic exists for `native` — element.find/findAll already
    // pass the selector through generically. This test exists to catch a future
    // refactor that accidentally drops the `native` payload during
    // (de)serialization, since packages/android has no other coverage that
    // would notice a silently-stripped field.
    const info: NativeAgentInfo = {
      ...ANDROID_AGENT_INFO,
      capabilities: ['agent.ping', 'element.find']
    };
    const match: MobileElementSnapshot = {
      type: 'android.widget.Button',
      label: 'Save',
      enabled: true,
      visible: true,
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      children: []
    };

    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return { body: ok(request.id, info) };
      }
      if (request.method === 'element.find') {
        return { body: ok(request.id, match) };
      }
      return {
        status: 404,
        body: { id: request.id, ok: false, error: { code: 'UNKNOWN_COMMAND', message: request.method } }
      };
    });
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: { id: ANDROID_DEVICE.id },
      agent: { mode: 'required', endpoint: server.endpoint, launchTimeout: 500, commandTimeout: 500 }
    }));

    const selector = by.native({
      android: { className: 'android.widget.Button', textContains: 'Save' },
      instance: 2
    });

    await expect(session.findElement!(selector)).resolves.toEqual(match);

    const request = server.requests.find((r) => r.method === 'element.find');
    expect(request?.params).toMatchObject({
      selector: {
        strategy: 'native',
        native: {
          android: { className: 'android.widget.Button', textContains: 'Save' },
          instance: 2
        }
      }
    });
  });

  it('falls back to the tree snapshot for findElements when the agent does not advertise element.findAll, even in required mode', async () => {
    const welcome: MobileElementSnapshot = {
      type: 'android.widget.TextView',
      text: 'Welcome',
      enabled: true,
      visible: true,
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      children: []
    };
    const other: MobileElementSnapshot = {
      type: 'android.widget.TextView',
      text: 'Other',
      enabled: true,
      visible: true,
      bounds: { x: 0, y: 60, width: 100, height: 40 },
      children: []
    };
    const treeWithMatches: MobileElementSnapshot = {
      ...ANDROID_TREE,
      children: [welcome, { ...welcome, bounds: { x: 0, y: 120, width: 100, height: 40 } }, other]
    };

    // ANDROID_AGENT_INFO advertises tree.get but not element.findAll/findMany.
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return { body: ok(request.id, ANDROID_AGENT_INFO) };
      }

      if (request.method === 'tree.get') {
        return { body: ok(request.id, treeWithMatches) };
      }

      return {
        status: 404,
        body: {
          id: request.id,
          ok: false,
          error: { code: 'UNKNOWN_COMMAND', message: request.method }
        }
      };
    });
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: {
        id: ANDROID_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    const welcomeSelector = { strategy: 'text', value: 'Welcome', exact: true } as const;
    const otherSelector = { strategy: 'text', value: 'Other', exact: true } as const;

    const found = await session.findElements!(welcomeSelector);
    expect(found).toHaveLength(2);

    const many = await session.findManyElements!([welcomeSelector, otherSelector]);
    expect(many).toHaveLength(3);

    const methods = server.requests.map((request) => request.method);
    expect(methods).not.toContain('element.findAll');
    expect(methods).not.toContain('element.findMany');
    expect(methods.filter((method) => method === 'tree.get').length).toBeGreaterThan(0);
  });

  it('reports the ui engine so tests can branch on it instead of on env vars', async () => {
    const server = await createAgentServer((request) => ({
      body: ok(request.id, request.method === 'agent.ping' ? ANDROID_AGENT_INFO : ANDROID_TREE)
    }));
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: { id: ANDROID_DEVICE.id },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    // A non-Flutter session is served by the platform hierarchy. The Flutter
    // counterpart reports 'flutter', which is what tells a spec that only
    // on-screen nodes exist.
    expect(session.deviceInfo.uiEngine).toBe('native');
  });

  it('caches the viewport instead of re-reading the tree for every gesture', async () => {
    const server = await createAgentServer((request) => ({
      body: ok(request.id, request.method === 'agent.ping' ? ANDROID_AGENT_INFO : ANDROID_TREE)
    }));
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: { id: ANDROID_DEVICE.id },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    const first = await session.getViewport!();
    const second = await session.getViewport!();

    expect(second).toEqual(first);
    expect(first).toEqual(ANDROID_TREE.bounds);
    // Serializing the whole hierarchy to recover one rectangle is the expensive
    // part; scroll helpers ask for the viewport on every reveal.
    expect(server.requests.filter((request) => request.method === 'tree.get')).toHaveLength(1);
  });
  describe('when an action response is lost', () => {
    const ACTION_AGENT_INFO: NativeAgentInfo = {
      ...ANDROID_AGENT_INFO,
      capabilities: ['agent.ping', 'tree.get', 'gesture.tap', 'element.tap', 'element.find', 'element.wait']
    };
    const SAVE_BUTTON: MobileElementSnapshot = {
      type: 'android.widget.Button',
      text: 'Save',
      enabled: true,
      visible: true,
      bounds: { x: 100, y: 200, width: 80, height: 40 },
      children: []
    };
    const shellInput = (calls: string[]) => calls.filter((call) => / shell (input|uiautomator) /.test(` ${call} `));
    let adb: FakeAdb;

    beforeEach(() => {
      adb = createFakeAdb();
    });

    afterEach(() => {
      adb.dispose();
    });

    it('fails an element tap with an unknown outcome instead of tapping again', async () => {
      const server = await createAgentServer(async (request) => {
        if (request.method === 'agent.ping') {
          return { body: ok(request.id, ACTION_AGENT_INFO) };
        }
        if (request.method === 'element.tap') {
          await delay(400);
        }
        return { body: ok(request.id, SAVE_BUTTON) };
      });
      servers.push(server);

      const session = await createDriver(adb.path).createSession(normalizeCapabilities({
        platform: 'android',
        device: { id: ANDROID_DEVICE.id },
        timeout: 300,
        agent: { mode: 'required', endpoint: server.endpoint, launchTimeout: 500, commandTimeout: 150 }
      }));

      await expect(session.tapElement!(by.text('Save'))).rejects.toMatchObject({
        code: 'ANDROID_AGENT_OUTCOME_UNKNOWN'
      } satisfies Partial<AsturError>);
      expect(server.requests.filter((request) => request.method === 'element.tap')).toHaveLength(1);
      expect(server.requests.filter((request) => request.method === 'gesture.tap')).toHaveLength(0);
      expect(shellInput(adb.calls())).toEqual([]);
    });

    it('fails a coordinate tap with an unknown outcome instead of repeating it through adb', async () => {
      const server = await createAgentServer(async (request) => {
        if (request.method === 'agent.ping') {
          return { body: ok(request.id, ACTION_AGENT_INFO) };
        }
        if (request.method === 'gesture.tap') {
          await delay(400);
        }
        return { body: ok(request.id, ANDROID_TREE) };
      });
      servers.push(server);

      const session = await createDriver(adb.path).createSession(normalizeCapabilities({
        platform: 'android',
        device: { id: ANDROID_DEVICE.id },
        agent: { mode: 'auto', endpoint: server.endpoint, launchTimeout: 500, commandTimeout: 150 }
      }));

      await expect(session.tap({ x: 10, y: 20 })).rejects.toMatchObject({
        code: 'ANDROID_AGENT_OUTCOME_UNKNOWN'
      } satisfies Partial<AsturError>);
      expect(shellInput(adb.calls())).toEqual([]);
    });

    it('keeps later commands on the agent when legacy fallback is never', async () => {
      let treeReads = 0;
      const server = await createAgentServer(async (request) => {
        if (request.method === 'agent.ping') {
          return { body: ok(request.id, ACTION_AGENT_INFO) };
        }
        if (request.method === 'tree.get' && ++treeReads === 1) {
          await delay(400);
        }
        return { body: ok(request.id, ANDROID_TREE) };
      });
      servers.push(server);

      const session = await createDriver(adb.path).createSession(normalizeCapabilities({
        platform: 'android',
        device: { id: ANDROID_DEVICE.id },
        agent: {
          mode: 'auto',
          legacyFallback: 'never',
          endpoint: server.endpoint,
          launchTimeout: 500,
          commandTimeout: 150
        }
      }));

      await expect(session.getTree()).rejects.toBeInstanceOf(AsturError);
      await expect(session.getTree()).resolves.toEqual(ANDROID_TREE);
      await session.tap({ x: 10, y: 20 });

      expect(server.requests.filter((request) => request.method === 'gesture.tap')).toHaveLength(1);
      expect(shellInput(adb.calls())).toEqual([]);
    });

    it('still taps by coordinates through the agent when the agent refuses an element tap', async () => {
      const server = await createAgentServer((request) => {
        if (request.method === 'agent.ping') {
          return { body: ok(request.id, ACTION_AGENT_INFO) };
        }
        if (request.method === 'element.tap') {
          return {
            body: {
              id: request.id,
              ok: false,
              error: { code: 'ELEMENT_NOT_CLICKABLE', message: 'UiObject2 refused the click' }
            }
          };
        }
        return { body: ok(request.id, SAVE_BUTTON) };
      });
      servers.push(server);

      const session = await createDriver(adb.path).createSession(normalizeCapabilities({
        platform: 'android',
        device: { id: ANDROID_DEVICE.id },
        agent: { mode: 'required', endpoint: server.endpoint, launchTimeout: 500, commandTimeout: 500 }
      }));

      await session.tapElement!(by.text('Save'));

      expect(server.requests.filter((request) => request.method === 'gesture.tap')).toHaveLength(1);
      expect(shellInput(adb.calls())).toEqual([]);
    });

    it('refuses to fall back when the agent rejected the tap before running it', async () => {
      const server = await createAgentServer((request) => {
        if (request.method === 'agent.ping') {
          return { body: ok(request.id, ACTION_AGENT_INFO) };
        }
        if (request.method === 'element.tap') {
          return {
            body: {
              id: request.id,
              ok: false,
              executed: false,
              error: { code: 'DEADLINE_EXCEEDED', message: 'The command waited past its budget.' }
            }
          };
        }
        return { body: ok(request.id, SAVE_BUTTON) };
      });
      servers.push(server);

      const session = await createDriver(adb.path).createSession(normalizeCapabilities({
        platform: 'android',
        device: { id: ANDROID_DEVICE.id },
        agent: { mode: 'auto', endpoint: server.endpoint, launchTimeout: 500, commandTimeout: 500 }
      }));

      await expect(session.tapElement!(by.text('Save'))).rejects.toMatchObject({
        code: 'ANDROID_AGENT_COMMAND_REJECTED'
      } satisfies Partial<AsturError>);
      expect(server.requests.filter((request) => request.method === 'gesture.tap')).toHaveLength(0);
      expect(shellInput(adb.calls())).toEqual([]);

      // The agent is still trusted: the next command goes to it, not to adb.
      await session.tap({ x: 1, y: 2 });
      expect(server.requests.filter((request) => request.method === 'gesture.tap')).toHaveLength(1);
    });
  });

  describe('agent authentication', () => {
    let adb: FakeAdb;
    let previousHostPort: string | undefined;

    beforeEach(() => {
      adb = createFakeAdb();
      previousHostPort = process.env.ASTUR_ANDROID_AGENT_HOST_PORT;
    });

    afterEach(() => {
      adb.dispose();
      if (previousHostPort === undefined) {
        delete process.env.ASTUR_ANDROID_AGENT_HOST_PORT;
      } else {
        process.env.ASTUR_ANDROID_AGENT_HOST_PORT = previousHostPort;
      }
    });

    it('starts the bundled agent with a fresh token and presents it on every command', async () => {
      const server = await createAgentServer((request) => ({
        body: ok(request.id, request.method === 'agent.ping' ? ANDROID_AGENT_INFO : ANDROID_TREE)
      }));
      servers.push(server);
      process.env.ASTUR_ANDROID_AGENT_HOST_PORT = new URL(server.endpoint).port;

      const tokens: string[] = [];
      for (let run = 0; run < 2; run += 1) {
        const session = await createDriver(adb.path).createSession(normalizeCapabilities({
          platform: 'android',
          device: { id: ANDROID_DEVICE.id },
          agent: { mode: 'required', launchTimeout: 10_000, commandTimeout: 2_000 }
        }));
        await session.getTree();
        await session.close();

        const instrument = adb.calls().filter((call) => call.includes(' instrument ')).at(-1) ?? '';
        const token = /-e asturToken (\S+)/.exec(instrument)?.[1];
        expect(token, instrument).toMatch(/^[A-Za-z0-9_-]{32,}$/);
        tokens.push(token!);
      }

      expect(tokens[0]).not.toBe(tokens[1]);
      expect(server.requests.length).toBeGreaterThan(0);
      for (const request of server.requests) {
        expect([`Bearer ${tokens[0]}`, `Bearer ${tokens[1]}`]).toContain(request.authorization);
      }
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDriver(adbPath = '__missing_adb__') {
  const driver = createAndroidDriver({
    adbPath,
    emulatorPath: '__missing_emulator__'
  });

  vi.spyOn(driver, 'listDevices').mockResolvedValue([ANDROID_DEVICE]);

  return driver;
}

async function createAgentServer(
  responder: (request: AgentRequest) => AgentResponse | Promise<AgentResponse>
): Promise<AgentServer> {
  const requests: AgentRequest[] = [];

  const server = createServer(async (request, response) => {
    try {
      const envelope = {
        ...await readCommandEnvelope(request),
        authorization: request.headers.authorization
      };
      requests.push(envelope);
      const result = await responder(envelope);
      writeJson(response, result.status ?? 200, result.body ?? ok(envelope.id, undefined));
    } catch (error) {
      writeJson(response, 500, {
        id: 'unknown',
        ok: false,
        error: {
          code: 'SERVER_ERROR',
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address.');
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

async function readCommandEnvelope(request: IncomingMessage): Promise<AgentRequest> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString('utf8');
  const parsed = JSON.parse(body) as NativeAgentCommandEnvelope;

  return {
    id: parsed.id,
    method: parsed.method,
    params: parsed.params
  };
}

function ok(id: string, result: unknown) {
  return {
    id,
    ok: true,
    result
  };
}

function writeJson(response: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}
