import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AsturError,
  connectNativeAgentClient,
  normalizeNativeAgentEndpoint,
  type NativeAgentCommandEnvelope,
  type NativeAgentInfo
} from '@astur/core';

interface AgentRequest {
  id: string;
  method: string;
  params?: unknown;
  protocolVersion?: string;
  command?: string;
  deadlineMs?: number;
  payload?: unknown;
}

interface AgentResponse {
  status?: number;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
}

interface AgentServer {
  endpoint: string;
  requests: AgentRequest[];
  close(): Promise<void>;
}

type ScriptedFetch = Record<string, (request: AgentRequest) => AgentResponse>;

describe('native agent client', () => {
  const servers: AgentServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it('normalizes tcp and bare host endpoints', () => {
    expect(normalizeNativeAgentEndpoint('tcp:127.0.0.1:8787')).toBe('http://127.0.0.1:8787/');
    expect(normalizeNativeAgentEndpoint('127.0.0.1:8787')).toBe('http://127.0.0.1:8787/');

    expect(() => normalizeNativeAgentEndpoint('ws://127.0.0.1:8787')).toThrowError(AsturError);
  });

  it('rejects empty native agent endpoints', () => {
    try {
      normalizeNativeAgentEndpoint('   ');
      throw new Error('expected endpoint validation error');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'AGENT_ENDPOINT_INVALID'
      } satisfies Partial<AsturError>);
    }
  });

  it('connects with agent.ping and sends typed commands', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, {
            id: 'astur-android-uiautomator',
            platform: 'android',
            version: '0.1.0-alpha.0',
            protocolVersion: 1,
            capabilities: ['agent.ping', 'tree.get']
          } satisfies NativeAgentInfo)
        };
      }

      if (request.method === 'tree.get') {
        return {
          body: ok(request.id, {
            type: 'hierarchy',
            enabled: true,
            visible: true,
            bounds: { x: 0, y: 0, width: 1080, height: 1920 },
            children: []
          })
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

    const client = await connectNativeAgentClient({
      endpoint: server.endpoint,
      platform: 'android',
      timeout: 2_000
    });

    const tree = await client.command('tree.get');

    expect(tree.type).toBe('hierarchy');
    expect(client.info.platform).toBe('android');
    expect(server.requests.map((request) => request.method)).toEqual(['agent.ping', 'tree.get']);
    expect(server.requests[1]).toMatchObject({
      protocolVersion: '1.0',
      command: 'tree.get',
      method: 'tree.get',
      deadlineMs: expect.any(Number)
    });
  });

  it('surfaces structured command errors from the native agent', async () => {
    const server = await createAgentServer((request) => {
      if (request.method === 'agent.ping') {
        return {
          body: ok(request.id, {
            id: 'astur-android-uiautomator',
            platform: 'android',
            version: '0.1.0-alpha.0',
            protocolVersion: 1,
            capabilities: ['agent.ping']
          } satisfies NativeAgentInfo)
        };
      }

      return {
        body: {
          id: request.id,
          ok: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message: `${request.method} is not implemented`
          },
          diagnostics: {
            matchingCandidates: 2,
            actionability: {
              failed: 'visible',
              visible: false,
              enabled: true
            }
          },
          timing: {
            totalMs: 42,
            agentMs: 39,
            nativeLookupMs: 20,
            hostRoundTrips: 1
          }
        }
      };
    });
    servers.push(server);

    const client = await connectNativeAgentClient({
      endpoint: server.endpoint,
      platform: 'android'
    });

    await expect(client.command('element.tap', {
      selector: {
        strategy: 'id',
        value: 'login-submit-button',
        exact: true
      },
      options: {
        timeout: 5_000,
        state: 'visible'
      }
    })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      details: {
        diagnostics: {
          matchingCandidates: 2,
          actionability: {
            failed: 'visible',
            visible: false,
            enabled: true
          }
        },
        timing: {
          totalMs: 42,
          agentMs: 39,
          nativeLookupMs: 20,
          hostRoundTrips: 1
        }
      }
    } satisfies Partial<AsturError>);
  });

  it('fails fast when endpoint agent platform does not match requested platform', async () => {
    const server = await createAgentServer((request) => ({
      body: ok(request.id, {
        id: 'astur-android-uiautomator',
        platform: 'android',
        version: '0.1.0-alpha.0',
        protocolVersion: 1,
        capabilities: ['agent.ping']
      } satisfies NativeAgentInfo)
    }));
    servers.push(server);

    await expect(connectNativeAgentClient({
      endpoint: server.endpoint,
      platform: 'ios'
    })).rejects.toMatchObject({
      code: 'AGENT_PLATFORM_MISMATCH'
    } satisfies Partial<AsturError>);
  });

  it('surfaces non-2xx responses as transport failures', async () => {
    const client = await connectNativeAgentClient({
      endpoint: 'http://127.0.0.1:8787',
      platform: 'android',
      fetchImpl: buildScriptedFetch({
        'agent.ping': (request) => ({
          body: ok(request.id, {
            id: 'astur-android-uiautomator',
            platform: 'android',
            version: '0.1.0-alpha.0',
            protocolVersion: 1,
            capabilities: ['agent.ping']
          } satisfies NativeAgentInfo)
        }),
        'tree.get': () => ({
          status: 503,
          body: {
            message: 'temporary outage'
          }
        })
      })
    });

    await expect(client.command('tree.get')).rejects.toMatchObject({
      code: 'AGENT_TRANSPORT_FAILED'
    } satisfies Partial<AsturError>);
  });

  it('surfaces invalid JSON payloads from the agent', async () => {
    const client = await connectNativeAgentClient({
      endpoint: 'http://127.0.0.1:8787',
      platform: 'android',
      fetchImpl: buildScriptedFetch({
        'agent.ping': (request) => ({
          body: ok(request.id, {
            id: 'astur-android-uiautomator',
            platform: 'android',
            version: '0.1.0-alpha.0',
            protocolVersion: 1,
            capabilities: ['agent.ping']
          } satisfies NativeAgentInfo)
        }),
        'tree.get': () => ({
          rawBody: '{not-json}',
          contentType: 'application/json'
        })
      })
    });

    await expect(client.command('tree.get')).rejects.toMatchObject({
      code: 'AGENT_RESPONSE_INVALID'
    } satisfies Partial<AsturError>);
  });

  it('surfaces mismatched command ids from the agent', async () => {
    const client = await connectNativeAgentClient({
      endpoint: 'http://127.0.0.1:8787',
      platform: 'android',
      fetchImpl: buildScriptedFetch({
        'agent.ping': (request) => ({
          body: ok(request.id, {
            id: 'astur-android-uiautomator',
            platform: 'android',
            version: '0.1.0-alpha.0',
            protocolVersion: 1,
            capabilities: ['agent.ping']
          } satisfies NativeAgentInfo)
        }),
        'tree.get': () => ({
          body: {
            id: 'different-id',
            ok: true,
            result: {
              type: 'hierarchy',
              enabled: true,
              visible: true,
              bounds: { x: 0, y: 0, width: 100, height: 100 },
              children: []
            }
          }
        })
      })
    });

    await expect(client.command('tree.get')).rejects.toMatchObject({
      code: 'AGENT_RESPONSE_MISMATCH'
    } satisfies Partial<AsturError>);
  });
});

async function createAgentServer(responder: (request: AgentRequest) => AgentResponse): Promise<AgentServer> {
  const requests: AgentRequest[] = [];

  const server = createServer(async (request, response) => {
    try {
      const envelope = await readCommandEnvelope(request);
      requests.push(envelope);
      const result = responder(envelope);
      writeResponse(response, envelope.id, result);
    } catch (error) {
      writeResponse(response, 'unknown', {
        status: 500,
        body: {
          id: 'unknown',
          ok: false,
          error: {
            code: 'SERVER_ERROR',
            message: error instanceof Error ? error.message : String(error)
          }
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

function buildScriptedFetch(script: ScriptedFetch): typeof fetch {
  return (async (_input, init) => {
    const envelope = JSON.parse(String(init?.body ?? '{}')) as AgentRequest;
    const action = script[envelope.method];
    const result = action
      ? action(envelope)
      : {
        status: 404,
        body: {
          id: envelope.id,
          ok: false,
          error: {
            code: 'UNKNOWN_COMMAND',
            message: envelope.method
          }
        }
      };

    const status = result.status ?? 200;
    const contentType = result.contentType ?? 'application/json';
    const body = result.rawBody ?? JSON.stringify(result.body ?? ok(envelope.id, undefined));

    return new Response(body, {
      status,
      headers: {
        'content-type': contentType
      }
    });
  }) as typeof fetch;
}

function ok(id: string, result: unknown) {
  return {
    id,
    ok: true,
    result
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
    params: parsed.params,
    protocolVersion: parsed.protocolVersion,
    command: parsed.command,
    deadlineMs: parsed.deadlineMs,
    payload: parsed.payload
  };
}

function writeResponse(response: ServerResponse<IncomingMessage>, id: string, result: AgentResponse): void {
  response.statusCode = result.status ?? 200;
  response.setHeader('content-type', result.contentType ?? 'application/json');
  response.end(result.rawBody ?? JSON.stringify(result.body ?? ok(id, undefined)));
}
