# iOS XCUITest Agent

iOS native UI automation must run through XCTest/XCUITest. The iOS agent is
Astur's Swift device-side automation bridge. It is not an AI agent and it is not
an Appium/WebDriver server.

The public test API should match Android:

```ts
await device.getById('login-submit-button').tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

The runtime path is:

```text
Astur locator/action API
  -> @astur-mobile/core session element methods
  -> @astur-mobile/ios agent transport
  -> Swift XCUITest agent
  -> XCUIApplication / XCUIElement
```

This directory is the code that makes iOS inspection and native interaction possible. The host-side `@astur-mobile/ios` package can install, launch, and screenshot simulator apps through Xcode tools, but only this XCTest runner can read the iOS accessibility tree and perform native element actions inside Apple's supported automation boundary.

Current command surface:

- `agent.ping`
- `device.setOrientation`
- `tree.get`
- `element.find`
- `element.findAll`
- `element.findMany`
- `element.wait`
- `element.tap`
- `element.doubleTap`
- `element.longPress`
- `element.fill`
- `element.drag`
- `gesture.tap`
- `gesture.doubleTap`
- `gesture.longPress`
- `gesture.swipe`
- `gesture.drag`
- `keyboard.state`
- `keyboard.dismiss`

Current implementation status:

- Swift XCUITest command dispatcher is implemented in `AsturAgent.swift`
- host-side iOS driver can connect to a provided endpoint or bootstrap the bundled simulator agent
- reverse HTTP bridge mode is available for simulator execution
- the bundled simulator agent is started once per Astur worker session, and Xcode DerivedData is reused per simulator id to avoid rebuilding into a fresh temp directory on every run
- native lookup, wait, tap, double tap, long press, fill, drag, swipe, and keyboard commands run in XCUITest
- fill replaces existing text inside the agent, using bounded delete input so React Native text fields do not leak state between specs
- orientation changes run through `XCUIDevice.shared.orientation`
- lifecycle, install, launch, screenshots, and video remain host-side through Xcode tools

Implementation rules:

- Use XCTest/XCUITest selectors and expectations for native UI control.
- Do wait, lookup, actionability checks, and the final action inside the agent.
- Return compact JSON snapshots for diagnostics and assertions.
- Keep simulator lifecycle in the host driver; keep native element control here.
- Preserve the public TypeScript API; complexity belongs in this layer.

Astur avoids Appium and WebDriver, but it cannot bypass Apple's XCTest
requirement for native iOS UI control.

Current platform limits:

- real-device execution still needs signing, provisioning, trusted-device handling, and real-device transport validation
- system alerts are limited to what XCTest exposes through stable queries
- direct per-app data/cache clearing is not available through `simctl`; use uninstall/reinstall reset for simulator clean state
