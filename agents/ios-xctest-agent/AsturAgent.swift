import CoreGraphics
import Foundation
import ObjectiveC
import UIKit
import XCTest

struct AsturCommand {
    let id: String
    let method: String
    let params: [String: Any]
}

struct AsturCommandResult {
    let id: String
    let ok: Bool
    let result: Any?
    let error: AsturCommandError?
}

struct AsturCommandError {
    let code: String
    let message: String
    let details: Any?
}

private struct AsturSelector {
    let strategy: String
    let value: String
    let exact: Bool
    let name: Any?
    /// Present only when strategy == "native": the raw NSPredicate format
    /// string from by.native({ ios, android }) (see @astur-mobile/core).
    let nativeIos: String?
    let nativeInstance: Int?

    func toDictionary() -> [String: Any] {
        var result: [String: Any] = [
            "strategy": strategy,
            "value": value,
            "exact": exact
        ]
        if let name {
            result["name"] = name
        }
        return result
    }
}

private struct AsturWaitOptions {
    let timeoutMs: Int
    let intervalMs: Int
    let state: String
}

private struct AsturActionability {
    let visible: Bool
    let enabled: Bool
    let stable: Bool
    let hittable: Bool
}

private struct AsturElementActionOptions {
    let wait: AsturWaitOptions
    let actionability: AsturActionability
    let keyboard: String?
    let intervalMs: Int?
    let durationMs: Int?
    let clear: Bool?
    let textInputMode: String?
}

private struct TextInputProfile {
    let secure: Bool
    let currentValue: String?
    let empty: Bool
}

private struct AsturPoint {
    let x: Int
    let y: Int

    func toDictionary() -> [String: Int] {
        [
            "x": x,
            "y": y
        ]
    }
}

private struct AsturElementDragTarget {
    let point: AsturPoint?
    let selector: AsturSelector?
}

private struct AsturSwipeGesture {
    let start: AsturPoint
    let end: AsturPoint
    let durationMs: Int
}

private struct AsturDragGesture {
    let start: AsturPoint
    let end: AsturPoint
    let durationMs: Int
}

private struct AsturBounds {
    let x: Int
    let y: Int
    let width: Int
    let height: Int

    func toDictionary() -> [String: Int] {
        [
            "x": x,
            "y": y,
            "width": width,
            "height": height
        ]
    }
}

private struct AsturElementSnapshot {
    let id: String?
    let text: String?
    let label: String?
    let value: String?
    let type: String
    let enabled: Bool
    let visible: Bool
    let selected: Bool?
    let focused: Bool?
    let bounds: AsturBounds
    let children: [AsturElementSnapshot]

    func toDictionary() -> [String: Any] {
        var result: [String: Any] = [
            "type": type,
            "enabled": enabled,
            "visible": visible,
            "bounds": bounds.toDictionary(),
            "children": children.map { $0.toDictionary() },
            "platform": "ios"
        ]

        if let id {
            result["id"] = id
        }
        if let text {
            result["text"] = text
        }
        if let label {
            result["label"] = label
        }
        if let value {
            result["value"] = value
        }
        if let selected {
            result["selected"] = selected
        }
        if let focused {
            result["focused"] = focused
        }

        return result
    }
}

final class AsturAgent {
    private let app: XCUIApplication

    init(bundleIdentifier: String) {
        self.app = XCUIApplication(bundleIdentifier: bundleIdentifier)
        AsturAgent.disableQuiescenceWaitingOnce()
    }

    /// Before every query/snapshot AND before/after every synthesized event, XCUITest
    /// waits for the app to become "idle" (quiescent). A Flutter screen mid-transition
    /// never reports idle (it renders continuously), so that wait blocks until XCUITest's
    /// internal idle timeout (~60s) — a single read or tap never returns and, because the
    /// agent processes one command at a time, the whole session looks frozen. Native
    /// UIKit / React Native go idle quickly after a transition, which is why they stay
    /// smooth; Flutter does not.
    ///
    /// The original disable patched the legacy selector
    /// `waitForQuiescenceIncludingAnimationsIdle:` which current Xcode renamed (now
    /// `…:isPreEvent:`, plus a `…:usingActivity:isPreEvent:` variant the read path uses,
    /// and the accessibility client's `waitForQuiescenceOnAllForegroundApplicationsAsPreEvent:`),
    /// so it silently no-opped and quiescence stayed fully active.
    ///
    /// Strategy: for READS (`isPreEvent == false`) return immediately — reads never need
    /// the app to be idle. For EVENTS (`isPreEvent == true`) we cannot skip the wait
    /// (taps/typing/keyboard-dismiss break without a settle) but we must not block on a
    /// never-idle Flutter screen, so we cap it with a short bounded settle instead of the
    /// original unbounded wait. Best-effort: only patches selectors that exist, runs
    /// once, and can be disabled with ASTUR_IOS_WAIT_FOR_QUIESCENCE=1.
    private static let didDisableQuiescence: Bool = {
        if ProcessInfo.processInfo.environment["ASTUR_IOS_WAIT_FOR_QUIESCENCE"] == "1" {
            return false
        }

        // Cap for the bounded pre-event wait (see `boundedWaitForQuiescent`). Long enough
        // that a real settle (keyboard animation, screen transition) completes; short
        // enough that a never-idle Flutter screen can't stall the agent. Overridable.
        let eventSettleCapMicros: UInt32 = {
            if let raw = ProcessInfo.processInfo.environment["ASTUR_IOS_EVENT_SETTLE_CAP_MS"],
               let ms = UInt32(raw) {
                return ms * 1_000
            }
            return 500_000
        }()

        var patched = 0

        if let processClass = NSClassFromString("XCUIApplicationProcess") {
            // -(BOOL)waitForQuiescenceIncludingAnimationsIdle:(BOOL)isPreEvent:(BOOL)
            let twoArg = NSSelectorFromString("waitForQuiescenceIncludingAnimationsIdle:isPreEvent:")
            if let method = class_getInstanceMethod(processClass, twoArg) {
                let replacement: @convention(block) (AnyObject, Bool, Bool) -> Bool = { object, _, isPreEvent in
                    if isPreEvent {
                        AsturAgent.boundedWaitForQuiescent(object, capMicros: eventSettleCapMicros)
                    }
                    return true
                }
                method_setImplementation(method, imp_implementationWithBlock(replacement))
                patched += 1
            }

            // -(BOOL)waitForQuiescenceIncludingAnimationsIdle:(BOOL)usingActivity:(id)isPreEvent:(BOOL)
            let threeArg = NSSelectorFromString("waitForQuiescenceIncludingAnimationsIdle:usingActivity:isPreEvent:")
            if let method = class_getInstanceMethod(processClass, threeArg) {
                let replacement: @convention(block) (AnyObject, Bool, AnyObject?, Bool) -> Bool = { object, _, _, isPreEvent in
                    if isPreEvent {
                        AsturAgent.boundedWaitForQuiescent(object, capMicros: eventSettleCapMicros)
                    }
                    return true
                }
                method_setImplementation(method, imp_implementationWithBlock(replacement))
                patched += 1
            }

            // Legacy single-arg fallback (older Xcode): no isPreEvent flag — treat as a
            // read and skip (older Xcode + UIKit settle was fast anyway).
            if patched == 0 {
                let legacy = NSSelectorFromString("waitForQuiescenceIncludingAnimationsIdle:")
                if let method = class_getInstanceMethod(processClass, legacy) {
                    let replacement: @convention(block) (AnyObject, Bool) -> Bool = { _, _ in true }
                    method_setImplementation(method, imp_implementationWithBlock(replacement))
                    patched += 1
                }
            }
        }

        // Element reads resolve through the accessibility client, which waits for *all*
        // foreground apps to quiesce before returning a snapshot — the dominant read-side
        // stall. Skip for reads. The AX client exposes no idle state of its own, so its
        // rare pre-event case gets a brief fixed settle.
        if let axClass = NSClassFromString("XCAXClient_iOS") {
            let selector = NSSelectorFromString("waitForQuiescenceOnAllForegroundApplicationsAsPreEvent:")
            if let method = class_getInstanceMethod(axClass, selector) {
                let replacement: @convention(block) (AnyObject, Bool) -> Bool = { _, isPreEvent in
                    if isPreEvent {
                        usleep(300_000)
                    }
                    return true
                }
                method_setImplementation(method, imp_implementationWithBlock(replacement))
                patched += 1
            }
        }

        return patched > 0
    }()

    /// Bounded replacement for XCUITest's unbounded pre-event quiescence wait: returns
    /// the instant the app process reports `isQuiescent` (a settled screen clears in a
    /// few ms) or when `capMicros` elapses, so a never-idle Flutter transition cannot
    /// stall the agent. KVC-based, so it degrades to a plain capped wait if the property
    /// is unavailable.
    private static func boundedWaitForQuiescent(_ object: AnyObject, capMicros: UInt32) {
        let stepMicros: UInt32 = 25_000
        var elapsed: UInt32 = 0
        let probe = object as? NSObject
        while elapsed < capMicros {
            if let quiescent = probe?.value(forKey: "isQuiescent") as? Bool, quiescent {
                return
            }
            usleep(stepMicros)
            elapsed &+= stepMicros
        }
    }

    private static func disableQuiescenceWaitingOnce() {
        _ = didDisableQuiescence
    }

    func launchIfNeeded() {
        if app.state == .runningForeground {
            return
        }

        if app.state == .notRunning {
            app.launch()
        } else {
            app.activate()
        }

        // Poll at 50ms intervals instead of blocking for a fixed 8s.
        // Return as soon as the app reaches foreground (typically <1s).
        let deadline = Date().addingTimeInterval(5)
        while app.state != .runningForeground && Date() < deadline {
            usleep(50_000)
        }
    }

    func terminateIfRunning() {
        if app.state == .notRunning {
            return
        }

        app.terminate()
        let deadline = Date().addingTimeInterval(3)
        while app.state != .notRunning && Date() < deadline {
            usleep(50_000)
        }
    }

    private func setOrientation(_ value: String) throws {
        switch value {
        case "portrait":
            XCUIDevice.shared.orientation = .portrait
        case "portrait-upside-down":
            XCUIDevice.shared.orientation = .portraitUpsideDown
        case "landscape", "landscape-left":
            XCUIDevice.shared.orientation = .landscapeLeft
        case "landscape-right":
            XCUIDevice.shared.orientation = .landscapeRight
        default:
            throw AsturAgentFailure(
                code: "UNSUPPORTED_ORIENTATION",
                message: "Unsupported iOS orientation: \(value)"
            )
        }

        // Brief settle time for orientation animation; 150ms is sufficient
        // on modern devices (was 500ms).
        usleep(150_000)
    }

    private func inspectorScreenshotBase64() -> String {
        return XCUIScreen.main.screenshot().pngRepresentation.base64EncodedString()
    }

    func dispatch(_ command: AsturCommand) -> AsturCommandResult {
        do {
            switch command.method {
            case "agent.ping":
                return ok(command.id, agentInfo())

            case "app.launch":
                launchIfNeeded()
                return ok(command.id)

            case "app.terminate":
                terminateIfRunning()
                return ok(command.id)

            case "device.screenshot":
                launchIfNeeded()
                return ok(command.id, [
                    "base64": inspectorScreenshotBase64()
                ])

            case "device.viewport":
                launchIfNeeded()
                return ok(command.id, bounds(app.frame).toDictionary())

            case "device.setOrientation":
                let orientation = try command.params.requiredString("orientation")
                try setOrientation(orientation)
                return ok(command.id)

            case "tree.get":
                launchIfNeeded()
                return ok(command.id, getTree().toDictionary())

            case "element.find":
                let selector = try parseSelectorFromParams(command.params)
                return ok(command.id, findElement(selector)?.toDictionary())

            case "element.findAll":
                let selector = try parseSelectorFromParams(command.params)
                return ok(command.id, findElements(selector).map { $0.toDictionary() })

            case "element.findMany":
                let selectors = try parseSelectorsFromParams(command.params)
                return ok(command.id, findManyElements(selectors).map { $0.toDictionary() })

            case "element.wait":
                let selector = try parseSelectorFromParams(command.params)
                let options = try parseWaitOptions(command.params.mapValue("options"))
                return ok(command.id, try waitForElement(selector, options: options)?.toDictionary())

            case "element.tap":
                let selector = try parseSelectorFromParams(command.params)
                let options = try parseElementActionOptions(command.params.mapValue("options"))
                boundedTap(try resolveElement(selector, options: options))
                return ok(command.id)

            case "element.doubleTap":
                let selector = try parseSelectorFromParams(command.params)
                let options = try parseElementActionOptions(command.params.mapValue("options"))
                try doubleTap(resolveElement(selector, options: options), intervalMs: options.intervalMs)
                return ok(command.id)

            case "element.longPress":
                let selector = try parseSelectorFromParams(command.params)
                let options = try parseElementActionOptions(command.params.mapValue("options"))
                let duration = Double(options.durationMs ?? defaultLongPressMs) / 1_000
                try resolveElement(selector, options: options).press(forDuration: duration)
                return ok(command.id)

            case "element.fill":
                let selector = try parseSelectorFromParams(command.params)
                let value = try command.params.requiredString("value")
                let options = try parseElementActionOptions(command.params.mapValue("options"))
                try fillElement(selector, value: value, options: options, clear: options.clear ?? true)
                return ok(command.id)

            case "element.drag":
                let selector = try parseSelectorFromParams(command.params)
                let target = try parseElementDragTarget(command.params)
                let options = try parseElementActionOptions(command.params.mapValue("options"))
                try dragElement(selector, target: target, options: options)
                return ok(command.id)

            case "gesture.tap":
                try coordinate(try parsePointFromParams(command.params, "target")).tap()
                return ok(command.id)

            case "gesture.doubleTap":
                let intervalMs = try command.params.mapValue("options")?.intValue("intervalMs")
                try doubleTap(coordinate(try parsePointFromParams(command.params, "target")), intervalMs: intervalMs)
                return ok(command.id)

            case "gesture.longPress":
                let target = try parsePointFromParams(command.params, "target")
                let options = command.params.mapValue("options")
                let duration = Double(try options?.intValue("durationMs") ?? defaultLongPressMs) / 1_000
                try coordinate(target).press(forDuration: duration)
                return ok(command.id)

            case "gesture.swipe":
                try drag(try parseSwipeGesture(command.params))
                return ok(command.id)

            case "gesture.drag":
                try drag(try parseDragGesture(command.params))
                return ok(command.id)

            case "keyboard.state":
                return ok(command.id, keyboardState())

            case "keyboard.dismiss":
                dismissKeyboard()
                return ok(command.id)

            default:
                return error(command.id, "UNKNOWN_COMMAND", "Unknown Astur agent command: \(command.method)")
            }
        } catch let failure as AsturAgentFailure {
            return error(command.id, failure.code, failure.message, failure.details)
        } catch {
            return self.error(
                command.id,
                "INTERNAL_ERROR",
                "Unhandled iOS XCUITest agent failure.",
                ["cause": String(describing: error)]
            )
        }
    }

    private func agentInfo() -> [String: Any] {
        [
            "id": "astur-ios-xctest",
            "platform": "ios",
            "version": "0.1.0-alpha.0",
            "protocolVersion": 1,
            "capabilities": supportedCapabilities
        ]
    }

    private func getTree() -> AsturElementSnapshot {
        let appFrame = app.frame

        // Primary path: a single full-hierarchy snapshot. XCUIElement.snapshot()
        // returns the entire descendant tree in one IPC round trip, so every
        // on-screen element (buttons, labels, containers, nested controls) is
        // captured — not just a few identified controls. This is fast because it
        // is one bridged call, unlike per-element `boundBy:` enumeration which is
        // what historically timed out on real devices.
        if let snapshotTree = try? buildSnapshotTree(viewport: appFrame) {
            return snapshotTree
        }

        // Fallback: bounded typed-candidate collection. Only used when XCUITest
        // cannot produce a full hierarchy snapshot for the current app/screen.
        let children = treeCandidateSnapshots(viewport: appFrame)
            .sorted(by: treeSnapshotPrecedes)

        return AsturElementSnapshot(
            id: app.identifier.nonEmpty,
            text: app.label.nonEmpty,
            label: app.label.nonEmpty,
            value: nil,
            type: elementTypeName(app.elementType),
            enabled: true,
            visible: !appFrame.isEmpty,
            selected: nil,
            focused: nil,
            bounds: bounds(appFrame),
            children: children
        )
    }

    private func buildSnapshotTree(viewport: CGRect) throws -> AsturElementSnapshot {
        let root = try app.snapshot()
        var budget = maxFullTreeNodes
        return convertSnapshot(root, viewport: viewport, budget: &budget, depth: 0)
    }

    private func convertSnapshot(
        _ snapshot: XCUIElementSnapshot,
        viewport: CGRect,
        budget: inout Int,
        depth: Int
    ) -> AsturElementSnapshot {
        let frame = snapshot.frame
        let label = snapshot.label.nonEmpty
        let value = stringValue(snapshot.value)?.nonEmpty
        let placeholder = snapshot.placeholderValue?.nonEmpty
        let visible = !frame.isEmpty && (viewport.isEmpty || frame.intersects(viewport))

        var children: [AsturElementSnapshot] = []
        // Bound recursion depth so a deeply-nested WebView DOM can't explode the
        // payload (or the converted tree's depth) on hybrid screens; the node
        // budget caps the total breadth.
        if depth < maxFullTreeDepth {
            children.reserveCapacity(snapshot.children.count)
            for child in snapshot.children {
                if budget <= 0 {
                    break
                }
                budget -= 1
                children.append(convertSnapshot(child, viewport: viewport, budget: &budget, depth: depth + 1))
            }
        }

        return AsturElementSnapshot(
            id: snapshot.identifier.nonEmpty,
            text: label ?? value ?? placeholder,
            label: label,
            value: value,
            type: elementTypeName(snapshot.elementType),
            enabled: snapshot.isEnabled,
            visible: visible,
            selected: snapshot.isSelected,
            focused: nil,
            bounds: bounds(frame),
            children: children
        )
    }

    private func findElement(_ selector: AsturSelector) -> AsturElementSnapshot? {
        guard let element = findElementObject(selector) else {
            return nil
        }

        return snapshot(element, includeChildren: false)
    }

    private func findElements(_ selector: AsturSelector) -> [AsturElementSnapshot] {
        findElementObjects(selector).map { snapshot($0, includeChildren: false) }
    }

    private func findManyElements(_ selectors: [AsturSelector]) -> [AsturElementSnapshot] {
        guard !selectors.isEmpty else {
            return []
        }

        // Native selectors are resolved separately (see findElementObjects) and
        // never fed into directManyQuery/matches() — they carry their own
        // complete predicate, not one of the shared strategies those optimise
        // for.
        let nativeSelectors = selectors.filter { $0.strategy.lowercased() == "native" }
        let otherSelectors = selectors.filter { $0.strategy.lowercased() != "native" }

        var results: [XCUIElement] = []

        if !otherSelectors.isEmpty {
            let query = directManyQuery(otherSelectors) ?? findManyCandidateQuery(otherSelectors)
            results += boundedElements(query, limit: maxFindManyResults)
                .filter { element in otherSelectors.contains { matches(element, selector: $0) } }
        }

        for selector in nativeSelectors {
            results += nativeElements(selector)
        }

        return results
            .prefix(maxFindManyResults)
            .map { snapshot($0, includeChildren: false) }
    }

    private func waitForElement(_ selector: AsturSelector, options: AsturWaitOptions) throws -> AsturElementSnapshot? {
        if options.state == "hidden" {
            try waitForHidden(selector, options: options)
            return nil
        }

        guard let element = waitForElementObject(selector, options: options) else {
            return nil
        }

        return snapshot(element, includeChildren: false)
    }

    private func fillElement(
        _ selector: AsturSelector,
        value: String,
        options: AsturElementActionOptions,
        clear: Bool
    ) throws {
        let element = try resolveElement(selector, options: options)
        boundedTap(element)

        let profile = textInputProfile(element)

        // Skip the slow clear+type entirely when the field already holds the
        // target value. Secure fields report a masked value, so always rewrite.
        if clear && !profile.secure, profile.currentValue == value {
            return
        }

        if value.isEmpty {
            if clear && !profile.empty {
                clearText(element)
            }
            return
        }

        let canReplaceWithPaste = clear || profile.empty
        if canReplaceWithPaste && shouldPasteText(value, profile: profile, requestedMode: options.textInputMode) {
            pasteText(value, into: element, replacing: clear && !profile.empty)
        } else {
            if clear && !profile.empty {
                clearText(element)
            }
            element.typeText(value)
        }

        // Native typeText can drop characters when the soft keyboard / QuickType
        // (Passwords) bar is still animating, leaving a truncated value (e.g. "test"
        // -> "tt"). Verify the field landed the value and retry for non-secure fields.
        // (Secure fields report a masked value, so the comparison can't be made.) The
        // value check returns immediately when correct, so a good fill pays nothing.
        if !profile.secure {
            var attempts = 0
            while attempts < 2 && !waitForTextInputValue(element, value, timeoutMs: 500) {
                attempts += 1
                clearText(element)
                element.typeText(value)
            }
        }

        // keyboard:auto policy — leave the keyboard up after typing. The next
        // action dismisses it only if its target is obstructed (see resolveElement),
        // so multi-field forms don't pay a dismiss per field. Explicit dismissal is
        // still available via the keyboard.dismiss command.
        if options.keyboard == "dismiss" {
            dismissKeyboard()
        }
    }

    private func dragElement(
        _ selector: AsturSelector,
        target: AsturElementDragTarget,
        options: AsturElementActionOptions
    ) throws {
        let source = try resolveElement(selector, options: options)
        let start = source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let destination = try resolveTargetCoordinate(target, wait: options.wait)
        let duration = Double(options.durationMs ?? defaultDragMs) / 1_000
        start.press(forDuration: duration, thenDragTo: destination)
    }

    private func drag(_ gesture: AsturSwipeGesture) throws {
        let dx = gesture.end.x - gesture.start.x
        let dy = gesture.end.y - gesture.start.y

        if abs(dy) > 120 && abs(dy) > abs(dx) * 2 {
            if dy < 0 {
                app.swipeUp()
            } else {
                app.swipeDown()
            }
            return
        }

        let start = try coordinate(gesture.start)
        let end = try coordinate(gesture.end)
        let duration = max(0.01, Double(gesture.durationMs) / 1_000)
        start.press(forDuration: duration, thenDragTo: end)
    }

    private func drag(_ gesture: AsturDragGesture) throws {
        let start = try coordinate(gesture.start)
        let end = try coordinate(gesture.end)
        let duration = max(0.01, Double(gesture.durationMs) / 1_000)
        start.press(forDuration: duration, thenDragTo: end)
    }

    private func doubleTap(_ element: XCUIElement, intervalMs: Int?) throws {
        // Prefer XCTest's native double-tap: it synthesizes both taps inside the
        // OS double-tap recognition window. Two separate element.tap() calls are
        // bracketed by app-idle waits, so the gap between touches blows past that
        // window and the app records two single taps instead. Only fall back to
        // the manual two-tap path when the caller explicitly forces an interval.
        if intervalMs == nil {
            element.doubleTap()
            return
        }

        element.tap()
        usleep(UInt32(max(30, intervalMs!) * 1_000))
        element.tap()
    }

    private func doubleTap(_ coordinate: XCUICoordinate, intervalMs: Int?) {
        if intervalMs == nil {
            coordinate.doubleTap()
            return
        }

        coordinate.tap()
        usleep(UInt32(max(30, intervalMs!) * 1_000))
        coordinate.tap()
    }

    private func keyboardState() -> [String: Any] {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else {
            return ["visible": false]
        }

        return [
            "visible": true,
            "bounds": bounds(keyboard.frame).toDictionary()
        ]
    }

    private func dismissKeyboard() {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else {
            return
        }

        // Tap a dismissal key only when it is actually hittable. `XCUIElement.tap()` has
        // an implicit "wait until hittable" that can otherwise spin for the entire command
        // timeout when the keyboard is slow to settle under host load — the dominant cause
        // of `keyboard.dismiss` hangs. Probe the first dismissal key that exists with a
        // bounded hittability wait; if it never becomes hittable, fall back to a tap above
        // the keyboard (a coordinate tap needs no hittable element, so it cannot hang).
        for title in ["Done", "Return", "Go", "Search", "Next"] {
            let button = keyboard.buttons[title]
            if button.exists {
                if waitForHittable(button, timeoutMs: 500) {
                    button.tap()
                    return
                }
                break
            }
        }

        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)).tap()
    }

    /// Polls `isHittable` up to `timeoutMs`, returning as soon as the element is hittable.
    /// Bounds XCUITest's otherwise open-ended implicit hittability wait inside `tap()`.
    private func waitForHittable(_ element: XCUIElement, timeoutMs: Int) -> Bool {
        let deadline = Date().addingTimeInterval(Double(max(0, timeoutMs)) / 1_000)
        repeat {
            if element.isHittable {
                return true
            }
            usleep(50_000)
        } while Date() < deadline
        return element.isHittable
    }

    private func resolveElement(_ selector: AsturSelector, options: AsturElementActionOptions) throws -> XCUIElement {
        guard var element = waitForElementObject(selector, options: options.wait) else {
            throw elementNotFound(selector, options: options)
        }

        // keyboard:auto policy — a prior fill may have left the soft keyboard up,
        // covering this target. Detect that by frame overlap (isHittable lies for
        // partially-covered controls, after which tap() stalls), dismiss it, and
        // re-resolve before the actionability checks so we measure the settled frame.
        if keyboardObscures(element) {
            dismissKeyboard()
            guard let refreshed = waitForElementObject(selector, options: options.wait) else {
                throw elementNotFound(selector, options: options)
            }
            element = refreshed
        }

        try ensureActionable(element, selector: selector, requirements: options.actionability)
        return element
    }

    private func elementNotFound(_ selector: AsturSelector, options: AsturElementActionOptions) -> AsturAgentFailure {
        AsturAgentFailure(
            code: "ELEMENT_NOT_FOUND",
            message: "Could not resolve element before action.",
            details: locatorFailureDetails(
                selector,
                state: options.wait.state,
                timeoutMs: options.wait.timeoutMs
            )
        )
    }

    /// True when the soft keyboard's frame overlaps the element's frame. Frame
    /// overlap is the reliable obstruction signal; `isHittable` returns true for
    /// controls only partially covered by the keyboard, and then `tap()` stalls.
    private func keyboardObscures(_ element: XCUIElement) -> Bool {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return false }
        let keyboardFrame = keyboard.frame
        guard !keyboardFrame.isEmpty else { return false }
        return element.frame.intersects(keyboardFrame)
    }

    /// Taps an element without letting XCUITest's implicit hittability wait own the
    /// whole command timeout: wait briefly for hittability, otherwise fall back to a
    /// coordinate tap at the element centre (which performs no hittability wait and
    /// so cannot spin for ~30s).
    private func boundedTap(_ element: XCUIElement, timeoutMs: Int = 700) {
        if waitForHittable(element, timeoutMs: timeoutMs) {
            element.tap()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func ensureActionable(
        _ element: XCUIElement,
        selector: AsturSelector,
        requirements: AsturActionability
    ) throws {
        if requirements.visible && !isVisible(element) {
            throw AsturAgentFailure(
                code: "ELEMENT_NOT_VISIBLE",
                message: "Element is not visible.",
                details: actionabilityFailureDetails(element, selector: selector, failed: "visible")
            )
        }

        if requirements.enabled && !element.isEnabled {
            throw AsturAgentFailure(
                code: "ELEMENT_DISABLED",
                message: "Element is disabled.",
                details: actionabilityFailureDetails(element, selector: selector, failed: "enabled")
            )
        }

        let stable = requirements.stable ? isStable(element) : nil
        if requirements.stable && stable == false {
            throw AsturAgentFailure(
                code: "ELEMENT_UNSTABLE",
                message: "Element bounds are not stable.",
                details: actionabilityFailureDetails(element, selector: selector, failed: "stable", stable: stable)
            )
        }

        if requirements.hittable && !element.isHittable {
            throw AsturAgentFailure(
                code: "ELEMENT_NOT_HITTABLE",
                message: "Element is not hittable.",
                details: actionabilityFailureDetails(element, selector: selector, failed: "hittable", stable: stable)
            )
        }
    }

    private func locatorFailureDetails(
        _ selector: AsturSelector,
        state: String,
        timeoutMs: Int
    ) -> [String: Any] {
        let candidates = findElementObjects(selector)
            .prefix(5)
            .map { snapshot($0, includeChildren: false).toDictionary() }
        let diagnostics: [String: Any] = [
            "selector": selector.toDictionary(),
            "state": state,
            "timeoutMs": timeoutMs,
            "matchingCandidates": candidates.count,
            "candidates": candidates
        ]

        return [
            "selector": selector.toDictionary(),
            "state": state,
            "timeout": timeoutMs,
            "diagnostics": diagnostics
        ]
    }

    private func actionabilityFailureDetails(
        _ element: XCUIElement,
        selector: AsturSelector,
        failed: String,
        stable: Bool? = nil
    ) -> [String: Any] {
        let candidate = snapshot(element, includeChildren: false).toDictionary()
        var actionability: [String: Any] = [
            "failed": failed,
            "visible": isVisible(element),
            "enabled": element.isEnabled,
            "hittable": element.isHittable
        ]

        if let stable {
            actionability["stable"] = stable
        }

        let diagnostics: [String: Any] = [
            "selector": selector.toDictionary(),
            "matchingCandidates": 1,
            "candidate": candidate,
            "actionability": actionability
        ]

        return [
            "selector": selector.toDictionary(),
            "candidate": candidate,
            "actionability": actionability,
            "diagnostics": diagnostics
        ]
    }

    private func waitForElementObject(_ selector: AsturSelector, options: AsturWaitOptions) -> XCUIElement? {
        // First attempt with zero delay — element may already be present.
        if let element = findElementObject(selector) {
            if options.state == "attached" {
                return element
            }
            if options.state == "visible" && isVisible(element) {
                return element
            }
        }

        let deadline = Date().addingTimeInterval(Double(max(0, options.timeoutMs)) / 1_000)
        let interval = UInt32(max(30, options.intervalMs) * 1_000)

        while Date() < deadline {
            usleep(interval)

            if let element = findElementObject(selector) {
                if options.state == "attached" {
                    return element
                }
                if options.state == "visible" && isVisible(element) {
                    return element
                }
            }
        }

        return nil
    }

    private func waitForHidden(_ selector: AsturSelector, options: AsturWaitOptions) throws {
        // Immediate check before entering the loop.
        let element = findElementObject(selector)
        if element == nil || !isVisible(element!) {
            return
        }

        let deadline = Date().addingTimeInterval(Double(max(0, options.timeoutMs)) / 1_000)
        let interval = UInt32(max(30, options.intervalMs) * 1_000)

        while Date() < deadline {
            usleep(interval)

            let el = findElementObject(selector)
            if el == nil || !isVisible(el!) {
                return
            }
        }

        throw AsturAgentFailure(
            code: "ELEMENT_NOT_HIDDEN",
            message: "Timed out waiting for element to be hidden.",
            details: locatorFailureDetails(selector, state: "hidden", timeoutMs: options.timeoutMs)
        )
    }

    private func findElementObject(_ selector: AsturSelector) -> XCUIElement? {
        // Deliberately isolated from the directQuery/matches() machinery below —
        // a native NSPredicate query is already a complete, self-contained
        // match; routing it through the generic id/text/role scan-and-filter
        // paths would risk the broad-scan fallback treating "no predicate
        // match" as "scan everything", which is wrong for this strategy.
        if selector.strategy.lowercased() == "native" {
            let matches = nativeElements(selector)
            let instance = selector.nativeInstance ?? 0
            return matches.indices.contains(instance) ? matches[instance] : nil
        }

        let query = directQuery(selector)

        if let query {
            let element = query.firstMatch
            if element.exists && matchesName(element, expected: selector.name, exact: selector.exact) {
                return element
            }

            if let alertElement = findAlertElement(selector) {
                return alertElement
            }
        }

        // Text fallback (exact or non-exact). Flutter merges descendant text into a
        // container's accessibility label on iOS, so the directQuery against
        // `staticTexts` misses text that only exists as a substring of a merged label
        // (e.g. a card labelled "ACCOUNT FLOWS\nCredentials\n…"). Resolve it with a
        // SINGLE predicate `firstMatch` over any element type — one hierarchy snapshot.
        //
        // Never enumerate `app.descendants(matching: .any)` element-by-element:
        // `boundedElements` resolves each `element(boundBy:)` as its own snapshot, so a
        // miss walks up to `maxFindAllResults` snapshots. Even with quiescence disabled
        // for reads, that is ~hundreds of snapshots per poll (tens of seconds) and, on a
        // single-threaded agent, stalls every command queued behind it. A predicate
        // `firstMatch` is one snapshot regardless of tree size.
        if selector.strategy.lowercased() == "text" {
            let predicate = NSPredicate(
                format: "label CONTAINS[cd] %@ OR value CONTAINS[cd] %@ OR placeholderValue CONTAINS[cd] %@",
                selector.value, selector.value, selector.value
            )
            let merged = app.descendants(matching: .any).matching(predicate).firstMatch
            return merged.exists ? merged : nil
        }

        // Non-text fallback: scan only the already-scoped `directQuery` results (a typed
        // or predicate-filtered query materialises just its own matches — a small set),
        // never the whole `.any` tree. Nothing to scan when there is no resolvable query
        // (xpath/coordinates) or the strategy is direct-query-only.
        guard let query, !usesDirectQueryOnly(selector) else {
            return nil
        }
        return boundedElements(query, limit: maxFindAllResults).first { matches($0, selector: selector) }
    }

    private func findAlertElement(_ selector: AsturSelector) -> XCUIElement? {
        guard selector.exact else {
            return nil
        }

        let predicate: NSPredicate?
        switch selector.strategy.lowercased() {
        case "id":
            predicate = NSPredicate(format: "identifier == %@", selector.value)
        case "accessibility", "text":
            predicate = NSPredicate(
                format: "identifier == %@ OR label == %@ OR value == %@",
                selector.value,
                selector.value,
                selector.value
            )
        default:
            predicate = nil
        }

        guard let predicate else {
            return nil
        }

        for alertHost in [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
            let element = alertHost.alerts.descendants(matching: .any).matching(predicate).firstMatch
            if element.exists {
                return element
            }
        }

        return nil
    }

    private func findElementObjects(_ selector: AsturSelector) -> [XCUIElement] {
        if selector.strategy.lowercased() == "native" {
            return nativeElements(selector)
        }

        if let query = directQuery(selector) {
            return boundedElements(query, limit: maxFindAllResults)
                .filter { matches($0, selector: selector) }
                .prefix(maxFindAllResults)
                .map { $0 }
        }

        return boundedElements(app.descendants(matching: .any), limit: maxFindAllResults)
            .filter { matches($0, selector: selector) }
            .prefix(maxFindAllResults)
            .map { $0 }
    }

    private func usesDirectQueryOnly(_ selector: AsturSelector) -> Bool {
        switch selector.strategy.lowercased() {
        case "id", "accessibility", "text":
            return selector.exact
        case "role", "type":
            return selector.name == nil || selector.name is String
        default:
            return false
        }
    }

    /// Resolves a by.native() iOS predicate. `nativeIos` is passed verbatim to
    /// `NSPredicate(format:)` — XCUITest's own declarative query grammar, the
    /// same mechanism Apple's own APIs and Appium's `-ios predicate string`
    /// strategy use — never interpreted as executable code. Kept isolated from
    /// directQuery/matches() (see the callers in findElementObject/
    /// findElementObjects) since the predicate is already a complete match on
    /// its own; nothing else needs to re-filter it.
    private func nativeElements(_ selector: AsturSelector) -> [XCUIElement] {
        guard let predicateString = selector.nativeIos, !predicateString.isEmpty else {
            return []
        }

        let query = app.descendants(matching: .any).matching(NSPredicate(format: predicateString))
        return boundedElements(query, limit: maxFindAllResults)
    }

    private func directQuery(_ selector: AsturSelector) -> XCUIElementQuery? {
        switch selector.strategy.lowercased() {
        case "id":
            if selector.exact {
                return app.descendants(matching: .any).matching(identifier: selector.value)
            }
            return app.descendants(matching: .any).matching(
                NSPredicate(format: "identifier CONTAINS[cd] %@", selector.value)
            )

        case "accessibility":
            if selector.exact {
                return app.descendants(matching: .any).matching(
                    NSPredicate(format: "identifier == %@ OR label == %@", selector.value, selector.value)
                )
            }
            return app.descendants(matching: .any).matching(
                NSPredicate(format: "identifier CONTAINS[cd] %@ OR label CONTAINS[cd] %@", selector.value, selector.value)
            )

        case "text":
            if selector.exact {
                return app.staticTexts.matching(
                    NSPredicate(format: "label == %@ OR value == %@", selector.value, selector.value)
                )
            }
            return app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[cd] %@ OR value CONTAINS[cd] %@", selector.value, selector.value)
            )

        case "role":
            guard let type = elementTypeForRole(selector.value) else {
                return nil
            }
            return app.descendants(matching: type)

        case "type":
            guard let type = elementTypeFromString(selector.value) else {
                return nil
            }
            return app.descendants(matching: type)

        case "xpath":
            return nil

        case "coordinates":
            return nil

        default:
            return nil
        }
    }

    private func findManyCandidateQuery(_ selectors: [AsturSelector]) -> XCUIElementQuery {
        if selectors.allSatisfy({ $0.strategy.lowercased() == "text" }) {
            return app.staticTexts
        }

        if selectors.allSatisfy({ $0.strategy.lowercased() == "role" && elementTypeForRole($0.value) == .button }) {
            return app.buttons
        }

        return app.descendants(matching: .any)
    }

    private func directManyQuery(_ selectors: [AsturSelector]) -> XCUIElementQuery? {
        guard !selectors.isEmpty else {
            return nil
        }

        let supportsSingleTextPredicate = selectors.allSatisfy {
            $0.strategy.lowercased() == "text" && $0.exact && $0.name == nil
        }
        guard supportsSingleTextPredicate else {
            return nil
        }

        let values = selectors.map { $0.value }
        return app.staticTexts.matching(
            NSPredicate(format: "label IN %@ OR value IN %@", values, values)
        )
    }

    private func matches(_ element: XCUIElement, selector: AsturSelector) -> Bool {
        guard element.exists else {
            return false
        }

        switch selector.strategy.lowercased() {
        case "id":
            return match(element.identifier, selector.value, exact: selector.exact)

        case "accessibility":
            return [
                element.identifier,
                element.label
            ].contains { match($0, selector.value, exact: selector.exact) }

        case "text":
            return [
                element.label,
                stringValue(element.value),
                element.placeholderValue
            ].contains { match($0, selector.value, exact: selector.exact) }

        case "role":
            return hasRole(element, role: selector.value)
                && matchesName(element, expected: selector.name, exact: selector.exact)

        case "type":
            if selector.value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "any" {
                return true
            }
            return match(elementTypeName(element.elementType), selector.value, exact: selector.exact)
                || match(shortElementTypeName(element.elementType), selector.value, exact: selector.exact)

        default:
            return false
        }
    }

    private func matchesName(_ element: XCUIElement, expected: Any?, exact: Bool) -> Bool {
        guard let expected = expected as? String else {
            return true
        }

        return [
            element.identifier,
            element.label,
            stringValue(element.value),
            element.placeholderValue
        ].contains { match($0, expected, exact: exact) }
    }

    private func hasRole(_ element: XCUIElement, role: String) -> Bool {
        guard let type = elementTypeForRole(role) else {
            return false
        }

        return element.elementType == type
    }

    private func resolveTargetCoordinate(_ target: AsturElementDragTarget, wait: AsturWaitOptions) throws -> XCUICoordinate {
        if let point = target.point {
            return try coordinate(point)
        }

        guard let selector = target.selector else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "Drag target must include either point or selector.")
        }

        guard let element = waitForElementObject(selector, options: AsturWaitOptions(
            timeoutMs: wait.timeoutMs,
            intervalMs: wait.intervalMs,
            state: "visible"
        )) else {
            throw AsturAgentFailure(
                code: "ELEMENT_NOT_FOUND",
                message: "Drag target selector did not resolve.",
                details: ["targetSelector": selector.toDictionary()]
            )
        }

        return element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    }

    private func coordinate(_ point: AsturPoint) throws -> XCUICoordinate {
        let clamped = clamp(point)
        return app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            .withOffset(CGVector(dx: clamped.x, dy: clamped.y))
    }

    private func clamp(_ point: AsturPoint) -> AsturPoint {
        let frame = app.frame
        let maxX = max(1, Int(frame.maxX.rounded(.down)) - 1)
        let maxY = max(1, Int(frame.maxY.rounded(.down)) - 1)

        return AsturPoint(
            x: min(max(0, point.x), maxX),
            y: min(max(0, point.y), maxY)
        )
    }

    private func clearText(_ element: XCUIElement) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.5)).tap()
        selectAllText(in: element)
        element.typeText(XCUIKeyboardKey.delete.rawValue)

        if isTextInputEmpty(element) {
            return
        }

        let currentLength = max(stringValue(element.value)?.count ?? 0, element.label.count)
        let deleteCount = min(120, max(32, currentLength + 24))
        element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: deleteCount))

        if !isTextInputEmpty(element) {
            selectAllText(in: element)
            element.typeText(XCUIKeyboardKey.delete.rawValue)
        }
    }

    private func pasteText(_ value: String, into element: XCUIElement, replacing: Bool) {
        let previousPasteboardItems = UIPasteboard.general.items
        UIPasteboard.general.string = value
        defer {
            UIPasteboard.general.items = previousPasteboardItems
        }

        if replacing {
            clearText(element)
        }

        element.press(forDuration: 0.5) // 500ms is the iOS minimum long-press (was 800ms)

        let paste = app.menuItems["Paste"].firstMatch
        if tapMenuItem(paste, timeoutMs: 800) {
            tapPastePermissionAlertIfPresent()
            if waitForTextInputValue(element, value, timeoutMs: 800) {
                return
            }
        }

        // Fallback to character-by-character
        if replacing {
            clearText(element)
        }
        element.typeText(value)
    }

    private func selectAllText(in element: XCUIElement) {
        element.press(forDuration: 0.5) // 500ms (was 800ms)
        let selectAll = app.menuItems["Select All"].firstMatch
        if tapMenuItem(selectAll, timeoutMs: 600) {
            usleep(60_000) // brief settle (was 120ms)
        }
    }

    private func tapMenuItem(_ element: XCUIElement, timeoutMs: Int) -> Bool {
        let timeout = Double(max(0, timeoutMs)) / 1_000
        guard element.waitForExistence(timeout: timeout) else {
            return false
        }

        boundedTap(element, timeoutMs: min(500, timeoutMs))
        return true
    }

    private func tapPastePermissionAlertIfPresent() {
        // iOS 16+ may show a paste-consent alert when test automation pastes via
        // UIPasteboard. Since the agent selected paste as an optimization, it also
        // owns clearing this prompt; otherwise a fast fill path turns into a
        // user-facing blocker in codegen and tests.
        for host in [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
            let allow = host.alerts.buttons["Allow Paste"].firstMatch
            if allow.waitForExistence(timeout: 0.4) {
                boundedTap(allow, timeoutMs: 500)
                usleep(120_000)
                return
            }
        }
    }

    private func textInputProfile(_ element: XCUIElement) -> TextInputProfile {
        let current = stringValue(element.value)
        let placeholder = element.placeholderValue
        let hasCurrentValue = current?.isEmpty == false && current != placeholder

        return TextInputProfile(
            secure: element.elementType == .secureTextField,
            currentValue: hasCurrentValue ? current : nil,
            empty: !hasCurrentValue
        )
    }

    private func shouldPasteText(_ value: String, profile: TextInputProfile, requestedMode: String?) -> Bool {
        if profile.secure {
            return false
        }

        switch requestedMode {
        case "type":
            return false
        case "paste":
            return true
        default:
            // Paste carries ~2-3s of fixed overhead (long-press, edit menu, paste-
            // consent alert, value verification) and can fall back to typing on hosts
            // (e.g. React Native) where the long-press menu is flaky — paying both
            // costs. typeText only overtakes that for genuinely long strings, so keep
            // the fast/reliable typeText path for short and medium values and reserve
            // auto-paste for long text. Explicit `textInputMode: "paste"` still forces it.
            return value.count >= 80
        }
    }

    private func waitForTextInputValue(_ element: XCUIElement, _ expected: String, timeoutMs: Int) -> Bool {
        let deadline = Date().addingTimeInterval(Double(max(0, timeoutMs)) / 1_000)
        repeat {
            if textInputValueEquals(element, expected) {
                return true
            }
            usleep(50_000)
        } while Date() < deadline
        return textInputValueEquals(element, expected)
    }

    private func textInputValueEquals(_ element: XCUIElement, _ expected: String) -> Bool {
        stringValue(element.value) == expected
    }

    private func isTextInputEmpty(_ element: XCUIElement) -> Bool {
        let value = stringValue(element.value)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let placeholder = element.placeholderValue?.trimmingCharacters(in: .whitespacesAndNewlines)

        return value == nil || value == "" || value == placeholder
    }

    private func isVisible(_ element: XCUIElement) -> Bool {
        guard element.exists else {
            return false
        }

        let frame = element.frame
        return !frame.isEmpty && frame.intersects(app.frame)
    }

    private func isStable(_ element: XCUIElement) -> Bool {
        let first = element.frame
        usleep(30_000) // 30ms settle check (was 80ms)
        return first.equalTo(element.frame)
    }

    private func boundedElements(_ query: XCUIElementQuery, limit: Int) -> [XCUIElement] {
        guard limit > 0 else {
            return []
        }

        var elements: [XCUIElement] = []
        elements.reserveCapacity(limit)

        for index in 0..<limit {
            let element = query.element(boundBy: index)
            if element.exists {
                elements.append(element)
            } else {
                break
            }
        }

        return elements
    }

    private func boundedTreeElements(_ query: XCUIElementQuery, limit: Int) -> [XCUIElement] {
        guard limit > 0 else {
            return []
        }

        return boundedElements(query, limit: limit)
    }

    private func scanTreeElements(_ query: XCUIElementQuery, scanLimit: Int, collectLimit: Int) -> [XCUIElement] {
        guard scanLimit > 0 && collectLimit > 0 else {
            return []
        }

        var elements: [XCUIElement] = []
        elements.reserveCapacity(collectLimit)
        var misses = 0

        for index in 0..<scanLimit {
            let element = query.element(boundBy: index)
            if element.exists {
                elements.append(element)
                misses = 0
                if elements.count >= collectLimit {
                    break
                }
            } else {
                misses += 1
                if misses >= maxTreeSnapshotConsecutiveMisses {
                    break
                }
            }
        }

        return elements
    }

    private func treeCandidateElements() -> [XCUIElement] {
        let queries: [(XCUIElementQuery, Int)] = [
            (app.otherElements.matching(NSPredicate(format: "identifier != ''")), maxTreeSnapshotOtherPerQuery),
            (app.staticTexts, maxTreeSnapshotTextPerQuery),
            (app.buttons, maxTreeSnapshotControlsPerQuery),
            (app.textFields, maxTreeSnapshotControlsPerQuery),
            (app.secureTextFields, maxTreeSnapshotControlsPerQuery),
            (app.textViews, maxTreeSnapshotTextViewPerQuery),
            (app.switches, maxTreeSnapshotControlsPerQuery),
            (app.sliders, maxTreeSnapshotControlsPerQuery)
        ]

        return queries.flatMap { query, limit in
            boundedTreeElements(query, limit: min(limit, maxTreeSnapshotChildren))
        }
    }

    private func treeCandidateSnapshots(viewport: CGRect) -> [AsturElementSnapshot] {
        var snapshots: [AsturElementSnapshot] = []
        snapshots.reserveCapacity(maxTreeSnapshotChildren)

        scanTreeSnapshots(
            app.otherElements.matching(NSPredicate(format: "identifier != ''")),
            scanLimit: maxTreeSnapshotOtherScan,
            collectLimit: maxTreeSnapshotOtherPerQuery,
            viewport: viewport,
            into: &snapshots
        )

        let queries: [(XCUIElementQuery, Int)] = [
            (app.staticTexts, maxTreeSnapshotTextPerQuery),
            (app.buttons, maxTreeSnapshotControlsPerQuery),
            (app.textFields, maxTreeSnapshotControlsPerQuery),
            (app.secureTextFields, maxTreeSnapshotControlsPerQuery),
            (app.textViews, maxTreeSnapshotTextViewPerQuery),
            (app.switches, maxTreeSnapshotControlsPerQuery),
            (app.sliders, maxTreeSnapshotControlsPerQuery)
        ]

        for (query, limit) in queries {
            if snapshots.count >= maxTreeSnapshotChildren {
                break
            }

            for element in boundedTreeElements(query, limit: min(limit, maxTreeSnapshotChildren - snapshots.count)) {
                let snapshot = treeSnapshot(element, viewport: viewport)
                if isUsefulTreeSnapshot(snapshot, viewport: viewport) {
                    snapshots.append(snapshot)
                }
            }
        }

        return deduplicateTreeSnapshots(snapshots)
    }

    private func scanTreeSnapshots(
        _ query: XCUIElementQuery,
        scanLimit: Int,
        collectLimit: Int,
        viewport: CGRect,
        into snapshots: inout [AsturElementSnapshot]
    ) {
        guard scanLimit > 0 && collectLimit > 0 else {
            return
        }

        var collected = 0
        var misses = 0

        for index in 0..<scanLimit {
            if snapshots.count >= maxTreeSnapshotChildren || collected >= collectLimit {
                break
            }

            let element = query.element(boundBy: index)
            if !element.exists {
                misses += 1
                if misses >= maxTreeSnapshotConsecutiveMisses {
                    break
                }
                continue
            }

            misses = 0
            let snapshot = treeSnapshot(element, viewport: viewport)
            if isUsefulTreeSnapshot(snapshot, viewport: viewport) {
                snapshots.append(snapshot)
                collected += 1
            }
        }
    }

    private func deduplicateTreeSnapshots(_ snapshots: [AsturElementSnapshot]) -> [AsturElementSnapshot] {
        var seen = Set<String>()
        var result: [AsturElementSnapshot] = []
        result.reserveCapacity(snapshots.count)

        for snapshot in snapshots {
            let key = [
                snapshot.type,
                snapshot.id ?? "",
                snapshot.label ?? "",
                snapshot.text ?? "",
                snapshot.value ?? "",
                String(snapshot.bounds.x),
                String(snapshot.bounds.y),
                String(snapshot.bounds.width),
                String(snapshot.bounds.height)
            ].joined(separator: "|")

            if seen.insert(key).inserted {
                result.append(snapshot)
            }
        }

        return result
    }

    private func isUsefulTreeSnapshot(_ snapshot: AsturElementSnapshot, viewport: CGRect) -> Bool {
        if !snapshot.visible || snapshot.bounds.width <= 0 || snapshot.bounds.height <= 0 {
            return false
        }

        let hasName = snapshot.id != nil || snapshot.label != nil || snapshot.text != nil || snapshot.value != nil
        if !hasName && !isUsefulUnnamedTreeType(snapshot.type) {
            return false
        }

        if snapshot.type == "XCUIElementTypeOther" {
            let coversViewport = snapshot.bounds.x <= 1
                && snapshot.bounds.y <= 1
                && snapshot.bounds.width >= max(1, Int(viewport.width.rounded()) - 2)
                && snapshot.bounds.height >= max(1, Int(viewport.height.rounded()) - 2)
            return hasName && !coversViewport
        }

        return true
    }

    private func isUsefulUnnamedTreeType(_ type: String) -> Bool {
        type == "XCUIElementTypeButton"
            || type == "XCUIElementTypeTextField"
            || type == "XCUIElementTypeSecureTextField"
            || type == "XCUIElementTypeTextView"
            || type == "XCUIElementTypeSwitch"
            || type == "XCUIElementTypeSlider"
    }

    private func treeSnapshotPrecedes(_ left: AsturElementSnapshot, _ right: AsturElementSnapshot) -> Bool {
        if abs(left.bounds.y - right.bounds.y) > 4 {
            return left.bounds.y < right.bounds.y
        }
        if abs(left.bounds.x - right.bounds.x) > 4 {
            return left.bounds.x < right.bounds.x
        }
        return left.type < right.type
    }

    private func snapshot(_ element: XCUIElement, includeChildren: Bool) -> AsturElementSnapshot {
        let children = includeChildren
            ? boundedElements(element.descendants(matching: .any), limit: maxSnapshotChildren).map {
                snapshot($0, includeChildren: false)
            }
            : []

        return AsturElementSnapshot(
            id: element.identifier.nonEmpty,
            text: bestText(element),
            label: element.label.nonEmpty,
            value: snapshotValue(element),
            type: elementTypeName(element.elementType),
            enabled: element.isEnabled,
            visible: isVisible(element),
            selected: element.isSelected,
            focused: nil,
            bounds: bounds(element.frame),
            children: Array(children)
        )
    }

    private func treeSnapshot(_ element: XCUIElement, viewport: CGRect) -> AsturElementSnapshot {
        let elementType = element.elementType
        let frame = element.frame
        let label = element.label.nonEmpty
        let value = lightweightSnapshotValue(element, type: elementType)
        let visible = !frame.isEmpty && (viewport.isEmpty || frame.intersects(viewport))
        let children = treeChildElements(element, type: elementType, frame: frame, viewport: viewport)
            .map { treeLeafSnapshot($0, viewport: viewport) }
            .filter { isUsefulTreeSnapshot($0, viewport: viewport) }

        return AsturElementSnapshot(
            id: element.identifier.nonEmpty,
            text: label ?? value,
            label: label,
            value: value,
            type: elementTypeName(elementType),
            enabled: true,
            visible: visible,
            selected: nil,
            focused: nil,
            bounds: bounds(frame),
            children: deduplicateTreeSnapshots(children).sorted(by: treeSnapshotPrecedes)
        )
    }

    private func treeLeafSnapshot(_ element: XCUIElement, viewport: CGRect) -> AsturElementSnapshot {
        let elementType = element.elementType
        let frame = element.frame
        let label = element.label.nonEmpty
        let value = lightweightSnapshotValue(element, type: elementType)
        let visible = !frame.isEmpty && (viewport.isEmpty || frame.intersects(viewport))

        return AsturElementSnapshot(
            id: element.identifier.nonEmpty,
            text: label ?? value,
            label: label,
            value: value,
            type: elementTypeName(elementType),
            enabled: true,
            visible: visible,
            selected: nil,
            focused: nil,
            bounds: bounds(frame),
            children: []
        )
    }

    private func treeChildElements(
        _ element: XCUIElement,
        type: XCUIElement.ElementType,
        frame: CGRect,
        viewport: CGRect
    ) -> [XCUIElement] {
        []
    }

    private func shouldExpandTreeElement(
        type: XCUIElement.ElementType,
        frame: CGRect,
        viewport: CGRect,
        id: String?
    ) -> Bool {
        guard type == .other, id != nil, !frame.isEmpty, frame.intersects(viewport) else {
            return false
        }

        let viewportArea = max(1, viewport.width * viewport.height)
        let elementArea = frame.width * frame.height
        return elementArea > 900 && elementArea < viewportArea * 0.75
    }

    private func lightweightSnapshotValue(_ element: XCUIElement, type: XCUIElement.ElementType) -> String? {
        switch type {
        case .textField, .secureTextField, .textView, .slider, .switch:
            return stringValue(element.value)?.nonEmpty
        default:
            return nil
        }
    }

    private func bestText(_ element: XCUIElement) -> String? {
        element.label.nonEmpty
            ?? stringValue(element.value)?.nonEmpty
            ?? element.placeholderValue?.nonEmpty
    }

    private func textValues(_ element: XCUIElement) -> [String] {
        [
            element.label.nonEmpty,
            stringValue(element.value)?.nonEmpty,
            element.placeholderValue?.nonEmpty
        ].compactMap { $0 }
    }

    private func snapshotValue(_ element: XCUIElement) -> String? {
        if let value = stringValue(element.value)?.nonEmpty {
            return value
        }

        switch element.elementType {
        case .textField, .secureTextField, .textView:
            return bestText(element)
        default:
            return nil
        }
    }

    private func bounds(_ frame: CGRect) -> AsturBounds {
        AsturBounds(
            x: Int(frame.minX.rounded()),
            y: Int(frame.minY.rounded()),
            width: max(0, Int(frame.width.rounded())),
            height: max(0, Int(frame.height.rounded()))
        )
    }

    private func parseSelectorFromParams(_ params: [String: Any]) throws -> AsturSelector {
        try parseSelector(params.mapValue("selector"))
    }

    private func parseSelectorsFromParams(_ params: [String: Any]) throws -> [AsturSelector] {
        guard let rawSelectors = params["selectors"] as? [[String: Any]] else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "selectors is required and must be an array.")
        }

        return try rawSelectors.map { try parseSelector($0) }
    }

    private func parseSelector(_ raw: [String: Any]?) throws -> AsturSelector {
        guard let raw else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "selector is required and must be an object.")
        }

        let strategy = try raw.requiredString("strategy")

        var nativeIos: String?
        var nativeInstance: Int?
        if strategy == "native" {
            let native = raw.mapValue("native")
            nativeIos = try native?.stringValue("ios")
            guard let resolvedIos = nativeIos, !resolvedIos.isEmpty else {
                throw AsturAgentFailure(
                    code: "INVALID_SELECTOR",
                    message: "by.native() selector has no `ios` predicate, but this is the iOS agent. "
                        + "Provide `ios` in by.native({ ios, android }) to run this selector on iOS."
                )
            }
            nativeInstance = try native?.intValue("instance")
        }

        return AsturSelector(
            strategy: strategy,
            value: try raw.requiredString("value"),
            exact: try raw.boolValue("exact") ?? true,
            name: raw["name"],
            nativeIos: nativeIos,
            nativeInstance: nativeInstance
        )
    }

    private func parseWaitOptions(_ raw: [String: Any]?) throws -> AsturWaitOptions {
        let state = try raw?.stringValue("state") ?? "attached"

        if !["attached", "visible", "hidden"].contains(state) {
            throw AsturAgentFailure(
                code: "INVALID_PARAMS",
                message: "options.state must be attached, visible, or hidden.",
                details: ["state": state]
            )
        }

        return AsturWaitOptions(
            timeoutMs: max(0, try raw?.intValue("timeout") ?? defaultWaitTimeoutMs),
            intervalMs: max(30, try raw?.intValue("interval") ?? defaultWaitIntervalMs),
            state: state
        )
    }

    private func parseElementActionOptions(_ raw: [String: Any]?) throws -> AsturElementActionOptions {
        var wait = try parseWaitOptions(raw)
        if wait.state == "attached" {
            wait = AsturWaitOptions(timeoutMs: wait.timeoutMs, intervalMs: wait.intervalMs, state: "visible")
        }

        let actionabilityRaw = raw?.mapValue("actionability")
        let actionability = AsturActionability(
            visible: try actionabilityRaw?.boolValue("visible") ?? true,
            enabled: try actionabilityRaw?.boolValue("enabled") ?? true,
            stable: try actionabilityRaw?.boolValue("stable") ?? false,
            hittable: try actionabilityRaw?.boolValue("hittable") ?? false
        )

        return AsturElementActionOptions(
            wait: wait,
            actionability: actionability,
            keyboard: try raw?.stringValue("keyboard"),
            intervalMs: try raw?.intValue("intervalMs"),
            durationMs: try raw?.intValue("durationMs"),
            clear: try raw?.boolValue("clear"),
            textInputMode: try raw?.stringValue("textInputMode")
        )
    }

    private func parseElementDragTarget(_ params: [String: Any]) throws -> AsturElementDragTarget {
        guard let target = params.mapValue("target") else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "target is required for element.drag.")
        }

        let selector = try target.mapValue("selector").map { try parseSelector($0) }
        let point = target["x"] != nil || target["y"] != nil
            ? AsturPoint(x: try target.requiredInt("x"), y: try target.requiredInt("y"))
            : nil

        if selector == nil && point == nil {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "target must be either { x, y } or { selector }.")
        }

        return AsturElementDragTarget(point: point, selector: selector)
    }

    private func parseSwipeGesture(_ params: [String: Any]) throws -> AsturSwipeGesture {
        guard let gesture = params.mapValue("gesture") else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "gesture is required and must be an object.")
        }

        return AsturSwipeGesture(
            start: try parsePointFromMap(gesture, "start"),
            end: try parsePointFromMap(gesture, "end"),
            durationMs: max(50, try gesture.intValue("durationMs") ?? defaultSwipeMs)
        )
    }

    private func parseDragGesture(_ params: [String: Any]) throws -> AsturDragGesture {
        guard let gesture = params.mapValue("gesture") else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "gesture is required and must be an object.")
        }

        return AsturDragGesture(
            start: try parsePointFromMap(gesture, "start"),
            end: try parsePointFromMap(gesture, "end"),
            durationMs: max(50, try gesture.intValue("durationMs") ?? defaultDragMs)
        )
    }

    private func parsePointFromParams(_ params: [String: Any], _ key: String) throws -> AsturPoint {
        try parsePointFromMap(params, key)
    }

    private func parsePointFromMap(_ raw: [String: Any], _ key: String) throws -> AsturPoint {
        guard let point = raw.mapValue(key) else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "\(key) is required and must contain x and y.")
        }

        return AsturPoint(
            x: try point.requiredInt("x"),
            y: try point.requiredInt("y")
        )
    }

    private func ok(_ id: String, _ result: Any? = nil) -> AsturCommandResult {
        AsturCommandResult(id: id, ok: true, result: result, error: nil)
    }

    private func error(_ id: String, _ code: String, _ message: String, _ details: Any? = nil) -> AsturCommandResult {
        AsturCommandResult(
            id: id,
            ok: false,
            result: nil,
            error: AsturCommandError(code: code, message: message, details: details)
        )
    }
}

private let defaultWaitTimeoutMs = 10_000
private let defaultWaitIntervalMs = 100  // 100ms (was 250ms) — faster element detection
private let defaultLongPressMs = 500  // 500ms (was 800ms) — sufficient for iOS long-press
private let defaultSwipeMs = 200     // 200ms (was 300ms) — faster swipe gestures
private let defaultDragMs = 400      // 400ms (was 700ms) — faster drag gestures
private let maxFullTreeNodes = 1_200 // cap for full-hierarchy snapshot tree payload (breadth)
private let maxFullTreeDepth = 40     // cap for full-hierarchy snapshot tree depth (bounds deep WebView DOMs)
private let maxTreeSnapshotChildren = 48
private let maxTreeSnapshotOtherScan = 16
private let maxTreeSnapshotOtherPerQuery = 6
private let maxTreeSnapshotTextPerQuery = 12
private let maxTreeSnapshotTextPerContainer = 4
private let maxTreeSnapshotControlsPerQuery = 8
private let maxTreeSnapshotTextViewPerQuery = 6
private let maxTreeSnapshotConsecutiveMisses = 2
private let maxSnapshotChildren = 2_000
private let maxFindAllResults = 500
private let maxFindManyResults = 500

private let supportedCapabilities = [
    "agent.ping",
    "app.launch",
    "app.terminate",
    "device.screenshot",
    "device.viewport",
    "device.setOrientation",
    "tree.get",
    "element.find",
    "element.findAll",
    "element.findMany",
    "element.wait",
    "element.tap",
    "element.doubleTap",
    "element.longPress",
    "element.fill",
    "element.drag",
    "gesture.tap",
    "gesture.doubleTap",
    "gesture.longPress",
    "gesture.swipe",
    "gesture.drag",
    "keyboard.state",
    "keyboard.dismiss"
]

private func elementTypeForRole(_ role: String) -> XCUIElement.ElementType? {
    switch role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "button":
        return .button
    case "checkbox":
        return .checkBox
    case "image", "img":
        return .image
    case "link":
        return .link
    case "menuitem":
        return .menuItem
    case "radio":
        return .radioButton
    case "slider":
        return .slider
    case "switch":
        return .switch
    case "tab":
        return .tabBar
    case "text":
        return .staticText
    case "textbox":
        return .textField
    default:
        return nil
    }
}

private func elementTypeFromString(_ value: String) -> XCUIElement.ElementType? {
    switch value
        .replacingOccurrences(of: "XCUIElementType", with: "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() {
    case "any":
        return .any
    case "application":
        return .application
    case "button":
        return .button
    case "cell":
        return .cell
    case "checkbox", "check box":
        return .checkBox
    case "collectionview", "collection view":
        return .collectionView
    case "image":
        return .image
    case "link":
        return .link
    case "menuitem", "menu item":
        return .menuItem
    case "navigationbar", "navigation bar":
        return .navigationBar
    case "other":
        return .other
    case "pageindicator", "page indicator":
        return .pageIndicator
    case "radiobutton", "radio button":
        return .radioButton
    case "scrollview", "scroll view":
        return .scrollView
    case "securetextfield", "secure text field":
        return .secureTextField
    case "slider":
        return .slider
    case "statictext", "static text", "text":
        return .staticText
    case "switch":
        return .switch
    case "tabbar", "tab bar":
        return .tabBar
    case "table":
        return .table
    case "textfield", "text field", "textbox":
        return .textField
    case "textview", "text view":
        return .textView
    case "webview", "web view":
        return .webView
    default:
        return nil
    }
}

private func elementTypeName(_ type: XCUIElement.ElementType) -> String {
    "XCUIElementType\(shortElementTypeName(type))"
}

private func shortElementTypeName(_ type: XCUIElement.ElementType) -> String {
    switch type {
    case .any:
        return "Any"
    case .application:
        return "Application"
    case .button:
        return "Button"
    case .cell:
        return "Cell"
    case .checkBox:
        return "CheckBox"
    case .collectionView:
        return "CollectionView"
    case .image:
        return "Image"
    case .link:
        return "Link"
    case .menuItem:
        return "MenuItem"
    case .navigationBar:
        return "NavigationBar"
    case .other:
        return "Other"
    case .pageIndicator:
        return "PageIndicator"
    case .radioButton:
        return "RadioButton"
    case .scrollView:
        return "ScrollView"
    case .secureTextField:
        return "SecureTextField"
    case .slider:
        return "Slider"
    case .staticText:
        return "StaticText"
    case .switch:
        return "Switch"
    case .tabBar:
        return "TabBar"
    case .table:
        return "Table"
    case .textField:
        return "TextField"
    case .textView:
        return "TextView"
    case .webView:
        return "WebView"
    default:
        return String(describing: type)
    }
}

private func match(_ actual: String?, _ expected: String, exact: Bool) -> Bool {
    guard let actual, !actual.isEmpty else {
        return false
    }

    return exact ? actual == expected : actual.localizedCaseInsensitiveContains(expected)
}

private func stringValue(_ value: Any?) -> String? {
    guard let value else {
        return nil
    }

    if let string = value as? String {
        return string
    }

    return String(describing: value)
}

private struct AsturAgentFailure: Error {
    let code: String
    let message: String
    let details: Any?

    init(code: String, message: String, details: Any? = nil) {
        self.code = code
        self.message = message
        self.details = details
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}

private extension Dictionary where Key == String, Value == Any {
    func mapValue(_ key: String) -> [String: Any]? {
        self[key] as? [String: Any]
    }

    func requiredString(_ key: String) throws -> String {
        guard let value = self[key] as? String else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "\(key) is required and must be a string.")
        }
        return value
    }

    func stringValue(_ key: String) throws -> String? {
        guard let value = self[key], !(value is NSNull) else {
            return nil
        }

        guard let string = value as? String else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "\(key) must be a string.")
        }

        return string
    }

    func requiredInt(_ key: String) throws -> Int {
        guard let value = try intValue(key) else {
            throw AsturAgentFailure(code: "INVALID_PARAMS", message: "\(key) is required and must be numeric.")
        }

        return value
    }

    func intValue(_ key: String) throws -> Int? {
        guard let value = self[key], !(value is NSNull) else {
            return nil
        }

        if let int = value as? Int {
            return int
        }

        if let number = value as? NSNumber {
            return number.intValue
        }

        throw AsturAgentFailure(code: "INVALID_PARAMS", message: "\(key) must be numeric.")
    }

    func boolValue(_ key: String) throws -> Bool? {
        guard let value = self[key], !(value is NSNull) else {
            return nil
        }

        if let bool = value as? Bool {
            return bool
        }

        if let number = value as? NSNumber {
            return number.boolValue
        }

        throw AsturAgentFailure(code: "INVALID_PARAMS", message: "\(key) must be a boolean.")
    }
}
