package com.ziaai.companion

import android.animation.ValueAnimator
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.hypot

class ZiaFloatingService : Service() {

    companion object {
        const val ACTION_UPDATE_CONFIG = "com.ziaai.companion.ACTION_UPDATE_CONFIG"
        const val NOTIFICATION_ID = 101
        const val CHANNEL_ID = "zia_live_overlay_channel"

        @Volatile
        var isRunning = false
    }

    private lateinit var windowManager: WindowManager
    private lateinit var floatingView: View
    private lateinit var layoutParams: WindowManager.LayoutParams

    private lateinit var orbView: ZiaOrbView
    private lateinit var miniMenuContainer: LinearLayout
    private lateinit var menuScreenBtn: Button
    private lateinit var menuCopilotBtn: Button
    private lateinit var menuOpenAppBtn: Button

    // Bottom "X" close target overlay shown while dragging the orb
    private lateinit var closeTargetView: TextView
    private lateinit var closeTargetParams: WindowManager.LayoutParams
    private var isCloseTargetAdded = false

    private val mainHandler = Handler(Looper.getMainLooper())
    private val serviceDestroyed = AtomicBoolean(false)

    // Configuration & state
    private var serverBaseUrl = ""
    private var userName = ""
    private var isScreenVisionEnabled = false
    private var isCopilotEnabled = false
    private var isWebSocketConnected = false
    private var isReconnecting = false
    private var lastReconnectNoticeAt = 0L
    private var reconnectAttempt = 0

    // Audio & WebSocket Live client
    private var audioEngine: ZiaLiveAudioEngine? = null
    private val httpClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private var liveSocket: WebSocket? = null

    // Local fallback TTS strictly for network outage voice alert
    private var localTts: TextToSpeech? = null
    private var localTtsReady = false

    // MediaProjection screen capture (1 FPS JPEG -> Gemini Live WebSocket)
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    private var edgeSnapAnimator: ValueAnimator? = null

    private val reconnectRunnable = Runnable {
        if (!serviceDestroyed.get()) {
            connectLiveWebSocket()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        startForegroundCompat(withProjection = false)

        val prefs = getSharedPreferences("zia_companion_prefs", MODE_PRIVATE)
        serverBaseUrl = (prefs.getString("server_url", "") ?: "").trimEnd('/')
        userName = (prefs.getString("user_name", "") ?: "").trim()
        isCopilotEnabled = prefs.getBoolean("copilot_enabled", false)

        initFallbackTts()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        initOrbOverlay()
        initCloseTargetOverlay()
        initLiveAudioEngine()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (serviceDestroyed.get()) return START_NOT_STICKY

        val urlFromIntent = intent?.getStringExtra("server_url")
        if (!urlFromIntent.isNullOrBlank()) {
            serverBaseUrl = urlFromIntent.trimEnd('/')
        }
        val nameFromIntent = intent?.getStringExtra("user_name")
        if (nameFromIntent != null) {
            userName = nameFromIntent.trim()
        }
        if (intent?.hasExtra("copilot_enabled") == true) {
            isCopilotEnabled = intent.getBooleanExtra("copilot_enabled", false)
            if (isCopilotEnabled && !PermissionHelper.isAccessibilityEnabled(this)) {
                isCopilotEnabled = false
            }
            sendConfigToSocket()
            updateMiniMenuButtons()
        }

        val projCode = intent?.getIntExtra("proj_result_code", Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        @Suppress("DEPRECATION")
        val projData: Intent? = intent?.getParcelableExtra("proj_data")
        if (projCode == Activity.RESULT_OK && projData != null) {
            startForegroundCompat(withProjection = true)
            setupMediaProjection(projCode, projData)
            isScreenVisionEnabled = true
            updateMiniMenuButtons()
        }

        if (liveSocket == null && serverBaseUrl.isNotBlank()) {
            connectLiveWebSocket()
        }

        return START_STICKY
    }

    private fun initFallbackTts() {
        try {
            localTts = TextToSpeech(this) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    try {
                        localTts?.language = Locale("pt", "BR")
                        localTtsReady = true
                    } catch (_: Exception) {
                    }
                }
            }
        } catch (_: Exception) {
        }
    }

    private fun speakNetworkAlert(message: String) {
        val now = System.currentTimeMillis()
        if (now - lastReconnectNoticeAt < 12000L) return
        lastReconnectNoticeAt = now
        try {
            if (localTtsReady) {
                localTts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, "zia_net_alert")
            }
        } catch (_: Exception) {
        }
    }

    private fun getOverlayType(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
    }

    private fun getScreenDimensions(): Pair<Int, Int> {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val b = windowManager.currentWindowMetrics.bounds
                b.width() to b.height()
            } else {
                val dm = DisplayMetrics()
                @Suppress("DEPRECATION")
                windowManager.defaultDisplay.getRealMetrics(dm)
                dm.widthPixels to dm.heightPixels
            }
        } catch (_: Exception) {
            val dm = resources.displayMetrics
            dm.widthPixels to dm.heightPixels
        }
    }

    private fun initOrbOverlay() {
        floatingView = LayoutInflater.from(this).inflate(R.layout.layout_zia_floating, null)
        orbView = floatingView.findViewById(R.id.ziaOrbView)
        miniMenuContainer = floatingView.findViewById(R.id.miniMenuContainer)
        menuScreenBtn = floatingView.findViewById(R.id.menuScreenBtn)
        menuCopilotBtn = floatingView.findViewById(R.id.menuCopilotBtn)
        menuOpenAppBtn = floatingView.findViewById(R.id.menuOpenAppBtn)

        val density = resources.displayMetrics.density
        val (_, screenH) = getScreenDimensions()

        layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            getOverlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (12 * density).toInt()
            y = (screenH * 0.35f).toInt()
        }

        // Round translucent dark-glass background for mini-menu
        miniMenuContainer.background = GradientDrawable().apply {
            setColor(0xE60B1120.toInt())
            cornerRadius = 18f * density
            setStroke((1.5f * density).toInt(), 0x5538BDF8)
        }

        setupOrbGestures(density)
        setupMiniMenuActions()
        updateMiniMenuButtons()

        try {
            windowManager.addView(floatingView, layoutParams)
        } catch (_: Exception) {
            stopSelf()
        }
    }

    private fun initCloseTargetOverlay() {
        val density = resources.displayMetrics.density
        val size = (64 * density).toInt()

        closeTargetView = TextView(this).apply {
            text = "✕"
            textSize = 22f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xCC1E293B.toInt())
                setStroke((2 * density).toInt(), 0xAA94A3B8.toInt())
            }
            visibility = View.GONE
        }

        closeTargetParams = WindowManager.LayoutParams(
            size,
            size,
            getOverlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = (36 * density).toInt()
        }

        try {
            windowManager.addView(closeTargetView, closeTargetParams)
            isCloseTargetAdded = true
        } catch (_: Exception) {
        }
    }

    private fun setCloseTargetHover(hovering: Boolean) {
        val density = resources.displayMetrics.density
        val bg = closeTargetView.background as? GradientDrawable ?: return
        if (hovering) {
            bg.setColor(0xEBDC2626.toInt())
            bg.setStroke((2.5f * density).toInt(), 0xFFFCA5A5.toInt())
            closeTargetView.scaleX = 1.18f
            closeTargetView.scaleY = 1.18f
        } else {
            bg.setColor(0xCC1E293B.toInt())
            bg.setStroke((2 * density).toInt(), 0xAA94A3B8.toInt())
            closeTargetView.scaleX = 1.0f
            closeTargetView.scaleY = 1.0f
        }
    }

    private fun isOrbOverCloseTarget(rawX: Float, rawY: Float): Boolean {
        val (screenW, screenH) = getScreenDimensions()
        val density = resources.displayMetrics.density
        val closeCenterX = screenW / 2f
        val closeCenterY = screenH - (36 * density) - (32 * density)
        return hypot((rawX - closeCenterX).toDouble(), (rawY - closeCenterY).toDouble()) < (76 * density)
    }

    private fun setupOrbGestures(density: Float) {
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var moved = false
        var longPressed = false

        val longPressRunnable = Runnable {
            if (!moved && !serviceDestroyed.get()) {
                longPressed = true
                toggleMiniMenu()
            }
        }

        orbView.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    edgeSnapAnimator?.cancel()
                    moved = false
                    longPressed = false
                    initialX = layoutParams.x
                    initialY = layoutParams.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    mainHandler.postDelayed(longPressRunnable, 440L)
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - initialTouchX
                    val dy = event.rawY - initialTouchY
                    if (!moved && (abs(dx) > 10 * density || abs(dy) > 10 * density)) {
                        moved = true
                        mainHandler.removeCallbacks(longPressRunnable)
                        hideMiniMenu()
                        if (isCloseTargetAdded) {
                            closeTargetView.visibility = View.VISIBLE
                        }
                    }
                    if (moved) {
                        val (screenW, screenH) = getScreenDimensions()
                        val orbW = orbView.width.takeIf { it > 0 } ?: (76 * density).toInt()
                        val orbH = orbView.height.takeIf { it > 0 } ?: (76 * density).toInt()
                        layoutParams.x = (initialX + dx.toInt()).coerceIn(0, maxOf(0, screenW - orbW))
                        layoutParams.y = (initialY + dy.toInt()).coerceIn(0, maxOf(0, screenH - orbH))
                        try {
                            windowManager.updateViewLayout(floatingView, layoutParams)
                        } catch (_: Exception) {
                        }
                        if (isCloseTargetAdded) {
                            setCloseTargetHover(isOrbOverCloseTarget(event.rawX, event.rawY))
                        }
                    }
                    true
                }

                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    mainHandler.removeCallbacks(longPressRunnable)
                    if (isCloseTargetAdded) {
                        closeTargetView.visibility = View.GONE
                        setCloseTargetHover(false)
                    }

                    if (moved) {
                        if (event.action == MotionEvent.ACTION_UP && isOrbOverCloseTarget(event.rawX, event.rawY)) {
                            Toast.makeText(this, "ZIA Live encerrada", Toast.LENGTH_SHORT).show()
                            stopSelf()
                            return@setOnTouchListener true
                        }
                        snapOrbToNearestEdge(density)
                    } else if (!longPressed && event.action == MotionEvent.ACTION_UP) {
                        if (miniMenuContainer.visibility == View.VISIBLE) {
                            hideMiniMenu()
                        } else {
                            // 1 quick tap pauses/resumes mic immediately
                            toggleMicPause()
                        }
                    }
                    true
                }

                else -> false
            }
        }
    }

    private fun snapOrbToNearestEdge(density: Float) {
        val (screenW, _) = getScreenDimensions()
        val orbW = orbView.width.takeIf { it > 0 } ?: (76 * density).toInt()
        val margin = (8 * density).toInt()
        val startX = layoutParams.x
        val targetX = if (startX + orbW / 2 < screenW / 2) {
            margin
        } else {
            maxOf(margin, screenW - orbW - margin)
        }

        edgeSnapAnimator?.cancel()
        edgeSnapAnimator = ValueAnimator.ofInt(startX, targetX).apply {
            duration = 220L
            interpolator = DecelerateInterpolator()
            addUpdateListener { anim ->
                if (serviceDestroyed.get()) return@addUpdateListener
                layoutParams.x = anim.animatedValue as Int
                try {
                    windowManager.updateViewLayout(floatingView, layoutParams)
                } catch (_: Exception) {
                }
            }
            start()
        }
    }

    private fun toggleMiniMenu() {
        if (miniMenuContainer.visibility == View.VISIBLE) {
            hideMiniMenu()
        } else {
            updateMiniMenuButtons()
            miniMenuContainer.visibility = View.VISIBLE
            try {
                windowManager.updateViewLayout(floatingView, layoutParams)
            } catch (_: Exception) {
            }
        }
    }

    private fun hideMiniMenu() {
        if (miniMenuContainer.visibility != View.GONE) {
            miniMenuContainer.visibility = View.GONE
            try {
                windowManager.updateViewLayout(floatingView, layoutParams)
            } catch (_: Exception) {
            }
        }
    }

    private fun setupMiniMenuActions() {
        menuScreenBtn.setOnClickListener {
            hideMiniMenu()
            if (mediaProjection == null) {
                Toast.makeText(this, "Liberando permissão para ver a tela...", Toast.LENGTH_SHORT).show()
                try {
                    val intent = Intent(this, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        putExtra("extra_request_screen", true)
                    }
                    startActivity(intent)
                } catch (_: Exception) {
                }
            } else {
                isScreenVisionEnabled = !isScreenVisionEnabled
                updateMiniMenuButtons()
                Toast.makeText(
                    this,
                    if (isScreenVisionEnabled) "👁️ ZIA vendo sua tela!" else "👁️ Visão de tela pausada",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }

        menuCopilotBtn.setOnClickListener {
            hideMiniMenu()
            if (!isCopilotEnabled && !PermissionHelper.isAccessibilityEnabled(this)) {
                Toast.makeText(
                    this,
                    "Ative 'Zia AI Live' na Acessibilidade para liberar toques no jogo!",
                    Toast.LENGTH_LONG
                ).show()
                PermissionHelper.openAccessibilitySettings(this)
                return@setOnClickListener
            }
            isCopilotEnabled = !isCopilotEnabled
            getSharedPreferences("zia_companion_prefs", MODE_PRIVATE)
                .edit()
                .putBoolean("copilot_enabled", isCopilotEnabled)
                .apply()
            sendConfigToSocket()
            updateMiniMenuButtons()
            Toast.makeText(
                this,
                if (isCopilotEnabled) "🎮 Modo Copiloto LIGADO!" else "🎮 Modo Copiloto desligado",
                Toast.LENGTH_SHORT
            ).show()
        }

        menuOpenAppBtn.setOnClickListener {
            hideMiniMenu()
            try {
                val intent = Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                }
                startActivity(intent)
            } catch (_: Exception) {
            }
        }
    }

    private fun updateMiniMenuButtons() {
        menuScreenBtn.text = if (isScreenVisionEnabled && mediaProjection != null) {
            "👁️ Ver Tela: ON"
        } else {
            "👁️ Ver Tela"
        }
        menuScreenBtn.setBackgroundColor(
            if (isScreenVisionEnabled && mediaProjection != null) 0x550EA5E9 else 0x331E293B
        )

        menuCopilotBtn.text = if (isCopilotEnabled) {
            "🎮 Pode Jogar: ON"
        } else {
            "🎮 Pode Jogar"
        }
        menuCopilotBtn.setBackgroundColor(
            if (isCopilotEnabled) 0x5510B981 else 0x331E293B
        )
    }

    private fun toggleMicPause() {
        val engine = audioEngine ?: return
        val nextPaused = !engine.isMicPaused()
        engine.setMicPaused(nextPaused)
        if (nextPaused && engine.isZiaSpeaking()) {
            engine.interruptPlayback()
        }
        Toast.makeText(
            this,
            if (nextPaused) "🎤 Microfone pausado" else "🎙️ Microfone ativo!",
            Toast.LENGTH_SHORT
        ).show()
    }

    private fun initLiveAudioEngine() {
        audioEngine = ZiaLiveAudioEngine(
            context = this,
            onEncodedAudioFrame = { b64 ->
                try {
                    val ws = liveSocket
                    if (ws != null && isWebSocketConnected) {
                        val payload = JSONObject()
                            .put("type", "audio")
                            .put("data", b64)
                            .toString()
                        ws.send(payload)
                    }
                } catch (_: Exception) {
                }
            },
            onVolumeLevels = { userVol, ziaVol, ziaTalking ->
                mainHandler.post {
                    if (serviceDestroyed.get()) return@post
                    val paused = audioEngine?.isMicPaused() == true
                    val orbState = when {
                        isReconnecting || !isWebSocketConnected -> ZiaOrbView.OrbState.RECONNECTING
                        paused -> ZiaOrbView.OrbState.MIC_PAUSED
                        ziaTalking -> ZiaOrbView.OrbState.ZIA_SPEAKING
                        userVol > 0.12f -> ZiaOrbView.OrbState.USER_SPEAKING
                        else -> ZiaOrbView.OrbState.LISTENING
                    }
                    orbView.updateAudioState(
                        orbState,
                        userVol,
                        ziaVol,
                        isScreenVisionEnabled && mediaProjection != null,
                        isCopilotEnabled
                    )
                }
            },
            onLocalBargeIn = {
                // Local speech detected while Zia was speaking — already flushed AudioTrack immediately
            }
        ).also { it.start() }
    }

    private fun buildWebSocketUrl(): String {
        val wsBase = when {
            serverBaseUrl.startsWith("https://") -> "wss://" + serverBaseUrl.removePrefix("https://")
            serverBaseUrl.startsWith("http://") -> "ws://" + serverBaseUrl.removePrefix("http://")
            else -> "wss://$serverBaseUrl"
        }
        val encodedName = try {
            URLEncoder.encode(userName, "UTF-8")
        } catch (_: Exception) {
            ""
        }
        val copilotFlag = if (isCopilotEnabled) "1" else "0"
        return "$wsBase/api/zia/live?userName=$encodedName&copilot=$copilotFlag"
    }

    private fun connectLiveWebSocket() {
        if (serviceDestroyed.get() || serverBaseUrl.isBlank()) return
        mainHandler.removeCallbacks(reconnectRunnable)
        try {
            liveSocket?.cancel()
        } catch (_: Exception) {
        }

        isReconnecting = true
        val url = buildWebSocketUrl()
        val request = try {
            Request.Builder().url(url).build()
        } catch (_: Exception) {
            scheduleReconnect(withVoiceAlert = true)
            return
        }

        liveSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                isWebSocketConnected = true
                isReconnecting = false
                reconnectAttempt = 0
                sendConfigToSocket()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleLiveServerMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                isWebSocketConnected = false
                if (!serviceDestroyed.get()) {
                    scheduleReconnect(withVoiceAlert = true)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isWebSocketConnected = false
                if (!serviceDestroyed.get()) {
                    scheduleReconnect(withVoiceAlert = true)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isWebSocketConnected = false
                if (!serviceDestroyed.get()) {
                    scheduleReconnect(withVoiceAlert = true)
                }
            }
        })
    }

    private fun scheduleReconnect(withVoiceAlert: Boolean) {
        if (serviceDestroyed.get()) return
        isReconnecting = true
        if (withVoiceAlert) {
            speakNetworkAlert("Minha conexão deu uma piscada, já estou voltando")
        }
        val delayMs = when (reconnectAttempt) {
            0 -> 1400L
            1 -> 2600L
            else -> 4200L
        }
        reconnectAttempt++
        mainHandler.removeCallbacks(reconnectRunnable)
        mainHandler.postDelayed(reconnectRunnable, delayMs)
    }

    private fun sendConfigToSocket() {
        try {
            val ws = liveSocket ?: return
            if (!isWebSocketConnected) return
            val json = JSONObject()
                .put("type", "config")
                .put("copilotEnabled", isCopilotEnabled)
                .toString()
            ws.send(json)
        } catch (_: Exception) {
        }
    }

    private fun handleLiveServerMessage(rawText: String) {
        try {
            val msg = JSONObject(rawText)
            when (msg.optString("type")) {
                "audio" -> {
                    val data = msg.optString("data", "")
                    if (data.isNotEmpty()) {
                        audioEngine?.enqueueZiaAudioBase64(data)
                    }
                }
                "interrupted" -> {
                    audioEngine?.interruptPlayback()
                }
                "action" -> {
                    if (!isCopilotEnabled) return
                    val action = msg.optString("action", "")
                    val acc = ZiaAccessibilityService.instance ?: return
                    if (action == "tap") {
                        val x = msg.optDouble("x", 500.0).toFloat()
                        val y = msg.optDouble("y", 500.0).toFloat()
                        val pixelPt = acc.tapNormalized(x, y)
                        if (pixelPt != null) {
                            mainHandler.post {
                                showTouchRippleIndicator(pixelPt.first, pixelPt.second)
                            }
                        }
                    } else if (action == "swipe") {
                        val x1 = msg.optDouble("x1", 500.0).toFloat()
                        val y1 = msg.optDouble("y1", 700.0).toFloat()
                        val x2 = msg.optDouble("x2", 500.0).toFloat()
                        val y2 = msg.optDouble("y2", 300.0).toFloat()
                        val dur = msg.optLong("durationMs", 220L)
                        val swipePts = acc.swipeNormalized(x1, y1, x2, y2, dur)
                        if (swipePts != null) {
                            mainHandler.post {
                                showTouchRippleIndicator(
                                    swipePts.x1,
                                    swipePts.y1,
                                    swipePts.x2,
                                    swipePts.y2
                                )
                            }
                        }
                    }
                }
                "error" -> {
                    if (!serviceDestroyed.get()) {
                        scheduleReconnect(withVoiceAlert = true)
                    }
                }
            }
        } catch (_: Exception) {
        }
    }

    private fun showTouchRippleIndicator(
        x: Float,
        y: Float,
        endX: Float? = null,
        endY: Float? = null
    ) {
        if (serviceDestroyed.get()) return
        try {
            lateinit var rippleView: TouchRippleOverlayView
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                getOverlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            )
            rippleView = TouchRippleOverlayView(this, x, y, endX, endY) {
                try {
                    windowManager.removeView(rippleView)
                } catch (_: Exception) {
                }
            }
            windowManager.addView(rippleView, params)
        } catch (_: Exception) {
        }
    }

    private fun setupMediaProjection(resultCode: Int, data: Intent) {
        try {
            val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            virtualDisplay?.release()
            imageReader?.close()
            mediaProjection?.stop()

            val proj = mgr.getMediaProjection(resultCode, data) ?: return
            mediaProjection = proj

            // Android 14 (API 34+) requires registering a MediaProjection.Callback BEFORE createVirtualDisplay
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                proj.registerCallback(object : MediaProjection.Callback() {
                    override fun onStop() {
                        isScreenVisionEnabled = false
                        mainHandler.post { updateMiniMenuButtons() }
                    }
                }, mainHandler)
            }

            val (realW, realH) = getScreenDimensions()
            val scale = minOf(1f, 720f / maxOf(realW, realH).coerceAtLeast(1))
            val capW = (realW * scale).toInt().coerceAtLeast(320)
            val capH = (realH * scale).toInt().coerceAtLeast(320)
            val densityDpi = resources.displayMetrics.densityDpi

            val reader = ImageReader.newInstance(capW, capH, PixelFormat.RGBA_8888, 2)
            imageReader = reader

            var lastFrameSentAt = 0L
            reader.setOnImageAvailableListener({ r ->
                val img = try {
                    r.acquireLatestImage()
                } catch (_: Exception) {
                    null
                } ?: return@setOnImageAvailableListener

                val now = System.currentTimeMillis()
                // Continuous real-time screen capture without 1s lock
                if (!isScreenVisionEnabled || !isWebSocketConnected || now - lastFrameSentAt < 450L) {
                    img.close()
                    return@setOnImageAvailableListener
                }
                lastFrameSentAt = now

                try {
                    val plane = img.planes[0]
                    val buffer = plane.buffer
                    val pixelStride = plane.pixelStride
                    val rowStride = plane.rowStride
                    val rowPadding = rowStride - pixelStride * capW
                    val bmp = Bitmap.createBitmap(
                        capW + rowPadding / pixelStride,
                        capH,
                        Bitmap.Config.ARGB_8888
                    )
                    bmp.copyPixelsFromBuffer(buffer)
                    val cropped = Bitmap.createBitmap(bmp, 0, 0, capW, capH)
                    if (cropped !== bmp) bmp.recycle()

                    val baos = ByteArrayOutputStream()
                    cropped.compress(Bitmap.CompressFormat.JPEG, 62, baos)
                    cropped.recycle()

                    val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
                    liveSocket?.send(
                        JSONObject()
                            .put("type", "video")
                            .put("data", b64)
                            .toString()
                    )
                } catch (_: Exception) {
                } finally {
                    try {
                        img.close()
                    } catch (_: Exception) {
                    }
                }
            }, mainHandler)

            virtualDisplay = proj.createVirtualDisplay(
                "ZiaLiveScreenCap",
                capW,
                capH,
                densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface,
                null,
                mainHandler
            )

            // Capture internal game/system audio on Android 10+ alongside microphone
            audioEngine?.attachGameAudioProjection(proj)
        } catch (_: Exception) {
        }
    }

    private fun startForegroundCompat(withProjection: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Zia AI Live em Tempo Real",
                NotificationManager.IMPORTANCE_LOW
            )
            val mgr = getSystemService(NotificationManager::class.java)
            mgr.createNotificationChannel(channel)

            val launchIntent = Intent(this, MainActivity::class.java)
            val pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("ZIA AI Live")
                .setContentText("ZIA está ativa vendo e jogando com você")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                if (PermissionHelper.hasRecordAudio(this)) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                }
                if (withProjection) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                }
                startForeground(NOTIFICATION_ID, notification, types)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        }
    }

    override fun onDestroy() {
        isRunning = false
        serviceDestroyed.set(true)
        mainHandler.removeCallbacks(reconnectRunnable)
        edgeSnapAnimator?.cancel()

        try {
            liveSocket?.close(1000, "Service stopped")
        } catch (_: Exception) {
        }
        liveSocket = null

        try {
            audioEngine?.release()
        } catch (_: Exception) {
        }
        audioEngine = null

        try {
            localTts?.stop()
            localTts?.shutdown()
        } catch (_: Exception) {
        }
        localTts = null

        try {
            virtualDisplay?.release()
            imageReader?.close()
            mediaProjection?.stop()
        } catch (_: Exception) {
        }

        if (::floatingView.isInitialized) {
            try {
                windowManager.removeView(floatingView)
            } catch (_: Exception) {
            }
        }
        if (isCloseTargetAdded) {
            try {
                windowManager.removeView(closeTargetView)
            } catch (_: Exception) {
            }
            isCloseTargetAdded = false
        }

        super.onDestroy()
    }
}
