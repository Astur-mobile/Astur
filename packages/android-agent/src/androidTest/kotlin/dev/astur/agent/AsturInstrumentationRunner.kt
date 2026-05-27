package dev.astur.agent

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle

class AsturInstrumentationRunner : Instrumentation() {
    private var arguments: Bundle? = null
    private var server: AsturAgentServer? = null

    override fun onCreate(arguments: Bundle?) {
        this.arguments = arguments
        super.onCreate(arguments)
        start()
    }

    override fun onStart() {
        super.onStart()

        val port = arguments?.getString("asturPort")?.toIntOrNull() ?: DEFAULT_PORT
        val started = Bundle().apply {
            putString("asturAgent", "started")
            putInt("asturPort", port)
        }
        sendStatus(Activity.RESULT_OK, started)

        server = AsturAgentServer(port, AsturAgent(this))

        try {
            server?.startBlocking()
        } catch (error: Throwable) {
            val failed = Bundle().apply {
                putString("asturAgent", "failed")
                putString("error", error.message ?: error.javaClass.name)
            }
            sendStatus(Activity.RESULT_CANCELED, failed)
            finish(Activity.RESULT_CANCELED, failed)
        }
    }

    override fun finish(resultCode: Int, results: Bundle?) {
        server?.stop()
        server = null
        super.finish(resultCode, results)
    }

    private companion object {
        private const val DEFAULT_PORT = 8729
    }
}
