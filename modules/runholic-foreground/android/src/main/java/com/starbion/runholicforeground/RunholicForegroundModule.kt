package com.starbion.runholicforeground

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

class RunholicForegroundModule : Module() {
    private var receiverRegistered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != RunTrackingService.ACTION_SESSION_UPDATE) return

            val payload = mutableMapOf<String, Any?>()

            payload["sessionId"] = intent.getStringExtra("sessionId")
            payload["isRunning"] = intent.getBooleanExtra("isRunning", false)
            payload["isPaused"] = intent.getBooleanExtra("isPaused", false)
            payload["startedAt"] = intent.getLongExtra("startedAt", 0L).toDouble()

            payload["elapsedMs"] = intent.getLongExtra("elapsedMs", 0L).toDouble()
            payload["durationSec"] = intent.getLongExtra("durationSec", 0L).toDouble()
            payload["distanceMeters"] = intent.getDoubleExtra("distanceMeters", 0.0)

            payload["avgPaceSec"] = intent.getDoubleExtra("avgPaceSec", 0.0)
            payload["currentPaceSec"] = intent.getDoubleExtra("currentPaceSec", 0.0)
            payload["paceState"] = intent.getStringExtra("paceState") ?: "안정"

            payload["elevationGainMeters"] =
                intent.getDoubleExtra("elevationGainMeters", 0.0)
            payload["elevationLossMeters"] =
                intent.getDoubleExtra("elevationLossMeters", 0.0)
            payload["cadence"] = intent.getDoubleExtra("cadence", 0.0)
            payload["calories"] = intent.getDoubleExtra("calories", 0.0)

            payload["targetDistanceKm"] =
                intent.getDoubleExtra("targetDistanceKm", -1.0)
            payload["remainingDistanceKm"] =
                intent.getDoubleExtra("remainingDistanceKm", -1.0)

            payload["aiCoachAnalysis"] =
                intent.getStringExtra("aiCoachAnalysis") ?: ""
            payload["runnerType"] =
                intent.getStringExtra("runnerType") ?: "중립"
            payload["runnerTrait"] =
                intent.getStringExtra("runnerTrait") ?: "미분류"

            payload["autoPausedByGpsLoss"] =
                intent.getBooleanExtra("autoPausedByGpsLoss", false)
            payload["gpsLossNoticePending"] =
                intent.getBooleanExtra("gpsLossNoticePending", false)

            payload["routeSegments"] =
                jsonToNestedArray(intent.getStringExtra("routeSegmentsJson"))
            payload["splits"] =
                jsonToArray(intent.getStringExtra("splitsJson"))
            payload["lastPoint"] =
                jsonToMap(intent.getStringExtra("lastPointJson"))
            payload["pendingAnnouncements"] =
                jsonToArray(intent.getStringExtra("pendingAnnouncementsJson"))

            payload["notificationVisible"] =
                intent.getBooleanExtra("notificationVisible", false)

            sendEvent("onSessionUpdate", payload)
        }
    }

    override fun definition() = ModuleDefinition {
        Name("RunholicForeground")

        Events("onSessionUpdate")

        OnCreate {
            ensureReceiverRegistered()
        }

        OnDestroy {
            unregisterReceiver()
        }

        AsyncFunction("startRun") {
                sessionId: String,
                targetDistanceKm: Double,
                weightKg: Double,
                strideCm: Double,
                heightCm: Double,
                sex: String,
                runnerType: String,
                runnerTrait: String ->

            try {
                val context = requireContext()

               val intent = Intent(context, RunTrackingService::class.java).apply {
                    action = RunTrackingService.ACTION_START
                    putExtra(RunTrackingService.EXTRA_SESSION_ID, sessionId)
                    putExtra(RunTrackingService.EXTRA_TARGET_DISTANCE_KM, targetDistanceKm)
                    putExtra(RunTrackingService.EXTRA_WEIGHT_KG, weightKg)
                    putExtra(RunTrackingService.EXTRA_STRIDE_CM, strideCm)
                    putExtra(RunTrackingService.EXTRA_HEIGHT_CM, heightCm)
                    putExtra(RunTrackingService.EXTRA_SEX, sex)
                    putExtra(RunTrackingService.EXTRA_RUNNER_TYPE, runnerType)
                    putExtra(RunTrackingService.EXTRA_RUNNER_TRAIT, runnerTrait)
                }

                ContextCompat.startForegroundService(context, intent)
                true
            } catch (e: Exception) {
                throw Exception("START_RUN_NATIVE_FAILED: ${e.javaClass.simpleName}: ${e.message}", e)
            }
        }

        AsyncFunction("pauseRun") {
            val context = requireContext()

            val intent = Intent(context, RunTrackingService::class.java).apply {
                action = RunTrackingService.ACTION_PAUSE
            }

            ContextCompat.startForegroundService(context, intent)
            true
        }

        AsyncFunction("resumeRun") {
            val context = requireContext()

            val intent = Intent(context, RunTrackingService::class.java).apply {
                action = RunTrackingService.ACTION_RESUME
            }

            ContextCompat.startForegroundService(context, intent)
            true
        }

        AsyncFunction("stopRun") {
            val context = requireContext()

            val intent = Intent(context, RunTrackingService::class.java).apply {
                action = RunTrackingService.ACTION_STOP
            }

            ContextCompat.startForegroundService(context, intent)
            true
        }

        AsyncFunction("ensureNotification") {
            val context = requireContext()

            val intent = Intent(context, RunTrackingService::class.java).apply {
                action = RunTrackingService.ACTION_ENSURE_NOTIFICATION
            }

            ContextCompat.startForegroundService(context, intent)
            true
        }

        AsyncFunction("getCurrentSession") {
            RunSessionStore.snapshot().toMap()
        }

        AsyncFunction("updateVoiceSettings") { reportEnabled: Boolean, coachEnabled: Boolean ->
            val context = requireContext()
            RunholicTTSManager.init(context)
            RunholicTTSManager.updateSettings(reportEnabled, coachEnabled)
            true
        }
    }

    private fun requireContext(): Context {
        return appContext.reactContext
            ?: throw IllegalStateException("React context is not available.")
    }

    private fun ensureReceiverRegistered() {
        if (receiverRegistered) return

        val context = appContext.reactContext ?: return

        val filter = IntentFilter().apply {
            addAction(RunTrackingService.ACTION_SESSION_UPDATE)
        }

        if (android.os.Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            context.registerReceiver(receiver, filter)
        }

        receiverRegistered = true
    }

    private fun unregisterReceiver() {
        if (!receiverRegistered) return

        val context = appContext.reactContext ?: return

        try {
            context.unregisterReceiver(receiver)
        } catch (_: Exception) {
        }

        receiverRegistered = false
    }

    private fun jsonToNestedArray(json: String?): List<Any?> {
        if (json.isNullOrEmpty() || json == "[]") return emptyList()

        val outer = JSONArray(json)
        val result = mutableListOf<Any?>()

        for (i in 0 until outer.length()) {
            val segment = outer.getJSONArray(i)
            val inner = mutableListOf<Any?>()

            for (j in 0 until segment.length()) {
                val obj = segment.getJSONObject(j)
                inner.add(jsonObjectToMap(obj))
            }

            result.add(inner)
        }

        return result
    }

    private fun jsonToArray(json: String?): List<Any?> {
        if (json.isNullOrEmpty() || json == "[]") return emptyList()

        val jsonArr = JSONArray(json)
        val result = mutableListOf<Any?>()

        for (i in 0 until jsonArr.length()) {
            val value = jsonArr.get(i)
            result.add(jsonValueToAny(value))
        }

        return result
    }

    private fun jsonToMap(json: String?): Map<String, Any?>? {
        if (json.isNullOrEmpty() || json == "null") return null
        val obj = JSONObject(json)
        return jsonObjectToMap(obj)
    }

    private fun jsonObjectToMap(obj: JSONObject): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>()
        val keys = obj.keys()

        while (keys.hasNext()) {
            val key = keys.next()
            val value = obj.get(key)
            map[key] = jsonValueToAny(value)
        }

        return map
    }

    private fun jsonValueToAny(value: Any?): Any? {
        return when (value) {
            JSONObject.NULL -> null
            is JSONObject -> jsonObjectToMap(value)
            is JSONArray -> {
                val list = mutableListOf<Any?>()
                for (i in 0 until value.length()) {
                    list.add(jsonValueToAny(value.get(i)))
                }
                list
            }
            is Int -> value
            is Long -> value.toDouble()
            is Float -> value.toDouble()
            is Double -> value
            is Boolean -> value
            is String -> value
            else -> value?.toString()
        }
    }
}