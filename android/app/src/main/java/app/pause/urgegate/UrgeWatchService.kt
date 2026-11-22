package app.pause.urgegate

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

/**
 * Reads the address bar of common browsers. When it shows a site on the
 * watch list, backs the browser off the page and opens the pause. While a
 * pause is running, switching to another app brings the pause back.
 */
class UrgeWatchService : AccessibilityService() {

    private var state: JSONObject? = null
    private var launchers: Set<String> = emptySet()
    private val launchable = HashMap<String, Boolean>()
    private var lastKey = ""
    private var lastAt = 0L
    private var lastGate = 0L

    private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == null || key == PauseStore.KEY) reload()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        reload()
        PauseStore.prefs(this).registerOnSharedPreferenceChangeListener(prefsListener)
        launchers = try {
            val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            packageManager.queryIntentActivities(home, PackageManager.MATCH_DEFAULT_ONLY)
                .map { it.activityInfo.packageName }
                .toSet()
        } catch (e: Exception) {
            emptySet()
        }
    }

    override fun onDestroy() {
        PauseStore.prefs(this).unregisterOnSharedPreferenceChangeListener(prefsListener)
        super.onDestroy()
    }

    override fun onInterrupt() {}

    private fun reload() {
        state = PauseStore.parsed(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val e = event ?: return
        val pkg = e.packageName?.toString() ?: return
        if (pkg == packageName) return
        val now = System.currentTimeMillis()

        // 1) A pause is running: keep it on screen.
        val active = state?.optJSONObject("activePause")
        if (active != null && active.optDouble("endsAt", 0.0) > now.toDouble()) {
            if (e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
                now - lastGate > 1500 &&
                pkg !in ALLOWED_DURING_PAUSE &&
                pkg !in launchers &&
                isLaunchableApp(pkg)
            ) {
                launchGate(active.optString("target", ""), active.optString("hit", ""))
            }
            return
        }

        // 2) Watch browsers' address bars.
        val ids = BROWSER_URL_IDS[pkg] ?: return
        val root = rootInActiveWindow ?: return
        val text = readUrl(root, ids)?.trim() ?: return
        if (text.isEmpty() || text.contains(' ')) return

        val hit = PauseCore.match(text, PauseCore.watchList(state)) ?: return
        if (PauseCore.hasPass(state, hit, now)) return

        val key = "$pkg|$text"
        if (key == lastKey && now - lastAt < 4000) return
        lastKey = key
        lastAt = now

        performGlobalAction(GLOBAL_ACTION_BACK)
        launchGate(text, hit)
    }

    private fun readUrl(root: AccessibilityNodeInfo, ids: List<String>): String? {
        for (id in ids) {
            val nodes = try {
                root.findAccessibilityNodeInfosByViewId(id)
            } catch (e: Exception) {
                null
            }
            val t = nodes?.firstOrNull()?.text?.toString()
            if (!t.isNullOrBlank()) return t
        }
        // Fallback for browsers whose ids changed: first edit field that looks like an address.
        return findAddressLike(root, 0, intArrayOf(0))
    }

    private fun findAddressLike(node: AccessibilityNodeInfo?, depth: Int, seen: IntArray): String? {
        if (node == null || depth > 12 || seen[0] > 250) return null
        seen[0]++
        val cls = node.className?.toString() ?: ""
        if (cls.endsWith("EditText")) {
            val t = node.text?.toString()?.trim()
            if (t != null && t.contains('.') && !t.contains(' ')) return t
        }
        for (i in 0 until node.childCount) {
            val found = findAddressLike(node.getChild(i), depth + 1, seen)
            if (found != null) return found
        }
        return null
    }

    private fun isLaunchableApp(pkg: String): Boolean =
        launchable.getOrPut(pkg) {
            try {
                packageManager.getLaunchIntentForPackage(pkg) != null
            } catch (e: Exception) {
                false
            }
        }

    private fun launchGate(target: String, hit: String) {
        lastGate = System.currentTimeMillis()
        val i = Intent(this, GateActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(GateActivity.EXTRA_TARGET, target)
            .putExtra(GateActivity.EXTRA_HIT, hit)
        try {
            startActivity(i)
        } catch (e: Exception) {
            // ignore
        }
    }

    companion object {
        private fun chromium(pkg: String) = pkg to listOf("$pkg:id/url_bar")

        val BROWSER_URL_IDS: Map<String, List<String>> = mapOf(
            chromium("com.android.chrome"),
            chromium("com.chrome.beta"),
            chromium("com.chrome.dev"),
            chromium("com.chrome.canary"),
            chromium("com.brave.browser"),
            chromium("com.microsoft.emmx"),
            chromium("com.vivaldi.browser"),
            chromium("com.kiwibrowser.browser"),
            "com.sec.android.app.sbrowser" to listOf(
                "com.sec.android.app.sbrowser:id/location_bar_edit_text",
                "com.sec.android.app.sbrowser:id/custom_location_bar_edit_text",
            ),
            "org.mozilla.firefox" to listOf(
                "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
                "org.mozilla.firefox:id/url_bar_title",
            ),
            "org.mozilla.firefox_beta" to listOf("org.mozilla.firefox_beta:id/mozac_browser_toolbar_url_view"),
            "org.mozilla.focus" to listOf(
                "org.mozilla.focus:id/mozac_browser_toolbar_url_view",
                "org.mozilla.focus:id/display_url",
            ),
            "com.opera.browser" to listOf("com.opera.browser:id/url_field"),
            "com.opera.mini.native" to listOf("com.opera.mini.native:id/url_field"),
            "com.duckduckgo.mobile.android" to listOf("com.duckduckgo.mobile.android:id/omnibarTextInput"),
        )

        /** Apps a running pause never blocks: system UI, phone, settings, keyboards. */
        val ALLOWED_DURING_PAUSE = setOf(
            "android",
            "com.android.systemui",
            "com.android.settings",
            "com.samsung.android.settings",
            "com.android.dialer",
            "com.google.android.dialer",
            "com.samsung.android.dialer",
            "com.samsung.android.incallui",
            "com.android.server.telecom",
            "com.android.phone",
            "com.google.android.inputmethod.latin",
            "com.samsung.android.honeyboard",
            "com.google.android.permissioncontroller",
            "com.android.permissioncontroller",
        )

        fun isEnabled(ctx: Context): Boolean {
            val enabled = Settings.Secure.getString(
                ctx.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ) ?: return false
            val me = ComponentName(ctx, UrgeWatchService::class.java)
            return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
        }
    }
}
