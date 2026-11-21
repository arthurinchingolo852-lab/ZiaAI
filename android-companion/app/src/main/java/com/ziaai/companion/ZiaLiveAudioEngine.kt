package com.ziaai.companion

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.media.projection.MediaProjection
import android.os.Build
import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

/**
 * Full-duplex Gemini Multimodal Live Audio Engine:
 * - Captures 16kHz PCM16 mono Microphone (+ hardware AEC & NoiseSuppressor)
 * - Captures 16kHz PCM16 mono Internal Game/System Audio on Android 10+ (AudioPlaybackCapture)
 * - Mixes both streams in real time and sends 40ms frames
 * - Plays 24kHz PCM16 mono Gemini Live voice output with instant Barge-in interruption
 */
class ZiaLiveAudioEngine(
    private val context: Context,
    private val onEncodedAudioFrame: (base64Pcm16k: String) -> Unit,
    private val onVolumeLevels: (userLevel: Float, ziaLevel: Float, isZiaSpeaking: Boolean) -> Unit,
    private val onLocalBargeIn: () -> Unit
) {

    companion object {
        const val INPUT_SAMPLE_RATE = 16000
        const val OUTPUT_SAMPLE_RATE = 24000
        const val FRAME_BYTES_16K = 1280 // 640 samples = 40ms at 16kHz PCM16
    }

    private val running = AtomicBoolean(false)
    private val micPaused = AtomicBoolean(false)
    private val ziaSpeaking = AtomicBoolean(false)

    private var micRecord: AudioRecord? = null
    private var gameRecord: AudioRecord? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null
    private var audioTrack: AudioTrack? = null

    private var micThread: Thread? = null
    private var gameThread: Thread? = null
    private var playbackThread: Thread? = null

    private val playbackQueue = LinkedBlockingQueue<ByteArray>(160)
    private val gameRingLock = Any()
    private var latestGameFrame: ByteArray? = null
    private var latestGameFrameAt = 0L

    @Volatile
    private var currentZiaVol = 0f

    @Volatile
    private var lastZiaAudioAt = 0L

    private var consecutiveLoudMicFrames = 0

    fun setMicPaused(paused: Boolean) {
        micPaused.set(paused)
        if (paused) {
            onVolumeLevels(0f, currentZiaVol, ziaSpeaking.get())
        }
    }

    fun isMicPaused(): Boolean = micPaused.get()

    fun isZiaSpeaking(): Boolean = ziaSpeaking.get()

    fun start() {
        if (!running.compareAndSet(false, true)) return
        initAudioTrack()
        startMicCaptureLoop()
    }

    @SuppressLint("MissingPermission")
    fun attachGameAudioProjection(projection: MediaProjection) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        stopGameCaptureOnly()
        gameThread = Thread({
            var rec: AudioRecord? = null
            try {
                val config = AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .build()

                val minBuf = AudioRecord.getMinBufferSize(
                    INPUT_SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                ).coerceAtLeast(FRAME_BYTES_16K * 4)

                rec = AudioRecord.Builder()
                    .setAudioPlaybackCaptureConfig(config)
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(INPUT_SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                            .build()
                    )
                    .setBufferSizeInBytes(maxOf(minBuf, FRAME_BYTES_16K * 6))
                    .build()

                if (rec.state != AudioRecord.STATE_INITIALIZED) {
                    rec.release()
                    return@Thread
                }
                gameRecord = rec
                rec.startRecording()

                val buf = ByteArray(FRAME_BYTES_16K)
                while (running.get() && rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    val read = rec.read(buf, 0, buf.size)
                    if (read > 0) {
                        synchronized(gameRingLock) {
                            latestGameFrame = buf.copyOf(read)
                            latestGameFrameAt = System.currentTimeMillis()
                        }
                    }
                }
            } catch (_: Exception) {
            } finally {
                try {
                    rec?.stop()
                } catch (_: Exception) {
                }
                try {
                    rec?.release()
                } catch (_: Exception) {
                }
            }
        }, "ZiaGameAudioCapture").apply { start() }
    }

    fun enqueueZiaAudioBase64(base64Pcm24k: String) {
        if (!running.get()) return
        try {
            val bytes = Base64.decode(base64Pcm24k, Base64.DEFAULT)
            if (bytes.isEmpty()) return
            ziaSpeaking.set(true)
            lastZiaAudioAt = System.currentTimeMillis()
            currentZiaVol = computeNormalizedRms(bytes, bytes.size)
            playbackQueue.offer(bytes)
        } catch (_: Exception) {
        }
    }

    /**
     * Instant phone-call style Barge-in: clears pending audio and flushes AudioTrack immediately.
     */
    fun interruptPlayback() {
        playbackQueue.clear()
        ziaSpeaking.set(false)
        currentZiaVol = 0f
        try {
            val track = audioTrack
            if (track != null && track.state == AudioTrack.STATE_INITIALIZED) {
                track.pause()
                track.flush()
                track.play()
            }
        } catch (_: Exception) {
        }
        onVolumeLevels(0f, 0f, false)
    }

    @SuppressLint("MissingPermission")
    private fun startMicCaptureLoop() {
        micThread = Thread({
            var rec: AudioRecord? = null
            try {
                if (!PermissionHelper.hasRecordAudio(context)) return@Thread

                val minBuf = AudioRecord.getMinBufferSize(
                    INPUT_SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                ).coerceAtLeast(FRAME_BYTES_16K * 4)

                rec = try {
                    AudioRecord(
                        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                        INPUT_SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        maxOf(minBuf, FRAME_BYTES_16K * 6)
                    )
                } catch (_: Exception) {
                    AudioRecord(
                        MediaRecorder.AudioSource.MIC,
                        INPUT_SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        maxOf(minBuf, FRAME_BYTES_16K * 6)
                    )
                }

                if (rec.state != AudioRecord.STATE_INITIALIZED) {
                    rec.release()
                    return@Thread
                }
                micRecord = rec

                try {
                    if (AcousticEchoCanceler.isAvailable()) {
                        echoCanceler = AcousticEchoCanceler.create(rec.audioSessionId)?.apply {
                            enabled = true
                        }
                    }
                    if (NoiseSuppressor.isAvailable()) {
                        noiseSuppressor = NoiseSuppressor.create(rec.audioSessionId)?.apply {
                            enabled = true
                        }
                    }
                } catch (_: Exception) {
                }

                rec.startRecording()
                val micBuf = ByteArray(FRAME_BYTES_16K)

                while (running.get() && rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    val read = rec.read(micBuf, 0, micBuf.size)
                    if (read <= 0) continue

                    val now = System.currentTimeMillis()
                    if (ziaSpeaking.get() && playbackQueue.isEmpty() && now - lastZiaAudioAt > 420L) {
                        ziaSpeaking.set(false)
                        currentZiaVol = 0f
                    }

                    if (micPaused.get()) {
                        onVolumeLevels(0f, currentZiaVol, ziaSpeaking.get())
                        continue
                    }

                    val userVol = computeNormalizedRms(micBuf, read)

                    // Local Barge-in check: if user starts talking loudly over Zia, cut Zia's voice instantly
                    if (ziaSpeaking.get() && userVol > 0.25f) {
                        consecutiveLoudMicFrames++
                        if (consecutiveLoudMicFrames >= 2) {
                            consecutiveLoudMicFrames = 0
                            interruptPlayback()
                            onLocalBargeIn()
                        }
                    } else {
                        consecutiveLoudMicFrames = 0
                    }

                    onVolumeLevels(userVol, currentZiaVol, ziaSpeaking.get())

                    val gameChunk: ByteArray? = synchronized(gameRingLock) {
                        if (latestGameFrame != null && now - latestGameFrameAt < 180L) {
                            val g = latestGameFrame
                            latestGameFrame = null
                            g
                        } else {
                            null
                        }
                    }

                    val mixedBytes = if (gameChunk != null) {
                        mixPcm16(micBuf, read, gameChunk)
                    } else {
                        micBuf.copyOf(read)
                    }

                    val b64 = Base64.encodeToString(mixedBytes, Base64.NO_WRAP)
                    onEncodedAudioFrame(b64)
                }
            } catch (_: Exception) {
            } finally {
                try {
                    echoCanceler?.release()
                } catch (_: Exception) {
                }
                try {
                    noiseSuppressor?.release()
                } catch (_: Exception) {
                }
                try {
                    rec?.stop()
                } catch (_: Exception) {
                }
                try {
                    rec?.release()
                } catch (_: Exception) {
                }
            }
        }, "ZiaMicCapture").apply { start() }
    }

    private fun initAudioTrack() {
        try {
            val minOutBuf = AudioTrack.getMinBufferSize(
                OUTPUT_SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ).coerceAtLeast(4800)

            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(OUTPUT_SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(minOutBuf * 2)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            track.play()
            audioTrack = track

            playbackThread = Thread({
                while (running.get()) {
                    try {
                        val chunk = playbackQueue.take()
                        if (!running.get()) break
                        if (track.state == AudioTrack.STATE_INITIALIZED) {
                            track.write(chunk, 0, chunk.size)
                            lastZiaAudioAt = System.currentTimeMillis()
                        }
                    } catch (_: InterruptedException) {
                        break
                    } catch (_: Exception) {
                    }
                }
            }, "ZiaAudioPlayback").apply { start() }
        } catch (_: Exception) {
        }
    }

    private fun mixPcm16(mic: ByteArray, micLen: Int, game: ByteArray): ByteArray {
        val sampleCount = micLen / 2
        val gameSamples = game.size / 2
        val out = ByteArray(sampleCount * 2)
        val micShort = ByteBuffer.wrap(mic, 0, micLen).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val gameShort = ByteBuffer.wrap(game).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val outBuf = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)

        for (i in 0 until sampleCount) {
            val m = micShort.get(i).toInt()
            val g = if (i < gameSamples) (gameShort.get(i).toInt() * 0.60f).toInt() else 0
            val mixed = (m + g).coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
            outBuf.putShort(mixed)
        }
        return out
    }

    private fun computeNormalizedRms(pcm: ByteArray, len: Int): Float {
        if (len < 2) return 0f
        var sumSq = 0.0
        val count = len / 2
        for (i in 0 until count) {
            val lo = pcm[i * 2].toInt() and 0xFF
            val hi = pcm[i * 2 + 1].toInt()
            val sample = ((hi shl 8) or lo).toShort().toDouble()
            sumSq += sample * sample
        }
        val rms = sqrt(sumSq / count)
        // Map typical voice RMS (250..8500) to 0..1 smoothly
        return ((rms - 220.0) / 7000.0).toFloat().coerceIn(0f, 1f)
    }

    private fun stopGameCaptureOnly() {
        try {
            gameRecord?.stop()
        } catch (_: Exception) {
        }
        try {
            gameRecord?.release()
        } catch (_: Exception) {
        }
        gameRecord = null
        gameThread?.interrupt()
        gameThread = null
    }

    fun release() {
        running.set(false)
        stopGameCaptureOnly()
        try {
            micRecord?.stop()
        } catch (_: Exception) {
        }
        try {
            micRecord?.release()
        } catch (_: Exception) {
        }
        micRecord = null
        micThread?.interrupt()

        playbackQueue.clear()
        playbackThread?.interrupt()
        try {
            audioTrack?.pause()
            audioTrack?.flush()
            audioTrack?.stop()
            audioTrack?.release()
        } catch (_: Exception) {
        }
        audioTrack = null
    }
}
