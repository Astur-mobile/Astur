import { randomUUID } from 'node:crypto';
import type {
  NativeAgentCommandEnvelope,
  NativeAgentCommandParams,
  NativeAgentCommandResponse,
  NativeAgentCommandResult,
  NativeAgentInfo,
  NativeAgentMethod,
  PlatformName
} from '@astur-mobile/protocol';
import { AsturError } from './errors.js';

export interface NativeAgentClient {
  readonly endpoint: string;
  readonly platform: PlatformName;
  readonly info: NativeAgentInfo;
  readonly commandTimeout: number;
  command<M extends NativeAgentMethod>(
    method: M,
    params?: NativeAgentCommandParams<M>
  ): Promise<NativeAgentCommandResponse<M>>;
}

export interface NativeAgentClientOptions {
  endpoint: string;
  platform: PlatformName;
  /**
   * Legacy timeout that applies to both handshake and commands when specific values are omitted.
   */
  timeout?: number;
  commandTimeout?: number;
  handshakeTimeout?: number;
  fetchImpl?: typeof fetch;
}

interface PendingNativeAgentClient {
  readonly endpoint: string;
  readonly platform: PlatformName;
  readonly commandTimeout: number;
  command<M extends NativeAgentMethod>(
    method: M,
    params?: NativeAgentCommandParams<M>
  ): Promise<NativeAgentCommandResponse<M>>;
}

export async function connectNativeAgentClient(options: NativeAgentClientOptions): Promise<NativeAgentClient> {
  const client = createNativeAgentClient(options);
  const commandTimeout = options.commandTimeout ?? options.timeout ?? 10_000;
  const handshakeTimeout = options.handshakeTimeout ?? options.timeout ?? commandTimeout;
  const handshakeClient = handshakeTimeout === commandTimeout
    ? client
    : createNativeAgentClient({
      ...options,
      commandTimeout: handshakeTimeout
    });
  const info = await handshakeClient.command('agent.ping');

  if (info.platform !== options.platform) {
    throw new AsturError(
      'AGENT_PLATFORM_MISMATCH',
      `Native agent at ${client.endpoint} reported platform ${info.platform}, expected ${options.platform}.`,
      {
        endpoint: client.endpoint,
        expectedPlatform: options.platform,
        reportedPlatform: info.platform,
        info
      }
    );
  }

  return {
    ...client,
    info
  };
}

export function normalizeNativeAgentEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new AsturError('AGENT_ENDPOINT_INVALID', 'Native agent endpoint must not be empty.');
  }

  const candidate = trimmed.startsWith('tcp:')
    ? `http://${trimmed.slice('tcp:'.length)}`
    : /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AsturError('AGENT_ENDPOINT_INVALID', `Invalid native agent endpoint: ${endpoint}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AsturError(
      'AGENT_ENDPOINT_UNSUPPORTED_PROTOCOL',
      `Native agent endpoint must use http or https, got ${parsed.protocol}`,
      { endpoint }
    );
  }

  return parsed.toString();
}

function createNativeAgentClient(options: NativeAgentClientOptions): PendingNativeAgentClient {
  const endpoint = normalizeNativeAgentEndpoint(options.endpoint);
  const timeout = options.commandTimeout ?? options.timeout ?? 10_000;
  const fetchImpl = options.fetchImpl ?? getGlobalFetch();

  if (!fetchImpl) {
    throw new AsturError(
      'AGENT_FETCH_UNAVAILABLE',
      'Global fetch is not available in this Node runtime. Provide NativeAgentClientOptions.fetchImpl.'
    );
  }

  return {
    endpoint,
    platform: options.platform,
    commandTimeout: timeout,
    command: async <M extends NativeAgentMethod>(
      method: M,
      params?: NativeAgentCommandParams<M>
    ): Promise<NativeAgentCommandResponse<M>> => {
      return sendNativeAgentCommand(fetchImpl, endpoint, timeout, method, params);
    }
  };
}

async function sendNativeAgentCommand<M extends NativeAgentMethod>(
  fetchImpl: typeof fetch,
  endpoint: string,
  timeout: number,
  method: M,
  params?: NativeAgentCommandParams<M>
): Promise<NativeAgentCommandResponse<M>> {
  const id = randomUUID();
  const envelope: NativeAgentCommandEnvelope<NativeAgentCommandParams<M>> = {
    id,
    protocolVersion: '1.0',
    command: method,
    deadlineMs: Date.now() + timeout,
    payload: params,
    method,
    params
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;

  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(envelope),
      signal: controller.signal
    });
  } catch (error) {
    throw new AsturError(
      'AGENT_TRANSPORT_FAILED',
      `Native agent command ${method} failed to reach ${endpoint}.`,
      {
        endpoint,
        method,
        timeout,
        cause: stringifyUnknownError(error)
      }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new AsturError(
      'AGENT_TRANSPORT_FAILED',
      `Native agent command ${method} failed with HTTP ${response.status}.`,
      {
        endpoint,
        method,
        status: response.status,
        statusText: response.statusText
      }
    );
  }

  let payload: NativeAgentCommandResult<NativeAgentCommandResponse<M>>;
  try {
    payload = await response.json() as NativeAgentCommandResult<NativeAgentCommandResponse<M>>;
  } catch (error) {
    throw new AsturError(
      'AGENT_RESPONSE_INVALID',
      `Native agent command ${method} returned invalid JSON.`,
      {
        endpoint,
        method,
        cause: stringifyUnknownError(error)
      }
    );
  }

  if (!payload || payload.id !== id) {
    throw new AsturError(
      'AGENT_RESPONSE_MISMATCH',
      `Native agent command ${method} returned a mismatched command id.`,
      {
        endpoint,
        method,
        expectedId: id,
        receivedId: payload?.id
      }
    );
  }

  if (!payload.ok) {
    throw new AsturError(
      payload.error?.code ?? 'AGENT_COMMAND_FAILED',
      payload.error?.message ?? `Native agent command ${method} failed.`,
      {
        endpoint,
        method,
        error: payload.error,
        diagnostics: payload.diagnostics,
        timing: payload.timing
      }
    );
  }

  return (payload.result ?? payload.data) as NativeAgentCommandResponse<M>;
}

function getGlobalFetch(): typeof fetch | undefined {
  return (globalThis as { fetch?: typeof fetch }).fetch;
}

function stringifyUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
