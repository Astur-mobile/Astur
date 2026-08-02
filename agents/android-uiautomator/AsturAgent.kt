package dev.astur.agent

import android.app.Instrumentation
import android.graphics.Rect
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import kotlin.math.max
import kotlin.math.min
import java.util.regex.Pattern

data class AsturCommand(
    val id: String,
    val method: String,
    val params: Map<String, Any?> = emptyMap()
)

data class AsturCommandResult(
    val id: String,
    val ok: Boolean,
    val result: Any? = null,
    val error: AsturCommandError? = null
)

data class AsturCommandError(
    val code: String,
    val message: String,
    val details: Any? = null
)

private data class AsturSelector(
    val strategy: String,
    val value: String,
    val exact: Boolean = true,
    val name: Any? = null,
    /** Present only when strategy == "native": the raw `{ android, instance }` payload (see by.native() in @astur-mobile/core). */
    val nativeAndroid: Map<String, Any?>? = null,
    val nativeInstance: Int? = null
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "strategy" to strategy,
            "value" to value,
            "exact" to exact,
            "name" to name
        )
    }
}

private data class AsturWaitOptions(
    val timeoutMs: Long = 10_000,
    val intervalMs: Long = 250,
    val state: String = "attached"
)

private data class AsturActionability(
    val visible: Boolean = true,
    val enabled: Boolean = true,
    val stable: Boolean = false,
    val hittable: Boolean = false
)

private data class AsturElementActionOptions(
    val wait: AsturWaitOptions = AsturWaitOptions(),
    val actionability: AsturActionability = AsturActionability(),
    val keyboard: String? = null,
    val intervalMs: Long? = null,
    val durationMs: Long? = null,
    val clear: Boolean? = null
)

private data class AsturPoint(
    val x: Int,
    val y: Int
) {
    fun toMap(): Map<String, Int> {
        return mapOf(
            "x" to x,
            "y" to y
        )
    }
}

private data class AsturElementDragTarget(
    val point: AsturPoint? = null,
    val selector: AsturSelector? = null
)

private data class AsturSwipeGesture(
    val start: AsturPoint,
    val end: AsturPoint,
    val durationMs: Long = 300
)

private data class AsturDragGesture(
    val start: AsturPoint,
    val end: AsturPoint,
    val durationMs: Long = 700
)

private data class AsturBounds(
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int
) {
    fun toMap(): Map<String, Int> {
        return mapOf(
            "x" to x,
            "y" to y,
            "width" to width,
            "height" to height
        )
    }
}

private data class AsturElementSnapshot(
    val id: String? = null,
    val text: String? = null,
    val label: String? = null,
    val value: String? = null,
    val type: String,
    val enabled: Boolean,
    val visible: Boolean,
    val selected: Boolean? = null,
    val focused: Boolean? = null,
    val bounds: AsturBounds,
    val children: List<AsturElementSnapshot> = emptyList(),
    val platform: String = "android",
    val raw: Any? = null
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "id" to id,
            "text" to text,
            "label" to label,
            "value" to value,
            "type" to type,
            "enabled" to enabled,
            "visible" to visible,
            "selected" to selected,
            "focused" to focused,
            "bounds" to bounds.toMap(),
            "children" to children.map { child -> child.toMap() },
            "platform" to platform,
            "raw" to raw
        )
    }
}

private interface AsturBackend {
    fun getTree(): AsturElementSnapshot
    fun findElement(selector: AsturSelector): AsturElementSnapshot?
    fun findElements(selector: AsturSelector): List<AsturElementSnapshot>
    fun waitForElement(selector: AsturSelector, options: AsturWaitOptions): AsturElementSnapshot?
    fun tapElement(selector: AsturSelector, options: AsturElementActionOptions)
    fun doubleTapElement(selector: AsturSelector, options: AsturElementActionOptions, intervalMs: Long)
    fun longPressElement(selector: AsturSelector, options: AsturElementActionOptions, durationMs: Long)
    fun fillElement(selector: AsturSelector, value: String, options: AsturElementActionOptions, clear: Boolean)
    fun dragElement(selector: AsturSelector, target: AsturElementDragTarget, options: AsturElementActionOptions)
    fun tap(point: AsturPoint)
    fun doubleTap(point: AsturPoint, intervalMs: Long)
    fun longPress(point: AsturPoint, durationMs: Long)
    fun swipe(gesture: AsturSwipeGesture)
    fun drag(gesture: AsturDragGesture)
    fun setOrientation(orientation: String)
    fun keyboardState(): Map<String, Any?>
    fun dismissKeyboard()
}

class AsturAgent private constructor(
    private val backend: AsturBackend
) {
    constructor() : this(UiAutomatorBackend())
    constructor(instrumentation: Instrumentation) : this(UiAutomatorBackend(instrumentation))

    fun dispatch(command: AsturCommand): AsturCommandResult {
        return try {
            when (command.method) {
                "agent.ping" -> ok(command.id, agentInfo())

                "device.setOrientation" -> {
                    backend.setOrientation(command.params.requiredString("orientation"))
                    ok(command.id)
                }

                "tree.get" -> ok(command.id, backend.getTree().toMap())
                "element.find" -> {
                    val selector = parseSelectorFromParams(command.params)
                    ok(command.id, backend.findElement(selector)?.toMap())
                }

                "element.findAll" -> {
                    val selector = parseSelectorFromParams(command.params)
                    ok(command.id, backend.findElements(selector).map { it.toMap() })
                }

                "element.findMany" -> {
                    val selectors = parseSelectorsFromParams(command.params)
                    ok(command.id, selectors.flatMap { backend.findElements(it) }.map { it.toMap() })
                }

                "element.wait" -> {
                    val selector = parseSelectorFromParams(command.params)
                    val options = parseWaitOptions(command.params.mapValue("options"))
                    ok(command.id, backend.waitForElement(selector, options)?.toMap())
                }

                "element.tap" -> {
                    val selector = parseSelectorFromParams(command.params)
                    val options = parseElementActionOptions(command.params.mapValue("options"))
                    backend.tapElement(selector, options)
                    ok(command.id)
                }

                "element.doubleTap" -> {
                    val selector = parseSelectorFromParams(command.params)
                    val options = parseElementActionOptions(command.params.mapValue("options"))
                    backend.doubleTapElement(selector, options, options.intervalMs ?: DEFAULT_DOUBLE_TAP_INTERVAL_MS)
                    ok(command.id)
                }

                "element.longPress" -> {
                    val selector = parseSelectorFromParams(command.params)
                    val options = parseElementActionOptions(command.params.mapValue("options"))
                    backend.longPressElement(selector, options, options.durationMs ?: DEFAULT_LONG_PRESS_MS)
                    ok(command.id)
                }

                "element.fill" -> {
                    val selector = parseSelectorFromParams(command.params)
                    val value = command.params.requiredString("value")
                    val options = parseElementActionOptions(command.params.mapValue("options"))
                    backend.fillElement(selector, value, options, options.clear ?: true)
                    ok(command.id)
                }

                "element.drag" -> {
                    val selector = parseSelectorFromParams(command.params)
                    val target = parseElementDragTarget(command.params)
                    val options = parseElementActionOptions(command.params.mapValue("options"))
                    backend.dragElement(selector, target, options)
                    ok(command.id)
                }

                "gesture.tap" -> {
                    backend.tap(parsePointFromParams(command.params, "target"))
                    ok(command.id)
                }

                "gesture.doubleTap" -> {
                    val target = parsePointFromParams(command.params, "target")
                    val options = command.params.mapValue("options")
                    val intervalMs = options?.longValue("intervalMs") ?: DEFAULT_DOUBLE_TAP_INTERVAL_MS
                    backend.doubleTap(target, intervalMs)
                    ok(command.id)
                }

                "gesture.longPress" -> {
                    val target = parsePointFromParams(command.params, "target")
                    val options = command.params.mapValue("options")
                    val durationMs = options?.longValue("durationMs") ?: DEFAULT_LONG_PRESS_MS
                    backend.longPress(target, durationMs)
                    ok(command.id)
                }

                "gesture.swipe" -> {
                    val gesture = parseSwipeGesture(command.params)
                    backend.swipe(gesture)
                    ok(command.id)
                }

                "gesture.drag" -> {
                    val gesture = parseDragGesture(command.params)
                    backend.drag(gesture)
                    ok(command.id)
                }

                "keyboard.state" -> ok(command.id, backend.keyboardState())

                "keyboard.dismiss" -> {
                    backend.dismissKeyboard()
                    ok(command.id)
                }

                else -> error(
                    command.id,
                    "UNKNOWN_COMMAND",
                    "Unknown Astur agent command: ${command.method}"
                )
            }
        } catch (error: AsturAgentException) {
            error(command.id, error.code, error.message ?: "Unknown agent failure", error.details)
        } catch (error: Throwable) {
            error(
                command.id,
                "INTERNAL_ERROR",
                "Unhandled Android UIAutomator agent failure.",
                mapOf("cause" to (error.message ?: error.javaClass.simpleName))
            )
        }
    }

    private fun agentInfo(): Map<String, Any> {
        return mapOf(
            "id" to "astur-android-uiautomator",
            "platform" to "android",
            "version" to "0.1.0-alpha.0",
            "protocolVersion" to 1,
            "capabilities" to supportedCapabilities
        )
    }

    private fun parseSelectorFromParams(params: Map<String, Any?>): AsturSelector {
        return parseSelector(params.mapValue("selector")
            ?: throw AsturAgentException(
                "INVALID_PARAMS",
                "selector is required and must be an object."
            ))
    }

    private fun parseSelectorsFromParams(params: Map<String, Any?>): List<AsturSelector> {
        val raw = params["selectors"] as? List<*>
            ?: throw AsturAgentException(
                "INVALID_PARAMS",
                "selectors is required and must be an array of selector objects."
            )

        return raw.map { entry ->
            @Suppress("UNCHECKED_CAST")
            val map = entry as? Map<String, Any?>
                ?: throw AsturAgentException(
                    "INVALID_PARAMS",
                    "selectors entries must be selector objects."
                )
            parseSelector(map)
        }
    }

    private fun parseSelector(raw: Map<String, Any?>): AsturSelector {
        val strategy = raw.requiredString("strategy")
        val value = raw.requiredString("value")
        val exact = raw.booleanValue("exact") ?: true

        val nativeAndroid: Map<String, Any?>?
        val nativeInstance: Int?
        if (strategy == "native") {
            val native = raw.mapValue("native")
            nativeAndroid = native?.mapValue("android")
                ?: throw AsturAgentException(
                    "INVALID_SELECTOR",
                    "by.native() selector has no `android` chain, but this is the Android agent. " +
                        "Provide `android` in by.native({ ios, android }) to run this selector on Android."
                )
            nativeInstance = native.intValue("instance")
        } else {
            nativeAndroid = null
            nativeInstance = null
        }

        return AsturSelector(
            strategy = strategy,
            value = value,
            exact = exact,
            name = raw["name"],
            nativeAndroid = nativeAndroid,
            nativeInstance = nativeInstance
        )
    }

    private fun parseWaitOptions(raw: Map<String, Any?>?): AsturWaitOptions {
        val timeout = (raw?.longValue("timeout") ?: DEFAULT_WAIT_TIMEOUT_MS).coerceAtLeast(0)
        val interval = (raw?.longValue("interval") ?: DEFAULT_WAIT_INTERVAL_MS).coerceAtLeast(50)
        val state = raw?.stringValue("state") ?: "attached"

        if (state != "attached" && state != "visible" && state != "hidden") {
            throw AsturAgentException(
                "INVALID_PARAMS",
                "options.state must be attached, visible, or hidden.",
                mapOf("state" to state)
            )
        }

        return AsturWaitOptions(timeoutMs = timeout, intervalMs = interval, state = state)
    }

    private fun parseElementActionOptions(raw: Map<String, Any?>?): AsturElementActionOptions {
        val wait = normalizeActionWait(parseWaitOptions(raw))
        val actionabilityRaw = raw?.mapValue("actionability")
        val actionability = AsturActionability(
            visible = actionabilityRaw?.booleanValue("visible") ?: true,
            enabled = actionabilityRaw?.booleanValue("enabled") ?: true,
            stable = actionabilityRaw?.booleanValue("stable") ?: false,
            hittable = actionabilityRaw?.booleanValue("hittable") ?: false
        )

        return AsturElementActionOptions(
            wait = wait,
            actionability = actionability,
            keyboard = raw?.stringValue("keyboard"),
            intervalMs = raw?.longValue("intervalMs"),
            durationMs = raw?.longValue("durationMs"),
            clear = raw?.booleanValue("clear")
        )
    }

    private fun normalizeActionWait(wait: AsturWaitOptions): AsturWaitOptions {
        return if (wait.state == "attached") {
            wait.copy(state = "visible")
        } else {
            wait
        }
    }

    private fun parseElementDragTarget(params: Map<String, Any?>): AsturElementDragTarget {
        val rawTarget = params.mapValue("target")
            ?: throw AsturAgentException(
                "INVALID_PARAMS",
                "target is required for element.drag and must be an object."
            )

        val selector = rawTarget.mapValue("selector")?.let { rawSelector -> parseSelector(rawSelector) }
        val point = if (rawTarget.containsKey("x") || rawTarget.containsKey("y")) {
            AsturPoint(rawTarget.requiredInt("x"), rawTarget.requiredInt("y"))
        } else {
            null
        }

        if (selector == null && point == null) {
            throw AsturAgentException(
                "INVALID_PARAMS",
                "target must be either { x, y } or { selector }.",
                mapOf("target" to rawTarget)
            )
        }

        return AsturElementDragTarget(point = point, selector = selector)
    }

    private fun parseSwipeGesture(params: Map<String, Any?>): AsturSwipeGesture {
        val gesture = params.mapValue("gesture")
            ?: throw AsturAgentException(
                "INVALID_PARAMS",
                "gesture is required and must be an object."
            )

        return AsturSwipeGesture(
            start = parsePointFromMap(gesture, "start"),
            end = parsePointFromMap(gesture, "end"),
            durationMs = (gesture.longValue("durationMs") ?: DEFAULT_SWIPE_MS).coerceAtLeast(50)
        )
    }

    private fun parseDragGesture(params: Map<String, Any?>): AsturDragGesture {
        val gesture = params.mapValue("gesture")
            ?: throw AsturAgentException(
                "INVALID_PARAMS",
                "gesture is required and must be an object."
            )

        return AsturDragGesture(
            start = parsePointFromMap(gesture, "start"),
            end = parsePointFromMap(gesture, "end"),
            durationMs = (gesture.longValue("durationMs") ?: DEFAULT_DRAG_MS).coerceAtLeast(50)
        )
    }

    private fun parsePointFromParams(params: Map<String, Any?>, key: String): AsturPoint {
        return parsePointFromMap(params, key)
    }

    private fun parsePointFromMap(raw: Map<String, Any?>, key: String): AsturPoint {
        val point = raw.mapValue(key)
            ?: throw AsturAgentException(
                "INVALID_PARAMS",
                "$key is required and must be an object containing x and y."
            )

        return AsturPoint(
            x = point.requiredInt("x"),
            y = point.requiredInt("y")
        )
    }

    private fun ok(id: String, result: Any? = null): AsturCommandResult {
        return AsturCommandResult(id = id, ok = true, result = result)
    }

    private fun error(id: String, code: String, message: String, details: Any? = null): AsturCommandResult {
        return AsturCommandResult(
            id,
            ok = false,
            error = AsturCommandError(
                code,
                message,
                details
            )
        )
    }

    private companion object {
        private const val DEFAULT_WAIT_TIMEOUT_MS = 10_000L
        private const val DEFAULT_WAIT_INTERVAL_MS = 250L
        private const val DEFAULT_DOUBLE_TAP_INTERVAL_MS = 80L
        private const val DEFAULT_LONG_PRESS_MS = 800L
        private const val DEFAULT_SWIPE_MS = 300L
        private const val DEFAULT_DRAG_MS = 700L

        private val supportedCapabilities = listOf(
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
        )
    }
}

private class UiAutomatorBackend(
    private val instrumentation: Instrumentation = InstrumentationRegistry.getInstrumentation(),
    private val device: UiDevice = UiDevice.getInstance(instrumentation)
) : AsturBackend {
    override fun getTree(): AsturElementSnapshot {
        val root = resolveTreeRoot()
        if (root != null) {
            return toSnapshot(root)
        }

        return AsturElementSnapshot(
            type = "android.view.ViewRoot",
            enabled = true,
            visible = true,
            bounds = AsturBounds(
                x = 0,
                y = 0,
                width = max(0, runCatching { device.displayWidth }.getOrDefault(0)),
                height = max(0, runCatching { device.displayHeight }.getOrDefault(0))
            ),
            children = emptyList(),
            platform = "android"
        )
    }

    override fun findElement(selector: AsturSelector): AsturElementSnapshot? {
        val node = findObject(selector) ?: return null
        return toSnapshot(node)
    }

    override fun findElements(selector: AsturSelector): List<AsturElementSnapshot> {
        return findObjects(selector).map { toSnapshot(it) }
    }

    override fun waitForElement(selector: AsturSelector, options: AsturWaitOptions): AsturElementSnapshot? {
        if (options.state == "hidden") {
            waitForHidden(selector, options)
            return null
        }

        val node = waitForObject(selector, options) ?: return null
        return toSnapshot(node)
    }

    override fun tapElement(selector: AsturSelector, options: AsturElementActionOptions) {
        val element = resolveElement(selector, options)
        // UiObject2.click() can return normally for a non-clickable container
        // without dispatching an action (Flutter commonly exposes a structural
        // Button parent with the actionable semantics node beneath it). Only
        // treat direct click as success when the resolved node is clickable;
        // otherwise tap its center so the descendant receives the gesture.
        val directClick = if (element.isClickable) runCatching { element.click() } else null
        if (directClick?.isSuccess == true) {
            return
        }

        val target = centerOf(safeBounds(element))
        if (clickPoint(target)) {
            return
        }

        throw AsturAgentException(
            "ELEMENT_TAP_FAILED",
            "UiAutomator failed to click the element.",
            mapOf(
                "selector" to selector.toMap(),
                "target" to target.toMap(),
                "cause" to if (directClick == null) {
                    "Resolved element is not directly clickable."
                } else {
                    directClick.exceptionOrNull()?.message ?: directClick.exceptionOrNull()?.javaClass?.simpleName
                }
            )
        )
    }

    override fun doubleTapElement(selector: AsturSelector, options: AsturElementActionOptions, intervalMs: Long) {
        val element = resolveElement(selector, options)
        val target = centerOf(safeBounds(element))
        doubleTap(target, intervalMs)
    }

    override fun longPressElement(selector: AsturSelector, options: AsturElementActionOptions, durationMs: Long) {
        val element = resolveElement(selector, options)
        val center = centerOf(safeBounds(element))
        longPress(center, durationMs)
    }

    override fun fillElement(selector: AsturSelector, value: String, options: AsturElementActionOptions, clear: Boolean) {
        val element = resolveElement(selector, options)

        if (clear) {
            runCatching { element.setText("") }
                .onFailure {
                    throw AsturAgentException(
                        "ELEMENT_CLEAR_FAILED",
                        "UiAutomator failed while clearing existing text.",
                        mapOf("selector" to selector.toMap())
                    )
                }
        }

        runCatching { element.setText(value) }
            .onFailure {
                throw AsturAgentException(
                    "ELEMENT_SET_TEXT_FAILED",
                    "UiAutomator failed while setting element text.",
                    mapOf(
                        "selector" to selector.toMap(),
                        "valueLength" to value.length
                    )
                )
            }

        if (options.keyboard == "auto") {
            dismissKeyboard()
        }
    }

    override fun dragElement(selector: AsturSelector, target: AsturElementDragTarget, options: AsturElementActionOptions) {
        val source = resolveElement(selector, options)
        val destination = resolveTargetPoint(target, options.wait)
        val start = centerOf(safeBounds(source))
        val durationMs = options.durationMs ?: 500L

        val succeeded = device.swipe(
            start.x,
            start.y,
            destination.x,
            destination.y,
            stepsFromDuration(durationMs)
        )

        if (!succeeded) {
            throw AsturAgentException(
                "ELEMENT_DRAG_FAILED",
                "UiAutomator failed while dragging the element.",
                mapOf(
                    "selector" to selector.toMap(),
                    "target" to (target.point?.toMap() ?: target.selector?.toMap())
                )
            )
        }
    }

    override fun tap(point: AsturPoint) {
        val target = clampPoint(point)
        if (!clickPoint(target)) {
            throw AsturAgentException(
                "GESTURE_TAP_FAILED",
                "UiAutomator failed to execute tap gesture.",
                mapOf("target" to target.toMap())
            )
        }
    }

    override fun doubleTap(point: AsturPoint, intervalMs: Long) {
        val target = clampPoint(point)
        val normalizedInterval = intervalMs.coerceIn(20L, 500L)

        if (!clickPoint(target)) {
            throw AsturAgentException(
                "GESTURE_DOUBLE_TAP_FAILED",
                "UiAutomator failed to execute the first tap of a double-tap gesture.",
                mapOf("target" to target.toMap(), "intervalMs" to normalizedInterval)
            )
        }

        sleep(normalizedInterval)

        if (!clickPoint(target)) {
            throw AsturAgentException(
                "GESTURE_DOUBLE_TAP_FAILED",
                "UiAutomator failed to execute the second tap of a double-tap gesture.",
                mapOf("target" to target.toMap(), "intervalMs" to normalizedInterval)
            )
        }
    }

    override fun longPress(point: AsturPoint, durationMs: Long) {
        val target = clampPoint(point)
        if (!pressPoint(target, durationMs)
            && !device.swipe(target.x, target.y, target.x, target.y, stepsFromDuration(durationMs))
        ) {
            throw AsturAgentException(
                "GESTURE_LONG_PRESS_FAILED",
                "UiAutomator failed to execute long-press gesture.",
                mapOf("target" to target.toMap(), "durationMs" to durationMs)
            )
        }
    }

    override fun swipe(gesture: AsturSwipeGesture) {
        val start = clampPoint(gesture.start)
        val end = clampPoint(gesture.end)

        if (!device.swipe(start.x, start.y, end.x, end.y, stepsFromDuration(gesture.durationMs))) {
            throw AsturAgentException(
                "GESTURE_SWIPE_FAILED",
                "UiAutomator failed to execute swipe gesture.",
                mapOf(
                    "start" to start.toMap(),
                    "end" to end.toMap(),
                    "durationMs" to gesture.durationMs
                )
            )
        }
    }

    override fun drag(gesture: AsturDragGesture) {
        val start = clampPoint(gesture.start)
        val end = clampPoint(gesture.end)

        if (!device.swipe(start.x, start.y, end.x, end.y, stepsFromDuration(gesture.durationMs))) {
            throw AsturAgentException(
                "GESTURE_DRAG_FAILED",
                "UiAutomator failed to execute drag gesture.",
                mapOf(
                    "start" to start.toMap(),
                    "end" to end.toMap(),
                    "durationMs" to gesture.durationMs
                )
            )
        }
    }

    override fun setOrientation(orientation: String) {
        when (orientation) {
            "portrait" -> device.setOrientationNatural()
            "landscape", "landscape-left" -> device.setOrientationLeft()
            "landscape-right" -> device.setOrientationRight()
            "portrait-upside-down" -> device.setOrientationNatural()
            else -> throw AsturAgentException(
                "UNSUPPORTED_ORIENTATION",
                "Unsupported Android orientation: $orientation"
            )
        }

        sleep(500)
    }

    override fun keyboardState(): Map<String, Any?> {
        val dumpsys = runCatching { device.executeShellCommand("dumpsys window") }.getOrDefault("")
        val visible = Regex("\\btype=ime\\b.*\\bvisible=true\\b").containsMatchIn(dumpsys)
            || Regex("\\bmImeShowing=true\\b").containsMatchIn(dumpsys)
        val bounds = parseInputBounds(dumpsys)

        return if (visible && bounds != null) {
            mapOf(
                "visible" to true,
                "bounds" to bounds.toMap()
            )
        } else {
            mapOf("visible" to visible)
        }
    }

    override fun dismissKeyboard() {
        val state = keyboardState()
        val visible = state["visible"] as? Boolean ?: false
        if (!visible) {
            return
        }

        device.pressBack()

        val deadline = System.currentTimeMillis() + 1_500L
        while (System.currentTimeMillis() <= deadline) {
            val after = keyboardState()["visible"] as? Boolean ?: false
            if (!after) {
                return
            }

            sleep(100)
        }
    }

    private fun resolveElement(selector: AsturSelector, options: AsturElementActionOptions): UiObject2 {
        val element = waitForObject(selector, options.wait)
            ?: throw AsturAgentException(
                "ELEMENT_NOT_FOUND",
                "Could not resolve element before action.",
                locatorFailureDetails(selector, options.wait.state, options.wait.timeoutMs)
            )

        ensureActionable(element, selector, options.actionability)
        return element
    }

    private fun ensureActionable(element: UiObject2, selector: AsturSelector, requirements: AsturActionability) {
        if (requirements.visible && !isVisible(element)) {
            throw AsturAgentException(
                "ELEMENT_NOT_VISIBLE",
                "Element is not visible.",
                actionabilityFailureDetails(element, selector, "visible")
            )
        }

        if (requirements.enabled && !runCatching { element.isEnabled }.getOrDefault(false)) {
            throw AsturAgentException(
                "ELEMENT_DISABLED",
                "Element is disabled.",
                actionabilityFailureDetails(element, selector, "enabled")
            )
        }

        val stable = if (requirements.stable) isStable(element) else null
        if (requirements.stable && stable != true) {
            throw AsturAgentException(
                "ELEMENT_UNSTABLE",
                "Element bounds are not stable.",
                actionabilityFailureDetails(element, selector, "stable", stable)
            )
        }

        if (requirements.hittable) {
            val bounds = safeBounds(element)
            val screenWidth = max(1, runCatching { device.displayWidth }.getOrDefault(1))
            val screenHeight = max(1, runCatching { device.displayHeight }.getOrDefault(1))
            val withinScreen = bounds.centerX() in 0 until screenWidth && bounds.centerY() in 0 until screenHeight

            if (!isVisible(element) || !runCatching { element.isEnabled }.getOrDefault(false) || !withinScreen) {
                throw AsturAgentException(
                    "ELEMENT_NOT_HITTABLE",
                    "Element is not hittable.",
                    actionabilityFailureDetails(element, selector, "hittable", stable)
                )
            }
        }
    }

    private fun locatorFailureDetails(
        selector: AsturSelector,
        state: String,
        timeoutMs: Long
    ): Map<String, Any?> {
        val candidate = runCatching { findObject(selector)?.let { toSnapshot(it).toMap() } }.getOrNull()
        val diagnostics = mutableMapOf<String, Any?>(
            "selector" to selector.toMap(),
            "state" to state,
            "timeoutMs" to timeoutMs,
            "matchingCandidates" to if (candidate == null) 0 else 1
        )

        if (candidate != null) {
            diagnostics["candidate"] = candidate
        }

        return mapOf(
            "selector" to selector.toMap(),
            "state" to state,
            "timeout" to timeoutMs,
            "diagnostics" to diagnostics
        )
    }

    private fun actionabilityFailureDetails(
        element: UiObject2,
        selector: AsturSelector,
        failed: String,
        stable: Boolean? = null
    ): Map<String, Any?> {
        val candidate = toSnapshot(element).toMap()
        val actionability = mutableMapOf<String, Any?>(
            "failed" to failed,
            "visible" to isVisible(element),
            "enabled" to runCatching { element.isEnabled }.getOrDefault(false)
        )

        if (stable != null) {
            actionability["stable"] = stable
        }

        val diagnostics = mapOf(
            "selector" to selector.toMap(),
            "matchingCandidates" to 1,
            "candidate" to candidate,
            "actionability" to actionability
        )

        return mapOf(
            "selector" to selector.toMap(),
            "candidate" to candidate,
            "actionability" to actionability,
            "diagnostics" to diagnostics
        )
    }

    private fun waitForObject(selector: AsturSelector, options: AsturWaitOptions): UiObject2? {
        val timeout = options.timeoutMs.coerceAtLeast(0)
        val interval = options.intervalMs.coerceAtLeast(50)
        val deadline = System.currentTimeMillis() + timeout

        while (true) {
            val candidate = findObject(selector)
            if (candidate != null) {
                if (options.state == "attached") {
                    return candidate
                }

                if (options.state == "visible" && isVisible(candidate)) {
                    return candidate
                }
            }

            if (System.currentTimeMillis() >= deadline) {
                return null
            }

            sleep(interval)
        }
    }

    private fun waitForHidden(selector: AsturSelector, options: AsturWaitOptions) {
        val timeout = options.timeoutMs.coerceAtLeast(0)
        val interval = options.intervalMs.coerceAtLeast(50)
        val deadline = System.currentTimeMillis() + timeout

        while (true) {
            val candidate = findObject(selector)
            if (candidate == null || !isVisible(candidate)) {
                return
            }

            if (System.currentTimeMillis() >= deadline) {
                throw AsturAgentException(
                    "ELEMENT_NOT_HIDDEN",
                    "Element did not become hidden before timeout.",
                    mapOf(
                        "selector" to selector.toMap(),
                        "timeout" to timeout
                    )
                )
            }

            sleep(interval)
        }
    }

    private fun findObject(selector: AsturSelector): UiObject2? {
        return when (selector.strategy.lowercase()) {
            "accessibility", "text", "type" -> {
                val by = toBySelector(selector)
                val candidate = device.findObject(by) ?: return null
                if (matchesName(candidate, selector.name, selector.exact)) {
                    candidate
                } else {
                    null
                }
            }

            "id" -> findById(selector)

            "role" -> findByRole(selector)

            "native" -> findNativeObjects(selector).let { matches ->
                matches.getOrNull(selector.nativeInstance ?: 0)
            }

            "xpath" -> throw AsturAgentException(
                "NOT_IMPLEMENTED",
                "xpath selectors are not supported by the Android UIAutomator agent."
            )

            "coordinates" -> throw AsturAgentException(
                "NOT_IMPLEMENTED",
                "coordinates selectors are not supported for element lookup. Use gesture.* commands for raw coordinates."
            )

            else -> throw AsturAgentException(
                "INVALID_SELECTOR",
                "Unsupported selector strategy: ${selector.strategy}",
                mapOf("selector" to selector.toMap())
            )
        }
    }

    private fun findObjects(selector: AsturSelector): List<UiObject2> {
        return when (selector.strategy.lowercase()) {
            "accessibility", "text", "type" -> {
                val candidates = runCatching { device.findObjects(toBySelector(selector)) }.getOrElse { emptyList() }
                candidates.filter { matchesName(it, selector.name, selector.exact) }
            }

            "id" -> findObjectsById(selector)

            "role" -> findObjectsByRole(selector)

            "native" -> findNativeObjects(selector)

            "xpath" -> throw AsturAgentException(
                "NOT_IMPLEMENTED",
                "xpath selectors are not supported by the Android UIAutomator agent."
            )

            "coordinates" -> throw AsturAgentException(
                "NOT_IMPLEMENTED",
                "coordinates selectors are not supported for element lookup. Use gesture.* commands for raw coordinates."
            )

            else -> throw AsturAgentException(
                "INVALID_SELECTOR",
                "Unsupported selector strategy: ${selector.strategy}",
                mapOf("selector" to selector.toMap())
            )
        }
    }

    /**
     * Resolves a by.native() Android chain. Deliberately built entirely from
     * androidx.test.uiautomator's own `By`/`BySelector` fluent API (no eval, no
     * custom expression parser) — see AndroidNativeSelector in @astur-mobile/protocol.
     */
    private fun findNativeObjects(selector: AsturSelector): List<UiObject2> {
        val chain = selector.nativeAndroid
            ?: throw AsturAgentException(
                "INVALID_SELECTOR",
                "by.native() selector is missing its `android` chain.",
                mapOf("selector" to selector.toMap())
            )

        return runCatching { device.findObjects(buildBySelector(chain)) }.getOrElse { emptyList() }
    }

    /**
     * Builds a `BySelector` from an AndroidNativeSelector chain by chaining its
     * instance methods (each further constrains the same selector — logical
     * AND). `By.pkg(".*")` is a neutral, always-true starting point when the
     * chain does not constrain the package. When it does, use that package as
     * the seed: UiAutomator rejects setting the same selector property twice.
     */
    private fun buildBySelector(chain: Map<String, Any?>): BySelector {
        val packageName = chain.stringValue("packageName")
        var selector: BySelector = packageName?.let(By::pkg) ?: By.pkg(Pattern.compile(".*"))

        chain.stringValue("className")?.let { selector = selector.clazz(it) }
        chain.stringValue("classNameMatches")?.let { selector = selector.clazz(Pattern.compile(it)) }
        chain.stringValue("text")?.let { selector = selector.text(it) }
        chain.stringValue("textContains")?.let { selector = selector.textContains(it) }
        chain.stringValue("textMatches")?.let { selector = selector.text(Pattern.compile(it)) }
        chain.stringValue("description")?.let { selector = selector.desc(it) }
        chain.stringValue("descriptionContains")?.let { selector = selector.descContains(it) }
        chain.stringValue("descriptionMatches")?.let { selector = selector.desc(Pattern.compile(it)) }
        chain.stringValue("resourceId")?.let { selector = selector.res(it) }
        chain.stringValue("resourceIdMatches")?.let { selector = selector.res(Pattern.compile(it)) }
        chain.mapValue("hasChild")?.let { selector = selector.hasChild(buildBySelector(it)) }
        chain.mapValue("hasDescendant")?.let { selector = selector.hasDescendant(buildBySelector(it)) }

        return selector
    }

    private fun findObjectsById(selector: AsturSelector): List<UiObject2> {
        val selectors = if (selector.exact) {
            if (selector.value.contains(":id/")) {
                listOf(By.res(selector.value))
            } else {
                // A resource name cannot both equal the bare value and contain ":id/",
                // so these candidates never match the same node twice.
                listOf(
                    By.res(selector.value),
                    By.res(Pattern.compile(".+:id/${Pattern.quote(selector.value)}"))
                )
            }
        } else {
            listOf(By.res(Pattern.compile(".*${Pattern.quote(selector.value)}.*")))
        }

        return selectors.flatMap { by ->
            runCatching { device.findObjects(by) }.getOrElse { emptyList() }
        }.filter { matchesName(it, selector.name, selector.exact) }
    }

    private fun findObjectsByRole(selector: AsturSelector): List<UiObject2> {
        val classes = roleClassMapping[selector.value.lowercase()]
            ?: throw AsturAgentException(
                "NOT_IMPLEMENTED",
                "Role '${selector.value}' is not mapped to Android widget classes.",
                mapOf("selector" to selector.toMap())
            )

        return classes.flatMap { clazz ->
            runCatching { device.findObjects(By.clazz(clazz)) }.getOrElse { emptyList() }
        }.filter { matchesName(it, selector.name, selector.exact) }
    }

    private fun toBySelector(selector: AsturSelector): BySelector {
        return when (selector.strategy.lowercase()) {
            "accessibility" -> if (selector.exact) {
                By.desc(selector.value)
            } else {
                By.descContains(selector.value)
            }

            "text" -> if (selector.exact) {
                By.text(selector.value)
            } else {
                By.textContains(selector.value)
            }

            "type" -> By.clazz(selector.value)

            else -> throw AsturAgentException(
                "INVALID_SELECTOR",
                "Selector strategy ${selector.strategy} cannot be translated to UiAutomator.",
                mapOf("selector" to selector.toMap())
            )
        }
    }

    private fun findById(selector: AsturSelector): UiObject2? {
        val selectors = if (selector.exact) {
            if (selector.value.contains(":id/")) {
                listOf(By.res(selector.value))
            } else {
                listOf(
                    By.res(selector.value),
                    By.res(Pattern.compile(".+:id/${Pattern.quote(selector.value)}"))
                )
            }
        } else {
            listOf(By.res(Pattern.compile(".*${Pattern.quote(selector.value)}.*")))
        }

        for (by in selectors) {
            val candidate = runCatching { device.findObject(by) }.getOrNull()
            if (candidate != null && matchesName(candidate, selector.name, selector.exact)) {
                return candidate
            }
        }

        return null
    }

    private fun findByRole(selector: AsturSelector): UiObject2? {
        val classes = roleClassMapping[selector.value.lowercase()]
            ?: throw AsturAgentException(
                "NOT_IMPLEMENTED",
                "Role '${selector.value}' is not mapped to Android widget classes.",
                mapOf("selector" to selector.toMap())
            )

        for (clazz in classes) {
            val candidates = runCatching { device.findObjects(By.clazz(clazz)) }.getOrElse { emptyList() }
            val match = candidates.firstOrNull { candidate -> matchesName(candidate, selector.name, selector.exact) }
            if (match != null) {
                return match
            }
        }

        return null
    }

    private fun matchesName(node: UiObject2, expectedRaw: Any?, exact: Boolean): Boolean {
        val expected = expectedRaw as? String ?: return true
        val values = listOfNotNull(
            runCatching { node.text }.getOrNull(),
            runCatching { node.contentDescription?.toString() }.getOrNull(),
            runCatching { node.resourceName }.getOrNull(),
            runCatching { node.className }.getOrNull()
        )

        return if (exact) {
            values.any { value -> value == expected }
        } else {
            values.any { value -> value.contains(expected, ignoreCase = true) }
        }
    }

    private fun resolveTargetPoint(target: AsturElementDragTarget, wait: AsturWaitOptions): AsturPoint {
        target.point?.let { point -> return clampPoint(point) }

        val selector = target.selector
            ?: throw AsturAgentException(
                "INVALID_PARAMS",
                "Drag target must include either point or selector."
            )

        val targetElement = waitForObject(selector, wait.copy(state = "visible"))
            ?: throw AsturAgentException(
                "ELEMENT_NOT_FOUND",
                "Drag target selector did not resolve.",
                mapOf("targetSelector" to selector.toMap())
            )

        return centerOf(safeBounds(targetElement))
    }

    private fun resolveTreeRoot(): UiObject2? {
        val packageName = currentPackageName()
        if (!packageName.isNullOrBlank()) {
            val packageNode = runCatching { device.findObject(By.pkg(packageName)) }.getOrNull()
            if (packageNode != null) {
                return ascendToRoot(packageNode)
            }
        }

        val fallback = runCatching { device.findObject(By.clazz("android.widget.FrameLayout")) }.getOrNull()
        return fallback?.let { node -> ascendToRoot(node) }
    }

    private fun ascendToRoot(node: UiObject2): UiObject2 {
        var current = node

        while (true) {
            val parent = runCatching { current.parent }.getOrNull() ?: return current
            current = parent
        }
    }

    private fun toSnapshot(node: UiObject2): AsturElementSnapshot {
        val bounds = safeBounds(node)
        val children = runCatching { node.children }
            .getOrElse { emptyList<UiObject2>() }
            .mapNotNull { child -> runCatching { toSnapshot(child) }.getOrNull() }

        return AsturElementSnapshot(
            id = runCatching { node.resourceName }.getOrNull(),
            text = runCatching { node.text }.getOrNull(),
            label = runCatching { node.contentDescription?.toString() }.getOrNull(),
            value = runCatching { node.text }.getOrNull(),
            type = runCatching { node.className }.getOrNull() ?: "android.view.View",
            enabled = runCatching { node.isEnabled }.getOrDefault(false),
            visible = isVisible(node),
            selected = runCatching { node.isSelected }.getOrNull(),
            focused = runCatching { node.isFocused }.getOrNull(),
            bounds = AsturBounds(
                x = bounds.left,
                y = bounds.top,
                width = max(0, bounds.width()),
                height = max(0, bounds.height())
            ),
            children = children,
            platform = "android"
        )
    }

    private fun parseInputBounds(dumpsys: String): AsturBounds? {
        val rectPattern = Regex("mBounds=Rect\\((\\d+),\\s*(\\d+)\\s*-\\s*(\\d+),\\s*(\\d+)\\)")
        val rectMatch = rectPattern.find(dumpsys)
        if (rectMatch != null) {
            val left = rectMatch.groupValues[1].toIntOrNull() ?: return null
            val top = rectMatch.groupValues[2].toIntOrNull() ?: return null
            val right = rectMatch.groupValues[3].toIntOrNull() ?: return null
            val bottom = rectMatch.groupValues[4].toIntOrNull() ?: return null

            return AsturBounds(left, top, max(0, right - left), max(0, bottom - top))
        }

        val framePattern = Regex("visibleFrame=\\[(\\d+),(\\d+)]\\[(\\d+),(\\d+)]")
        val frameMatch = framePattern.find(dumpsys)
        if (frameMatch != null) {
            val left = frameMatch.groupValues[1].toIntOrNull() ?: return null
            val top = frameMatch.groupValues[2].toIntOrNull() ?: return null
            val right = frameMatch.groupValues[3].toIntOrNull() ?: return null
            val bottom = frameMatch.groupValues[4].toIntOrNull() ?: return null

            return AsturBounds(left, top, max(0, right - left), max(0, bottom - top))
        }

        return null
    }

    private fun currentPackageName(): String? {
        return runCatching { device.currentPackageName }.getOrNull()
    }

    private fun isVisible(node: UiObject2): Boolean {
        val bounds = safeBounds(node)
        return bounds.width() > 0 && bounds.height() > 0
    }

    private fun isStable(node: UiObject2): Boolean {
        val first = Rect(safeBounds(node))
        sleep(80)
        val second = Rect(safeBounds(node))
        return first == second
    }

    private fun safeBounds(node: UiObject2): Rect {
        return runCatching { Rect(node.visibleBounds) }.getOrDefault(Rect(0, 0, 0, 0))
    }

    private fun centerOf(bounds: Rect): AsturPoint {
        return AsturPoint(bounds.centerX(), bounds.centerY())
    }

    private fun clickPoint(point: AsturPoint): Boolean {
        val target = clampPoint(point)
        return injectTap(target) || device.click(target.x, target.y)
    }

    private fun pressPoint(point: AsturPoint, durationMs: Long): Boolean {
        val target = clampPoint(point)
        val downTime = SystemClock.uptimeMillis()
        val down = motionEvent(downTime, downTime, MotionEvent.ACTION_DOWN, target)
        val downSent = runCatching { instrumentation.uiAutomation.injectInputEvent(down, true) }.getOrDefault(false)
        down.recycle()

        if (!downSent) {
            return false
        }

        sleep(durationMs.coerceAtLeast(500L))

        val upTime = SystemClock.uptimeMillis()
        val up = motionEvent(downTime, upTime, MotionEvent.ACTION_UP, target)
        val upSent = runCatching { instrumentation.uiAutomation.injectInputEvent(up, true) }.getOrDefault(false)
        up.recycle()

        return upSent
    }

    private fun injectTap(point: AsturPoint): Boolean {
        val target = clampPoint(point)
        val downTime = SystemClock.uptimeMillis()
        val down = motionEvent(downTime, downTime, MotionEvent.ACTION_DOWN, target)
        val uiAutomation = instrumentation.uiAutomation
        val downSent = runCatching {
            uiAutomation.injectInputEvent(down, true)
        }.getOrDefault(false)
        down.recycle()

        if (!downSent) {
            return false
        }

        sleep(45L)
        val upTime = SystemClock.uptimeMillis()
        val up = motionEvent(downTime, upTime, MotionEvent.ACTION_UP, target)
        val upSent = runCatching {
            uiAutomation.injectInputEvent(up, true)
        }.getOrDefault(false)
        up.recycle()

        return upSent
    }

    private fun motionEvent(downTime: Long, eventTime: Long, action: Int, point: AsturPoint): MotionEvent {
        return MotionEvent.obtain(
            downTime,
            eventTime,
            action,
            point.x.toFloat(),
            point.y.toFloat(),
            0
        ).also { event ->
            event.source = InputDevice.SOURCE_TOUCHSCREEN
        }
    }

    private fun clampPoint(point: AsturPoint): AsturPoint {
        val width = max(1, runCatching { device.displayWidth }.getOrDefault(1))
        val height = max(1, runCatching { device.displayHeight }.getOrDefault(1))

        return AsturPoint(
            x = min(max(0, point.x), width - 1),
            y = min(max(0, point.y), height - 1)
        )
    }

    private fun stepsFromDuration(durationMs: Long): Int {
        val normalized = durationMs.coerceAtLeast(50)
        return min(80, max(2, (normalized / 50L).toInt()))
    }

    private fun sleep(durationMs: Long) {
        try {
            Thread.sleep(durationMs)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private companion object {
        private val roleClassMapping: Map<String, List<String>> = mapOf(
            "button" to listOf("android.widget.Button", "android.widget.ImageButton"),
            "checkbox" to listOf("android.widget.CheckBox"),
            "image" to listOf("android.widget.ImageView"),
            "img" to listOf("android.widget.ImageView"),
            "link" to listOf("android.widget.TextView"),
            "menuitem" to listOf("android.widget.TextView"),
            "radio" to listOf("android.widget.RadioButton"),
            "slider" to listOf("android.widget.SeekBar"),
            "switch" to listOf("android.widget.Switch", "androidx.appcompat.widget.SwitchCompat"),
            "tab" to listOf("android.widget.TabWidget", "com.google.android.material.tabs.TabLayout\$TabView"),
            "text" to listOf("android.widget.TextView"),
            "textbox" to listOf("android.widget.EditText", "android.widget.AutoCompleteTextView")
        )
    }
}

private fun Any?.asStringKeyMap(): Map<String, Any?>? {
    val raw = this as? Map<*, *> ?: return null
    val result = linkedMapOf<String, Any?>()

    for ((key, value) in raw) {
        if (key is String) {
            result[key] = value
        }
    }

    return result
}

private fun Map<String, Any?>.mapValue(key: String): Map<String, Any?>? {
    return this[key].asStringKeyMap()
}

private fun Map<String, Any?>.requiredString(key: String): String {
    return stringValue(key)
        ?: throw AsturAgentException(
            "INVALID_PARAMS",
            "$key is required and must be a string."
        )
}

private fun Map<String, Any?>.stringValue(key: String): String? {
    val value = this[key] ?: return null
    if (value is String) {
        return value
    }

    throw AsturAgentException(
        "INVALID_PARAMS",
        "$key must be a string.",
        mapOf("value" to value)
    )
}

private fun Map<String, Any?>.booleanValue(key: String): Boolean? {
    val value = this[key] ?: return null
    if (value is Boolean) {
        return value
    }

    throw AsturAgentException(
        "INVALID_PARAMS",
        "$key must be a boolean.",
        mapOf("value" to value)
    )
}

private fun Map<String, Any?>.requiredInt(key: String): Int {
    return intValue(key)
        ?: throw AsturAgentException(
            "INVALID_PARAMS",
            "$key is required and must be numeric."
        )
}

private fun Map<String, Any?>.intValue(key: String): Int? {
    return longValue(key)?.toInt()
}

private fun Map<String, Any?>.longValue(key: String): Long? {
    val value = this[key] ?: return null

    return when (value) {
        is Int -> value.toLong()
        is Long -> value
        is Short -> value.toLong()
        is Byte -> value.toLong()
        is Double -> {
            if (value.isFinite()) {
                value.toLong()
            } else {
                throw AsturAgentException("INVALID_PARAMS", "$key must be a finite number.")
            }
        }

        is Float -> {
            if (value.isFinite()) {
                value.toLong()
            } else {
                throw AsturAgentException("INVALID_PARAMS", "$key must be a finite number.")
            }
        }

        is Number -> value.toLong()
        else -> throw AsturAgentException(
            "INVALID_PARAMS",
            "$key must be numeric.",
            mapOf("value" to value)
        )
    }
}

private class AsturAgentException(
    val code: String,
    message: String,
    val details: Any? = null
) : RuntimeException(message)
