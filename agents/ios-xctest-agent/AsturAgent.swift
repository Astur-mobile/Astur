import CoreGraphics
import Foundation
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
    }

    func launchIfNeeded() {
        if app.state == .notRunning {
            app.launch()
        } else {
            app.activate()
        }

        _ = app.wait(for: .runningForeground, timeout: 8)
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

        Thread.sleep(forTimeInterval: 0.5)
    }

    func dispatch(_ command: AsturCommand) -> AsturCommandResult {
        do {
            switch command.method {
            case "agent.ping":
                return ok(command.id, agentInfo())

            case "device.setOrientation":
                let orientation = try command.params.requiredString("orientation")
                try setOrientation(orientation)
                return ok(command.id)

            case "tree.get":
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
                return ok(command.id, waitForElement(selector, options: options)?.toDictionary())

            case "element.tap":
                let selector = try parseSelectorFromParams(command.params)
                let options = try parseElementActionOptions(command.params.mapValue("options"))
                try resolveElement(selector, options: options).tap()
                return ok(command.id)

            case "element.doubleTap":
                let selector = try parseSelectorFromParams(command.params)
                let options = try parseElementActionOptions(command.params.mapValue("options"))
                try resolveElement(selector, options: options).doubleTap()
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
                try coordinate(try parsePointFromParams(command.params, "target")).doubleTap()
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
        let children = app.descendants(matching: .any)
            .allElementsBoundByIndex
            .prefix(maxTreeSnapshotChildren)
            .map { treeSnapshot($0, viewport: appFrame) }

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
            children: Array(children)
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
        if let query = directManyQuery(selectors) {
            let fastMatches = Array(query.allElementsBoundByIndex.prefix(maxFindManyResults))
            let coveredValues = Set(fastMatches.flatMap { textValues($0) })
            let missingSelectors = selectors.filter { !coveredValues.contains($0.value) }
            let fallbackMatches = missingSelectors.flatMap { findElementObjects($0) }

            return (fastMatches + fallbackMatches)
                .prefix(maxFindManyResults)
                .map { snapshot($0, includeChildren: false) }
        }

        return selectors.flatMap { findElementObjects($0) }
            .prefix(maxFindManyResults)
            .map { snapshot($0, includeChildren: false) }
    }

    private func waitForElement(_ selector: AsturSelector, options: AsturWaitOptions) -> AsturElementSnapshot? {
        if options.state == "hidden" {
            waitForHidden(selector, options: options)
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
        element.tap()

        if clear {
            clearText(element)
        }

        element.typeText(value)

        if options.keyboard == "auto" {
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

        for title in ["Done", "Return", "Go", "Search", "Next"] {
            let button = keyboard.buttons[title]
            if button.exists {
                button.tap()
                return
            }
        }

        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)).tap()
    }

    private func resolveElement(_ selector: AsturSelector, options: AsturElementActionOptions) throws -> XCUIElement {
        guard let element = waitForElementObject(selector, options: options.wait) else {
            throw AsturAgentFailure(
                code: "ELEMENT_NOT_FOUND",
                message: "Could not resolve element before action.",
                details: [
                    "selector": selector.toDictionary(),
                    "state": options.wait.state,
                    "timeout": options.wait.timeoutMs
                ]
            )
        }

        try ensureActionable(element, selector: selector, requirements: options.actionability)
        return element
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
                details: ["selector": selector.toDictionary()]
            )
        }

        if requirements.enabled && !element.isEnabled {
            throw AsturAgentFailure(
                code: "ELEMENT_DISABLED",
                message: "Element is disabled.",
                details: ["selector": selector.toDictionary()]
            )
        }

        if requirements.stable && !isStable(element) {
            throw AsturAgentFailure(
                code: "ELEMENT_UNSTABLE",
                message: "Element bounds are not stable.",
                details: ["selector": selector.toDictionary()]
            )
        }

        if requirements.hittable && !element.isHittable {
            throw AsturAgentFailure(
                code: "ELEMENT_NOT_HITTABLE",
                message: "Element is not hittable.",
                details: ["selector": selector.toDictionary()]
            )
        }
    }

    private func waitForElementObject(_ selector: AsturSelector, options: AsturWaitOptions) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(Double(max(0, options.timeoutMs)) / 1_000)
        let interval = UInt32(max(50, options.intervalMs) * 1_000)

        while true {
            if let element = findElementObject(selector) {
                if options.state == "attached" {
                    return element
                }

                if options.state == "visible" && isVisible(element) {
                    return element
                }
            }

            if Date() >= deadline {
                return nil
            }

            usleep(interval)
        }
    }

    private func waitForHidden(_ selector: AsturSelector, options: AsturWaitOptions) {
        let deadline = Date().addingTimeInterval(Double(max(0, options.timeoutMs)) / 1_000)
        let interval = UInt32(max(50, options.intervalMs) * 1_000)

        while true {
            let element = findElementObject(selector)
            if element == nil || !isVisible(element!) {
                return
            }

            if Date() >= deadline {
                return
            }

            usleep(interval)
        }
    }

    private func findElementObject(_ selector: AsturSelector) -> XCUIElement? {
        if let query = directQuery(selector) {
            let element = query.firstMatch
            if element.exists && matchesName(element, expected: selector.name, exact: selector.exact) {
                return element
            }

            if usesDirectQueryOnly(selector) {
                return nil
            }
        }

        return app.descendants(matching: .any)
            .allElementsBoundByIndex
            .first { matches($0, selector: selector) }
    }

    private func findElementObjects(_ selector: AsturSelector) -> [XCUIElement] {
        let candidates = directQuery(selector)?.allElementsBoundByIndex
            ?? app.descendants(matching: .any).allElementsBoundByIndex

        return candidates
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

    private func directQuery(_ selector: AsturSelector) -> XCUIElementQuery? {
        switch selector.strategy.lowercased() {
        case "id":
            if selector.exact {
                return app.descendants(matching: .any).matching(identifier: selector.value)
            }
            return nil

        case "accessibility":
            if selector.exact {
                return app.descendants(matching: .any).matching(
                    NSPredicate(format: "identifier == %@ OR label == %@", selector.value, selector.value)
                )
            }
            return nil

        case "text":
            if selector.exact {
                return app.descendants(matching: .any).matching(
                    NSPredicate(format: "label == %@ OR value == %@", selector.value, selector.value)
                )
            }
            return nil

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
        let currentLength = max(stringValue(element.value)?.count ?? 0, element.label.count)
        let deleteCount = min(120, max(32, currentLength + 24))
        element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: deleteCount))

        if !isTextInputEmpty(element) {
            selectAllText(in: element)
            element.typeText(XCUIKeyboardKey.delete.rawValue)
        }
    }

    private func selectAllText(in element: XCUIElement) {
        element.press(forDuration: 0.8)
        let selectAll = app.menuItems["Select All"].firstMatch
        if selectAll.waitForExistence(timeout: 1.0) {
            selectAll.tap()
            usleep(120_000)
        }
    }

    private func isTextInputEmpty(_ element: XCUIElement) -> Bool {
        let value = stringValue(element.value)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let placeholder = element.placeholderValue?.trimmingCharacters(in: .whitespacesAndNewlines)

        return value == nil || value == "" || value == placeholder
    }

    private func isVisible(_ element: XCUIElement) -> Bool {
        element.exists && !element.frame.isEmpty
    }

    private func isStable(_ element: XCUIElement) -> Bool {
        let first = element.frame
        usleep(80_000)
        return first.equalTo(element.frame)
    }

    private func snapshot(_ element: XCUIElement, includeChildren: Bool) -> AsturElementSnapshot {
        let children = includeChildren
            ? element.descendants(matching: .any).allElementsBoundByIndex.prefix(maxSnapshotChildren).map {
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

        return AsturSelector(
            strategy: try raw.requiredString("strategy"),
            value: try raw.requiredString("value"),
            exact: try raw.boolValue("exact") ?? true,
            name: raw["name"]
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
            intervalMs: max(50, try raw?.intValue("interval") ?? defaultWaitIntervalMs),
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
            clear: try raw?.boolValue("clear")
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
private let defaultWaitIntervalMs = 250
private let defaultDoubleTapIntervalMs = 80
private let defaultLongPressMs = 800
private let defaultSwipeMs = 300
private let defaultDragMs = 700
private let maxTreeSnapshotChildren = 100
private let maxSnapshotChildren = 2_000
private let maxFindAllResults = 500
private let maxFindManyResults = 500

private let supportedCapabilities = [
    "agent.ping",
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
