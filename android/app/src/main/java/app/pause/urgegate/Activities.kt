package app.pause.urgegate

import android.content.Intent
import android.net.Uri

/** The Pause home screen: stats, watch list, settings, protection toggle. */
class MainActivity : WebActivity() {
    override fun startUrl(): String = GATE_URL

    override fun onResume() {
        super.onResume()
        // Re-check protection status after coming back from Accessibility settings.
        js("window.PauseApp && window.PauseApp.refresh()")
    }
}

/** The full-screen pause, launched over the browser by UrgeWatchService. */
class GateActivity : WebActivity() {
    override fun startUrl(): String = urlFor(intent)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // A pause already on screen keeps running; otherwise show the new one.
        if (!locked) web.loadUrl(urlFor(intent))
    }

    override fun onBackWhenUnlocked() {
        finishAndRemoveTask()
    }

    override fun closeFromWeb() {
        finishAndRemoveTask()
    }

    private fun urlFor(i: Intent?): String {
        val target = i?.getStringExtra(EXTRA_TARGET) ?: ""
        val hit = i?.getStringExtra(EXTRA_HIT) ?: ""
        return GATE_URL + "?mode=pause&target=" + Uri.encode(target) + "&hit=" + Uri.encode(hit)
    }

    companion object {
        const val EXTRA_TARGET = "target"
        const val EXTRA_HIT = "hit"
    }
}
