package com.starbion.runholicforeground

data class RoutePointState(
    val latitude: Double,
    val longitude: Double,
    val altitude: Double? = null,
    val timestamp: Long = 0L,
    val accuracy: Double? = null
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "latitude" to latitude,
            "longitude" to longitude,
            "altitude" to altitude,
            "timestamp" to timestamp,
            "accuracy" to accuracy
        )
    }
}

data class RunSplitState(
    val km: Int,
    val avgPaceSec: Double,
    val cumulativeElevationGainM: Double = 0.0,
    val elevationDeltaM: Double = 0.0,
    val elevationGainM: Double = 0.0,
    val elevationLossM: Double = 0.0
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "km" to km,
            "avgPaceSec" to avgPaceSec,
            "cumulativeElevationGainM" to cumulativeElevationGainM,
            "elevationDeltaM" to elevationDeltaM,
            "elevationGainM" to elevationGainM,
            "elevationLossM" to elevationLossM
        )
    }
}

data class SpeechAnnouncementState(
    val key: String? = null,
    val reportText: String? = null,
    val coachText: String? = null
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "key" to key,
            "reportText" to reportText,
            "coachText" to coachText
        )
    }
}

data class RunSessionState(
    val sessionId: String? = null,
    val isRunning: Boolean = false,
    val isPaused: Boolean = false,
    val startedAt: Long = 0L,
    val resumedAt: Long,

    val elapsedMs: Long = 0L,
    val durationSec: Long = 0L,
    val distanceMeters: Double = 0.0,

    val avgPaceSec: Double = 0.0,
    val currentPaceSec: Double = 0.0,
    val paceState: String = "안정",
    val avgPaceLevel: String = "보통",

    val elevationGainMeters: Double = 0.0,
    val elevationLossMeters: Double = 0.0,
    val cadence: Double = 0.0,
    val calories: Double = 0.0,

    val targetDistanceKm: Double? = null,
    val remainingDistanceKm: Double? = null,

    val aiCoachAnalysis: String = "러닝을 시작하면 AI 코치 분석이 표시됩니다.",
    val runnerType: String = "중립",
    val runnerTrait: String = "미분류",

    val routeSegments: List<List<RoutePointState>> = emptyList(),
    val splits: List<RunSplitState> = emptyList(),
    val lastPoint: RoutePointState? = null,

    val autoPausedByGpsLoss: Boolean = false,
    val gpsLossNoticePending: Boolean = false,

    val pendingAnnouncements: List<SpeechAnnouncementState> = emptyList(),

    val notificationVisible: Boolean = false
) {
    fun toMap(): Map<String, Any?> {
        return mapOf(
            "sessionId" to sessionId,
            "isRunning" to isRunning,
            "isPaused" to isPaused,
            "startedAt" to startedAt,
            "resumedAt" to resumedAt,

            "elapsedMs" to elapsedMs,
            "durationSec" to durationSec,
            "distanceMeters" to distanceMeters,

            "avgPaceSec" to avgPaceSec,
            "currentPaceSec" to currentPaceSec,
            "paceState" to paceState,
            "avgPaceLevel" to avgPaceLevel,

            "elevationGainMeters" to elevationGainMeters,
            "elevationLossMeters" to elevationLossMeters,
            "cadence" to cadence,
            "calories" to calories,

            "targetDistanceKm" to targetDistanceKm,
            "remainingDistanceKm" to remainingDistanceKm,

            "aiCoachAnalysis" to aiCoachAnalysis,
            "runnerType" to runnerType,
            "runnerTrait" to runnerTrait,

            "routeSegments" to routeSegments.map { segment ->
                segment.map { it.toMap() }
            },
            "splits" to splits.map { it.toMap() },
            "lastPoint" to lastPoint?.toMap(),

            "autoPausedByGpsLoss" to autoPausedByGpsLoss,
            "gpsLossNoticePending" to gpsLossNoticePending,

            "pendingAnnouncements" to pendingAnnouncements.map { it.toMap() },

            "notificationVisible" to notificationVisible
        )
    }
}