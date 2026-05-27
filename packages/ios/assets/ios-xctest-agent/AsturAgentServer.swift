import Foundation
import Network

final class AsturAgentServer {
    private let port: UInt16
    private let agent: AsturAgent
    private let queue = DispatchQueue(label: "dev.astur.ios-agent.server")
    private var listener: NWListener?

    init(port: UInt16, agent: AsturAgent) {
        self.port = port
        self.agent = agent
    }

    func start() throws {
        let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
        listener.stateUpdateHandler = { state in
            print("Astur iOS agent listener state: \(state)")
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        read(connection, buffer: Data())
    }

    private func read(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }

            if error != nil {
                connection.cancel()
                return
            }

            var next = buffer
            if let data {
                next.append(data)
            }

            if let request = HttpRequest(data: next) {
                self.respond(to: request, connection: connection)
                return
            }

            if isComplete {
                self.write(
                    connection,
                    status: 400,
                    body: self.errorJson(id: "unknown", code: "BAD_REQUEST", message: "Incomplete Astur HTTP command.")
                )
                return
            }

            self.read(connection, buffer: next)
        }
    }

    private func respond(to request: HttpRequest, connection: NWConnection) {
        do {
            let body: [String: Any]
            if request.method == "GET" && request.path == "/health" {
                let startedAt = Date()
                body = resultJson(
                    agent.dispatch(AsturCommand(id: "health", method: "agent.ping", params: [:])),
                    elapsedMs: elapsedMs(startedAt)
                )
            } else if request.method == "POST" {
                let command = try parseCommand(request.body)
                let startedAt = Date()
                body = resultJson(agent.dispatch(command), elapsedMs: elapsedMs(startedAt))
            } else {
                body = errorJson(
                    id: "unknown",
                    code: "UNSUPPORTED_HTTP_METHOD",
                    message: "Astur agent expects POST commands."
                )
            }

            write(connection, status: 200, body: body)
        } catch {
            write(
                connection,
                status: 500,
                body: errorJson(
                    id: "unknown",
                    code: "SERVER_ERROR",
                    message: String(describing: error)
                )
            )
        }
    }

    private func parseCommand(_ body: Data) throws -> AsturCommand {
        let raw = try JSONSerialization.jsonObject(with: body)
        guard let json = raw as? [String: Any] else {
            throw ServerFailure("Astur command must be a JSON object.")
        }

        let id = (json["id"] as? String)?.nonEmpty ?? "unknown"
        let method = (json["method"] as? String)?.nonEmpty
            ?? (json["command"] as? String)?.nonEmpty

        guard let method else {
            throw ServerFailure("Astur command must include method or command.")
        }

        let params = (json["params"] as? [String: Any])
            ?? (json["payload"] as? [String: Any])
            ?? [:]

        return AsturCommand(id: id, method: method, params: params)
    }

    private func resultJson(_ result: AsturCommandResult, elapsedMs: Int) -> [String: Any] {
        var body: [String: Any] = [
            "id": result.id,
            "ok": result.ok,
            "timing": [
                "totalMs": elapsedMs,
                "agentMs": elapsedMs,
                "hostRoundTrips": 1,
                "usedSnapshot": false,
                "usedLegacyFallback": false
            ]
        ]

        if result.ok {
            body["result"] = result.result ?? NSNull()
            body["data"] = result.result ?? NSNull()
        } else {
            var error: [String: Any] = [
                "code": result.error?.code ?? "UNKNOWN",
                "message": result.error?.message ?? "Unknown iOS agent error."
            ]
            if let details = result.error?.details {
                error["details"] = details
            }
            body["error"] = error
        }

        return body
    }

    private func errorJson(id: String, code: String, message: String) -> [String: Any] {
        [
            "id": id,
            "ok": false,
            "error": [
                "code": code,
                "message": message
            ],
            "timing": [
                "totalMs": 0,
                "agentMs": 0,
                "hostRoundTrips": 1
            ]
        ]
    }

    private func write(_ connection: NWConnection, status: Int, body: [String: Any]) {
        let payload = (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
        var response = Data()
        let header = """
        HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r
        content-type: application/json\r
        content-length: \(payload.count)\r
        connection: close\r
        \r

        """
        response.append(header.data(using: .utf8)!)
        response.append(payload)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func elapsedMs(_ startedAt: Date) -> Int {
        max(0, Int(Date().timeIntervalSince(startedAt) * 1_000))
    }
}

private struct HttpRequest {
    let method: String
    let path: String
    let body: Data

    init?(data: Data) {
        guard let separator = data.range(of: Data("\r\n\r\n".utf8)) else {
            return nil
        }

        let headerData = data[..<separator.lowerBound]
        guard let header = String(data: headerData, encoding: .utf8) else {
            return nil
        }

        let lines = header.components(separatedBy: "\r\n")
        let requestLine = lines.first?.split(separator: " ").map(String.init) ?? []
        guard requestLine.count >= 2 else {
            return nil
        }

        let contentLength = lines
            .first { $0.lowercased().hasPrefix("content-length:") }
            .flatMap { Int($0.split(separator: ":", maxSplits: 1).last?.trimmingCharacters(in: .whitespaces) ?? "") }
            ?? 0

        let bodyStart = separator.upperBound
        guard data.count - bodyStart >= contentLength else {
            return nil
        }

        self.method = requestLine[0]
        self.path = requestLine[1]
        self.body = data[bodyStart..<(bodyStart + contentLength)]
    }
}

private struct ServerFailure: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
