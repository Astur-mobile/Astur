import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIosDriver } from '@astur/ios';
import {
  AsturError,
  normalizeCapabilities,
  type DeviceInfo,
  type MobileElementSnapshot,
  type NativeAgentCommandEnvelope,
  type NativeAgentInfo
} from '@astur/core';

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

const IOS_DEVICE: DeviceInfo = {
  id: 'SIM-1',
  name: 'iPhone 16 Pro',
  platform: 'ios',
  kind: 'simulator',
  state: 'booted'
};

const IOS_AGENT_INFO: NativeAgentInfo = {
  id: 'astur-ios-xctest',
  platform: 'ios',
  version: '0.1.0-alpha.0',
  protocolVersion: 1,
  capabilities: ['agent.ping', 'tree.get']
};

const IOS_TREE: MobileElementSnapshot = {
  type: 'application',
  enabled: true,
  visible: true,
  bounds: { x: 0, y: 0, width: 1179, height: 2556 },
  children: []
};

const IOS_ELEMENT: MobileElementSnapshot = {
  id: 'login-submit-button',
  text: 'Login',
  label: 'Login',
  type: 'XCUIElementTypeButton',
  enabled: true,
  visible: true,
  bounds: { x: 100, y: 200, width: 300, height: 64 },
  children: []
};

describe('iOS native-agent mode', () => {
  const servers: AgentServer[] = [];
  let previousIosEndpoint: string | undefined;

  beforeEach(() => {
    previousIosEndpoint = process.env.ASTUR_IOS_AGENT_ENDPOINT;
    delete process.env.ASTUR_IOS_AGENT_ENDPOINT;
  });

  afterEach(async () => {
    if (previousIosEndpoint === undefined) {
      delete process.env.ASTUR_IOS_AGENT_ENDPOINT;
    } else {
      process.env.ASTUR_IOS_AGENT_ENDPOINT = previousIosEndpoint;
    }
    vi.restoreAllMocks();
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it('fails when required mode has no endpoint', async () => {
    const driver = createDriver();

    await expect(driver.createSession(normalizeCapabilities({
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'required'
      }
    }))).rejects.toMatchObject({
      code: 'IOS_XCTEST_AGENT_ENDPOINT_REQUIRED'
    } satisfies Partial<AsturError>);
  });

  it('fails when required mode endpoint handshake cannot connect', async () => {
    const driver = createDriver();

    await expect(driver.createSession(normalizeCapabilities({
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: 'http://127.0.0.1:65534',
        launchTimeout: 50,
        commandTimeout: 50
      }
    }))).rejects.toMatchObject({
      code: 'IOS_XCTEST_AGENT_CONNECT_FAILED'
    } satisfies Partial<AsturError>);
  });

  it('falls back in auto mode when endpoint handshake cannot connect', async () => {
    const driver = createDriver();

    const session = await driver.createSession(normalizeCapabilities({
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'auto',
        endpoint: 'http://127.0.0.1:65534',
        launchTimeout: 50,
        commandTimeout: 50
      }
    }));

    await expect(session.getTree()).rejects.toMatchObject({
      code: 'XCTEST_AGENT_REQUIRED'
    } satisfies Partial<AsturError>);
  });

  it('does not contact endpoint when mode is off', async () => {
    const server = await createAgentServer((request) => ({
      body: ok(request.id, IOS_AGENT_INFO)
    }));
    servers.push(server);

    const driver = createDriver();
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'off',
        endpoint: server.endpoint
      }
    }));

    expect(server.requests).toHaveLength(0);
    await expect(session.getTree()).rejects.toMatchObject({
      code: 'XCTEST_AGENT_REQUIRED'
    } satisfies Partial<AsturError>);
  });

  it('routes tree.get through endpoint when required mode handshake succeeds', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, IOS_AGENT_INFO)
        };
      }

      if (request.method === 'tree.get') {
        return {
          body: ok(request.id, IOS_TREE)
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
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.getTree()).resolves.toEqual(IOS_TREE);
    expect(server.requests.map((request) => request.method)).toEqual(['agent.ping', 'tree.get']);
  });

  it('propagates the Astur session timeout into native element commands', async () => {
    const agentInfo: NativeAgentInfo = {
      ...IOS_AGENT_INFO,
      capabilities: ['agent.ping', 'element.wait', 'element.tap']
    };
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, agentInfo)
        };
      }

      if (request.method === 'element.wait') {
        return {
          body: ok(request.id, IOS_ELEMENT)
        };
      }

      if (request.method === 'element.tap') {
        return {
          body: ok(request.id, undefined)
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
      platform: 'ios',
      timeout: 23_000,
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));
    const selector = { strategy: 'id' as const, value: 'login-submit-button' };

    await expect(session.waitForElement(selector, { state: 'visible' })).resolves.toEqual(IOS_ELEMENT);
    await expect(session.tapElement?.(selector)).resolves.toBeUndefined();

    expect(server.requests.find((request) => request.method === 'element.wait')?.params).toMatchObject({
      selector,
      options: {
        timeout: 23_000,
        state: 'visible'
      }
    });
    expect(server.requests.find((request) => request.method === 'element.tap')?.params).toMatchObject({
      selector,
      options: {
        timeout: 23_000
      }
    });
  });

  it('wraps command failures in required mode', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, IOS_AGENT_INFO)
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
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.getTree()).rejects.toMatchObject({
      code: 'IOS_XCTEST_AGENT_COMMAND_FAILED'
    } satisfies Partial<AsturError>);
  });

  it('fails fast in required mode when command is not advertised by agent capabilities', async () => {
    const pingOnlyInfo: NativeAgentInfo = {
      ...IOS_AGENT_INFO,
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
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'required',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.getTree()).rejects.toMatchObject({
      code: 'IOS_XCTEST_AGENT_COMMAND_UNSUPPORTED'
    } satisfies Partial<AsturError>);

    expect(server.requests.filter((request) => request.method === 'tree.get')).toHaveLength(0);
  });

  it('marks unsupported command after first failure in auto mode and falls back to XCTest required error', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, IOS_AGENT_INFO)
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
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'auto',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.getTree()).rejects.toMatchObject({
      code: 'XCTEST_AGENT_REQUIRED'
    } satisfies Partial<AsturError>);

    await expect(session.getTree()).rejects.toMatchObject({
      code: 'XCTEST_AGENT_REQUIRED'
    } satisfies Partial<AsturError>);

    expect(server.requests.filter((request) => request.method === 'tree.get')).toHaveLength(1);
  });

  it('keeps endpoint enabled for command-level failures in auto mode', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, IOS_AGENT_INFO)
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
      platform: 'ios',
      device: {
        id: IOS_DEVICE.id
      },
      agent: {
        mode: 'auto',
        endpoint: server.endpoint,
        launchTimeout: 500,
        commandTimeout: 500
      }
    }));

    await expect(session.getTree()).rejects.toMatchObject({
      code: 'XCTEST_AGENT_REQUIRED'
    } satisfies Partial<AsturError>);

    await expect(session.getTree()).rejects.toMatchObject({
      code: 'XCTEST_AGENT_REQUIRED'
    } satisfies Partial<AsturError>);

    expect(server.requests.filter((request) => request.method === 'tree.get')).toHaveLength(2);
  });
});

function createDriver() {
  const driver = createIosDriver({
    xcrunPath: '__missing_xcrun__',
    xcodebuildPath: '__missing_xcodebuild__'
  });

  vi.spyOn(driver, 'listDevices').mockResolvedValue([IOS_DEVICE]);

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
