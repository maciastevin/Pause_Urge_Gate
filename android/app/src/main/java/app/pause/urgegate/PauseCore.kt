package app.pause.urgegate

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Native port of the matching rules in browser-extension/gate/core.js.
 * Keep the two in sync.
 */
object PauseCore {
    val DEFAULT_WATCH = listOf(
        "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com",
        "youporn.com", "spankbang.com", "onlyfans.com", "chaturbate.com",
        "porn", "xxx", "nsfw", "hentai",
    )

    private val scheme = Regex("^[a-z][a-z0-9+.-]*://")
    private val port = Regex(":\\d+$")

    fun clean(x: String): String =
        x.trim().lowercase().replace(scheme, "").removePrefix("www.").trimEnd('/')

    /** Returns host and host+path (no query string) for a URL or address-bar text. */
    fun parse(url: String): Pair<String, String> {
        val u = url.trim().lowercase().replace(scheme, "")
        val cut = u.indexOfFirst { it == '/' || it == '?' || it == '#' }
        val host = (if (cut < 0) u else u.substring(0, cut)).removePrefix("www.").replace(port, "")
        val rest = if (cut < 0) "" else u.substring(cut)
        val q = rest.indexOfFirst { it == '?' || it == '#' }
        val path = if (q < 0) rest else rest.substring(0, q)
        return Pair(host, host + path)
    }

    fun match(url: String, watch: List<String>): String? {
        val (host, hostPath) = parse(url)
        if (host.isEmpty()) return null
        for (raw in watch) {
            val e = clean(raw)
            if (e.isEmpty()) continue
            if (e.contains('/')) {
                if (hostPath.startsWith(e) || hostPath.contains(".$e")) return e
            } else if (e.contains('.')) {
                if (host == e || host.endsWith(".$e")) return e
            } else if (hostPath.contains(e)) {
                return e
            }
        }
        return null
    }

    val DEFAULT_WATCH_APPS = setOf("com.twitter.android", "com.reddit.frontpage", "com.tumblr")

    fun watchApps(state: JSONObject?): Set<String> {
        val arr = state?.optJSONArray("watchApps") ?: return DEFAULT_WATCH_APPS
        val out = HashSet<String>()
        for (i in 0 until arr.length()) {
            val pkg = arr.optJSONObject(i)?.optString("pkg", "") ?: ""
            if (pkg.isNotBlank()) out.add(pkg)
        }
        return out
    }

    private val SEARCH_PARAMS = setOf("q", "query", "search_query", "search", "p", "text", "k", "wd", "term", "keywords", "kw")
    private val RECOVERY_WORDS = setOf(
        "quit", "quitting", "stop", "stopping", "addiction", "addicted", "addict", "recovery", "recover",
        "overcome", "nofap", "sober", "sobriety", "therapy", "therapist", "blocker", "support", "relapse",
    )
    private val nonWord = Regex("[^a-z0-9]+")

    fun isRecovery(text: String): Boolean =
        text.lowercase().split(nonWord).any { it in RECOVERY_WORDS }

    fun searchTerms(url: String): String {
        val qi = url.indexOf('?')
        if (qi < 0) return ""
        val out = ArrayList<String>()
        for (pair in url.substring(qi + 1).substringBefore('#').split('&')) {
            val eq = pair.indexOf('=')
            if (eq < 0) continue
            if (pair.substring(0, eq).lowercase() !in SEARCH_PARAMS) continue
            val raw = pair.substring(eq + 1).replace('+', ' ')
            val v = try {
                java.net.URLDecoder.decode(raw, "UTF-8")
            } catch (e: Exception) {
                raw
            }
            if (v.isNotBlank()) out.add(v)
        }
        return out.joinToString(" ")
    }

    /** Free text (a search) against the watch list. See matchText in core.js. */
    fun matchText(text: String, watch: List<String>): String? {
        val t = text.lowercase()
        if (t.isBlank() || isRecovery(t)) return null
        val squashed = t.replace(nonWord, "")
        for (raw in watch) {
            val e = clean(raw)
            if (e.isEmpty()) continue
            if (!e.contains('/') && !e.contains('.')) {
                if (t.contains(e)) return e
            } else {
                val name = e.substringBefore('/').substringBefore('.')
                if (name.length >= 4 && squashed.contains(name)) return e
            }
        }
        return null
    }

    fun matchAll(url: String, watch: List<String>): String? =
        match(url, watch) ?: matchText(searchTerms(url), watch)

    fun watchList(state: JSONObject?): List<String> {
        val arr = state?.optJSONArray("watch") ?: return DEFAULT_WATCH
        val out = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val s = arr.optString(i, "")
            if (s.isNotBlank()) out.add(s)
        }
        return out
    }

    fun hasPass(state: JSONObject?, hit: String, now: Long): Boolean {
        val passes = state?.optJSONObject("passes") ?: return false
        return passes.optDouble(hit, 0.0) > now.toDouble()
    }
}

/** The JSON state the gate UI keeps, stored in SharedPreferences. */
object PauseStore {
    private const val PREFS = "pause"
    const val KEY = "state"

    fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(ctx: Context): String? = prefs(ctx).getString(KEY, null)

    fun save(ctx: Context, json: String) {
        prefs(ctx).edit().putString(KEY, json).apply()
    }

    fun parsed(ctx: Context): JSONObject? {
        val raw = load(ctx) ?: return null
        return try {
            JSONObject(raw)
        } catch (e: Exception) {
            null
        }
    }
}
