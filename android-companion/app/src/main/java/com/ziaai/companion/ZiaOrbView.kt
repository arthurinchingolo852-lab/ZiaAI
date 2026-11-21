package com.ziaai.companion

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.SweepGradient
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

class ZiaOrbView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    enum class OrbState {
        CONNECTING,
        LISTENING,
        USER_SPEAKING,
        ZIA_SPEAKING,
        MIC_PAUSED,
        RECONNECTING
    }

    private var state: OrbState = OrbState.CONNECTING
    private var userLevel = 0f
    private var ziaLevel = 0f
    private var smoothedLevel = 0f
    private var phase = 0f
    private var isScreenActive = false
    private var isCopilotActive = false

    private val auraPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val corePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
    }
    private val copilotArcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val orbPath = Path()
    private val gradientMatrix = Matrix()

    private var spinAnimator: ValueAnimator? = null

    init {
        startAnimationLoop()
    }

    private fun startAnimationLoop() {
        spinAnimator?.cancel()
        spinAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 2600L
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            addUpdateListener { anim ->
                phase = (anim.animatedValue as Float) * (2f * PI.toFloat())
                val target = when (state) {
                    OrbState.ZIA_SPEAKING -> ziaLevel.coerceAtLeast(0.18f)
                    OrbState.USER_SPEAKING -> userLevel.coerceAtLeast(0.22f)
                    OrbState.LISTENING -> userLevel.coerceAtLeast(0.06f)
                    OrbState.CONNECTING, OrbState.RECONNECTING -> 0.14f
                    OrbState.MIC_PAUSED -> 0.02f
                }
                smoothedLevel += (target - smoothedLevel) * 0.28f
                invalidate()
            }
            start()
        }
    }

    fun updateAudioState(
        newState: OrbState,
        userVol: Float,
        ziaVol: Float,
        screenOn: Boolean,
        copilotOn: Boolean
    ) {
        state = newState
        userLevel = userVol.coerceIn(0f, 1f)
        ziaLevel = ziaVol.coerceIn(0f, 1f)
        isScreenActive = screenOn
        isCopilotActive = copilotOn
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f
        val minDim = minOf(width, height).toFloat()
        if (minDim <= 0f) return

        val baseRadius = minDim * 0.30f
        val dynamicBoost = smoothedLevel * (minDim * 0.09f)
        val breathe = sin(phase * 1.5f) * (minDim * 0.015f)
        val currentRadius = baseRadius + dynamicBoost + breathe

        val (c1, c2, c3, glowColor) = when (state) {
            OrbState.ZIA_SPEAKING -> QuadColor(
                Color.parseColor("#38BDF8"),
                Color.parseColor("#A855F7"),
                Color.parseColor("#EC4899"),
                Color.argb((120 + (smoothedLevel * 100)).toInt().coerceIn(80, 220), 168, 85, 247)
            )
            OrbState.USER_SPEAKING -> QuadColor(
                Color.parseColor("#22D3EE"),
                Color.parseColor("#10B981"),
                Color.parseColor("#38BDF8"),
                Color.argb((120 + (smoothedLevel * 110)).toInt().coerceIn(80, 230), 34, 211, 238)
            )
            OrbState.LISTENING -> QuadColor(
                Color.parseColor("#0EA5E9"),
                Color.parseColor("#6366F1"),
                Color.parseColor("#38BDF8"),
                Color.argb(110, 56, 189, 248)
            )
            OrbState.MIC_PAUSED -> QuadColor(
                Color.parseColor("#334155"),
                Color.parseColor("#475569"),
                Color.parseColor("#64748B"),
                Color.argb(70, 100, 116, 139)
            )
            OrbState.RECONNECTING, OrbState.CONNECTING -> QuadColor(
                Color.parseColor("#F59E0B"),
                Color.parseColor("#38BDF8"),
                Color.parseColor("#A855F7"),
                Color.argb(115, 245, 158, 11)
            )
        }

        // 1. Ambient pulsing outer aura
        val auraRadius = currentRadius + minDim * (0.10f + smoothedLevel * 0.10f)
        auraPaint.shader = RadialGradient(
            cx,
            cy,
            auraRadius,
            intArrayOf(glowColor, Color.TRANSPARENT),
            floatArrayOf(0.45f, 1f),
            Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, auraRadius, auraPaint)

        // 2. Organic morphing sphere contour reacting to voice volume
        orbPath.reset()
        val points = 36
        val wobbleAmp = when (state) {
            OrbState.MIC_PAUSED -> 0f
            OrbState.ZIA_SPEAKING, OrbState.USER_SPEAKING -> minDim * (0.015f + smoothedLevel * 0.045f)
            else -> minDim * 0.012f
        }
        for (i in 0..points) {
            val angle = (i.toFloat() / points) * (2f * PI.toFloat())
            val wave1 = sin(angle * 3f + phase * 2f) * wobbleAmp
            val wave2 = cos(angle * 5f - phase * 3f) * (wobbleAmp * 0.55f)
            val r = currentRadius + wave1 + wave2
            val px = cx + cos(angle) * r
            val py = cy + sin(angle) * r
            if (i == 0) orbPath.moveTo(px, py) else orbPath.lineTo(px, py)
        }
        orbPath.close()

        val sweep = SweepGradient(cx, cy, intArrayOf(c1, c2, c3, c1), null)
        gradientMatrix.setRotate((phase * 180f / PI.toFloat()), cx, cy)
        sweep.setLocalMatrix(gradientMatrix)
        corePaint.shader = sweep
        canvas.drawPath(orbPath, corePaint)

        // 3. Crisp inner specular ring
        ringPaint.strokeWidth = minDim * 0.025f
        ringPaint.color = if (state == OrbState.MIC_PAUSED) {
            Color.argb(130, 203, 213, 225)
        } else {
            Color.argb(190, 224, 242, 254)
        }
        canvas.drawPath(orbPath, ringPaint)

        // 4. Pause bars inside orb if mic is paused
        if (state == OrbState.MIC_PAUSED) {
            badgePaint.color = Color.WHITE
            val barW = minDim * 0.04f
            val barH = minDim * 0.16f
            val gap = minDim * 0.045f
            canvas.drawRoundRect(
                cx - gap - barW,
                cy - barH / 2f,
                cx - gap,
                cy + barH / 2f,
                4f,
                4f,
                badgePaint
            )
            canvas.drawRoundRect(
                cx + gap,
                cy - barH / 2f,
                cx + gap + barW,
                cy + barH / 2f,
                4f,
                4f,
                badgePaint
            )
        }

        // 5. Status dots/arcs for Ver Tela & Copiloto
        if (isScreenActive) {
            badgePaint.color = Color.parseColor("#38BDF8")
            canvas.drawCircle(cx + currentRadius * 0.78f, cy - currentRadius * 0.78f, minDim * 0.055f, badgePaint)
        }
        if (isCopilotActive) {
            copilotArcPaint.strokeWidth = minDim * 0.032f
            copilotArcPaint.color = Color.parseColor("#10B981")
            val arcR = currentRadius + minDim * 0.06f
            canvas.drawArc(
                cx - arcR,
                cy - arcR,
                cx + arcR,
                cy + arcR,
                -45f + (phase * 57.3f),
                90f,
                false,
                copilotArcPaint
            )
        }
    }

    override fun onDetachedFromWindow() {
        spinAnimator?.cancel()
        spinAnimator = null
        super.onDetachedFromWindow()
    }

    private data class QuadColor(val c1: Int, val c2: Int, val c3: Int, val glow: Int)
}
