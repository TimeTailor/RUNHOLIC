package com.starbion.runholicforeground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class RunTrackingService : Service() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var notificationGuardian: NotificationGuardian

    @Suppress("MissingPermission")
    private fun getLastKnownRoutePoint(): RoutePointState? {
        return try {
            val task = fusedLocationClient.lastLocation
            val location = com.google.android.gms.tasks.Tasks.await(task)
            if (location != null) {
                RoutePointState(
                    latitude = location.latitude,
                    longitude = location.longitude,
                    altitude = if (location.hasAltitude()) location.altitude else null,
                    timestamp = if (location.time > 0L) location.time else System.currentTimeMillis(),
                    accuracy = location.accuracy.toDouble()
                )
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private var isForegroundStarted = false
    private var isLocationUpdatesActive = false

    private val ticker = object : Runnable {
        override fun run() {
            RunSessionStore.tick(System.currentTimeMillis())
            val snapshot = RunSessionStore.snapshot()

            if (snapshot.isRunning) {
                if (!snapshot.isPaused && RunSessionStore.shouldAutoPauseForGpsLoss()) {
                    RunSessionStore.autoPauseByGpsLoss(System.currentTimeMillis())
                    stopLocationUpdates()
                }

                refreshForegroundNotification()
                emitSessionUpdate()
                mainHandler.postDelayed(this, 1000L)
            }
        }
    }

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val locations = result.locations
            if (locations.isEmpty()) return

            for (location in locations) {
                val point = RoutePointState(
                    latitude = location.latitude,
                    longitude = location.longitude,
                    altitude = if (location.hasAltitude()) location.altitude else null,
                    timestamp = if (location.time > 0L) location.time else System.currentTimeMillis(),
                    accuracy = location.accuracy.toDouble()
                )

                RunSessionStore.onLocation(point)
            }

            refreshForegroundNotification()
            emitSessionUpdate()
        }
    }

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()

        notificationGuardian = NotificationGuardian(
            context = this,
            notificationId = NOTIFICATION_ID,
            rebuild = { buildNotification() }
        )

        RunholicTTSManager.init(this)

        RunholicTTSManager.setOnItemFinishedListener { item ->
            if (item.key == "run_finish") {
                mainHandler.post {
                    stopServiceNow()
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> handleStart(intent)
            ACTION_PAUSE -> handlePause()
            ACTION_RESUME -> handleResume()
            ACTION_STOP -> handleStop()
            ACTION_ENSURE_NOTIFICATION -> handleEnsureNotification()
            else -> {
                if (RunSessionStore.snapshot().isRunning) {
                    refreshForegroundNotification()
                    emitSessionUpdate()
                }
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        stopTicking()
        stopLocationUpdates()
        RunholicTTSManager.shutdown()
        super.onDestroy()
    }

    private fun handleStart(intent: Intent) {
        val existing = RunSessionStore.snapshot()
        if (!existing.isRunning) {
            val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
                ?: System.currentTimeMillis().toString()

            val targetDistanceKm =
                if (intent.hasExtra(EXTRA_TARGET_DISTANCE_KM)) {
                    intent.getDoubleExtra(EXTRA_TARGET_DISTANCE_KM, -1.0)
                        .takeIf { it >= 0.0 }
                } else {
                    null
                }

            val weightKg = intent.getDoubleExtra(EXTRA_WEIGHT_KG, 0.0)
            val strideCm = intent.getDoubleExtra(EXTRA_STRIDE_CM, 0.0)
            val heightCm = intent.getDoubleExtra(EXTRA_HEIGHT_CM, 0.0)
            val sex = intent.getStringExtra(EXTRA_SEX) ?: "남성"
            val runnerType = intent.getStringExtra(EXTRA_RUNNER_TYPE) ?: "중립"
            val runnerTrait = intent.getStringExtra(EXTRA_RUNNER_TRAIT) ?: "미분류"

            val currentLocation = getLastKnownRoutePoint()

            RunSessionStore.startNewSession(
                id = sessionId,
                targetDistanceKm = targetDistanceKm,
                weightKg = weightKg,
                strideCm = strideCm,
                heightCm = heightCm,
                sex = sex,
                runnerType = runnerType,
                runnerTrait = runnerTrait,
                currentLocation = currentLocation
            )
        }

        startOrUpdateForeground(forceStartForeground = true)
        startTicking()

        if (!RunSessionStore.snapshot().isPaused) {
            startLocationUpdates()
        }

        mainHandler.postDelayed({
            enqueueReportTts("run_start", "러닝을 시작합니다.")
        }, 180L)
        emitSessionUpdate()
    }

    private fun handlePause() {
        val snapshot = RunSessionStore.snapshot()
        if (!snapshot.isRunning) return

        RunSessionStore.pause()
        stopLocationUpdates()
        enqueueReportTts("run_pause", "러닝을 일시정지합니다.")
        refreshForegroundNotification()
        emitSessionUpdate()
    }

    private fun handleResume() {
        val snapshot = RunSessionStore.snapshot()
        if (!snapshot.isRunning) return

        val currentLocation = getLastKnownRoutePoint()

        RunSessionStore.resume(currentLocation)
        startOrUpdateForeground(forceStartForeground = false)
        startTicking()
        startLocationUpdates()
        enqueueReportTts("run_resume", "러닝을 다시 시작합니다.")
        emitSessionUpdate()
    }

    private fun handleStop() {
        stopTicking()
        stopLocationUpdates()

        val currentLocation = getLastKnownRoutePoint()
        RunSessionStore.stop(currentLocation)

        emitSessionUpdate()

        enqueueReportTts("run_finish", "러닝을 종료합니다.")
    }

    private fun handleEnsureNotification() {
        if (!RunSessionStore.snapshot().isRunning) return

        startOrUpdateForeground(forceStartForeground = !isForegroundStarted)
        notificationGuardian.ensurePosted()
        emitSessionUpdate()
    }

    private fun startTicking() {
        mainHandler.removeCallbacks(ticker)
        mainHandler.post(ticker)
    }

    private fun stopTicking() {
        mainHandler.removeCallbacks(ticker)
    }

    private fun stopServiceNow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }

        isForegroundStarted = false
        stopSelf()
    }

    private fun startLocationUpdates() {
        if (isLocationUpdatesActive) return
        val snapshot = RunSessionStore.snapshot()
        if (!snapshot.isRunning || snapshot.isPaused) return

        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            1000L
        )
            .setMinUpdateIntervalMillis(1000L)
            .setMinUpdateDistanceMeters(2f)
            .setWaitForAccurateLocation(false)
            .build()

        try {
            fusedLocationClient.requestLocationUpdates(
                request,
                locationCallback,
                Looper.getMainLooper()
            )
            isLocationUpdatesActive = true
        } catch (_: SecurityException) {
            refreshForegroundNotification()
            emitSessionUpdate()
        }
    }

    private fun stopLocationUpdates() {
        if (!isLocationUpdatesActive) return
        fusedLocationClient.removeLocationUpdates(locationCallback)
        isLocationUpdatesActive = false
    }

    private fun refreshForegroundNotification() {
        val snapshot = RunSessionStore.snapshot()
        if (!snapshot.isRunning) return
        startOrUpdateForeground(forceStartForeground = false)
    }

    private fun startOrUpdateForeground(forceStartForeground: Boolean) {
        val notification = buildNotification()

        if (forceStartForeground || !isForegroundStarted) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            isForegroundStarted = true
        } else {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val snapshot = RunSessionStore.snapshot()
        val elapsedText = formatElapsed(snapshot.elapsedMs)
        val distanceKm = snapshot.distanceMeters / 1000.0
        val avgPaceText =
            if (snapshot.avgPaceSec > 0.0) "${formatPace(snapshot.avgPaceSec)}/km" else "00:00/km"

        val title = if (snapshot.isPaused) {
            "RUNHOLIC 일시정지됨"
        } else {
            "RUNHOLIC"
        }

        val body = if (snapshot.isPaused) {
            "러닝 일시정지 (재개/종료: 앱 내부에서)\n$elapsedText · ${String.format(Locale.US, "%.2f", distanceKm)}km · 평균 $avgPaceText"
        } else {
            "러닝 기록 중 (일시정지/종료: 앱 내부에서)\n$elapsedText · ${String.format(Locale.US, "%.2f", distanceKm)}km · 평균 $avgPaceText"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(createContentIntent())
            .build()
    }

    private fun createContentIntent(): PendingIntent? {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: return null

        launchIntent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP

        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        return PendingIntent.getActivity(
            this,
            1001,
            launchIntent,
            pendingFlags
        )
    }

    private fun getNotificationVisible(): Boolean {
        val running = RunSessionStore.snapshot().isRunning
        if (!running) return false
        return notificationGuardian.isVisible()
    }

    private fun enqueueReportTts(key: String, text: String, urgent: Boolean = true) {
        if (!RunholicTTSManager.isReportEnabled()) return

        RunholicTTSManager.enqueue(
            TtsQueueItem(
                key = key,
                reportText = text,
                coachText = null,
                urgent = urgent
            )
        )
    }

    private fun emitSessionUpdate() {
        val snapshot = RunSessionStore.snapshot(
            notificationVisible = getNotificationVisible()
        )
        val drainedAnnouncements = RunSessionStore.drainPendingAnnouncements()

        drainedAnnouncements.forEach { item ->
            RunholicTTSManager.enqueue(
                TtsQueueItem(
                    key = item.key,
                    reportText = item.reportText,
                    coachText = item.coachText,
                    urgent = false
                )
            )
        }

        val intent = Intent(ACTION_SESSION_UPDATE).apply {
            setPackage(packageName)

            putExtra("sessionId", snapshot.sessionId)
            putExtra("isRunning", snapshot.isRunning)
            putExtra("isPaused", snapshot.isPaused)
            putExtra("startedAt", snapshot.startedAt)

            putExtra("elapsedMs", snapshot.elapsedMs)
            putExtra("durationSec", snapshot.durationSec)
            putExtra("distanceMeters", snapshot.distanceMeters)

            putExtra("avgPaceSec", snapshot.avgPaceSec)
            putExtra("currentPaceSec", snapshot.currentPaceSec)
            putExtra("paceState", snapshot.paceState)

            putExtra("elevationGainMeters", snapshot.elevationGainMeters)
            putExtra("elevationLossMeters", snapshot.elevationLossMeters)
            putExtra("cadence", snapshot.cadence)
            putExtra("calories", snapshot.calories)

            putExtra("targetDistanceKm", snapshot.targetDistanceKm ?: -1.0)
            putExtra("remainingDistanceKm", snapshot.remainingDistanceKm ?: -1.0)

            putExtra("aiCoachAnalysis", snapshot.aiCoachAnalysis)
            putExtra("runnerType", snapshot.runnerType)
            putExtra("runnerTrait", snapshot.runnerTrait)

            putExtra("autoPausedByGpsLoss", snapshot.autoPausedByGpsLoss)
            putExtra("gpsLossNoticePending", snapshot.gpsLossNoticePending)

            putExtra("routeSegmentsJson", routeSegmentsToJson(snapshot.routeSegments))
            putExtra("splitsJson", splitsToJson(snapshot.splits))
            putExtra("lastPointJson", lastPointToJson(snapshot.lastPoint))

            putExtra("pendingAnnouncementsJson", "[]")

            putExtra("notificationVisible", snapshot.notificationVisible)
        }

        sendBroadcast(intent)
    }

    private fun routeSegmentsToJson(routeSegments: List<List<RoutePointState>>): String {
        val outer = JSONArray()

        routeSegments.forEach { segment ->
            val inner = JSONArray()
            segment.forEach { point ->
                val obj = JSONObject()
                obj.put("latitude", point.latitude)
                obj.put("longitude", point.longitude)
                obj.put("altitude", point.altitude)
                obj.put("timestamp", point.timestamp)
                obj.put("accuracy", point.accuracy)
                inner.put(obj)
            }
            outer.put(inner)
        }

        return outer.toString()
    }

    private fun splitsToJson(splits: List<RunSplitState>): String {
        val arr = JSONArray()

        splits.forEach { split ->
            val obj = JSONObject()
            obj.put("km", split.km)
            obj.put("avgPaceSec", split.avgPaceSec)
            obj.put("cumulativeElevationGainM", split.cumulativeElevationGainM)
            obj.put("elevationDeltaM", split.elevationDeltaM)
            obj.put("elevationGainM", split.elevationGainM)
            obj.put("elevationLossM", split.elevationLossM)
            arr.put(obj)
        }

        return arr.toString()
    }

    private fun lastPointToJson(lastPoint: RoutePointState?): String {
        if (lastPoint == null) return "null"

        val obj = JSONObject()
        obj.put("latitude", lastPoint.latitude)
        obj.put("longitude", lastPoint.longitude)
        obj.put("altitude", lastPoint.altitude)
        obj.put("timestamp", lastPoint.timestamp)
        obj.put("accuracy", lastPoint.accuracy)
        return obj.toString()
    }

    private fun announcementsToJson(items: List<SpeechAnnouncementState>): String {
        val arr = JSONArray()

        items.forEach { item ->
            val obj = JSONObject()
            obj.put("key", item.key)
            obj.put("reportText", item.reportText)
            obj.put("coachText", item.coachText)
            arr.put(obj)
        }

        return arr.toString()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "RUNHOLIC Tracker",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "RUNHOLIC 러닝 기록용 포그라운드 서비스 채널"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val notificationManager =
            getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.createNotificationChannel(channel)
    }

    private fun formatElapsed(elapsedMs: Long): String {
        val totalSeconds = (elapsedMs / 1000L).coerceAtLeast(0L)
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L

        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, seconds)
    }

    private fun formatPace(secPerKm: Double): String {
        if (!secPerKm.isFinite() || secPerKm <= 0.0) return "00:00"
        val totalSec = secPerKm.toInt()
        val minutes = totalSec / 60
        val seconds = totalSec % 60
        return String.format(Locale.US, "%02d:%02d", minutes, seconds)
    }

    companion object {
        const val ACTION_START = "com.starbion.runholicforeground.action.START"
        const val ACTION_PAUSE = "com.starbion.runholicforeground.action.PAUSE"
        const val ACTION_RESUME = "com.starbion.runholicforeground.action.RESUME"
        const val ACTION_STOP = "com.starbion.runholicforeground.action.STOP"
        const val ACTION_ENSURE_NOTIFICATION =
            "com.starbion.runholicforeground.action.ENSURE_NOTIFICATION"
        const val ACTION_SESSION_UPDATE =
            "com.starbion.runholicforeground.action.SESSION_UPDATE"

        const val EXTRA_SESSION_ID = "sessionId"
        const val EXTRA_TARGET_DISTANCE_KM = "targetDistanceKm"
        const val EXTRA_WEIGHT_KG = "weightKg"
        const val EXTRA_STRIDE_CM = "strideCm"
        const val EXTRA_RUNNER_TYPE = "runnerType"
        const val EXTRA_RUNNER_TRAIT = "runnerTrait"
        const val EXTRA_HEIGHT_CM = "heightCm"
        const val EXTRA_SEX = "sex"

        private const val CHANNEL_ID = "runholic-tracker"
        private const val NOTIFICATION_ID = 41001
    }
}