package dev.astur.agent

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.nio.charset.Charset
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * The agent's HTTP endpoint, reached from the host through `adb forward`.
 *
 * It listens on loopback only, which keeps it off the network. Loopback does
 * not separate apps on the same device, though: any installed app can connect
 * to this port and would get UiAutomation's reach into every other app. So
 * every request must present the per-session token the host passed in the
 * instrumentation arguments, and that check runs before the body is read.
 *
 * Commands run one at a time. UiAutomation is not safe to drive concurrently,
 * and a command the host gave up on must not overlap the next one.
 */
class AsturAgentServer(
    private val port: Int,
    token: String,
    private val agent: AsturAgent = AsturAgent()
) {
    private val executor = Executors.newCachedThreadPool()
    private val expectedAuthorization = "Bearer $token".toByteArray(Charsets.UTF_8)
    private val dispatchLock = Any()

    @Volatile
    private var running = false
    private var serverSocket: ServerSocket? = null

    fun startBlocking() {
        running = true

        ServerSocket(port, BACKLOG, InetAddress.getLoopbackAddress()).use { server ->
            serverSocket = server

            while (running) {
                try {
                    val client = server.accept()
                    // The host's budget starts counting here, before the request
                    // waits for a worker thread or for the command ahead of it.
                    val acceptedAt = SystemClock.elapsedRealtime()
                    executor.execute {
                        handleClient(client, acceptedAt)
                    }
                } catch (error: SocketException) {
                    if (running) {
                        throw error
                    }
                }
            }
        }
    }

    fun startInBackground() {
        thread(name = "AsturAgentServer") {
            startBlocking()
        }
    }

    fun stop() {
        running = false
        runCatching { serverSocket?.close() }
        executor.shutdownNow()
    }

    private fun handleClient(socket: Socket, acceptedAt: Long) {
        socket.use { client ->
            try {
                val input = client.getInputStream()
                val head = readHead(input)

                if (!isAuthorized(head.headers["authorization"])) {
                    writeJson(client, 401, refusalJson("unknown", "UNAUTHORIZED", "Missing or invalid Astur agent token."))
                    return
                }

                if (head.contentLength > MAX_BODY_BYTES) {
                    writeJson(client, 413, refusalJson("unknown", "BAD_REQUEST", "Astur command body is too large."))
                    return
                }

                val requestBody = readBody(input, head.contentLength).toString(UTF_8)
                val body = when {
                    head.method == "GET" && head.path == "/health" -> {
                        resultToJson(agent.dispatch(AsturCommand(id = "health", method = "agent.ping")), 0L)
                    }

                    head.method == "POST" -> {
                        val command = try {
                            parseCommand(requestBody)
                        } catch (error: Exception) {
                            writeJson(client, 400, refusalJson("unknown", "BAD_REQUEST", error.message ?: "Malformed Astur command."))
                            return
                        }
                        val expiresAt = command.budgetMs?.let { acceptedAt + it }

                        synchronized(dispatchLock) {
                            if (expiresAt != null && SystemClock.elapsedRealtime() >= expiresAt) {
                                refusalJson(
                                    command.command.id,
                                    "DEADLINE_EXCEEDED",
                                    "The host's time budget for ${command.command.method} ran out before it started; nothing was done."
                                )
                            } else {
                                val startedAt = SystemClock.elapsedRealtime()
                                val result = agent.dispatch(command.command, expiresAt)
                                resultToJson(result, SystemClock.elapsedRealtime() - startedAt)
                            }
                        }
                    }

                    else -> errorJson(
                        id = "unknown",
                        code = "UNSUPPORTED_HTTP_METHOD",
                        message = "Astur agent expects POST commands."
                    )
                }

                writeJson(client, 200, body)
            } catch (error: Throwable) {
                writeJson(
                    client,
                    500,
                    errorJson(
                        id = "unknown",
                        code = "SERVER_ERROR",
                        message = error.message ?: error.javaClass.name
                    )
                )
            }
        }
    }

    private fun isAuthorized(authorization: String?): Boolean {
        // Constant-time, so response timing does not reveal how much matched.
        return authorization != null
            && MessageDigest.isEqual(authorization.toByteArray(Charsets.UTF_8), expectedAuthorization)
    }

    private data class ParsedCommand(val command: AsturCommand, val budgetMs: Long?)

    private fun parseCommand(body: String): ParsedCommand {
        val json = JSONObject(body)
        val id = json.optString("id").takeIf { it.isNotBlank() } ?: "unknown"
        val method = json.optString("method").takeIf { it.isNotBlank() }
            ?: json.optString("command").takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("Astur command must include method or command.")
        val paramsRaw = when {
            json.has("params") -> json.opt("params")
            json.has("payload") -> json.opt("payload")
            else -> JSONObject()
        }

        val budgetMs = if (json.has("budgetMs")) json.optLong("budgetMs", -1L).takeIf { it >= 0 } else null

        return ParsedCommand(
            command = AsturCommand(
                id = id,
                method = method,
                params = paramsRaw.asStringMap()
            ),
            budgetMs = budgetMs
        )
    }

    private fun resultToJson(result: AsturCommandResult, elapsedMs: Long): JSONObject {
        val json = JSONObject()
            .put("id", result.id)
            .put("ok", result.ok)
        if (result.executed != null) {
            json.put("executed", result.executed)
        }
        json
            .put(
                "timing",
                JSONObject()
                    .put("totalMs", elapsedMs)
                    .put("agentMs", elapsedMs)
                    .put("hostRoundTrips", 1)
                    .put("usedSnapshot", false)
                    .put("usedLegacyFallback", false)
            )

        if (result.ok) {
            json
                .put("result", toJsonValue(result.result))
                .put("data", toJsonValue(result.result))
        } else {
            val details = result.error?.details
            json.put(
                "error",
                JSONObject()
                    .put("code", result.error?.code ?: "UNKNOWN")
                    .put("message", result.error?.message ?: "Unknown Android agent error.")
                    .put("details", toJsonValue(details))
            )

            if (details is Map<*, *>) {
                val diagnostics = details["diagnostics"]
                if (diagnostics != null) {
                    json.put("diagnostics", toJsonValue(diagnostics))
                }
            }
        }

        return json
    }

    /** A refusal made before the command ran: the host may report it without guessing. */
    private fun refusalJson(id: String, code: String, message: String): JSONObject {
        return errorJson(id, code, message).put("executed", false)
    }

    private fun errorJson(id: String, code: String, message: String): JSONObject {
        return JSONObject()
            .put("id", id)
            .put("ok", false)
            .put(
                "error",
                JSONObject()
                    .put("code", code)
                    .put("message", message)
            )
            .put(
                "timing",
                JSONObject()
                    .put("totalMs", 0)
                    .put("agentMs", 0)
                    .put("hostRoundTrips", 1)
            )
    }

    private fun readHead(input: InputStream): HttpHead {
        val headerBytes = ByteArrayOutputStream()
        var match = 0

        while (true) {
            val next = input.read()
            if (next < 0) {
                throw IllegalArgumentException("Unexpected end of HTTP request headers.")
            }
            if (headerBytes.size() >= MAX_HEADER_BYTES) {
                throw IllegalArgumentException("HTTP request headers are too large.")
            }

            headerBytes.write(next)
            match = when {
                match == 0 && next == '\r'.code -> 1
                match == 1 && next == '\n'.code -> 2
                match == 2 && next == '\r'.code -> 3
                match == 3 && next == '\n'.code -> 4
                next == '\r'.code -> 1
                else -> 0
            }

            if (match == 4) {
                break
            }
        }

        val header = headerBytes.toString(UTF_8.name())
        val lines = header.split("\r\n")
        val requestLine = lines.firstOrNull()?.split(" ") ?: emptyList()
        val method = requestLine.getOrNull(0).orEmpty()
        val path = requestLine.getOrNull(1).orEmpty()
        val headers = lines
            .drop(1)
            .filter { line -> line.contains(':') }
            .associate { line -> line.substringBefore(':').trim().lowercase() to line.substringAfter(':').trim() }
        val contentLength = headers["content-length"]?.toIntOrNull() ?: 0

        return HttpHead(method = method, path = path, headers = headers, contentLength = contentLength)
    }

    private fun readBody(input: InputStream, contentLength: Int): ByteArray {
        if (contentLength <= 0) {
            return ByteArray(0)
        }

        val body = ByteArray(contentLength)
        var offset = 0

        while (offset < contentLength) {
            val read = input.read(body, offset, contentLength - offset)
            if (read < 0) {
                throw IllegalArgumentException("Unexpected end of HTTP request body.")
            }

            offset += read
        }

        return body
    }

    private fun writeJson(socket: Socket, status: Int, body: JSONObject) {
        val payload = body.toString().toByteArray(UTF_8)
        val statusText = when (status) {
            200 -> "OK"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            413 -> "Payload Too Large"
            else -> "Error"
        }
        val header = buildString {
            append("HTTP/1.1 ")
            append(status)
            append(' ')
            append(statusText)
            append("\r\ncontent-type: application/json\r\ncontent-length: ")
            append(payload.size)
            append("\r\nconnection: close\r\n\r\n")
        }.toByteArray(UTF_8)

        socket.getOutputStream().apply {
            write(header)
            write(payload)
            flush()
        }
    }

    private fun Any?.asStringMap(): Map<String, Any?> {
        if (this == null || this == JSONObject.NULL) {
            return emptyMap()
        }

        if (this !is JSONObject) {
            throw IllegalArgumentException("Astur command params/payload must be an object.")
        }

        val result = linkedMapOf<String, Any?>()
        val keys = keys()

        while (keys.hasNext()) {
            val key = keys.next()
            result[key] = fromJsonValue(opt(key))
        }

        return result
    }

    private fun fromJsonValue(value: Any?): Any? {
        return when (value) {
            null, JSONObject.NULL -> null
            is JSONObject -> value.asStringMap()
            is JSONArray -> {
                val list = mutableListOf<Any?>()
                for (index in 0 until value.length()) {
                    list += fromJsonValue(value.opt(index))
                }
                list
            }

            else -> value
        }
    }

    private fun toJsonValue(value: Any?): Any {
        return when (value) {
            null -> JSONObject.NULL
            is Map<*, *> -> {
                val json = JSONObject()
                for ((key, child) in value) {
                    if (key != null) {
                        json.put(key.toString(), toJsonValue(child))
                    }
                }
                json
            }

            is Iterable<*> -> {
                val json = JSONArray()
                for (child in value) {
                    json.put(toJsonValue(child))
                }
                json
            }

            is Array<*> -> {
                val json = JSONArray()
                for (child in value) {
                    json.put(toJsonValue(child))
                }
                json
            }

            else -> value
        }
    }

    private data class HttpHead(
        val method: String,
        val path: String,
        val headers: Map<String, String>,
        val contentLength: Int
    )

    private companion object {
        private val UTF_8: Charset = Charsets.UTF_8
        private const val BACKLOG = 50
        private const val MAX_HEADER_BYTES = 16 * 1024
        private const val MAX_BODY_BYTES = 8 * 1024 * 1024
    }
}
