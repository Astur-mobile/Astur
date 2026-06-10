package dev.astur.agent

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.nio.charset.Charset
import java.util.concurrent.Executors
import kotlin.concurrent.thread

class AsturAgentServer(
    private val port: Int,
    private val agent: AsturAgent = AsturAgent()
) {
    private val executor = Executors.newCachedThreadPool()

    @Volatile
    private var running = false
    private var serverSocket: ServerSocket? = null

    fun startBlocking() {
        running = true

        ServerSocket(port).use { server ->
            serverSocket = server

            while (running) {
                try {
                    val client = server.accept()
                    executor.execute {
                        handleClient(client)
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

    private fun handleClient(socket: Socket) {
        socket.use { client ->
            try {
                val request = readRequest(client.getInputStream())
                val body = when {
                    request.method == "GET" && request.path == "/health" -> {
                        resultToJson(agent.dispatch(AsturCommand(id = "health", method = "agent.ping")), 0L)
                    }

                    request.method == "POST" -> {
                        val command = parseCommand(request.body)
                        val startedAt = SystemClock.elapsedRealtime()
                        val result = agent.dispatch(command)
                        resultToJson(result, SystemClock.elapsedRealtime() - startedAt)
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

    private fun parseCommand(body: String): AsturCommand {
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

        return AsturCommand(
            id = id,
            method = method,
            params = paramsRaw.asStringMap()
        )
    }

    private fun resultToJson(result: AsturCommandResult, elapsedMs: Long): JSONObject {
        val json = JSONObject()
            .put("id", result.id)
            .put("ok", result.ok)
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

    private fun readRequest(input: InputStream): HttpRequest {
        val headerBytes = ByteArrayOutputStream()
        var match = 0

        while (true) {
            val next = input.read()
            if (next < 0) {
                throw IllegalArgumentException("Unexpected end of HTTP request headers.")
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
        val contentLength = lines
            .firstOrNull { line -> line.lowercase().startsWith("content-length:") }
            ?.substringAfter(":")
            ?.trim()
            ?.toIntOrNull()
            ?: 0
        val body = readBody(input, contentLength).toString(UTF_8)

        return HttpRequest(method = method, path = path, body = body)
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
        val statusText = if (status == 200) "OK" else "Error"
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

    private data class HttpRequest(
        val method: String,
        val path: String,
        val body: String
    )

    private companion object {
        private val UTF_8: Charset = Charsets.UTF_8
    }
}
