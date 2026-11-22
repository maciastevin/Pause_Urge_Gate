/* Pause — gate UI. Runs as the browser extension page, inside the Android
 * app's WebView, or as a plain web page (preview mode). */
(function () {
  "use strict";
  const C = window.PauseCore;
  const $app = document.getElementById("app");

  /* ------------------------------- platform ------------------------------- */

  const Platform = (function () {
    const N = window.PauseNative;
    if (N) {
      return {
        kind: "android",
        load: async () => { try { return JSON.parse(N.load() || "null"); } catch (e) { return null; } },
        save: async (s) => N.save(JSON.stringify(s)),
        openSafe: (url) => N.openUrl(url),
        emergency: (url) => N.openUrl(url),
        continueTo: (url) => { N.openUrl(/^https?:/i.test(url) ? url : "https://" + url); N.close(); },
        close: () => N.close(),
        setLocked: (b) => N.setLocked(!!b),
        protectionOn: () => !!N.isProtectionOn(),
        openProtection: () => N.openProtectionSettings(),
        nativeListen: N.canListen && N.canListen() ? () => N.listen() : null,
      };
    }
    const ch = typeof chrome !== "undefined" ? chrome : null;
    if (ch && ch.storage && ch.storage.local && ch.runtime && ch.runtime.id) {
      return {
        kind: "extension",
        load: () => ch.storage.local.get("state").then((r) => r.state || null),
        save: (s) => ch.storage.local.set({ state: s }),
        openSafe: (url) => { location.href = url; },
        emergency: (url) => { ch.tabs.create({ url: url, active: true }); },
        continueTo: (url) => { location.href = url; },
        close: () => window.close(),
        setLocked: () => {},
        protectionOn: () => true,
        openProtection: () => {},
        nativeListen: null,
        onChange: (fn) => ch.storage.onChanged.addListener((c, area) => { if (area === "local" && c.state) fn(); }),
      };
    }
    return {
      kind: "web",
      load: async () => { try { return JSON.parse(localStorage.getItem("pause-state") || "null"); } catch (e) { return null; } },
      save: async (s) => { try { localStorage.setItem("pause-state", JSON.stringify(s)); } catch (e) {} },
      openSafe: (url) => { location.href = url; },
      emergency: (url) => { try { window.open(url, "_blank", "noopener"); } catch (e) {} },
      continueTo: (url) => { location.href = /^https?:/i.test(url) ? url : "https://" + url; },
      close: () => window.close(),
      setLocked: () => {},
      protectionOn: () => false,
      openProtection: () => {},
      nativeListen: null,
    };
  })();

  /* --------------------------------- data --------------------------------- */

  const AFFIRMATIONS = [
    "I am stronger than this urge. It will pass, and I will still be proud tomorrow.",
    "I choose the life I actually want, not the five minutes I would regret.",
    "This feeling is temporary. My goals are not.",
    "I don't need this. I need air, time, and a clear head.",
    "Every urge I ride out makes the next one weaker.",
    "I am the kind of person who keeps promises to himself.",
  ];
  const CAT_LINES = [
    ["🐱", "This cat just tried to fit in a box half its size for 20 minutes. It also had a plan it didn't think through."],
    ["😹", "A group of cats is called a clowder. A group of bad decisions is called 'just one quick look.'"],
    ["🐾", "Cats sleep 70% of their lives. Even they pace themselves better than an urge does."],
    ["🙀", "This cat knocked a cup off a table while maintaining eye contact. Zero shame. Be the cat: walk away like you meant it."],
    ["😼", "A cat's brain is 90% similar to a human's. The other 10% is pure confidence you don't need that tab open."],
    ["🐈", "Cats can rotate their ears 180 degrees. Use yours to listen to literally anything else for the next few minutes."],
  ];
  const PATHS = {
    breathe: { label: "Breathe", emoji: "🌬️", blurb: "Slow your nervous system down" },
    affirmation: { label: "Affirmation", emoji: "🎙️", blurb: "Say it out loud — for real" },
    challenge: { label: "Challenge", emoji: "🧠", blurb: "Math that fights back" },
    cats: { label: "Funny cats", emoji: "🐱", blurb: "Emergency joy, deployed" },
  };

  /* -------------------------------- helpers ------------------------------- */

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clock = (t) => Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    return new Date(t).toLocaleDateString();
  };
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const wordMatch = (target, said) => {
    const t = norm(target);
    const s = new Set(norm(said));
    return t.length ? t.filter((w) => s.has(w)).length / t.length : 0;
  };
  const params = new URLSearchParams(location.search);

  /* --------------------------------- state -------------------------------- */

  let state = C.defaults();
  let view = "home"; // home | pause | exited
  let ui = {}; // per-view transient UI state
  let tick = null;

  async function persist() { await Platform.save(state); }

  async function boot() {
    const loaded = await Platform.load();
    state = C.normalize(loaded);
    if (!loaded) await persist();
    if (params.get("mode") === "pause") {
      await beginPause(params.get("target") || "", params.get("hit") || "");
    } else if (state.activePause && state.activePause.endsAt > Date.now()) {
      // A pause is still running — you don't get to skip it by opening home.
      await beginPause(state.activePause.target, state.activePause.hit);
    } else {
      renderHome();
    }
    if (Platform.onChange) Platform.onChange(async () => {
      if (view !== "home") return;
      state = C.normalize(await Platform.load());
      renderHome();
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && view === "home") renderHome(); });
  }

  /* ---------------------------------- home --------------------------------- */

  function renderHome() {
    view = "home";
    clearInterval(tick);
    Platform.setLocked(false);
    const st = C.stats(state);
    const e = C.escalation(state);
    const s = state.settings;
    let protection;
    if (Platform.kind === "android") {
      const on = Platform.protectionOn();
      protection = on
        ? `<div class="status"><span class="dot"></span><div><b>Protection is on</b><p class="small dim" style="margin:2px 0 0">Pause is watching Chrome, Samsung Internet, Firefox, Brave, Edge, Opera and DuckDuckGo for your watch list.</p></div></div>`
        : `<div class="status off"><span class="dot"></span><div class="grow"><b>Protection is off</b><p class="small dim" style="margin:2px 0 8px">Turn on Pause in Accessibility settings so it can catch watched sites in your browser. Pause only reads the address bar; nothing leaves your phone.</p><button class="btn primary sm" data-act="protect">Turn on protection</button></div></div>`;
    } else if (Platform.kind === "extension") {
      protection = `<div class="status"><span class="dot"></span><div><b>Watching this browser</b><p class="small dim" style="margin:2px 0 0">Watched sites open the pause instead. To cover private windows, turn on “Allow in Incognito” for Pause in your extensions page.</p></div></div>`;
    } else {
      protection = `<div class="status off"><span class="dot"></span><div><b>Preview mode</b><p class="small dim" style="margin:2px 0 0">This is the plain web version — install the browser extension or the Android app for real blocking.</p></div></div>`;
    }
    const recent = state.sessions.slice().reverse().slice(0, 8);
    $app.innerHTML = `
      <header class="brand">
        <img src="icon.svg" alt="" />
        <div><h1>Pause</h1><p>Ride out the urge. It always passes.</p></div>
      </header>

      <section class="card">${protection}</section>

      <section class="card">
        <div class="stats">
          <div class="stat"><b>${st.streak}</b><span>day streak</span></div>
          <div class="stat"><b>${st.ridden}</b><span>urges ridden out</span></div>
          <div class="stat"><b>${st.total}</b><span>pauses</span></div>
        </div>
        ${e.level > 0
          ? `<p class="warn mt">⚡ Fall timer is up: your next pause is <b>${e.minutes} min</b> (${e.multiplier}×) because you came back within 30 minutes. It resets after 30 quiet minutes.</p>`
          : `<p class="small dim mt" style="margin-bottom:0">Next pause: <b>${e.minutes} min</b>. Come back within 30 minutes of a pause and the next one doubles.</p>`}
        <button class="btn primary block mt" data-act="practice">Practice a pause</button>
      </section>

      <section class="card">
        <h3>Watch list</h3>
        <p class="small dim" style="margin:0">Sites (<i>site.com</i>) block that site. Single words (<i>nsfw</i>) block any address containing them — searches aren't blocked.</p>
        <form class="row mt" data-form="watch">
          <input class="field grow" name="entry" placeholder="Add a site or keyword…" autocomplete="off" autocapitalize="off" />
          <button class="btn primary">Add</button>
        </form>
        <div class="chips">${state.watch.map((w, i) => `<span class="chip">${esc(w)}<button aria-label="Remove ${esc(w)}" data-act="unwatch" data-i="${i}">×</button></span>`).join("") || `<span class="small dim">Nothing on the list yet.</span>`}</div>
      </section>

      <section class="card">
        <h3>Settings</h3>
        <div class="setting">
          <label for="pm">Pause length: <span id="pmv">${s.pauseMinutes}</span> min</label>
          <input id="pm" type="range" min="1" max="15" step="1" value="${s.pauseMinutes}" data-set="pauseMinutes" />
        </div>
        <div class="setting">
          <label class="toggle"><span><b style="font-size:14px">Fall timer</b><br><span class="small dim">Coming back within 30 min doubles the next pause (5 → 10 → 20, max 60).</span></span>
          <input type="checkbox" ${s.escalationEnabled ? "checked" : ""} data-set="escalationEnabled" /></label>
        </div>
        <div class="setting">
          <label for="ca">Your own affirmation</label>
          <textarea id="ca" class="field" maxlength="300" placeholder="Write something you'd want to hear in the moment…" data-set="customAffirmation">${esc(s.customAffirmation)}</textarea>
        </div>
        <div class="setting">
          <label for="eu">Emergency exit goes to</label>
          <input id="eu" class="field" value="${esc(s.emergencyExitUrl)}" data-set="emergencyExitUrl" inputmode="url" autocapitalize="off" />
          <div class="row wrap mt">
            <button class="btn sm" data-act="exitpreset" data-url="https://www.google.com">Google</button>
            <button class="btn sm" data-act="exitpreset" data-url="https://en.wikipedia.org/wiki/Special:Random">Random Wikipedia</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h3>Recent pauses</h3>
        ${recent.length ? `<ul class="history">${recent.map((r) => `<li><span>${r.path && PATHS[r.path] ? PATHS[r.path].emoji + " " : ""}${esc(r.trigger || "Pause")} <span class="dim small">· ${ago(r.at)}</span></span>${r.completed ? `<span class="tag ok">rode it out ✓</span>` : r.endedAt ? `<span class="tag no">exited</span>` : `<span class="tag no">in progress</span>`}</li>`).join("")}</ul>` : `<p class="small dim" style="margin:0">No pauses yet. When one happens, it shows up here.</p>`}
      </section>

      <div class="exit-area">
        <button class="btn red big block" data-act="emergency-home">🚨 Emergency exit</button>
        <p class="xs dim">Takes you straight to your safe page.</p>
      </div>`;
  }

  async function setSetting(key, value) {
    if (key === "pauseMinutes") value = C.clamp(value, 1, 15);
    if (key === "emergencyExitUrl") value = String(value).trim();
    state.settings[key] = value;
    await persist();
  }

  /* --------------------------------- pause --------------------------------- */

  async function beginPause(target, hit) {
    view = "pause";
    ui = { path: null, done: new Set(), finished: false };
    C.startPause(state, target, hit);
    await persist();
    Platform.setLocked(true);
    renderPause();
    clearInterval(tick);
    tick = setInterval(updateClock, 1000);
  }

  function remaining() {
    const ap = state.activePause;
    if (!ap) return 0;
    return Math.max(0, Math.ceil((ap.endsAt - Date.now()) / 1000));
  }

  function updateClock() {
    const ap = state.activePause;
    if (!ap || view !== "pause") return;
    const left = remaining();
    const total = ap.minutes * 60;
    const circ = 2 * Math.PI * 52;
    const ring = document.getElementById("ringfg");
    if (ring) ring.setAttribute("stroke-dashoffset", String(circ * (left / total)));
    const c = document.getElementById("clock");
    if (c) c.textContent = clock(left);
    const lbl = document.getElementById("clocklbl");
    if (lbl) lbl.textContent = left ? "remaining" : "you did it";
    const go = document.getElementById("letmego");
    if (go) {
      go.disabled = left > 0;
      go.textContent = left ? "Locked until the pause ends · " + clock(left) : "The urge passed — let me go ✓";
    }
    const note = document.getElementById("gonote");
    if (note) note.textContent = left
      ? "The pause stays up while the timer runs — that's the point. Do one of the activities; the craving peaks and fades on its own."
      : "Notice how different you feel from a few minutes ago? That's the whole trick. It works every time you let it.";
    if (!left) Platform.setLocked(false);
  }

  function renderPause() {
    const ap = state.activePause;
    const practice = ap.hit === "Practice run";
    const circ = 2 * Math.PI * 52;
    const left = remaining();
    const donePaths = [...ui.done];
    $app.innerHTML = `
      <div class="pause-head">
        <p class="eyebrow">Pause caught it</p>
        <h2>Hold on. Let's give this a minute — literally.</h2>
        <p>${ap.hit && !practice ? `You were headed to <b style="color:var(--text)">${esc(C.parseUrl(ap.target).host || ap.hit)}</b>. ` : ""}Nothing here is judging you. Pick something to do with the next few minutes while the urge burns itself out.</p>
        ${ap.multiplier > 1 ? `<p class="warn mt" style="max-width:24rem;margin-left:auto;margin-right:auto">⚡ This pause is ${ap.multiplier}× longer — you came back within 30 minutes of the last one. Each quick return doubles the timer again, up to 60 minutes.</p>` : ""}
        <div class="ring">
          <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" stroke-width="9"/>
          <circle id="ringfg" cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (left / (ap.minutes * 60))}" style="transition:stroke-dashoffset 1s linear"/></svg>
          <div class="inner"><span class="clock" id="clock">${clock(left)}</span><span class="lbl" id="clocklbl">${left ? "remaining" : "you did it"}</span></div>
        </div>
        ${donePaths.length ? `<p class="donepaths">${donePaths.map((p) => PATHS[p].emoji + " " + PATHS[p].label).join("  ·  ")} — done ✓</p>` : ""}
      </div>
      <div id="pathzone"></div>
      <div class="exit-area">
        <button class="btn primary big block" id="letmego" data-act="letmego" ${left ? "disabled" : ""}>${left ? "Locked until the pause ends · " + clock(left) : "The urge passed — let me go ✓"}</button>
        <p class="xs dim" id="gonote"></p>
        <div class="mt2">
          <button class="btn red block" data-act="emergency">🚨 Emergency exit — get me out of here</button>
          <p class="xs dim">Opens your safe page and clears this screen. It ends the pause early — and coming back within 30 minutes makes the next one longer.</p>
        </div>
      </div>`;
    renderPathZone();
    updateClock();
  }

  function renderPathZone() {
    const z = document.getElementById("pathzone");
    if (!z) return;
    if (!ui.path) {
      z.innerHTML = `<div class="paths">${Object.keys(PATHS).map((p, i) => `
        <button class="path" data-act="path" data-p="${p}" style="animation-delay:${i * 40}ms">
          <span class="em" aria-hidden="true">${PATHS[p].emoji}</span>
          <b>${PATHS[p].label}${ui.done.has(p) ? " ✓" : ""}</b>
          <span class="blurb">${PATHS[p].blurb}</span>
        </button>`).join("")}</div>`;
      return;
    }
    const p = ui.path;
    z.innerHTML = `<section class="card" style="margin-top:22px">
      <div class="row" style="justify-content:space-between;margin-bottom:14px">
        <h3 style="margin:0">${PATHS[p].emoji} ${PATHS[p].label}</h3>
        <button class="btn sm" data-act="allpaths">← All options</button>
      </div>
      <div id="activity"></div></section>`;
    ({ breathe: Breathe, affirmation: Affirmation, challenge: Challenge, cats: Cats })[p](document.getElementById("activity"));
  }

  function markDone(p) {
    ui.done.add(p);
    ui.lastPath = p;
    ui.path = null;
    stopActivity();
    renderPause();
  }

  let activityCleanup = null;
  function stopActivity() {
    if (activityCleanup) { try { activityCleanup(); } catch (e) {} activityCleanup = null; }
  }

  async function letMeGo() {
    if (remaining() > 0) return;
    const ap = state.activePause;
    const path = ui.path || ui.lastPath || [...ui.done][0] || "none";
    C.finishPause(state, path, true);
    await persist();
    stopActivity();
    clearInterval(tick);
    Platform.setLocked(false);
    renderDone(ap);
  }

  function renderDone(ap) {
    view = "done";
    const practice = ap.hit === "Practice run";
    const host = C.parseUrl(ap.target).host;
    const confetti = ["#7c6ff0", "#ffb38a", "#5ed3b3", "#f06fa8", "#ffd166"].map((c, i) => `<span class="confetti" style="left:${12 + i * 18}%;background:${c};animation-delay:${i * 80}ms"></span>`).join("");
    $app.innerHTML = `<div class="exited" style="position:relative">${confetti}
      <p style="font-size:52px;margin:0">🌅</p>
      <h2>You rode it out.</h2>
      <p class="dim">That's one more urge that didn't get to decide for you. ${C.stats(state).streak > 1 ? `You're on a ${C.stats(state).streak}-day streak.` : ""}</p>
      <button class="btn mint big block mt2" data-act="safe">Take me somewhere better →</button>
      ${practice ? `<button class="btn block mt" data-act="home">Back to Pause home</button>` : `
        <button class="btn block mt" data-act="home">Open Pause home</button>
        ${ap.target ? `<button class="linkish mt" data-act="continue" data-target="${esc(ap.target)}" data-hit="${esc(ap.hit)}">Continue to ${esc(host)} anyway</button>
        <p class="xs dim">Continuing lets that site through for 10 minutes. If you're back in a pause within 30 minutes, the next one is twice as long.</p>` : ""}`}
    </div>`;
  }

  async function emergencyExit() {
    const url = C.safeUrl(state.settings.emergencyExitUrl);
    if (state.activePause) {
      C.finishPause(state, ui.path || ui.lastPath || "none", false);
      await persist();
    }
    stopActivity();
    clearInterval(tick);
    Platform.setLocked(false);
    Platform.emergency(url);
    renderExited(url);
  }

  function renderExited(url) {
    view = "exited";
    $app.innerHTML = `<div class="exited">
      <p style="font-size:52px;margin:0">🌿</p>
      <h2>You're out.</h2>
      <p class="dim">Your safe page should have opened — go there, breathe, let the moment pass. If it didn't open, tap below.</p>
      <button class="btn primary big block mt2" data-act="safe" data-url="${esc(url)}">Open my safe page →</button>
      <button class="btn block mt" data-act="home">Back to Pause home</button>
    </div>`;
  }

  /* ------------------------------- activities ------------------------------ */

  function Breathe(el) {
    const phases = [["Breathe in…", 4], ["Hold…", 2], ["Let it go…", 4]];
    let i = 0, cycles = 0, t = null;
    function draw() {
      const fin = cycles >= 3;
      el.innerHTML = `<div class="center">
        <div class="orb-wrap"><div class="orb-glow"></div><div class="orb"><span>${phases[i][0]}</span></div></div>
        <p class="small dim">Follow the orb — it swells from the center as you breathe in, and settles as you let go.</p>
        <p class="small" style="font-weight:700;margin:4px 0 0">${fin ? "Three full cycles. Notice your shoulders?" : "Cycle " + Math.min(cycles + 1, 3) + " of 3"}</p>
        <div class="pips">${[0, 1, 2].map((k) => `<i class="${cycles > k ? "on" : ""}"></i>`).join("")}</div>
        <button class="btn mint mt2" data-act="pathdone" data-p="breathe" ${fin ? "" : "disabled"}>${fin ? "That helped ✓" : "Keep breathing…"}</button>
      </div>`;
    }
    function step() {
      t = setTimeout(() => {
        if (i === phases.length - 1) cycles++;
        i = (i + 1) % phases.length;
        const span = el.querySelector(".orb span");
        if (cycles >= 3 || i === 0) draw(); else if (span) span.textContent = phases[i][0];
        step();
      }, phases[i][1] * 1000);
    }
    draw();
    step();
    activityCleanup = () => clearTimeout(t);
  }

  function Affirmation(el) {
    const custom = state.settings.customAffirmation.trim();
    const list = custom ? [custom].concat(AFFIRMATIONS) : AFFIRMATIONS;
    const goal = 3;
    const a = { idx: Math.floor(Math.random() * (custom ? 1 : list.length)), said: 0, listening: false, recording: false, heard: "", feedback: "", audio: null, micBlocked: false, typed: "", saidAloud: false };
    let rec = null, media = null, chunks = [];
    const current = () => list[a.idx % list.length];

    function advance() {
      a.said++; a.idx++; a.heard = ""; a.audio = null; a.saidAloud = false; a.typed = "";
      a.feedback = "That one's in. 💪";
      draw();
    }
    function heard(transcript) {
      a.listening = false;
      a.heard = transcript;
      if (wordMatch(current(), transcript) >= 0.55) advance();
      else { a.feedback = "I heard you, but not quite the words — try once more, nice and clear."; draw(); }
    }
    function micFail(msg) { a.listening = false; a.recording = false; a.micBlocked = true; a.feedback = msg; draw(); }

    window.__pauseSpeech = (t) => heard(String(t || ""));
    window.__pauseSpeechError = (code) => {
      if (code === "denied") micFail("The mic is off for Pause — no problem. Use a no-mic option below; they count just the same.");
      else micFail("Couldn't hear that — try again, or use one of the no-mic options below.");
    };

    function listen() {
      if (Platform.nativeListen) {
        a.listening = true; a.feedback = "Listening… say the words out loud."; draw();
        Platform.nativeListen();
        return;
      }
      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Ctor) return micFail("This browser can't listen for your voice — no problem, use one of the no-mic options below.");
      rec = new Ctor();
      rec.lang = "en-US"; rec.interimResults = false; rec.continuous = false;
      rec.onresult = (e) => heard(((e.results[0] && e.results[0][0] && e.results[0][0].transcript) || "").trim());
      rec.onend = () => { if (a.listening) { a.listening = false; draw(); } };
      rec.onerror = (e) => {
        const err = e && e.error;
        if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") micFail("The mic is blocked for this window — that's the browser saying no, not you doing anything wrong. Use a no-mic option below; they count just the same.");
        else micFail("Couldn't hear that — try again, or use one of the no-mic options below.");
      };
      a.listening = true; a.feedback = "Listening… say the words out loud."; draw();
      try { rec.start(); } catch (err) { a.listening = false; draw(); }
    }
    async function record() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") return micFail("This window doesn't expose a microphone — use one of the no-mic options below instead.");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        media = new MediaRecorder(stream);
        chunks = [];
        media.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        media.onstop = () => {
          a.audio = URL.createObjectURL(new Blob(chunks, { type: media.mimeType || "audio/webm" }));
          stream.getTracks().forEach((t) => t.stop());
          a.recording = false;
          a.feedback = "That's you, saying it. Tick the box below to count it.";
          draw();
        };
        media.start();
        a.recording = true; a.feedback = "Recording — say it like you mean it."; draw();
      } catch (err) {
        micFail("Mic access was blocked. The no-mic options below work just as well.");
      }
    }
    function checkTyped() {
      if (wordMatch(current(), a.typed) >= 0.8) advance();
      else { a.feedback = "Not quite — type the affirmation word for word, exactly as it's written above. Feeling each word is the point."; draw(); }
    }

    function draw() {
      const fin = a.said >= goal;
      if (fin) {
        el.innerHTML = `<div class="center"><p class="small dim" style="font-weight:700;text-transform:uppercase;letter-spacing:.08em">${a.said} of ${goal} said</p>
          <p style="font-size:18px;font-weight:800;color:var(--mint)">Three affirmations, out loud. That's not nothing — that's you, choosing. 🎉</p>
          <button class="btn mint" data-act="pathdone" data-p="affirmation">Done ✓</button></div>`;
        return;
      }
      el.innerHTML = `<div class="center">
        <p class="xs dim" style="font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0">Say this out loud — your voice, not just your eyes</p>
        <blockquote class="aff">“${esc(current())}”</blockquote>
        <p class="small" style="font-weight:700;margin:10px 0 0">${a.said} of ${goal} said</p>
        <div class="pips">${[0, 1, 2].map((k) => `<i class="${a.said > k ? "on" : ""}"></i>`).join("")}</div>
        <div class="row wrap mt2" style="justify-content:center">
          <button class="btn primary" data-a="listen" ${a.listening ? "disabled" : ""}>${a.listening ? "🎙️ Listening…" : "🎙️ Say it — I'm listening"}</button>
          ${a.recording ? `<button class="btn red" data-a="stop">■ Stop recording</button>` : `<button class="btn" data-a="record">● Record instead</button>`}
        </div>
        ${a.audio ? `<audio controls src="${a.audio}" style="width:100%;max-width:24rem;margin-top:14px"></audio>` : ""}
        ${a.heard ? `<p class="small dim">Heard: “${esc(a.heard)}”</p>` : ""}
        ${a.feedback ? `<p class="small" style="color:var(--accent);font-weight:600">${esc(a.feedback)}</p>` : ""}
        <div class="nomic ${a.micBlocked ? "hl" : ""}">
          <b class="small">No mic? No problem.</b>
          <p class="xs dim" style="margin:4px 0 0">Either way below counts — the point was never the mic, it's you actually engaging with the words.</p>
          <label class="check"><input type="checkbox" data-a="aloud" ${a.saidAloud ? "checked" : ""}/> I read the words above out loud, for real</label>
          <button class="btn mint block mt" data-a="count" ${a.saidAloud ? "" : "disabled"}>Count it ✓</button>
          <div class="or">or type it</div>
          <input class="field" data-a="typed" placeholder="Type the affirmation word for word…" value="${esc(a.typed)}" autocomplete="off" />
          <button class="btn dark block mt" data-a="check">Check my typing</button>
        </div>
        <p class="xs dim mt">Your voice is checked only on this device — nothing is uploaded by Pause.</p>
      </div>`;
    }

    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      const k = b.getAttribute("data-a");
      if (k === "listen") listen();
      else if (k === "record") record();
      else if (k === "stop" && media) media.stop();
      else if (k === "count" && a.saidAloud) advance();
      else if (k === "check") checkTyped();
    });
    el.addEventListener("change", (e) => {
      if (e.target.matches('[data-a="aloud"]')) { a.saidAloud = e.target.checked; const c = el.querySelector('[data-a="count"]'); if (c) c.disabled = !a.saidAloud; }
    });
    el.addEventListener("input", (e) => { if (e.target.matches('[data-a="typed"]')) a.typed = e.target.value; });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches('[data-a="typed"]')) checkTyped(); });
    draw();
    activityCleanup = () => {
      try { rec && rec.stop(); } catch (e) {}
      try { media && media.state === "recording" && media.stop(); } catch (e) {}
      window.__pauseSpeech = null; window.__pauseSpeechError = null;
    };
  }

  function makeProblem(level) {
    const r = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    if (level <= 1) { const a = r(12, 58), b = r(11, 47); return { text: `${a} + ${b}`, answer: a + b }; }
    if (level === 2) {
      if (Math.random() < 0.5) { const a = r(6, 12), b = r(4, 9); return { text: `${a} × ${b}`, answer: a * b }; }
      const a = r(60, 140), b = r(25, 59); return { text: `${a} − ${b}`, answer: a - b };
    }
    if (level === 3) { const a = r(7, 15), b = r(6, 12), c = r(15, 60); return { text: `${a} × ${b} + ${c}`, answer: a * b + c }; }
    if (Math.random() < 0.5) {
      const pct = [10, 20, 25, 50][r(0, 3)];
      const base = pct === 25 ? r(10, 50) * 4 : r(4, 20) * 10;
      return { text: `${pct}% of ${base}`, answer: (base * pct) / 100 };
    }
    const a = r(13, 29), b = r(3, 9), c = r(20, 80); return { text: `${a} × ${b} − ${c}`, answer: a * b - c };
  }

  function Challenge(el) {
    const GOAL = 8;
    let solved = 0, streak = 0, problem = makeProblem(1), flash = "";
    const level = () => Math.min(4, 1 + Math.floor(solved / 2));
    function draw(shake) {
      if (solved >= GOAL) {
        el.innerHTML = `<div class="center" style="position:relative;overflow:hidden;padding:10px 0">
          ${["#7c6ff0", "#ffb38a", "#5ed3b3", "#f06fa8", "#ffd166"].map((c, i) => `<span class="confetti" style="left:${12 + i * 18}%;background:${c};animation-delay:${i * 80}ms"></span>`).join("")}
          <p style="font-size:48px;margin:0">🏆</p>
          <p style="font-size:20px;font-weight:800;margin:8px 0 0">Challenge cleared!</p>
          <p class="small dim">Eight problems, escalating to multi-step math — and your brain took the hit from <em>finishing something hard</em> instead. That's the trade working.</p>
          <button class="btn mint" data-act="pathdone" data-p="challenge">Done ✓</button></div>`;
        return;
      }
      el.innerHTML = `<div class="center">
        <div class="row small" style="justify-content:space-between;font-weight:700"><span>Level ${level()} of 4</span><span class="dim">${solved} / ${GOAL} solved</span></div>
        <div class="bar"><div style="width:${(solved / GOAL) * 100}%"></div></div>
        <p class="small dim" style="font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:22px 0 0">Solve it — no calculator, that's the point</p>
        <p class="problem ${shake ? "shake" : ""}">${problem.text} = ?</p>
        <form class="row mt" style="max-width:20rem;margin-left:auto;margin-right:auto" data-c="form">
          <input class="field answer grow ${shake ? "bad" : ""}" type="text" inputmode="decimal" placeholder="Answer" aria-label="Your answer" autocomplete="off" />
          <button class="btn orange">Check</button>
        </form>
        ${flash ? `<p class="small" style="color:var(--accent);font-weight:700" aria-live="polite">${esc(flash)}</p>` : ""}
        <p class="xs dim">It gets harder every two solves — percentages and two-steppers by the end.</p>
      </div>`;
      const inp = el.querySelector("input");
      if (inp) inp.focus({ preventScroll: true });
    }
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = el.querySelector("input").value.trim();
      const v = Number(raw);
      if (!raw || isNaN(v)) { flash = "Type your answer first."; return draw(); }
      if (v === problem.answer) {
        solved++; streak++;
        flash = streak >= 3 ? `🔥 ${streak} in a row!` : "Correct! +10 focus points";
        if (solved < GOAL) problem = makeProblem(level());
        draw();
      } else {
        streak = 0;
        flash = "Not quite — slow down, work it through.";
        draw(true);
      }
    });
    draw();
    activityCleanup = null;
  }

  function Cats(el) {
    let idx = Math.floor(Math.random() * CAT_LINES.length), seen = 1;
    function draw() {
      const l = CAT_LINES[idx % CAT_LINES.length];
      const ready = seen >= 3;
      el.innerHTML = `<div class="center">
        <div class="cat-img"><img src="cat.svg" alt="A very happy orange cat floating among painterly purple cosmic clouds, wearing tiny headphones" /></div>
        <p style="font-size:15px;font-weight:500;max-width:28rem;margin:16px auto 0" aria-live="polite"><span style="font-size:20px">${l[0]}</span> ${esc(l[1])}</p>
        <div class="row wrap mt2" style="justify-content:center">
          <button class="btn pink" data-k="more">Another one 😹</button>
          <button class="btn mint" data-act="pathdone" data-p="cats" ${ready ? "" : "disabled"}>${ready ? "Okay, I'm smiling ✓" : `Smile first (${Math.min(seen, 3)}/3)`}</button>
        </div></div>`;
    }
    el.addEventListener("click", (e) => { if (e.target.closest('[data-k="more"]')) { idx++; seen++; draw(); } });
    draw();
    activityCleanup = null;
  }

  /* -------------------------------- events -------------------------------- */

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.getAttribute("data-act");
    switch (act) {
      case "practice": return beginPause("", "Practice run");
      case "path": ui.path = b.getAttribute("data-p"); return renderPathZone();
      case "allpaths": stopActivity(); ui.path = null; return renderPathZone();
      case "pathdone": return markDone(b.getAttribute("data-p"));
      case "letmego": return letMeGo();
      case "emergency": return emergencyExit();
      case "emergency-home": return emergencyExit();
      case "safe": return Platform.openSafe(b.getAttribute("data-url") || C.safeUrl(state.settings.emergencyExitUrl));
      case "home": return renderHome();
      case "continue": {
        C.grantPass(state, b.getAttribute("data-hit"));
        await persist();
        return Platform.continueTo(b.getAttribute("data-target"));
      }
      case "protect": return Platform.openProtection();
      case "unwatch": {
        const i = Number(b.getAttribute("data-i"));
        const w = state.watch[i];
        if (w != null && confirm(`Remove “${w}” from your watch list?`)) {
          state.watch.splice(i, 1);
          await persist();
          renderHome();
        }
        return;
      }
      case "exitpreset": {
        await setSetting("emergencyExitUrl", b.getAttribute("data-url"));
        return renderHome();
      }
    }
  });

  document.addEventListener("submit", async (e) => {
    const f = e.target.closest('[data-form="watch"]');
    if (!f) return;
    e.preventDefault();
    const entry = C.cleanEntry(f.entry.value);
    if (entry && state.watch.map(C.cleanEntry).indexOf(entry) < 0) {
      state.watch.unshift(entry);
      await persist();
    }
    renderHome();
  });

  document.addEventListener("input", (e) => {
    const k = e.target.getAttribute && e.target.getAttribute("data-set");
    if (k === "pauseMinutes") { const v = document.getElementById("pmv"); if (v) v.textContent = e.target.value; }
  });
  document.addEventListener("change", async (e) => {
    const k = e.target.getAttribute && e.target.getAttribute("data-set");
    if (!k) return;
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    await setSetting(k, v);
    if (k === "pauseMinutes" || k === "escalationEnabled") renderHome();
  });

  // Android back button / system calls
  window.PauseApp = {
    isLocked: () => view === "pause" && remaining() > 0,
    trigger: (target, hit) => beginPause(target, hit),
    refresh: () => { if (view === "home") renderHome(); },
  };

  boot();
})();
