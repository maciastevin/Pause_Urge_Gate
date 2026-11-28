/*
 * Pause core logic — shared by the gate page, the browser extension's
 * background worker, and (ported 1:1) the Android watcher service.
 * No DOM access in here.
 */
(function (g) {
  "use strict";

  // A pause that starts within this window of the previous pause counts as a
  // quick return and doubles the next timer ("fall timer").
  const QUICK_RETURN_MS = 30 * 60 * 1000;
  const MAX_PAUSE_MINUTES = 60;
  // After riding out a pause, "continue anyway" lets that site through for a bit.
  const PASS_MS = 10 * 60 * 1000;
  const MAX_SESSIONS = 500;

  const DEFAULT_WATCH = [
    "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com",
    "youporn.com", "spankbang.com", "onlyfans.com", "chaturbate.com",
    "porn", "xxx", "nsfw", "hentai",
  ];

  // Android only: apps that trigger a pause when opened.
  const DEFAULT_WATCH_APPS = [
    { pkg: "com.twitter.android", label: "X" },
    { pkg: "com.reddit.frontpage", label: "Reddit" },
    { pkg: "com.tumblr", label: "Tumblr" },
  ];

  function defaults() {
    return {
      v: 1,
      settings: {
        pauseMinutes: 5,
        customAffirmation: "",
        escalationEnabled: true,
        emergencyExitUrl: "https://www.google.com",
        strictLock: false,
      },
      watch: DEFAULT_WATCH.slice(),
      watchApps: DEFAULT_WATCH_APPS.map((a) => Object.assign({}, a)),
      sessions: [],
      passes: {},
      activePause: null,
    };
  }

  function normalize(s) {
    const d = defaults();
    if (!s || typeof s !== "object") return d;
    return {
      v: 1,
      settings: Object.assign({}, d.settings, s.settings || {}),
      watch: Array.isArray(s.watch) ? s.watch.filter(Boolean).map(String) : d.watch,
      watchApps: Array.isArray(s.watchApps) ? s.watchApps.filter((a) => a && a.pkg) : d.watchApps,
      sessions: Array.isArray(s.sessions) ? s.sessions : [],
      passes: s.passes && typeof s.passes === "object" ? s.passes : {},
      activePause: s.activePause && typeof s.activePause === "object" ? s.activePause : null,
    };
  }

  function cleanEntry(x) {
    return String(x || "")
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }

  function parseUrl(url) {
    let u = String(url || "").trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    const cut = u.search(/[/?#]/);
    const host = (cut < 0 ? u : u.slice(0, cut)).replace(/^www\./, "").replace(/:\d+$/, "");
    const rest = cut < 0 ? "" : u.slice(cut);
    const q = rest.search(/[?#]/);
    const path = q < 0 ? rest : rest.slice(0, q);
    return { host: host, path: path, hostPath: host + path };
  }

  /**
   * Returns the watch-list entry that matches the URL, or null.
   *  - "site.com"        → that host and its subdomains
   *  - "site.com/r/x"    → URLs starting with that host + path
   *  - "keyword"         → keyword anywhere in host or path (not the query
   *                         string, so searching "how to quit porn" isn't blocked)
   */
  function match(url, watch) {
    const p = parseUrl(url);
    if (!p.host) return null;
    for (const raw of watch || []) {
      const e = cleanEntry(raw);
      if (!e) continue;
      if (e.indexOf("/") >= 0) {
        if (p.hostPath.indexOf(e) === 0 || p.hostPath.indexOf("." + e) >= 0) return e;
      } else if (e.indexOf(".") >= 0) {
        if (p.host === e || p.host.endsWith("." + e)) return e;
      } else if (p.hostPath.indexOf(e) >= 0) {
        return e;
      }
    }
    return null;
  }

  // Query-string keys that hold what someone typed into a search box.
  const SEARCH_PARAMS = ["q", "query", "search_query", "search", "p", "text", "k", "wd", "term", "keywords", "kw"];
  // Searches about getting help are never blocked.
  const RECOVERY_WORDS = [
    "quit", "quitting", "stop", "stopping", "addiction", "addicted", "addict", "recovery", "recover",
    "overcome", "nofap", "sober", "sobriety", "therapy", "therapist", "blocker", "support", "relapse",
  ];

  function isRecovery(text) {
    const words = String(text || "").toLowerCase().split(/[^a-z0-9]+/);
    return words.some((w) => RECOVERY_WORDS.indexOf(w) >= 0);
  }

  /** The search terms in a URL's query string, or "" if none. */
  function searchTerms(url) {
    const s = String(url || "");
    const qi = s.indexOf("?");
    if (qi < 0) return "";
    const out = [];
    s.slice(qi + 1).split("#")[0].split("&").forEach((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return;
      const key = pair.slice(0, eq).toLowerCase();
      if (SEARCH_PARAMS.indexOf(key) < 0) return;
      let v = pair.slice(eq + 1).replace(/\+/g, " ");
      try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ }
      if (v.trim()) out.push(v);
    });
    return out.join(" ");
  }

  /**
   * Matches free text (a search, a typed query) against the watch list:
   * keywords anywhere, and site names without their ending ("pornhub" for
   * pornhub.com). Searches about recovery are let through.
   */
  function matchText(text, watch) {
    const t = String(text || "").toLowerCase();
    if (!t.trim() || isRecovery(t)) return null;
    const squashed = t.replace(/[^a-z0-9]+/g, "");
    for (const raw of watch || []) {
      const e = cleanEntry(raw);
      if (!e) continue;
      if (e.indexOf("/") < 0 && e.indexOf(".") < 0) {
        if (t.indexOf(e) >= 0) return e;
      } else {
        const name = e.split("/")[0].split(".")[0];
        if (name.length >= 4 && squashed.indexOf(name) >= 0) return e;
      }
    }
    return null;
  }

  /** match() for the address, then for any search terms in it. */
  function matchAll(url, watch) {
    return match(url, watch) || matchText(searchTerms(url), watch);
  }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function sessionTime(s) {
    return s.endedAt || s.at || 0;
  }

  /** Fall-timer escalation for a pause starting now. */
  function escalation(state, now) {
    now = now || Date.now();
    const base = clamp(state.settings.pauseMinutes, 1, 15);
    let level = 0;
    if (state.settings.escalationEnabled) {
      const ss = state.sessions.slice().sort((a, b) => sessionTime(b) - sessionTime(a));
      let prev = now;
      for (const s of ss) {
        if (prev - sessionTime(s) <= QUICK_RETURN_MS) {
          level++;
          prev = s.at || sessionTime(s);
        } else break;
      }
    }
    level = Math.min(level, 6);
    const multiplier = Math.pow(2, level);
    return { level: level, multiplier: multiplier, base: base, minutes: Math.min(base * multiplier, MAX_PAUSE_MINUTES) };
  }

  /** Starts (or resumes) a pause. Mutates state. Returns the active pause. */
  function startPause(state, target, hit, now) {
    now = now || Date.now();
    const ap = state.activePause;
    if (ap && ap.endsAt > now) return ap;
    if (ap && !ap.finished) {
      // Timer ran out while the gate was closed — that still counts as riding it out.
      finishPause(state, "none", true, ap.endsAt);
    }
    const esc = escalation(state, now);
    const id = now;
    state.sessions.push({ id: id, at: now, endedAt: null, path: "none", trigger: hit || "", completed: false });
    if (state.sessions.length > MAX_SESSIONS) state.sessions.splice(0, state.sessions.length - MAX_SESSIONS);
    state.activePause = {
      id: id,
      target: target || "",
      hit: hit || "",
      startedAt: now,
      endsAt: now + esc.minutes * 60 * 1000,
      minutes: esc.minutes,
      multiplier: esc.multiplier,
    };
    return state.activePause;
  }

  function finishPause(state, path, completed, when) {
    const ap = state.activePause;
    if (!ap) return;
    const s = state.sessions.find((x) => x.id === ap.id);
    if (s) {
      s.endedAt = when || Date.now();
      s.path = path || "none";
      s.completed = !!completed;
    }
    state.activePause = null;
  }

  function grantPass(state, hit, now) {
    now = now || Date.now();
    for (const k of Object.keys(state.passes)) if (state.passes[k] < now) delete state.passes[k];
    if (hit) state.passes[hit] = now + PASS_MS;
  }

  function hasPass(state, hit, now) {
    now = now || Date.now();
    return !!(hit && state.passes && state.passes[hit] > now);
  }

  function dayKey(t) {
    const d = new Date(t);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function stats(state) {
    const done = state.sessions.filter((s) => s.completed);
    const days = new Set(done.map((s) => dayKey(sessionTime(s))));
    let streak = 0;
    const c = new Date();
    if (!days.has(dayKey(c.getTime()))) c.setDate(c.getDate() - 1);
    while (days.has(dayKey(c.getTime()))) {
      streak++;
      c.setDate(c.getDate() - 1);
    }
    return { total: state.sessions.length, ridden: done.length, streak: streak };
  }

  function safeUrl(u) {
    u = String(u || "").trim();
    return /^https?:\/\//i.test(u) ? u : "https://www.google.com";
  }

  g.PauseCore = {
    QUICK_RETURN_MS, MAX_PAUSE_MINUTES, PASS_MS, DEFAULT_WATCH, DEFAULT_WATCH_APPS,
    defaults, normalize, cleanEntry, parseUrl, match, matchText, matchAll, searchTerms, isRecovery, clamp, escalation,
    startPause, finishPause, grantPass, hasPass, stats, safeUrl,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
