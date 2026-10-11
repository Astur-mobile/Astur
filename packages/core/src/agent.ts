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
  /** Per-session secret the agent requires, sent as a bearer credential. */
  token?: string;
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
      return sendNativeAgentCommand(fetchImpl, endpoint, timeout, options.token, method, params);
    }
  };
}

async function sendNativeAgentCommand<M extends NativeAgentMethod>(
  fetchImpl: typeof fetch,
  endpoint: string,
  timeout: number,
  token: string | undefined,
  method: M,
  params?: NativeAgentCommandParams<M>
): Promise<NativeAgentCommandResponse<M>> {
  const id = randomUUID();
  const envelope: NativeAgentCommandEnvelope<NativeAgentCommandParams<M>> = {
    id,
    protocolVersion: '1.0',
    command: method,
    deadlineMs: Date.now() + timeout,
    budgetMs: timeout,
    payload: params,
    method,
    params
  };

  // One deadline covers the whole exchange: sending, the headers, and reading
  // the body. Clearing the timer once headers arrived used to leave the body
  // read unbounded, so a response trickling in after the timeout still counted.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AsturError(
        'AGENT_COMMAND_TIMEOUT',
        `Native agent command ${method} got no complete response within ${timeout} ms.`,
        { endpoint, method, timeout }
      ));
      controller.abort();
    }, timeout);
  });
  // The deadline is always raced; this only keeps a rejection that lands
  // between two races from being reported as unhandled.
  deadline.catch(() => undefined);

  let payload: NativeAgentCommandResult<NativeAgentCommandResponse<M>>;
  try {
    payload = await Promise.race([
      exchangeNativeAgentCommand<M>(fetchImpl, endpoint, token, method, envelope, controller.signal, deadline),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
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
        executed: payload.executed,
        error: payload.error,
        diagnostics: payload.diagnostics,
        timing: payload.timing
      }
    );
  }

  return (payload.result ?? payload.data) as NativeAgentCommandResponse<M>;
}

async function exchangeNativeAgentCommand<M extends NativeAgentMethod>(
  fetchImpl: typeof fetch,
  endpoint: string,
  token: string | undefined,
  method: M,
  envelope: NativeAgentCommandEnvelope<NativeAgentCommandParams<M>>,
  signal: AbortSignal,
  deadline: Promise<never>
): Promise<NativeAgentCommandResult<NativeAgentCommandResponse<M>>> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(envelope),
      signal
    });
  } catch (error) {
    if (signal.aborted) {
      return deadline;
    }

    throw new AsturError(
      'AGENT_TRANSPORT_FAILED',
      `Native agent command ${method} failed to reach ${endpoint}.`,
      {
        endpoint,
        method,
        cause: stringifyUnknownError(error)
      }
    );
  }

  if (response.status >= 400 && response.status < 500) {
    const refusal = await readRefusal(response);
    if (refusal) {
      throw refusal;
    }
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

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    if (signal.aborted) {
      return deadline;
    }

    throw new AsturError(
      'AGENT_TRANSPORT_FAILED',
      `Native agent command ${method} lost its response from ${endpoint}.`,
      {
        endpoint,
        method,
        cause: stringifyUnknownError(error)
      }
    );
  }

  try {
    return JSON.parse(body) as NativeAgentCommandResult<NativeAgentCommandResponse<M>>;
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
}

/**
 * A 4xx that carries the agent's own error envelope is the agent refusing the
 * request before running it (bad token, malformed body), so it is reported
 * under the agent's code instead of as a transport failure of unknown outcome.
 * A 5xx never is: the command may have been partway through.
 */
async function readRefusal(response: Response): Promise<AsturError | undefined> {
  try {
    const body = JSON.parse(await response.text()) as NativeAgentCommandResult;
    if (body?.ok === false && body.executed === false && body.error?.code) {
      return new AsturError(body.error.code, body.error.message, {
        status: response.status,
        executed: false
      });
    }
  } catch {
    // Not an agent envelope; fall through to the generic transport failure.
  }

  return undefined;
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
