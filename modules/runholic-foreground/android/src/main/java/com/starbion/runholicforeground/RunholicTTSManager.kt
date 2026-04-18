package com.starbion.runholicforeground

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.ArrayDeque
import java.util.Locale
import java.util.UUID

data class TtsQueueItem(
    val key: String? = null,
    val reportText: String? = null,
    val coachText: String? = null,
    val urgent: Boolean = false,
)

object RunholicTTSManager {
    private lateinit var appContext: Context
    private var audioManager: AudioManager? = null
    private var tts: TextToSpeech? = null
    private var isReady = false

    private val queue = ArrayDeque<TtsQueueItem>()
    private var speaking = false
    private var currentItem: TtsQueueItem? = null
    private var currentPart: String? = null

    private var reportEnabled = true
    private var coachEnabled = true

    private var focusRequest: AudioFocusRequest? = null

    private var onQueueIdle: (() -> Unit)? = null
    private var onItemFinished: ((TtsQueueItem) -> Unit)? = null

    fun init(context: Context) {
        if (::appContext.isInitialized && isReady) return

        appContext = context.applicationContext
        audioManager =
            appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

        if (tts == null) {
            tts = TextToSpeech(appContext) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    tts?.language = Locale.KOREAN
                    tts?.setSpeechRate(0.95f)
                    tts?.setPitch(1.08f)
                    isReady = true
                    processQueue()
                }
            }

            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit

                override fun onDone(utteranceId: String?) {
                    onPartDone()
                }

                override fun onError(utteranceId: String?) {
                    onPartDone()
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?, errorCode: Int) {
                    onPartDone()
                }
            })
        }
    }

    fun updateSettings(reportEnabled: Boolean, coachEnabled: Boolean) {
        this.reportEnabled = reportEnabled
        this.coachEnabled = coachEnabled
    }

    fun isReportEnabled(): Boolean = reportEnabled

    fun isCoachEnabled(): Boolean = coachEnabled

    fun setOnQueueIdleListener(listener: (() -> Unit)?) {
        onQueueIdle = listener
    }

    fun setOnItemFinishedListener(listener: ((TtsQueueItem) -> Unit)?) {
        onItemFinished = listener
    }

    fun enqueue(item: TtsQueueItem) {
        val hasReport = !item.reportText.isNullOrBlank()
        val hasCoach = !item.coachText.isNullOrBlank()

        if (!hasReport && !hasCoach) return

        item.key?.let { key ->
            if (currentItem?.key == key) return
            if (queue.any { it.key == key }) return
        }

        queue.addLast(item)
        processQueue()
    }

    fun enqueueSingle(text: String, key: String? = null, urgent: Boolean = false) {
        enqueue(
            TtsQueueItem(
                key = key,
                reportText = text,
                coachText = null,
                urgent = urgent,
            )
        )
    }

    fun clear() {
        queue.clear()
        currentItem = null
        currentPart = null
        speaking = false
        try {
            tts?.stop()
        } catch (_: Exception) {
        }
        abandonAudioFocus()
    }

    fun shutdown() {
        clear()
        try {
            tts?.shutdown()
        } catch (_: Exception) {
        }
        tts = null
        isReady = false
    }

    private fun processQueue() {
        if (!::appContext.isInitialized) return
        if (!isReady) return
        if (speaking) return

        val next = if (queue.isEmpty()) {
            null
        } else {
            queue.removeFirst()
        }

        if (next == null) {
            abandonAudioFocus()
            onQueueIdle?.invoke()
            return
        }

        currentItem = next
        currentPart = when {
            reportEnabled && !next.reportText.isNullOrBlank() -> "report"
            coachEnabled && !next.coachText.isNullOrBlank() -> "coach"
            else -> null
        }

        if (currentPart == null) {
            currentItem = null
            processQueue()
            return
        }

        if (!requestAudioFocus(next.urgent)) {
            // 포커스 실패 시에도 발화 자체는 시도한다.
            // 일부 음악 앱은 focus grant 응답이 불안정해도 실제 ducking은 동작하는 경우가 있다.
        }

        speaking = true
        speakCurrentPart()
    }

    @Synchronized
    private fun onPartDone() {
        val item = currentItem
        val part = currentPart

        if (item == null || part == null) {
            speaking = false
            currentItem = null
            currentPart = null
            processQueue()
            return
        }

        if (part == "report" && coachEnabled && !item.coachText.isNullOrBlank()) {
            currentPart = "coach"
            speakCurrentPart()
            return
        }

        speaking = false
        currentItem = null
        currentPart = null

        onItemFinished?.invoke(item)
        processQueue()
    }

    private fun speakCurrentPart() {
        val item = currentItem ?: return
        val part = currentPart ?: return

        val text = when (part) {
            "report" -> item.reportText?.trim().orEmpty()
            "coach" -> item.coachText?.trim().orEmpty()
            else -> ""
        }

        if (text.isBlank()) {
            onPartDone()
            return
        }

        val utteranceId = UUID.randomUUID().toString()

        try {
            val volume = 1.0f

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                val bundle = android.os.Bundle().apply {
                    putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume)
                }
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, bundle, utteranceId)
            } else {
                @Suppress("DEPRECATION")
                val params = hashMapOf<String, String>().apply {
                    put(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume.toString())
                }
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params)
            }
        } catch (_: Exception) {
            onPartDone()
        }
    }

    private fun requestAudioFocus(urgent: Boolean): Boolean {
        val manager = audioManager ?: return false

        val gain =
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(gain)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAcceptsDelayedFocusGain(false)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener { }
                .build()

            focusRequest = request
            manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                null,
                AudioManager.STREAM_MUSIC,
                gain
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    private fun abandonAudioFocus() {
        val manager = audioManager ?: return

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let { manager.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                manager.abandonAudioFocus(null)
            }
        } catch (_: Exception) {
        }
    }
}