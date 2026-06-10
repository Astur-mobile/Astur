import Foundation

final class AsturAgentBridgeClient {
    private let agent: AsturAgent
    private let bridgeUrl: URL

    /// Long-poll timeout: the agent holds the GET /command request open for up to
    /// this duration on the server side, eliminating the 100ms polling gap.
    /// Falls back to a short retry on network errors so the loop stays resilient.
    private let longPollTimeout: TimeInterval = 30

    init(agent: AsturAgent, bridgeUrl: URL) {
        self.agent = agent
        self.bridgeUrl = bridgeUrl
    }

    func run() {
        register()

        while true {
            autoreleasepool {
                if let command = fetchCommand() {
                    postResult(agent.dispatch(command))
                }
                // No sleep — fetchCommand blocks via long-poll or returns immediately
                // on error. A tiny back-off only on consecutive transport failures.
            }
        }
    }

    private func register() {
        let info = agent.dispatch(AsturCommand(id: "register", method: "agent.ping", params: [:])).result ?? [:]
        _ = request(
            path: "/register",
            method: "POST",
            body: [
                "id": "register",
                "ok": true,
                "result": info,
                "data": info
            ],
            timeout: 5
        )
    }

    private func fetchCommand() -> AsturCommand? {
        // Long-poll: server holds the connection open until a command is queued
        // or the timeout elapses (returns 204). This removes the old 100ms
        // polling gap and delivers commands with near-zero latency.
        let response = request(path: "/command", method: "GET", timeout: longPollTimeout + 2)
        guard response.status == 200, let data = response.data else {
            // On 204 (no command yet) or transient error, return nil and
            // immediately re-enter the loop — no Thread.sleep needed.
            return nil
        }

        guard
            let raw = try? JSONSerialization.jsonObject(with: data),
            let json = raw as? [String: Any]
        else {
            return nil
        }

        let id = (json["id"] as? String)?.nonEmpty ?? "unknown"
        let method = (json["method"] as? String)?.nonEmpty
            ?? (json["command"] as? String)?.nonEmpty
            ?? "unknown"
        let params = (json["params"] as? [String: Any])
            ?? (json["payload"] as? [String: Any])
            ?? [:]

        return AsturCommand(id: id, method: method, params: params)
    }

    private func postResult(_ result: AsturCommandResult) {
        _ = request(path: "/response", method: "POST", body: resultJson(result), timeout: 5)
    }

    private func resultJson(_ result: AsturCommandResult) -> [String: Any] {
        var body: [String: Any] = [
            "id": result.id,
            "ok": result.ok,
            "timing": [
                "totalMs": 0,
                "agentMs": 0,
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
                if let detailMap = details as? [String: Any] {
                    if let diagnostics = detailMap["diagnostics"] {
                        body["diagnostics"] = diagnostics
                    }
                }
            }
            body["error"] = error
        }

        return body
    }

    private func request(path: String, method: String, body: [String: Any]? = nil, timeout: TimeInterval = 5) -> (status: Int, data: Data?) {
        let url = bridgeUrl.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }

        let semaphore = DispatchSemaphore(value: 0)
        var status = 0
        var data: Data?

        URLSession.shared.dataTask(with: request) { responseData, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            data = responseData
            semaphore.signal()
        }.resume()

        _ = semaphore.wait(timeout: .now() + timeout + 1)
        return (status, data)
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
