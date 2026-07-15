import { afterEach, describe, expect, it, vi } from 'vitest';
import { __testing, main } from '@astur-mobile/cli';
import type { DeviceInfo } from '@astur-mobile/protocol';

describe('CLI platform-aware output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports iOS as skipped when the host platform is not macOS', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await main(['devices', '--ios']);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    }

    expect(log.mock.calls.flat().join('\n')).toContain('Local iOS automation requires macOS with Xcode.');
  });

  it('prints concrete next steps for missing doctor prerequisites', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    __testing.printChecks([
      {
        id: 'android.devices',
        label: 'Android devices',
        status: 'warn',
        message: 'No Android devices detected.',
        fix: 'Start an emulator or connect a device with USB debugging enabled.'
      },
      {
        id: 'ios.xctest-agent',
        label: 'XCUITest agent',
        status: 'warn',
        message: 'Native iOS element automation requires the Swift XCUITest agent.',
        fix: 'Build agents/ios-xctest-agent and configure signing for real devices.'
      }
    ]);

    const output = log.mock.calls.flat().join('\n');

    expect(output).toContain('next steps');
    expect(output).toContain('Android devices: Start an emulator or connect a device with USB debugging enabled.');
    expect(output).toContain('XCUITest agent: Build agents/ios-xctest-agent and configure signing for real devices.');
  });

  it('generates a default Android emulator scaffold', () => {
    const files = __testing.buildInitFiles(__testing.defaultInitAnswers());
    const config = files.find((file) => file.path === 'playwright.config.ts')?.contents;
    const test = files.find((file) => file.path === 'specs/example.test.ts')?.contents;

    expect(config).toContain("name: 'android-emulator'");
    expect(config).toContain("platform: 'android'");
    expect(config).toContain("avd: 'Pixel_9_API_35'");
    expect(config).toContain("path: './apps/demo.apk'");
    expect(config).toContain("reporter: [");
    expect(config).toContain("video: 'off'");
    expect(config).toContain("trace: 'off'");
    expect(config).not.toContain('automation:');
    expect(config).not.toContain('agent:');
    expect(test).toContain("device.app.launch()");

    const setup = files.find((file) => file.path === 'ASTUR_SETUP.md')?.contents;
    expect(setup).toContain('## Parallel Testing');
    expect(setup).toContain('Astur reserves each configured device per Playwright worker');
    expect(setup).toContain('## Flutter Apps');
    expect(setup).toContain('Dart VM service');
    expect(setup).toContain('ASTUR_FLUTTER_PROJECT');
  });

  it('can scaffold both platforms as separate Playwright projects', () => {
    const files = __testing.buildInitFiles({
      ...__testing.defaultInitAnswers(),
      platforms: ['android', 'ios'],
      ios: {
        target: 'simulator',
        simulatorName: 'iPhone 16 Pro',
        app: {
          source: 'path',
          path: './apps/Demo.app',
          bundleId: 'com.example.demo'
        }
      }
    });
    const config = files.find((file) => file.path === 'playwright.config.ts')?.contents;

    expect(config).toContain("name: 'android-emulator'");
    expect(config).toContain("name: 'ios-simulator'");
    expect(config).toContain("platform: 'ios'");
    expect(config).toContain("bundleId: 'com.example.demo'");
  });

  it('omits device kind when a concrete device id or simulator name is enough', () => {
    const files = __testing.buildInitFiles({
      ...__testing.defaultInitAnswers(),
      platforms: ['android', 'ios'],
      android: {
        target: 'real',
        deviceId: 'R5CT123456A',
        app: {
          source: 'installed',
          packageName: 'com.example.android'
        }
      },
      ios: {
        target: 'simulator',
        simulatorName: 'iPhone 16 Pro',
        app: {
          source: 'installed',
          bundleId: 'com.example.ios'
        }
      }
    });
    const config = files.find((file) => file.path === 'playwright.config.ts')?.contents;

    expect(config).toContain("device: { id: 'R5CT123456A' }");
    expect(config).toContain("name: 'iPhone 16 Pro'");
    expect(config).not.toContain("device: { kind: 'real', id: 'R5CT123456A' }");
    expect(config).not.toContain("kind: 'simulator'");
  });

  it('parses codegen options for platform, device, and app selection', () => {
    expect(__testing.parseCodegenArgs([
      '--platform',
      'android',
      '--device',
      'emulator-5554',
      '--app',
      './apps/demo.apk',
      '--app-id',
      'com.example.demo',
      '--json'
    ])).toEqual({
      help: false,
      json: true,
      ui: false,
      launch: true,
      platform: 'android',
      deviceId: 'emulator-5554',
      appPath: './apps/demo.apk',
      appId: 'com.example.demo'
    });

    expect(__testing.parseCodegenArgs(['--android', '--no-ui']).ui).toBe(false);
    expect(__testing.parseCodegenArgs(['--ios', '--no-launch']).launch).toBe(false);
    expect(__testing.parseCodegenArgs(['--simulator'])).toMatchObject({
      platform: 'ios',
      deviceKind: 'simulator'
    });
    expect(__testing.parseCodegenArgs(['--emulator'])).toMatchObject({
      platform: 'android',
      deviceKind: 'emulator'
    });
  });

  it('selects ready devices for codegen bootstrap', () => {
    const devices: DeviceInfo[] = [
      {
        id: 'offline-device',
        name: 'Offline',
        platform: 'android',
        kind: 'real',
        state: 'offline'
      },
      {
        id: 'emulator-5554',
        name: 'Pixel 7',
        platform: 'android',
        kind: 'emulator',
        state: 'online'
      },
      {
        id: 'real-ios-device',
        name: 'iPhone',
        platform: 'ios',
        kind: 'real',
        state: 'online'
      },
      {
        id: 'sim-1',
        name: 'iPhone 16 Pro',
        platform: 'ios',
        kind: 'simulator',
        state: 'booted'
      }
    ];

    expect(__testing.selectCodegenDevice(devices)?.id).toBe('emulator-5554');
    expect(__testing.selectCodegenDevice(devices, 'sim-1')?.id).toBe('sim-1');
    expect(__testing.selectCodegenDevice(devices, undefined, 'simulator')?.id).toBe('sim-1');
    expect(__testing.selectCodegenDevice(devices, undefined, 'real')?.id).toBe('real-ios-device');
    expect(__testing.selectCodegenDevice(devices, 'offline-device')).toBeUndefined();
    expect(__testing.selectCodegenDevice([
      devices[2],
      {
        id: 'sim-shutdown',
        name: 'iPhone 17 Pro',
        platform: 'ios',
        kind: 'simulator',
        state: 'shutdown'
      }
    ], undefined, 'simulator')?.id).toBe('sim-shutdown');
  });

  it('lets core apply platform-aware automation defaults for codegen sessions', () => {
    const config = __testing.buildCodegenConfig({
      id: 'emulator-5554',
      name: 'Pixel 7',
      platform: 'android',
      kind: 'emulator',
      state: 'online'
    }, {
      help: false,
      json: false,
      ui: true,
      launch: true,
      platform: 'android',
      deviceId: 'emulator-5554'
    });

    expect(config.automation).toBeUndefined();
    expect(config.device).toEqual({ id: 'emulator-5554' });
  });

  it('defaults iOS codegen to the Astur demo bundle when no app id is provided', () => {
    const config = __testing.buildCodegenConfig({
      id: 'sim-1',
      name: 'iPhone 16',
      platform: 'ios',
      kind: 'simulator',
      state: 'booted'
    }, {
      help: false,
      json: false,
      ui: true,
      launch: true,
      platform: 'ios',
      deviceId: 'sim-1'
    });

    expect(config.app).toEqual({ bundleId: 'com.astur.demo', path: undefined });
    expect(config.automation).toBeUndefined();
  });

  it('describes iOS real-device codegen preparation before the Inspector is ready', () => {
    const config = __testing.buildCodegenConfig({
      id: 'real-ios-device',
      name: 'iPhone',
      platform: 'ios',
      kind: 'real',
      state: 'online'
    }, {
      help: false,
      json: false,
      ui: true,
      launch: true,
      platform: 'ios',
      deviceId: 'real-ios-device'
    });

    const details = __testing.codegenPreparationDetails({
      id: 'real-ios-device',
      name: 'iPhone',
      platform: 'ios',
      kind: 'real',
      state: 'online'
    }, config);

    expect(details.title).toBe('iOS real device');
    expect(details.notes.join('\n')).toContain('First real-device runs can take a few minutes');
    expect(details.notes.join('\n')).toContain('The mirror becomes usable after the first screen frame');
  });

  it('generates matcher-aware assertions in recorded code output', () => {
    const code = __testing.inspectorServer.generateTestCode([
      {
        index: 0,
        action: 'expect',
        locator: "getByText('Save')",
        assertion: 'containsText',
        value: 'Saved'
      },
      {
        index: 1,
        action: 'expect',
        locator: "getByLabel('Username')",
        assertion: 'value',
        value: 'amr'
      },
      {
        index: 2,
        action: 'expect',
        locator: "getByRole('button', { name: 'Continue' })",
        assertion: 'visible'
      }
    ], 'typescript');

    expect(code).toContain("await expect(device.getByText('Save')).toContainText(\"Saved\");");
    expect(code).toContain("await expect(device.getByLabel('Username')).toHaveValue(\"amr\");");
    expect(code).toContain("await expect(device.getByRole('button', { name: 'Continue' })).toBeVisible();");
  });

  it('normalizes recorded locators before generating test code', () => {
    const code = __testing.inspectorServer.generateTestCode([
      {
        index: 0,
        action: 'tap',
        locator: "device.getByTestId('login-submit-button')"
      }
    ], 'typescript');

    expect(code).toContain("await device.getByTestId('login-submit-button').tap();");
    expect(code).not.toContain('device.device.');
  });

  it('generates coordinate and scroll gestures recorded from the inspector mirror', () => {
    const code = __testing.inspectorServer.generateTestCode([
      {
        index: 0,
        action: 'tapPoint',
        locator: '',
        point: { x: 120, y: 240 }
      },
      {
        index: 1,
        action: 'swipe',
        locator: '',
        gesture: {
          start: { x: 250, y: 900 },
          end: { x: 250, y: 300 },
          durationMs: 350
        }
      }
    ], 'typescript');

    expect(code).toContain('await device.tap({"x":120,"y":240});');
    expect(code).toContain('await device.swipe({"start":{"x":250,"y":900},"end":{"x":250,"y":300},"durationMs":350});');
  });

  it('prefers actionable parents over decorative icon leaves for live inspector clicks', () => {
    const nodes = [
      {
        uid: '0',
        depth: 0,
        title: 'root',
        type: 'android.root',
        visible: true,
        enabled: true,
        bounds: { x: 0, y: 0, width: 300, height: 600 }
      },
      {
        uid: '0.0',
        parentUid: '0',
        depth: 1,
        title: 'Login',
        type: 'android.widget.Button',
        id: 'login-submit-button',
        label: 'Login',
        visible: true,
        enabled: true,
        bounds: { x: 20, y: 200, width: 180, height: 56 }
      },
      {
        uid: '0.0.0',
        parentUid: '0.0',
        depth: 2,
        title: '&#986000;',
        type: 'android.widget.TextView',
        text: '&#986000;',
        visible: true,
        enabled: true,
        bounds: { x: 36, y: 212, width: 22, height: 22 }
      }
    ];

    const hit = __testing.inspectorServer.findUiNodeAtPoint(nodes, { x: 42, y: 218 }, {
      preferActionable: true
    });
    if (!hit) {
      throw new Error('Expected inspector hit target.');
    }

    const suggestions = __testing.inspectorServer.suggestLocatorsForNode(hit, nodes);

    expect(hit.uid).toBe('0.0');
    expect(suggestions[0].code).toBe("getByTestId('login-submit-button')");
    expect(suggestions[0].code).not.toMatch(/^device\./);
  });

  it('exposes cross-platform and Android-only inspector device actions appropriately', () => {
    expect(__testing.inspectorServer.getInspectorDeviceActionDefinitions({
      platform: 'android',
      kind: 'emulator'
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'refresh', label: 'Refresh Screen' }),
      expect.objectContaining({ id: 'tree.refresh', label: 'Refresh UI Tree' }),
      expect.objectContaining({ id: 'orientation.portrait' }),
      expect.objectContaining({ id: 'orientation.landscape' }),
      expect.objectContaining({ id: 'keyboard.dismiss' }),
      expect.objectContaining({ id: 'device.lock' }),
      expect.objectContaining({ id: 'device.unlock' }),
      expect.objectContaining({ id: 'navigation.back' }),
      expect.objectContaining({ id: 'navigation.home' }),
      expect.objectContaining({ id: 'navigation.recents' })
    ]));

    expect(__testing.inspectorServer.getInspectorDeviceActionDefinitions({
      platform: 'ios',
      kind: 'simulator'
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'refresh', label: 'Refresh Screen' }),
      expect.objectContaining({ id: 'tree.refresh', label: 'Refresh UI Tree' }),
      expect.objectContaining({ id: 'orientation.portrait' }),
      expect.objectContaining({ id: 'orientation.landscape' }),
      expect.objectContaining({ id: 'keyboard.dismiss' }),
      expect.objectContaining({ id: 'device.lock' }),
      expect.objectContaining({ id: 'device.unlock' })
    ]));
    expect(__testing.inspectorServer.getInspectorDeviceActionDefinitions({
      platform: 'ios',
      kind: 'simulator'
    }).find((action) => action.id === 'navigation.home')).toBeUndefined();

    expect(__testing.inspectorServer.getInspectorDeviceActionDefinitions({
      platform: 'ios',
      kind: 'real'
    }).find((action) => action.id === 'device.lock')).toBeUndefined();
    expect(__testing.inspectorServer.getInspectorDeviceActionDefinitions({
      platform: 'ios',
      kind: 'real'
    }).find((action) => action.id === 'navigation.back')).toBeUndefined();
  });

  it('renders non-recording direct action controls in the Inspector UI', () => {
    const html = __testing.inspectorServer.buildInspectorHtml({
      id: 'emulator-5554',
      name: 'Pixel 7',
      platform: 'android',
      kind: 'emulator',
      state: 'online'
    });

    expect(html).toContain('id="interact-mode-btn"');
    expect(html).toContain('id="element-tap-btn"');
    expect(html).toContain('id="element-fill-input"');
    expect(html).toContain("type: 'direct_action'");
  });

  it('resets native <button> chrome on .code-tab so the TypeScript/JavaScript toggle keeps contrast on hover', () => {
    // .code-tab is shared by <div> tabs (Code / Recording Steps) and real
    // <button> tabs (TypeScript / JavaScript). Without an explicit background/
    // border/appearance reset, the <button> elements fall back to the
    // browser's native (light) button chrome, and the dark-theme hover color
    // (near-white, meant for the dark panel background) becomes unreadable
    // white-on-white. Assert the reset lands on the shared rule so it covers
    // both usages.
    const html = __testing.inspectorServer.buildInspectorHtml({
      id: 'emulator-5554',
      name: 'Pixel 7',
      platform: 'android',
      kind: 'emulator',
      state: 'online'
    });

    const rule = html.match(/\.code-tab\{[^}]*\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toContain('background:transparent');
    expect(rule).toContain('appearance:none');
    expect(rule).toContain('border:none');

    expect(html).toContain('<button class="code-tab active" data-lang="typescript">TypeScript</button>');
    expect(html).toContain('<button class="code-tab" data-lang="javascript">JavaScript</button>');
  });
});
