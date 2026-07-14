import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndroidDriver } from '@astur-mobile/android';
import {
  AsturError,
  normalizeCapabilities,
  type DeviceInfo,
  type MobileElementSnapshot,
  type NativeAgentCommandEnvelope,
  type NativeAgentInfo
} from '@astur-mobile/core';

interface AgentRequest {
  id: string;
  method: string;
  params?: unknown;
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
});

function createDriver() {
  const driver = createAndroidDriver({
    adbPath: '__missing_adb__',
    emulatorPath: '__missing_emulator__'
  });

  vi.spyOn(driver, 'listDevices').mockResolvedValue([ANDROID_DEVICE]);

  return driver;
}

async function createAgentServer(responder: (request: AgentRequest) => AgentResponse): Promise<AgentServer> {
  const requests: AgentRequest[] = [];

  const server = createServer(async (request, response) => {
    try {
      const envelope = await readCommandEnvelope(request);
      requests.push(envelope);
      const result = responder(envelope);
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
