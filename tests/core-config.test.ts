import { describe, expect, it } from 'vitest';
import { normalizeCapabilities } from '@astur-mobile/core';

describe('normalizeCapabilities', () => {
  it('fills stable defaults', () => {
    expect(normalizeCapabilities({ platform: 'android' })).toEqual({
      platform: 'android',
      device: {},
      app: undefined,
      timeout: 10_000,
      artifactsDir: 'test-results/astur',
      artifacts: {},
      keyboard: {
        dismiss: 'auto'
      },
      automation: defaultAndroidAutomation(),
      agent: defaultAndroidAgent()
    });
  });

  it('normalizes string app paths into app descriptors', () => {
    expect(normalizeCapabilities({
      platform: 'ios',
      device: { name: 'iPhone 16 Pro' },
      app: './Demo.app',
      timeout: 5_000,
      artifactsDir: 'artifacts',
      artifacts: {
        screenshot: 'only-on-failure'
      }
    })).toEqual({
      platform: 'ios',
      device: { name: 'iPhone 16 Pro' },
      app: { path: './Demo.app' },
      timeout: 5_000,
      artifactsDir: 'artifacts',
      artifacts: {
        screenshot: 'only-on-failure'
      },
      keyboard: {
        dismiss: 'auto'
      },
      automation: defaultIosAutomation(),
      agent: defaultIosAgent()
    });
  });

  it('preserves structured app descriptors', () => {
    const app = { path: './demo.apk', packageName: 'dev.astur.demo', activity: '.MainActivity' };

    expect(normalizeCapabilities({ platform: 'android', app }).app).toBe(app);
  });

  it('allows preserving the soft keyboard when tests need direct keyboard control', () => {
    expect(normalizeCapabilities({
      platform: 'android',
      keyboard: {
        dismiss: 'preserve'
      }
    }).keyboard).toEqual({
      dismiss: 'preserve'
    });
  });

  it('normalizes automation options and keeps native agent compatibility', () => {
    const capabilities = normalizeCapabilities({
      platform: 'android',
      automation: {
        engine: 'agent',
        transport: 'http',
        legacyFallback: 'never',
        commandTimeoutMs: 2_000,
        startupTimeoutMs: 3_000,
        strictLocators: false,
        snapshot: {
          mode: 'debug',
          cacheTtlMs: 50
        },
        timings: {
          enabled: false,
          slowCommandThresholdMs: 250
        }
      },
      agent: {
        install: false,
        endpoint: 'tcp:127.0.0.1:8787'
      }
    });

    expect(capabilities.automation).toEqual({
      engine: 'agent',
      transport: 'http',
      legacyFallback: 'never',
      commandTimeoutMs: 2_000,
      startupTimeoutMs: 3_000,
      strictLocators: false,
      snapshot: {
        mode: 'debug',
        cacheTtlMs: 50
      },
      timings: {
        enabled: false,
        slowCommandThresholdMs: 250
      }
    });
    expect(capabilities.agent).toEqual({
      mode: 'required',
      install: false,
      endpoint: 'tcp:127.0.0.1:8787',
      launchTimeout: 3_000,
      commandTimeout: 2_000,
      legacyFallback: 'never',
      transport: 'http'
    });
  });

  it('keeps fallback opt-in through the auto engine', () => {
    const capabilities = normalizeCapabilities({
      platform: 'android',
      automation: {
        engine: 'auto'
      }
    });

    expect(capabilities.automation.legacyFallback).toBe('on-agent-failure');
    expect(capabilities.agent.mode).toBe('auto');
    expect(capabilities.agent.legacyFallback).toBe('on-agent-failure');
  });

  it('normalizes legacy native agent options as an alias', () => {
    expect(normalizeCapabilities({
      platform: 'android',
      agent: {
        mode: 'required',
        install: false,
        endpoint: 'tcp:127.0.0.1:8787',
        launchTimeout: 3_000,
        commandTimeout: 2_000,
        legacyFallback: 'never',
        transport: 'http'
      }
    }).agent).toEqual({
      mode: 'required',
      install: false,
      endpoint: 'tcp:127.0.0.1:8787',
      launchTimeout: 3_000,
      commandTimeout: 2_000,
      legacyFallback: 'never',
      transport: 'http'
    });
  });

  it('preserves remote app descriptors for runtime download', () => {
    expect(normalizeCapabilities({
      platform: 'android',
      app: {
        url: 'https://example.com/demo.apk',
        packageName: 'dev.astur.demo',
        activity: '.MainActivity'
      }
    }).app).toEqual({
      url: 'https://example.com/demo.apk',
      packageName: 'dev.astur.demo',
      activity: '.MainActivity'
    });
  });
});

function defaultAndroidAutomation() {
  return {
    engine: 'agent',
    transport: 'auto',
    legacyFallback: 'never',
    commandTimeoutMs: 20_000,
    startupTimeoutMs: 30_000,
    strictLocators: true,
    snapshot: {
      mode: 'on-failure',
      cacheTtlMs: 200
    },
    timings: {
      enabled: true,
      slowCommandThresholdMs: 1_000
    }
  };
}

function defaultAndroidAgent() {
  return {
    mode: 'required',
    install: true,
    endpoint: undefined,
    launchTimeout: 30_000,
    commandTimeout: 20_000,
    legacyFallback: 'never',
    transport: 'auto'
  };
}

function defaultIosAutomation() {
  return {
    engine: 'agent',
    transport: 'auto',
    legacyFallback: 'never',
    commandTimeoutMs: 30_000,
    startupTimeoutMs: 60_000,
    strictLocators: true,
    snapshot: {
      mode: 'on-failure',
      cacheTtlMs: 200
    },
    timings: {
      enabled: true,
      slowCommandThresholdMs: 1_000
    }
  };
}

function defaultIosAgent() {
  return {
    mode: 'required',
    install: true,
    endpoint: undefined,
    launchTimeout: 60_000,
    commandTimeout: 30_000,
    legacyFallback: 'never',
    transport: 'auto'
  };
}
