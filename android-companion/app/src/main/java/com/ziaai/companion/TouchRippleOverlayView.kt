package com.ziaai.companion

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View
import android.view.animation.DecelerateInterpolator

/**
 * Full-screen non-touchable overlay that paints a 0.6s luminous ripple ring
 * at the exact screen pixel coordinates whenever Zia executes a tap or swipe.
 */
class TouchRippleOverlayView(
    context: Context,
    private val tapX: Float,
    private val tapY: Float,
    private val endX: Float? = null,
    private val endY: Float? = null,
    private val onFinished: () -> Unit
) : View(context) {

    private var progress = 0f
    private val density = resources.displayMetrics.density

    private val outerRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 4f * density
        color = Color.parseColor("#38BDF8")
    }

    private val innerGlowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#A855F7")
    }

    private val trailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeWidth = 6f * density
        color = Color.parseColor("#22D3EE")
    }

    private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 600L // Exact 0.6s luminous touch wave
        interpolator = DecelerateInterpolator()
        addUpdateListener { anim ->
            progress = anim.animatedValue as Float
            invalidate()
        }
        start()
    }

    init {
        postDelayed({
            animator.cancel()
            onFinished()
        }, 610L)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val alpha = ((1f - progress) * 245f).toInt().coerceIn(0, 255)

        if (endX != null && endY != null) {
            trailPaint.alpha = alpha
            val curX = tapX + (endX - tapX) * progress
            val curY = tapY + (endY - tapY) * progress
            canvas.drawLine(tapX, tapY, curX, curY, trailPaint)

            innerGlowPaint.alpha = alpha
            canvas.drawCircle(curX, curY, 12f * density, innerGlowPaint)
        }

        val minR = 10f * density
        val maxR = 46f * density
        val radius = minR + (maxR - minR) * progress

        outerRingPaint.alpha = alpha
        outerRingPaint.strokeWidth = (4.5f - progress * 2.5f).coerceAtLeast(1.5f) * density
        canvas.drawCircle(tapX, tapY, radius, outerRingPaint)

        innerGlowPaint.alpha = ((1f - progress) * 140f).toInt().coerceIn(0, 140)
        canvas.drawCircle(tapX, tapY, minR * (1f - progress * 0.4f), innerGlowPaint)
    }

    override fun onDetachedFromWindow() {
        animator.cancel()
        super.onDetachedFromWindow()
    }
}
