import XCTest

final class AsturAgentUITests: XCTestCase {
    private var server: AsturAgentServer?

    override func tearDown() {
        server?.stop()
        server = nil
        super.tearDown()
    }

    func testAgentServer() throws {
        let environment = ProcessInfo.processInfo.environment
        let bundleIdentifier = runtimeValue("ASTUR_AUT_BUNDLE_ID", environment: environment) ?? "com.astur.demo"
        let port = UInt16(runtimeValue("ASTUR_IOS_AGENT_PORT", environment: environment) ?? "8788") ?? 8788
        let shouldLaunch = runtimeValue("ASTUR_AUT_LAUNCH", environment: environment) != "0"
        let bridgeUrl = runtimeValue("ASTUR_IOS_AGENT_BRIDGE_URL", environment: environment).flatMap(URL.init(string:))

        let agent = AsturAgent(bundleIdentifier: bundleIdentifier)
        if shouldLaunch {
            agent.launchIfNeeded()
        }

        if let bridgeUrl {
            AsturAgentBridgeClient(agent: agent, bridgeUrl: bridgeUrl).run()
            return
        }

        let server = AsturAgentServer(port: port, agent: agent)
        try server.start()
        self.server = server

        RunLoop.current.run()
    }

    private func runtimeValue(_ key: String, environment: [String: String]) -> String? {
        if let value = environment[key]?.nonEmpty, !value.hasPrefix("$(") {
            return value
        }

        if let value = Bundle(for: AsturAgentUITests.self).object(forInfoDictionaryKey: key) as? String,
           let nonEmpty = value.nonEmpty,
           !nonEmpty.hasPrefix("$(") {
            return nonEmpty
        }

        return nil
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
