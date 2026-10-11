import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import {
  AsturError,
  type NativeAgentClient
} from '@astur-mobile/core';
import type {
  NativeAgentCommandParams,
  NativeAgentCommandResponse,
  NativeAgentInfo,
  NativeAgentMethod
} from '@astur-mobile/protocol';

/**
 * The host side of the iOS agent's reverse bridge. The XCUITest runner cannot
 * accept connections on a real device, so it dials out: it registers, then
 * long-polls GET /command and POSTs each result to /response.
 *
 * For a real device the bridge listens on an address the phone can reach,
 * which means anyone else on that network can reach it too: register a fake
 * agent, take the commands, or answer them with forged results. Every request
 * must therefore carry this session's token, which the host hands the agent
 * alongside the bridge URL.
 */

interface BridgeCommand {
  id: string;
  protocolVersion: string;
  command: NativeAgentMethod;
  method: NativeAgentMethod;
  deadlineMs: number;
  payload?: unknown;
  params?: unknown;
}

interface BridgeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

interface CommandPoll {
  response: ServerResponse;
  timer: NodeJS.Timeout;
  onClose(): void;
}

export class IosAgentBridge {
  readonly endpoint: string;
  readonly agentEndpoint: string;
  /** Passed to the agent as ASTUR_IOS_AGENT_BRIDGE_TOKEN; required on every request. */
  readonly token = randomBytes(32).toString('base64url');
  private readonly expectedAuthorization = Buffer.from(`Bearer ${this.token}`);
  private readonly traceEnabled = process.env.ASTUR_IOS_AGENT_TRACE === '1';
  private readonly queue: BridgeCommand[] = [];
  private readonly commandPolls: CommandPoll[] = [];
  private readonly pending = new Map<string, {
    method: NativeAgentMethod;
    resolve(value: unknown): void;
    reject(error: unknown): void;
    timer?: NodeJS.Timeout;
  }>();
  private readonly registrationWaiters: Array<{
    resolve(info: NativeAgentInfo): void;
    reject(error: unknown): void;
    timer: NodeJS.Timeout;
  }> = [];
  private registration?: NativeAgentInfo;

  private constructor(
    private readonly server: HttpServer,
    private readonly commandTimeout: number,
    private readonly port: number,
    advertisedHost: string
  ) {
    this.endpoint = `http://127.0.0.1:${port}`;
    this.agentEndpoint = `http://${formatHostForUrl(advertisedHost)}:${port}`;
  }

  static async start(
    port: number,
    commandTimeout: number,
    options: { bindHost?: string; advertisedHost?: string } = {}
  ): Promise<IosAgentBridge> {
    let bridge!: IosAgentBridge;
    const server = createHttpServer((request, response) => {
      void bridge.handle(request, response);
    });
    const bindHost = options.bindHost ?? '127.0.0.1';
    const advertisedHost = options.advertisedHost ?? bindHost;
    bridge = new IosAgentBridge(server, commandTimeout, port, advertisedHost);

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, bindHost, () => {
        server.off('error', reject);
        resolve();
      });
    });

    return bridge;
  }

  createClient(info: NativeAgentInfo): NativeAgentClient {
    return {
      endpoint: this.endpoint,
      platform: 'ios',
      info,
      commandTimeout: this.commandTimeout,
      command: async <M extends NativeAgentMethod>(
        method: M,
        params?: NativeAgentCommandParams<M>
      ): Promise<NativeAgentCommandResponse<M>> => {
        return this.command(method, params) as Promise<NativeAgentCommandResponse<M>>;
      }
    };
  }

  waitForRegistration(timeoutMs: number): Promise<NativeAgentInfo> {
    if (this.registration) {
      return Promise.resolve(this.registration);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AsturError(
          'IOS_XCTEST_AGENT_CONNECT_FAILED',
          `Timed out waiting for iOS XCUITest agent registration at ${this.endpoint}.`,
          { endpoint: this.endpoint, timeout: timeoutMs }
        ));
      }, timeoutMs);

      this.registrationWaiters.push({ resolve, reject, timer });
    });
  }

  async close(): Promise<void> {
    for (const pending of this.pending.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new AsturError(
        'AGENT_DISCONNECTED',
        'iOS XCUITest bridge closed before the command completed.',
        { endpoint: this.endpoint, method: pending.method }
      ));
    }
    this.pending.clear();

    for (const poll of this.commandPolls.splice(0)) {
      clearTimeout(poll.timer);
      poll.response.off('close', poll.onClose);
      if (!poll.response.writableEnded) {
        poll.response.statusCode = 204;
        poll.response.end();
      }
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private command<M extends NativeAgentMethod>(
    method: M,
    params?: NativeAgentCommandParams<M>
  ): Promise<NativeAgentCommandResponse<M>> {
    const id = randomUUID();
    const command: BridgeCommand = {
      id,
      protocolVersion: '1.0',
      command: method,
      method,
      deadlineMs: Date.now() + this.commandTimeout,
      payload: params,
      params
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.queue.push(command);
      this.trace('queue', method, id);
      this.flushCommandPoll();
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.isAuthorized(request.headers.authorization)) {
        writeJson(response, 401, {
          ok: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing or invalid iOS bridge token.' }
        });
        return;
      }

      if (request.method === 'POST' && request.url === '/register') {
        await this.handleRegister(request, response);
        return;
      }

      if (request.method === 'GET' && request.url === '/command') {
        this.handleCommandPoll(response);
        return;
      }

      if (request.method === 'POST' && request.url === '/response') {
        await this.handleCommandResponse(request, response);
        return;
      }

      writeJson(response, 404, {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: `Unknown iOS bridge route: ${request.method ?? 'GET'} ${request.url ?? '/'}`
        }
      });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: {
          code: 'BRIDGE_ERROR',
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private isAuthorized(authorization: string | undefined): boolean {
    const presented = Buffer.from(authorization ?? '');
    return presented.length === this.expectedAuthorization.length
      && timingSafeEqual(presented, this.expectedAuthorization);
  }

  private async handleRegister(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request) as { result?: NativeAgentInfo; data?: NativeAgentInfo };
    const info = body.result ?? body.data;
    if (!info || info.platform !== 'ios') {
      writeJson(response, 400, {
        ok: false,
        error: {
          code: 'INVALID_REGISTRATION',
          message: 'iOS bridge registration must include iOS native-agent info.'
        }
      });
      return;
    }

    this.registration = info;
    for (const waiter of this.registrationWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve(info);
    }

    writeJson(response, 200, { ok: true });
  }

  private handleCommandPoll(response: ServerResponse): void {
    const command = this.queue.shift();
    if (command) {
      this.deliverCommand(response, command);
      return;
    }

    const longPollMs = 30_000;
    const timer = setTimeout(() => {
      cleanup();
      response.statusCode = 204;
      response.end();
    }, longPollMs);

    let poll: CommandPoll;
    const cleanup = (): void => {
      clearTimeout(timer);
      response.off('close', onClose);
      const index = this.commandPolls.indexOf(poll);
      if (index !== -1) {
        this.commandPolls.splice(index, 1);
      }
    };

    const onClose = (): void => {
      cleanup();
    };

    poll = {
      response,
      timer,
      onClose
    };
    response.on('close', onClose);
    this.commandPolls.push(poll);
  }

  private flushCommandPoll(): void {
    while (this.queue.length > 0 && this.commandPolls.length > 0) {
      const poll = this.commandPolls.shift();
      const command = this.queue.shift();
      if (!poll || !command) {
        return;
      }

      clearTimeout(poll.timer);
      poll.response.off('close', poll.onClose);
      if (!poll.response.writableEnded) {
        this.deliverCommand(poll.response, command);
      }
    }
  }

  private deliverCommand(response: ServerResponse, command: BridgeCommand): void {
    this.startCommandTimer(command);
    this.trace('deliver', command.method, command.id);
    writeJson(response, 200, command);
  }

  private startCommandTimer(command: BridgeCommand): void {
    const pending = this.pending.get(command.id);
    if (!pending || pending.timer) {
      return;
    }

    pending.timer = setTimeout(() => {
      this.pending.delete(command.id);
      this.trace('timeout', command.method, command.id);
      pending.reject(new AsturError(
        'AGENT_COMMAND_TIMEOUT',
        `iOS XCUITest agent command ${command.method} timed out.`,
        { endpoint: this.endpoint, method: command.method, timeout: this.commandTimeout }
      ));
    }, this.commandTimeout);
  }

  private async handleCommandResponse(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request) as BridgeResponse;
    const pending = this.pending.get(body.id);
    if (!pending) {
      this.trace('orphan-response', undefined, body.id);
      writeJson(response, 200, { ok: true });
      return;
    }

    this.pending.delete(body.id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this.trace(body.ok ? 'response-ok' : 'response-error', pending.method, body.id);

    if (body.ok) {
      pending.resolve(body.result ?? body.data);
    } else {
      pending.reject(new AsturError(
        body.error?.code ?? 'AGENT_COMMAND_FAILED',
        body.error?.message ?? `iOS XCUITest agent command ${pending.method} failed.`,
        {
          endpoint: this.endpoint,
          method: pending.method,
          error: body.error
        }
      ));
    }

    writeJson(response, 200, { ok: true });
  }

  private trace(event: string, method: NativeAgentMethod | string | undefined, id: string): void {
    if (!this.traceEnabled) {
      return;
    }

    console.log(`[astur/ios-agent] ${event} ${method ?? 'unknown'} ${id}`);
  }
}

/** Results carry whole trees and screenshots, so this is generous; it only stops abuse. */
const MAX_BRIDGE_BODY_BYTES = 64 * 1024 * 1024;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BRIDGE_BODY_BYTES) {
      throw new Error('iOS bridge request body is too large.');
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

export function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

