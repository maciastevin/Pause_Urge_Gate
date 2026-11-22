package app.pause.urgegate

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

const val ASSET_HOST = "appassets.androidplatform.net"
const val GATE_URL = "https://$ASSET_HOST/assets/gate/index.html"

/** Hosts the shared gate UI in a WebView and exposes the PauseNative bridge. */
abstract class WebActivity : ComponentActivity() {

    protected lateinit var web: WebView

    @Volatile
    var locked = false

    private var recognizer: SpeechRecognizer? = null
    private var pendingListen = false

    private val micPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted && pendingListen) {
                startListening()
            } else if (!granted) {
                js("window.__pauseSpeechError && window.__pauseSpeechError('denied')")
            }
            pendingListen = false
        }

    abstract fun startUrl(): String

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val loader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.setBackgroundColor(ContextCompat.getColor(this, R.color.bg))
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.allowFileAccess = false

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val url = request?.url ?: return null
                return loader.shouldInterceptRequest(url)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (url.host == ASSET_HOST) return false
                openExternal(url.toString())
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                val req = request ?: return
                runOnUiThread {
                    if (req.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && hasMic()) {
                        req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        req.deny()
                        if (!hasMic()) micPermission.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }
            }
        }

        web.addJavascriptInterface(Bridge(), "PauseNative")
        setContentView(web)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!locked) onBackWhenUnlocked()
            }
        })

        web.loadUrl(startUrl())
    }

    open fun onBackWhenUnlocked() {
        finish()
    }

    open fun closeFromWeb() {
        finish()
    }

    override fun onDestroy() {
        recognizer?.destroy()
        recognizer = null
        web.destroy()
        super.onDestroy()
    }

    fun js(code: String) {
        runOnUiThread { if (::web.isInitialized) web.evaluateJavascript(code, null) }
    }

    fun hasMic(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    fun openExternal(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            // no browser — nothing to do
        }
    }

    fun openAccessibilitySettings() {
        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    fun startListening() {
        if (!hasMic()) {
            pendingListen = true
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        recognizer?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
                js("window.__pauseSpeech && window.__pauseSpeech(${JSONObject.quote(text)})")
            }

            override fun onError(error: Int) {
                val code = if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) "denied" else "error"
                js("window.__pauseSpeechError && window.__pauseSpeechError('$code')")
            }

            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        r.startListening(intent)
    }

    /** window.PauseNative in the gate UI. Called on a WebView background thread. */
    inner class Bridge {
        @JavascriptInterface
        fun load(): String = PauseStore.load(this@WebActivity) ?: ""

        @JavascriptInterface
        fun save(json: String) {
            PauseStore.save(this@WebActivity, json)
        }

        @JavascriptInterface
        fun platform(): String = "android"

        @JavascriptInterface
        fun isProtectionOn(): Boolean = UrgeWatchService.isEnabled(this@WebActivity)

        @JavascriptInterface
        fun openProtectionSettings() {
            runOnUiThread { openAccessibilitySettings() }
        }

        @JavascriptInterface
        fun openUrl(url: String) {
            runOnUiThread { openExternal(url) }
        }

        @JavascriptInterface
        fun close() {
            runOnUiThread { closeFromWeb() }
        }

        @JavascriptInterface
        fun setLocked(value: Boolean) {
            locked = value
        }

        @JavascriptInterface
        fun canListen(): Boolean = SpeechRecognizer.isRecognitionAvailable(this@WebActivity)

        @JavascriptInterface
        fun listen() {
            runOnUiThread { startListening() }
        }
    }
}
