# Roadmap

This page tracks what is still missing to reach the native-agent architecture goal:

```text
Simple Playwright-style test API
  -> Astur core
  -> Astur platform driver
  -> persistent native platform agent
  -> UiAutomator / XCUITest
```

## Implemented

- Android and iOS agents return structured timing and failure diagnostics through the shared protocol.
- Actionability failures include selector, candidate snapshot, and visible/enabled/hittable/stability state where the platform exposes it.
- Host-side `AsturError` keeps native-agent timing and diagnostics instead of dropping them at the transport boundary.
- A manual self-hosted native smoke workflow enforces required-agent paths for Android, iOS simulator, and signed real iOS hardware.

## Still Missing

- Default hosted CI cannot run real mobile hardware. Signed iOS and physical Android smoke jobs require self-hosted runners with the matching device labels.
- Deeper strict-locator reporting, including ranked candidate lists for every selector strategy, is still being expanded.
- Richer device-pool scheduling for cloud/device-farm targets is still planned.
- Real iOS Inspector/codegen needs a compact native-tree stream so broad XCTest snapshots do not block the live tree on larger screens.

## Next Best Steps (In Order)

1. Agent diagnostics and parity
- Keep Android/iOS protocol result shapes aligned and contract-tested.
- Expand candidate diagnostics for complex selectors without making normal actions pay for full-tree dumps.

2. Atomic interaction path polish
- Keep find + wait + action in one native command path on both platforms.
- Expand role and control coverage for widgets such as sliders, media pickers, and alerts.

3. Parallel execution
- Continue expanding device pools so loose selectors can distribute workers across local and remote devices automatically.
- Keep cross-platform projects isolated by device id and artifact directory.

4. Reliability and telemetry
- Surface command timing and trace metadata consistently in reports so flaky runs identify whether delay was host transport, native lookup, app rendering, or action execution.
- Add Inspector-specific timing for screenshot refresh, tree refresh, hit testing, and recording actions.

5. CI enforcement and migration
- Keep the required-agent smoke workflow green on self-hosted Android/iOS runners.
- Keep fallback paths for local development until agent suites are stable enough to make the agent path mandatory everywhere.

## End-User Experience Goal

The test API should stay simple:

```ts
await device.getByRole('button', { name: 'Sign in' }).tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

All transport, waiting, actionability, and platform complexity should remain in the runtime and native-agent layers.
