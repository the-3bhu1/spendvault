package com.spendvault.app

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Bundle
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max

class CardScanActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PAN = "pan"
        const val EXTRA_EXPIRY_MONTH = "expiryMonth"
        const val EXTRA_EXPIRY_YEAR = "expiryYear"
        const val EXTRA_NETWORK = "network"
        const val EXTRA_ERROR = "error"

        fun frameRect(width: Float, height: Float, out: RectF) {
            val frameW = width * 0.86f
            val frameH = frameW / 1.586f
            val top = height * 0.42f - frameH / 2
            out.set((width - frameW) / 2, top, (width + frameW) / 2, top + frameH)
        }
    }

    private val frame = RectF()

    private lateinit var previewView: PreviewView
    private lateinit var torchButton: TextView
    private lateinit var analysisExecutor: ExecutorService
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val consensus = CardTextParser.Consensus()
    private var camera: Camera? = null
    private var torchOn = false
    @Volatile private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        analysisExecutor = Executors.newSingleThreadExecutor()

        previewView = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
        val closeButton = chromeButton("✕", 26f).apply {
            contentDescription = "Close"
            setOnClickListener { cancel() }
        }
        torchButton = chromeButton("Flash off", 15f).apply {
            visibility = View.GONE
            setOnClickListener { toggleTorch() }
        }
        val topBar = FrameLayout(this).apply {
            addView(closeButton, FrameLayout.LayoutParams(wrap(), wrap(), Gravity.START or Gravity.CENTER_VERTICAL))
            addView(torchButton, FrameLayout.LayoutParams(wrap(), wrap(), Gravity.END or Gravity.CENTER_VERTICAL))
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(previewView, FrameLayout.LayoutParams(match(), match()))
            addView(CardFrameOverlay(this@CardScanActivity), FrameLayout.LayoutParams(match(), match()))
            addView(topBar, FrameLayout.LayoutParams(match(), wrap(), Gravity.TOP))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            topBar.setPadding(bars.left + dp(8), bars.top + dp(8), bars.right + dp(8), 0)
            insets
        }
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = cancel()
        })
        startCamera()
    }

    override fun onDestroy() {
        super.onDestroy()
        analysisExecutor.shutdown()
        recognizer.close()
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                            .build()
                    )
                    .build()
                    .also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                            .setResolutionStrategy(
                                ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)
                            )
                            .build()
                    )
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(analysisExecutor, ::analyze)
                provider.unbindAll()
                val cam = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                camera = cam
                if (cam.cameraInfo.hasFlashUnit()) torchButton.visibility = View.VISIBLE
            } catch (e: Exception) {
                android.util.Log.w("SpendVaultScan", "Camera start failed: ${e.javaClass.simpleName}")
                fail("UNAVAILABLE")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    @OptIn(ExperimentalGetImage::class)
    private fun analyze(proxy: ImageProxy) {
        val media = proxy.image
        if (media == null || finished) { proxy.close(); return }
        val rotation = proxy.imageInfo.rotationDegrees
        val sideways = rotation == 90 || rotation == 270
        val uprightW = if (sideways) proxy.height else proxy.width
        val uprightH = if (sideways) proxy.width else proxy.height
        val input = InputImage.fromMediaImage(media, rotation)
        recognizer.process(input)
            .addOnSuccessListener { text ->
                if (finished) return@addOnSuccessListener
                consensus.offer(CardTextParser.parse(linesInFrame(text, uprightW, uprightH)))?.let(::deliver)
            }
            .addOnCompleteListener { proxy.close() }
    }

    private fun linesInFrame(text: Text, imageW: Int, imageH: Int): List<String> {
        val viewW = previewView.width.toFloat()
        val viewH = previewView.height.toFloat()
        if (viewW == 0f || viewH == 0f) return emptyList()
        val scale = max(viewW / imageW, viewH / imageH)
        val offsetX = (viewW - imageW * scale) / 2
        val offsetY = (viewH - imageH * scale) / 2
        frameRect(viewW, viewH, frame)
        val slackX = frame.width() * 0.05f
        val slackY = frame.height() * 0.05f
        return text.textBlocks.flatMap { it.lines }.filter { line ->
            val box = line.boundingBox ?: return@filter false
            val x = box.exactCenterX() * scale + offsetX
            val y = box.exactCenterY() * scale + offsetY
            x in (frame.left - slackX)..(frame.right + slackX) && y in (frame.top - slackY)..(frame.bottom + slackY)
        }.map { it.text }
    }

    private fun deliver(result: CardTextParser.Result) {
        if (finished) return
        finished = true
        val data = Intent().putExtra(EXTRA_PAN, result.pan)
        result.expiryMonth?.let { data.putExtra(EXTRA_EXPIRY_MONTH, it) }
        result.expiryYear?.let { data.putExtra(EXTRA_EXPIRY_YEAR, it) }
        result.network?.let { data.putExtra(EXTRA_NETWORK, it) }
        setResult(RESULT_OK, data)
        finish()
    }

    private fun cancel() {
        finished = true
        setResult(RESULT_CANCELED)
        finish()
    }

    private fun fail(code: String) {
        finished = true
        setResult(RESULT_CANCELED, Intent().putExtra(EXTRA_ERROR, code))
        finish()
    }

    private fun toggleTorch() {
        val cam = camera ?: return
        torchOn = !torchOn
        cam.cameraControl.enableTorch(torchOn)
        torchButton.text = if (torchOn) "Flash on" else "Flash off"
    }

    private fun chromeButton(label: String, sizeSp: Float) = TextView(this).apply {
        text = label
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setPadding(dp(14), dp(10), dp(14), dp(10))
        isClickable = true
        isFocusable = true
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun match() = FrameLayout.LayoutParams.MATCH_PARENT
    private fun wrap() = FrameLayout.LayoutParams.WRAP_CONTENT

    private class CardFrameOverlay(context: Context) : View(context) {
        private val density = resources.displayMetrics.density
        private val scrim = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xAA000000.toInt() }
        private val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 3 * density
            color = Color.WHITE
        }
        private val title = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = 17 * density
            isFakeBoldText = true
        }
        private val subtitle = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xCCFFFFFF.toInt()
            textAlign = Paint.Align.CENTER
            textSize = 13 * density
        }
        private val frame = RectF()
        private val path = Path()

        override fun onDraw(canvas: Canvas) {
            val w = width.toFloat()
            val h = height.toFloat()
            frameRect(w, h, frame)
            val radius = 14 * density
            path.reset()
            path.fillType = Path.FillType.EVEN_ODD
            path.addRect(0f, 0f, w, h, Path.Direction.CW)
            path.addRoundRect(frame, radius, radius, Path.Direction.CW)
            canvas.drawPath(path, scrim)
            canvas.drawRoundRect(frame, radius, radius, border)
            val textTop = frame.bottom + 40 * density
            canvas.drawText("Fit the side with the card number in the frame", w / 2, textTop, title)
            canvas.drawText("Read on this phone. Nothing is sent anywhere.", w / 2, textTop + 26 * density, subtitle)
        }
    }
}
