# Roadmap

This page tracks what is still missing to reach the native-agent architecture goal:

```text
Simple Playwright-style test API
  -> Astur core
  -> Astur platform driver
  -> persistent native platform agent
  -> UiAutomator / XCUITest
```

## Still Missing

- Structured agent-side actionability and failure diagnostics for strict locators.
- CI coverage that enforces native-agent paths with `agent.mode: 'required'`.
- Real-device iOS transport/signing validation.
- Automatic device reservation across parallel workers.

## Next Best Steps (In Order)

1. Agent diagnostics and parity
- Add strict locator failure details (candidate list, actionability state, and optional snapshot metadata).
- Keep Android/iOS protocol result shapes aligned and contract-tested.

2. Atomic interaction path polish
- Keep find + wait + action in one native command path on both platforms.
- Expand role and control coverage for widgets such as sliders, media pickers, and alerts.

3. Parallel execution
- Add device reservation so workers cannot accidentally target the same physical device.
- Keep cross-platform projects isolated by device id and artifact directory.

4. Reliability and telemetry
- Add command timing and trace metadata to help debug flaky runs.

5. CI enforcement and migration
- Add Android and iOS smoke suites with `agent.mode: 'required'`.
- Keep fallback paths for local development until agent suites are stable.

## End-User Experience Goal

The test API should stay simple:

```ts
await device.getByRole('button', { name: 'Sign in' }).tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

All transport, waiting, actionability, and platform complexity should remain in the runtime and native-agent layers.
