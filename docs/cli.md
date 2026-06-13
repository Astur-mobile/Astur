# CLI Reference

Astur is published through the `astur-mobile` package because the unscoped `astur` name is already occupied on npm. The executable is still `astur`.

From this repository:

```bash
npx astur-mobile <command>
```

After local install, npm also exposes:

```bash
npx astur <command>
```

## `doctor`

Checks host prerequisites.

```bash
npx astur-mobile doctor
npx astur-mobile doctor --verbose
```

Default output hides long command errors. Use `--verbose` for full ADB, Xcode, or simulator command output.

## `devices`

Lists Android devices, iOS simulators, and connected iOS real devices.

```bash
npx astur-mobile devices
npx astur-mobile devices --android
npx astur-mobile devices --ios
```

Use the printed `id` value as `use.astur.device.id` in `playwright.config.ts`. On Android this is the ADB serial, such as `emulator-5554` for an emulator or a USB serial for a real device. On iOS this is the simulator UDID from `simctl` or the physical device UDID from `devicectl`.

`platform` selects the Android or iOS driver. `device.kind` is only an optional filter for loose selection, for example "any emulator" or "any real Android device". When you provide a concrete `id`, you usually do not need `kind`.

Examples:

```ts
// Android emulator already running.
device: { id: 'emulator-5554' }

// Real Android device from adb devices -l.
device: { id: 'R5CT123456A' }

// iOS simulator by UDID.
device: { id: '4E2F2A1D-9B8A-4D41-8E5F-123456789ABC' }

// iOS simulator by name.
device: { name: 'iPhone 16 Pro' }

// Real iOS device by UDID.
device: { kind: 'real', id: '00008030-000548220EF0802E' }

// Loose selector: any online Android emulator.
device: { kind: 'emulator' }
```

On Linux/Windows, `--ios` prints a platform limitation message instead of failing.

## `init`

Runs a setup wizard and creates starter files:

```bash
npx astur-mobile init
```

For CI, demos, or non-interactive shells, use Android emulator defaults:

```bash
npx astur-mobile init --yes
```

The wizard asks for:

- Android, iOS, or both
- emulator, simulator, real device, or BrowserStack placeholder config
- local app path, app download URL, or already-installed package/bundle
- default mobile element timeout
- HTML/JUnit reports
- native screenshot, native video, and Playwright trace settings

Generated files:

- `playwright.config.ts`
- `tests/example.test.ts`
- `.gitignore`
- `ASTUR_SETUP.md`

Existing files are not overwritten.

BrowserStack config is scaffolded for the expected environment variables, but cloud execution is not implemented in the current beta. Local emulator, simulator, and real-device paths are runnable today.

## `test`

Runs Playwright Test:

```bash
npx astur-mobile test
npx astur-mobile test tests/login.test.ts
npx astur-mobile test --project android-pixel
```

Use `playwright.config.ts` to control native-agent mode and endpoint behavior:

- `agent.mode: 'auto'` for migration and mixed environments
- `agent.mode: 'required'` for strict CI enforcement
- `agent.mode: 'off'` to force fallback platform tooling

Platform endpoint environment variables:

- `ASTUR_ANDROID_AGENT_ENDPOINT`
- `ASTUR_IOS_AGENT_ENDPOINT`

## `codegen`

Bootstraps a runtime-backed inspector/codegen session using the same locator
engine as `@astur-mobile/core`.

```bash
npx astur-mobile codegen
npx astur-mobile codegen --android --device emulator-5554 --app ./MyApp.apk --app-id com.example.myapp
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
npx astur-mobile codegen --ios --real --device <device-udid> --app ./MyApp.ipa --app-id com.example.myapp
```

Current beta behavior:

- auto-selects an online/booted device (or uses `--device`)
- optionally installs/launches app when `--app` and/or `--app-id` are provided
- opens the live Astur Inspector UI by default
- streams screenshots and semantic UI-tree updates from the active session
- ranks locator suggestions from the cached tree for low-latency selection
- records mirror taps by executing a native coordinate tap first, then appending the best semantic locator when one is available
- records mouse-wheel scrolls over the mirror as `device.swipe(...)` steps
- lets you switch devices from the current-device chip in the header without restarting `codegen`
- exposes app and device actions under the `Controls` button
- lets you install an uploaded APK, a simulator `.app`, or a real-device `.ipa`, launch an already-installed app by package/bundle id, grant/revoke permissions, and clear app data/cache where the platform supports it
- exports TypeScript or JavaScript test code using the `@astur-mobile/test` API

The device mirror can appear a moment before the UI tree fills. Real-device screenshots, UI-tree inspection, and native actions require a healthy Astur iOS agent bound to the app bundle id. Plain `npx astur-mobile codegen --ios` defaults the bundle id to `com.astur.demo`; pass `--app-id` (or set `ASTUR_IOS_BUNDLE_ID`) for your own app. Always pass a simulator `.app` or real-device `.ipa` with `--app` on first run so Astur can install it — if you pass only `--app-id` and the app is not installed, Astur returns `IOS_APP_NOT_INSTALLED`. For real devices, set `ASTUR_IOS_DEVELOPMENT_TEAM` so Xcode can sign the bundled XCUITest runner, and make sure the macOS signing keychain is unlocked. When the tree cannot be read, the inspector shows the platform error in the header status area instead of silently rendering an empty tree.

Flags:

- `--android` or `--ios`
- `--platform android|ios`
- `--device <id>`
- `--app <path>`
- `--app-id <package-or-bundle-id>`
- `--ui` (default)
- `--no-ui`
- `--no-launch`
- `--json`

## `inspect`

Alias for `codegen`.
