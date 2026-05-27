import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, unlink } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AppUnderTest,
  AsturAutomationConfig,
  AsturConfig,
  NativeAgentConfig,
  NormalizedAsturAutomationConfig,
  NormalizedCapabilities,
  NormalizedNativeAgentConfig
} from '@astur/protocol';
import { AsturError } from './errors.js';

export function normalizeCapabilities(config: AsturConfig): NormalizedCapabilities {
  const automation = normalizeAutomation(config.automation, config.agent);
  const agent = normalizeAgent(config.agent, automation);

  return {
    platform: config.platform,
    device: config.device ?? {},
    app: normalizeApp(config.app),
    timeout: config.timeout ?? 10_000,
    artifactsDir: config.artifactsDir ?? 'test-results/astur',
    artifacts: config.artifacts ?? {},
    keyboard: {
      dismiss: config.keyboard?.dismiss ?? 'auto'
    },
    automation,
    agent
  };
}

export async function materializeCapabilities(
  capabilities: NormalizedCapabilities
): Promise<NormalizedCapabilities> {
  if (!capabilities.app?.url || capabilities.app.path) {
    return capabilities;
  }

  const path = capabilities.app.downloadPath ?? defaultDownloadPath(capabilities.app.url, capabilities.artifactsDir);
  await mkdir(dirname(path), { recursive: true });
  await downloadApp(capabilities.app.url, path);

  return {
    ...capabilities,
    app: {
      ...capabilities.app,
      path
    }
  };
}

function normalizeApp(app: AsturConfig['app']): AppUnderTest | undefined {
  if (!app) {
    return undefined;
  }

  if (typeof app === 'string') {
    return { path: app };
  }

  return app;
}

function normalizeAutomation(
  automation: AsturAutomationConfig | undefined,
  agent: NativeAgentConfig | undefined
): NormalizedAsturAutomationConfig {
  const engine = automation?.engine ?? agentModeToEngine(agent?.mode) ?? 'agent';
  const commandTimeoutMs = automation?.commandTimeoutMs ?? agent?.commandTimeout ?? 10_000;
  const startupTimeoutMs = automation?.startupTimeoutMs ?? agent?.launchTimeout ?? 15_000;

  return {
    engine,
    transport: automation?.transport ?? agent?.transport ?? 'auto',
    legacyFallback: automation?.legacyFallback ?? agent?.legacyFallback ?? defaultLegacyFallback(engine),
    commandTimeoutMs,
    startupTimeoutMs,
    strictLocators: automation?.strictLocators ?? true,
    snapshot: {
      mode: automation?.snapshot?.mode ?? 'on-failure',
      cacheTtlMs: automation?.snapshot?.cacheTtlMs ?? 200
    },
    timings: {
      enabled: automation?.timings?.enabled ?? true,
      slowCommandThresholdMs: automation?.timings?.slowCommandThresholdMs ?? 1_000
    }
  };
}

function defaultLegacyFallback(
  engine: NormalizedAsturAutomationConfig['engine']
): NormalizedAsturAutomationConfig['legacyFallback'] {
  return engine === 'auto' ? 'on-agent-failure' : 'never';
}

function normalizeAgent(
  agent: NativeAgentConfig | undefined,
  automation: NormalizedAsturAutomationConfig
): NormalizedNativeAgentConfig {
  return {
    mode: agent?.mode ?? engineToAgentMode(automation.engine),
    install: agent?.install ?? true,
    endpoint: agent?.endpoint,
    launchTimeout: agent?.launchTimeout ?? automation.startupTimeoutMs,
    commandTimeout: agent?.commandTimeout ?? automation.commandTimeoutMs,
    legacyFallback: agent?.legacyFallback ?? automation.legacyFallback,
    transport: agent?.transport ?? automation.transport
  };
}

function agentModeToEngine(mode: NativeAgentConfig['mode'] | undefined): NormalizedAsturAutomationConfig['engine'] | undefined {
  if (mode === 'required') {
    return 'agent';
  }

  if (mode === 'off') {
    return 'legacy-adb';
  }

  if (mode === 'auto') {
    return 'auto';
  }

  return undefined;
}

function engineToAgentMode(engine: NormalizedAsturAutomationConfig['engine']): NormalizedNativeAgentConfig['mode'] {
  switch (engine) {
    case 'agent':
      return 'required';
    case 'legacy-adb':
      return 'off';
    case 'auto':
      return 'auto';
  }
}

function defaultDownloadPath(url: string, artifactsDir: string): string {
  const parsed = new URL(url);
  const fileName = basename(parsed.pathname) || `app-${Date.now()}`;
  return join(artifactsDir, 'apps', fileName);
}

async function downloadApp(url: string, path: string): Promise<void> {
  const parsed = new URL(url);

  if (parsed.protocol === 'file:') {
    await copyFile(fileURLToPath(parsed), path);
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AsturError('APP_DOWNLOAD_UNSUPPORTED_PROTOCOL', `Unsupported app download URL protocol: ${parsed.protocol}`);
  }

  await downloadHttp(url, path);
}

function downloadHttp(url: string, path: string, redirects = 0): Promise<void> {
  if (redirects > 5) {
    return Promise.reject(new AsturError('APP_DOWNLOAD_REDIRECT_LIMIT', `Too many redirects while downloading ${url}.`));
  }

  return new Promise((resolve, reject) => {
    const get = url.startsWith('https:') ? httpsGet : httpGet;
    const request = get(url, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        downloadHttp(new URL(location, url).toString(), path, redirects + 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new AsturError('APP_DOWNLOAD_FAILED', `Downloading ${url} failed with HTTP ${status}.`));
        return;
      }

      const file = createWriteStream(path);
      response.pipe(file);
      file.on('finish', () => {
        file.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      file.on('error', (error) => {
        file.close(() => undefined);
        void unlink(path).catch(() => undefined);
        reject(error);
      });
    });

    request.on('error', reject);
  });
}
