package com.ziaai.companion

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent

class ZiaAccessibilityService : AccessibilityService() {

    data class PixelSwipe(val x1: Float, val y1: Float, val x2: Float, val y2: Float)

    companion object {
        @Volatile
        var instance: ZiaAccessibilityService? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Passive listener — gestures are dispatched only when Modo Copiloto de Jogos is active
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        super.onDestroy()
        if (instance === this) {
            instance = null
        }
    }

    private fun getRealScreenBounds(): Pair<Float, Float> {
        return try {
            val wm = getSystemService(WINDOW_SERVICE) as WindowManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bounds = wm.currentWindowMetrics.bounds
                bounds.width().toFloat() to bounds.height().toFloat()
            } else {
                val dm = DisplayMetrics()
                @Suppress("DEPRECATION")
                wm.defaultDisplay.getRealMetrics(dm)
                dm.widthPixels.toFloat() to dm.heightPixels.toFloat()
            }
        } catch (_: Exception) {
            val dm = resources.displayMetrics
            dm.widthPixels.toFloat() to dm.heightPixels.toFloat()
        }
    }

    /**
     * Converts normalized AI coordinates (0..1000) into exact device pixel coordinates
     * and dispatches a real touch gesture. Returns the pixel pair for the 0.6s ripple indicator.
     */
    fun tapNormalized(xNorm: Float, yNorm: Float): Pair<Float, Float>? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return null
        return try {
            val (w, h) = getRealScreenBounds()
            val x = (xNorm.coerceIn(5f, 995f) / 1000f) * w
            val y = (yNorm.coerceIn(5f, 995f) / 1000f) * h
            val path = Path().apply { moveTo(x, y) }
            val stroke = GestureDescription.StrokeDescription(path, 0L, 28L)
            dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
            x to y
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Converts normalized AI coordinates (0..1000) into exact pixel coordinates for swipe.
     */
    fun swipeNormalized(
        x1Norm: Float,
        y1Norm: Float,
        x2Norm: Float,
        y2Norm: Float,
        durationMs: Long = 220L
    ): PixelSwipe? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return null
        return try {
            val (w, h) = getRealScreenBounds()
            val x1 = (x1Norm.coerceIn(5f, 995f) / 1000f) * w
            val y1 = (y1Norm.coerceIn(5f, 995f) / 1000f) * h
            val x2 = (x2Norm.coerceIn(5f, 995f) / 1000f) * w
            val y2 = (y2Norm.coerceIn(5f, 995f) / 1000f) * h
            val path = Path().apply {
                moveTo(x1, y1)
                lineTo(x2, y2)
            }
            val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs.coerceIn(50L, 1200L))
            dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
            PixelSwipe(x1, y1, x2, y2)
        } catch (_: Exception) {
            null
        }
    }
}
