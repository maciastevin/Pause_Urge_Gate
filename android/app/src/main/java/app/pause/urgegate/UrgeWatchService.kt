package app.pause.urgegate

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
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
    private var blocker: View? = null
    private val handler = Handler(Looper.getMainLooper())
    private val blockerCheck = object : Runnable {
        override fun run() {
            if (blocker == null) return
            val active = state?.optJSONObject("activePause")
            if (active == null || active.optDouble("endsAt", 0.0) <= System.currentTimeMillis().toDouble()) {
                hideBlocker()
            } else {
                handler.postDelayed(this, 2000)
            }
        }
    }

    private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == null || key == PauseStore.KEY) reload()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
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
        if (instance === this) instance = null
        hideBlocker()
        PauseStore.prefs(this).unregisterOnSharedPreferenceChangeListener(prefsListener)
        super.onDestroy()
    }

    override fun onInterrupt() {}

    private fun reload() {
        state = PauseStore.parsed(this)
        val active = state?.optJSONObject("activePause")
        if (active == null) hideBlocker()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val e = event ?: return
        val pkg = e.packageName?.toString() ?: return
        val now = System.currentTimeMillis()
        val stateChange = e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED

        // 1) A pause is running: cover everything except Pause itself and the phone.
        val active = state?.optJSONObject("activePause")
        if (active != null && active.optDouble("endsAt", 0.0) > now.toDouble()) {
            if (!stateChange) return
            if (pkg == packageName) {
                val cls = e.className?.toString() ?: ""
                if (cls.endsWith("GateActivity") || cls.endsWith("MainActivity")) hideBlocker()
                return
            }
            if (pkg in ALLOWED_DURING_PAUSE) {
                if (pkg in PHONE_APPS) hideBlocker()
                return
            }
            if (pkg in launchers || isLaunchableApp(pkg)) {
                showBlocker()
                if (now - lastGate > 1500) {
                    launchGate(active.optString("target", ""), active.optString("hit", ""))
                }
            }
            return
        }
        if (pkg == packageName) return

        // 2) A watched app was opened.
        if (stateChange && pkg in PauseCore.watchApps(state)) {
            val hit = "app:$pkg"
            if (!PauseCore.hasPass(state, hit, now)) {
                val key = "app|$pkg"
                if (key != lastKey || now - lastAt > 4000) {
                    lastKey = key
                    lastAt = now
                    performGlobalAction(GLOBAL_ACTION_HOME)
                    launchGate(hit, hit)
                }
            }
            return
        }

        // 3) Search boxes in any app (Google, X, YouTube, app search bars...).
        if (e.eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            checkSearchBox(e, pkg, now)
            return
        }

        // 4) Watch browsers' address bars.
        val ids = BROWSER_URL_IDS[pkg] ?: return
        val root = rootInActiveWindow ?: return
        val text = readUrl(root, ids)?.trim() ?: return
        if (text.isEmpty()) return

        val watch = PauseCore.watchList(state)
        val hit = (if (text.contains(' ')) PauseCore.matchText(text, watch) else PauseCore.matchAll(text, watch)) ?: return
        if (PauseCore.hasPass(state, hit, now)) return

        val key = "$pkg|$text"
        if (key == lastKey && now - lastAt < 4000) return
        lastKey = key
        lastAt = now

        performGlobalAction(GLOBAL_ACTION_BACK)
        launchGate(text, hit)
    }

    private fun checkSearchBox(e: AccessibilityEvent, pkg: String, now: Long) {
        val node = e.source
        val typed = e.text?.joinToString(" ")?.trim().orEmpty()
        if (typed.length < 3) return
        val vid = node?.viewIdResourceName
        val isAddressBar = vid != null && BROWSER_URL_IDS[pkg]?.contains(vid) == true
        if (!isAddressBar && !looksLikeSearchBox(node, e)) return
        val hit = PauseCore.matchText(typed, PauseCore.watchList(state)) ?: return
        if (PauseCore.hasPass(state, hit, now)) return
        val key = "search|$pkg|$hit"
        if (key == lastKey && now - lastAt < 4000) return
        lastKey = key
        lastAt = now
        performGlobalAction(GLOBAL_ACTION_BACK)
        launchGate("", hit)
    }

    /** A text field that's for searching or typing an address (not a chat box). */
    private fun looksLikeSearchBox(node: AccessibilityNodeInfo?, e: AccessibilityEvent): Boolean {
        val cls = (node?.className ?: e.className)?.toString()?.lowercase() ?: ""
        if (cls.contains("searchview") || cls.contains("searchbox")) return true
        val id = node?.viewIdResourceName?.lowercase() ?: ""
        val hint = node?.hintText?.toString()?.lowercase() ?: ""
        val desc = node?.contentDescription?.toString()?.lowercase() ?: ""
        val words = listOf("search", "query", "omnibox", "url", "address", "find", "explore")
        return words.any { id.contains(it) || hint.contains(it) || desc.contains(it) }
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

    /** Called by the pause screen the moment it loses the foreground mid-pause. */
    fun coverNow() {
        val active = state?.optJSONObject("activePause") ?: return
        if (active.optDouble("endsAt", 0.0) > System.currentTimeMillis().toDouble()) showBlocker()
    }

    fun uncover() = hideBlocker()

    /** Full-screen cover drawn above every app while a pause runs. */
    private fun showBlocker() {
        if (blocker != null) return
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt() }

        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.gravity = Gravity.CENTER
        box.setBackgroundColor(Color.parseColor("#F717142A"))
        box.setPadding(dp(32f), dp(32f), dp(32f), dp(32f))

        val title = TextView(this)
        title.text = "Pause is still running"
        title.setTextColor(Color.WHITE)
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        title.gravity = Gravity.CENTER
        box.addView(title)

        val body = TextView(this)
        body.text = "The rest of your phone is on hold until the timer ends. You've got this."
        body.setTextColor(Color.parseColor("#A49EC4"))
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        body.gravity = Gravity.CENTER
        body.setPadding(0, dp(12f), 0, dp(24f))
        box.addView(body)

        val back = Button(this)
        back.text = "Back to my pause"
        back.setOnClickListener {
            val active = state?.optJSONObject("activePause")
            launchGate(active?.optString("target", "") ?: "", active?.optString("hit", "") ?: "")
        }
        box.addView(back)

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        try {
            wm.addView(box, lp)
            blocker = box
            handler.postDelayed(blockerCheck, 2000)
        } catch (e: Exception) {
            blocker = null
        }
    }

    private fun hideBlocker() {
        val v = blocker ?: return
        blocker = null
        handler.removeCallbacks(blockerCheck)
        try {
            (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(v)
        } catch (e: Exception) {
            // already gone
        }
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
        @Volatile
        var instance: UrgeWatchService? = null

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

        /** Phone/emergency apps: the pause cover steps aside for these. */
        val PHONE_APPS = setOf(
            "com.android.dialer",
            "com.google.android.dialer",
            "com.samsung.android.dialer",
            "com.samsung.android.incallui",
            "com.android.server.telecom",
            "com.android.phone",
        )

        /** Apps a running pause never blocks: system UI, phone, keyboards. */
        val ALLOWED_DURING_PAUSE = setOf(
            "android",
            "com.android.systemui",
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
