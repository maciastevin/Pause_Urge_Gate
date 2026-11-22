import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import { api } from "./api";
import type { Actions } from "../../server/src/actions";
import catImg from "./assets/media-generation-cosmic-cat-0-54be63e4-979f-4676-a18a-d39711b85fc9.webp";

const FIELDS = actionFields<typeof Actions>();

/* ---------------------------------- data ---------------------------------- */

const AFFIRMATIONS = [
  "I am stronger than this urge. It will pass, and I will still be proud tomorrow.",
  "I choose the life I actually want, not the five minutes I would regret.",
  "This feeling is temporary. My goals are not.",
  "I don't need this. I need air, time, and a clear head.",
  "Every urge I ride out makes the next one weaker.",
  "I am the kind of person who keeps promises to himself.",
];

const CAT_LINES = [
  { emoji: "🐱", text: "This cat just tried to fit in a box half its size for 20 minutes. It also had a plan it didn't think through." },
  { emoji: "😹", text: "A group of cats is called a clowder. A group of bad decisions is called 'just one quick look.'" },
  { emoji: "🐾", text: "Cats sleep 70% of their lives. Even they pace themselves better than an urge does." },
  { emoji: "🙀", text: "This cat knocked a cup off a table while maintaining eye contact. Zero shame. Be the cat: walk away like you meant it." },
  { emoji: "😼", text: "A cat's brain is 90% similar to a human's. The other 10% is pure confidence you don't need that tab open." },
  { emoji: "🐈", text: "Cats can rotate their ears 180 degrees. Use yours to listen to literally anything else for the next few minutes." },
];

type Path = "breathe" | "affirmation" | "challenge" | "cats";

const PATH_META: Record<Path, { label: string; emoji: string; blurb: string; tint: string }> = {
  breathe: { label: "Breathe", emoji: "🌬️", blurb: "Slow your nervous system down", tint: "#7c6ff0" },
  affirmation: { label: "Affirmation", emoji: "🎙️", blurb: "Say it out loud — for real", tint: "#2fbfa0" },
  challenge: { label: "Challenge", emoji: "🧠", blurb: "Math that fights back", tint: "#ff9d5c" },
  cats: { label: "Funny cats", emoji: "🐱", blurb: "Emergency joy, deployed", tint: "#f06fa8" },
};

function fmtClock(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Emergency exit, best effort from inside a web page: fling the user's safe
 * page open in a new tab so it takes over their attention, then try to close
 * this tab. A web page cannot force-close other apps (Reddit, X, a browser) —
 * that last step belongs to the native shell — so the caller also swaps this
 * screen to the calm "You're out" view as the guaranteed part.
 */
function performEmergencyExit(destination: string) {
  const url = /^https?:\/\//i.test(destination.trim()) ? destination.trim() : "https://www.google.com";
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    /* popup blocked — the exited screen still offers the link */
  }
  try {
    window.close();
  } catch {
    /* only works for tabs a script opened; harmless otherwise */
  }
}

/* ------------------------------ brush backdrop ----------------------------- */

function BrushBackdrop({ opacity = 1 }: { opacity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity }}>
      <div className="absolute -top-24 -left-24 h-72 w-96 rounded-[60%_40%_55%_45%/50%_60%_40%_50%] bg-[#c9c2ff] blur-2xl" style={{ animation: "drift 14s ease-in-out infinite" }} />
      <div className="absolute top-10 -right-28 h-64 w-80 rounded-[45%_55%_40%_60%/60%_40%_60%_40%] bg-[#ffd9bd] blur-2xl" style={{ animation: "drift 18s ease-in-out infinite reverse" }} />
      <div className="absolute -bottom-28 left-1/4 h-60 w-96 rounded-[55%_45%_60%_40%/45%_55%_45%_55%] bg-[#b8ecdc] blur-3xl" style={{ animation: "drift 20s ease-in-out infinite" }} />
    </div>
  );
}

/* ---------------------------------- App ----------------------------------- */

export function App() {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: () => api.getState({}) });
  const [intervention, setIntervention] = useState<{ trigger: string } | null>(null);
  const [exited, setExited] = useState(false);

  const logSession = useMutation({
    mutationFn: (args: { path: Path | "none"; triggerText: string; completed: boolean }) => api.logSession(args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });

  if (state.isPending) {
    return (
      <div className="relative min-h-screen bg-[var(--bg)]">
        <BrushBackdrop />
        <p className="relative pt-24 text-center text-[var(--dim)]">Loading your pause…</p>
      </div>
    );
  }
  if (state.error || !state.data) {
    return (
      <div className="min-h-screen bg-[var(--bg)] px-6 pt-24 text-center">
        <p className="text-lg font-semibold text-[var(--text)]">Something didn't load</p>
        <p className="mt-2 text-sm text-[var(--dim)]">Pull to retry, or reopen the app.</p>
        <button
          type="button"
          onClick={() => state.refetch()}
          className="mt-5 rounded-full bg-[var(--accent)] px-6 py-2.5 font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  const data = state.data;

  const emergencyExitFromPause = (path: Path | "none") => {
    if (intervention) {
      logSession.mutate({ path, triggerText: intervention.trigger, completed: false });
    }
    performEmergencyExit(data.emergencyExitUrl);
    setIntervention(null);
    setExited(true);
  };
  const emergencyExitFromHome = () => {
    performEmergencyExit(data.emergencyExitUrl);
    setExited(true);
  };

  return (
    <div className="relative min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <Home
        pauseMinutes={data.pauseMinutes}
        customAffirmation={data.customAffirmation}
        escalationEnabled={data.escalationEnabled}
        emergencyExitUrl={data.emergencyExitUrl}
        escalationLevel={data.escalationLevel}
        escalationMultiplier={data.escalationMultiplier}
        effectivePauseMinutes={data.effectivePauseMinutes}
        lastPauseAt={data.lastPauseAt}
        blocklist={data.blocklist}
        sessions={data.sessions}
        totalPauses={data.totalPauses}
        completedPauses={data.completedPauses}
        streakDays={data.streakDays}
        onTrigger={(trigger) => setIntervention({ trigger })}
        onEmergencyExit={emergencyExitFromHome}
      />
      {intervention && (
        <Intervention
          totalSeconds={data.effectivePauseMinutes * 60}
          trigger={intervention.trigger}
          customAffirmation={data.customAffirmation}
          multiplier={data.escalationMultiplier}
          onFinish={(path, completed) => {
            logSession.mutate({ path, triggerText: intervention.trigger, completed });
            setIntervention(null);
          }}
          onEmergencyExit={emergencyExitFromPause}
        />
      )}
      {exited && (
        <ExitedScreen destination={data.emergencyExitUrl} onBack={() => setExited(false)} />
      )}
    </div>
  );
}

/* ------------------------------- Exited screen ------------------------------ */

function ExitedScreen({ destination, onBack }: { destination: string; onBack: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[var(--bg)] text-[var(--text)]" role="dialog" aria-modal="true" aria-label="Emergency exit complete">
      <BrushBackdrop />
      <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-6 py-12 text-center">
        <p className="text-5xl" aria-hidden>🌿</p>
        <h2 className="mt-4 text-3xl font-extrabold">You're out.</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--dim)]">
          Your safe page should have opened in a new tab — go there, breathe, let the moment pass.
          If it didn't open, tap below. This screen is all that's left of the pause.
        </p>
        <a
          href={destination}
          target="_blank"
          rel="noreferrer"
          className="mt-6 w-full rounded-full bg-[var(--accent)] px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-[#7c6ff0]/30"
        >
          Open my safe page →
        </a>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 w-full rounded-full bg-[var(--surface)] px-6 py-3 text-sm font-bold ring-1 ring-[var(--border)]"
        >
          Back to Pause home
        </button>
        <p className="mt-6 max-w-sm text-xs leading-relaxed text-[var(--dim)]">
          One honest limit: a web page can't reach over and force-close Reddit, X, or your browser —
          that takes the native app (Screen Time on Apple, Accessibility on Android), where this same
          button kills the app you were in. And a heads-up: coming back within 30 minutes makes your
          next pause longer. That's on purpose.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------- Home ----------------------------------- */

function Home(props: {
  pauseMinutes: number;
  customAffirmation: string;
  escalationEnabled: boolean;
  emergencyExitUrl: string;
  escalationLevel: number;
  escalationMultiplier: number;
  effectivePauseMinutes: number;
  lastPauseAt: string | null;
  blocklist: { id: number; domain: string }[];
  sessions: { id: number; path: string; triggerText: string; completed: boolean; created_at: string }[];
  totalPauses: number;
  completedPauses: number;
  streakDays: number;
  onTrigger: (trigger: string) => void;
  onEmergencyExit: () => void;
}) {
  const queryClient = useQueryClient();
  const [fakeUrl, setFakeUrl] = useState("");
  const [urlMsg, setUrlMsg] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [domainError, setDomainError] = useState("");
  const [pauseMinutes, setPauseMinutes] = useState(props.pauseMinutes);
  const [customAff, setCustomAff] = useState(props.customAffirmation);
  const [escalationEnabled, setEscalationEnabled] = useState(props.escalationEnabled);
  const [exitUrl, setExitUrl] = useState(props.emergencyExitUrl);
  const [settingsMsg, setSettingsMsg] = useState("");

  useEffect(() => setPauseMinutes(props.pauseMinutes), [props.pauseMinutes]);
  useEffect(() => setCustomAff(props.customAffirmation), [props.customAffirmation]);
  useEffect(() => setEscalationEnabled(props.escalationEnabled), [props.escalationEnabled]);
  useEffect(() => setExitUrl(props.emergencyExitUrl), [props.emergencyExitUrl]);

  const addDomain = useMutation({
    mutationFn: (domain: string) => api.addBlockDomain({ domain }),
    onSuccess: () => {
      setNewDomain("");
      setDomainError("");
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
    onError: (e) => setDomainError(e instanceof Error ? e.message : "Couldn't add that."),
  });
  const removeDomain = useMutation({
    mutationFn: (id: number) => api.removeBlockDomain({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const saveSettings = useMutation({
    mutationFn: async () =>
      await api.updateSettings({
        pauseMinutes,
        customAffirmation: customAff.trim(),
        escalationEnabled,
        emergencyExitUrl: exitUrl.trim() || "https://www.google.com",
      }),
    onSuccess: () => {
      setSettingsMsg("Saved ✓");
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
    onError: (e) => setSettingsMsg(e instanceof Error ? e.message : "Couldn't save."),
  });

  const tryVisit = () => {
    const v = fakeUrl.trim().toLowerCase();
    if (!v) {
      setUrlMsg("Type an address first — try one from your watch list.");
      return;
    }
    const hit = props.blocklist.find((d) => v.includes(d.domain));
    if (hit) {
      props.onTrigger(hit.domain);
    } else {
      setUrlMsg(`“${fakeUrl.trim()}” isn't on your watch list, so Pause wouldn't step in. Add it below if it should be.`);
    }
  };

  return (
    <main className="relative mx-auto w-full max-w-2xl px-4 pb-16">
      {/* Hero */}
      <section className="relative mt-4 overflow-hidden rounded-[28px] bg-[var(--surface)] shadow-[0_18px_50px_-20px_rgba(124,111,240,0.45)]">
        <BrushBackdrop />
        <div className="relative px-6 pb-7 pt-8 sm:px-9">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Pause · a $5 fallback, forever yours</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">
            The urge lasts minutes.
            <br />
            <span className="text-[var(--accent)]">So does the pause.</span>
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--dim)]">
            When a site on your watch list pops up, Pause takes over the screen for {props.effectivePauseMinutes} minutes —
            breathe, say it out loud, beat a challenge, or deploy emergency cats — until the moment passes.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => props.onTrigger("Practice run")}
              className="rounded-full bg-[var(--accent)] px-6 py-3 text-[15px] font-bold text-white shadow-lg shadow-[#7c6ff0]/30 transition active:scale-95"
            >
              ▶ Try a pause now
            </button>
            <span className="inline-flex items-center rounded-full bg-[var(--surface)]/80 px-4 py-2 text-sm font-semibold text-[var(--dim)] ring-1 ring-[var(--border)]">
              $5 one-time · Mac · iPhone · iPad · Android · no subscription
            </span>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-[var(--surface)]/85 px-2 py-3 ring-1 ring-[var(--border)]">
              <p className="text-2xl font-extrabold">{props.streakDays}<span className="text-base"> 🔥</span></p>
              <p className="text-xs font-medium text-[var(--dim)]">day streak</p>
            </div>
            <div className="rounded-2xl bg-[var(--surface)]/85 px-2 py-3 ring-1 ring-[var(--border)]">
              <p className="text-2xl font-extrabold">{props.completedPauses}</p>
              <p className="text-xs font-medium text-[var(--dim)]">urges ridden out</p>
            </div>
            <div className="rounded-2xl bg-[var(--surface)]/85 px-2 py-3 ring-1 ring-[var(--border)]">
              <p className="text-2xl font-extrabold">{props.totalPauses}</p>
              <p className="text-xs font-medium text-[var(--dim)]">pauses taken</p>
            </div>
          </div>
        </div>
      </section>

      {/* Escalation status */}
      {props.escalationEnabled && props.escalationMultiplier > 1 && (
        <section className="mt-6 rounded-[24px] bg-[#fff3e8] p-5 ring-1 ring-[#f5cf9f] dark:bg-[#3a2c1c] dark:ring-[#6b4d26] sm:p-6" aria-live="polite">
          <h2 className="text-lg font-bold">⚡ Quick return — your next pause is {props.escalationMultiplier}× longer</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            You came back within 30 minutes of your last pause
            {props.lastPauseAt ? <> (last one ended {new Date(props.lastPauseAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })})</> : null},
            so the timer doubled: your next pause runs <b className="text-[var(--text)]">{props.effectivePauseMinutes} minutes</b> instead
            of {props.pauseMinutes}. Every quick return doubles it again, up to 60 minutes. Go 30 minutes without a
            pause and it resets to normal.
          </p>
        </section>
      )}

      {/* Emergency exit */}
      <section className="mt-6 rounded-[24px] bg-red-500/[0.07] p-5 ring-1 ring-red-400/40 sm:p-6">
        <h2 className="text-lg font-bold">🚨 Emergency exit</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          In a bad moment and just need <em>out</em> — of this, of the app you were in, of all of it? One tap opens
          your safe page in a new tab, tries to close this tab, and clears Pause off your screen.
        </p>
        <button
          type="button"
          onClick={props.onEmergencyExit}
          className="mt-4 w-full rounded-full bg-red-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-red-500/25 transition active:scale-[0.98] sm:w-auto sm:px-8"
        >
          Get me out of here now
        </button>
        <p className="mt-3 text-xs leading-relaxed text-[var(--dim)]">
          The honest limit: a web page can't force-close Reddit, X, or your browser — nothing running in a browser
          tab can. The native $5 app can: there, this button kills the app you were in. Here it does everything a
          page is allowed to do, instantly. Change where it takes you in settings below.
        </p>
      </section>

      {/* Simulated browser */}
      <section className="mt-6 rounded-[24px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--border)] sm:p-6">
        <h2 className="text-lg font-bold">See it catch something</h2>
        <p className="mt-1 text-sm text-[var(--dim)]">
          This is how detection feels: type an address from your watch list and hit Go — Pause steps in before the page loads.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-full bg-[var(--surface2)] py-1.5 pl-4 pr-1.5 ring-1 ring-[var(--border)]">
          <span aria-hidden>🔒</span>
          <label htmlFor="fake-url" className="sr-only">Simulated browser address</label>
          <input
            id="fake-url"
            value={fakeUrl}
            onChange={(e) => setFakeUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tryVisit()}
            placeholder={props.blocklist[0] ? `Try ${props.blocklist[0].domain}…` : "Add a site below, then try it…"}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--dim)]"
          />
          <button type="button" onClick={tryVisit} className="shrink-0 rounded-full bg-[var(--text)] px-5 py-2 text-sm font-bold text-[var(--bg)]">
            Go
          </button>
        </div>
        {urlMsg && <p className="mt-3 text-sm font-medium text-[var(--accent)]">{urlMsg}</p>}
      </section>

      {/* Watch list */}
      <section className="mt-6 rounded-[24px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--border)] sm:p-6">
        <h2 className="text-lg font-bold">Your watch list</h2>
        <p className="mt-1 text-sm text-[var(--dim)]">Sites and words that trigger a pause. Yours starts empty — add the ones that matter to you.</p>
        {props.blocklist.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-[var(--surface2)] px-4 py-3 text-sm text-[var(--dim)]">Nothing here yet. Add your first trigger below.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {props.blocklist.map((d) => (
              <li key={d.id} className="inline-flex items-center gap-2 rounded-full bg-[var(--surface2)] py-1.5 pl-4 pr-1.5 text-sm font-semibold ring-1 ring-[var(--border)]">
                {d.domain}
                <button
                  type="button"
                  aria-label={`Remove ${d.domain} from watch list`}
                  onClick={() => removeDomain.mutate(d.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--dim)] ring-1 ring-[var(--border)]"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <label htmlFor="new-domain" className="sr-only">Site or keyword to watch</label>
          <input
            id="new-domain"
            {...FIELDS.addBlockDomain.domain}
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (!newDomain.trim()) { setDomainError("Type a site or keyword first."); return; }
                addDomain.mutate(newDomain.trim());
              }
            }}
            placeholder="e.g. example-site.com"
            className="min-w-0 flex-1 rounded-full bg-[var(--surface2)] px-4 py-2.5 text-[15px] outline-none ring-1 ring-[var(--border)] placeholder:text-[var(--dim)]"
          />
          <button
            type="button"
            onClick={() => {
              if (!newDomain.trim()) { setDomainError("Type a site or keyword first."); return; }
              addDomain.mutate(newDomain.trim());
            }}
            className="shrink-0 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white"
          >
            Add
          </button>
        </div>
        {domainError && <p className="mt-2 text-sm font-medium text-red-500">{domainError}</p>}
      </section>

      {/* How it works */}
      <section className="mt-6">
        <h2 className="px-1 text-lg font-bold">Inside every pause</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(Object.keys(PATH_META) as Path[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => props.onTrigger(`Practice run — ${PATH_META[p].label}`)}
              className="rounded-[22px] bg-[var(--surface)] p-5 text-left shadow-sm ring-1 ring-[var(--border)] transition active:scale-[0.98]"
            >
              <span className="text-3xl" aria-hidden>{PATH_META[p].emoji}</span>
              <p className="mt-2 font-bold">{PATH_META[p].label}</p>
              <p className="text-sm text-[var(--dim)]">{PATH_META[p].blurb}. Tap to practice it.</p>
            </button>
          ))}
        </div>
      </section>

      {/* Recent pauses */}
      <section className="mt-6 rounded-[24px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--border)] sm:p-6">
        <h2 className="text-lg font-bold">Recent pauses</h2>
        {props.sessions.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--dim)]">No pauses yet. Your history will live here — private, on this device, nobody else's business.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {props.sessions.slice(0, 8).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {s.path === "none" ? "Pause ended early" : PATH_META[s.path as Path]?.label ?? s.path}
                    {s.triggerText ? <span className="font-normal text-[var(--dim)]"> · {s.triggerText}</span> : null}
                  </span>
                  <span className="block text-xs text-[var(--dim)]">
                    {new Date(s.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${s.completed ? "bg-[#d9f5ec] text-[#0c7a5f]" : "bg-[var(--surface2)] text-[var(--dim)]"}`}>
                  {s.completed ? "Ridden out ✓" : "Partial"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Settings */}
      <section className="mt-6 rounded-[24px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--border)] sm:p-6">
        <h2 className="text-lg font-bold">Make it yours</h2>
        <label htmlFor="pause-minutes" className="mt-4 block text-sm font-semibold">
          Pause length: {pauseMinutes} minute{pauseMinutes === 1 ? "" : "s"}
        </label>
        <input
          id="pause-minutes"
          type="range"
          min={1}
          max={15}
          step={1}
          value={pauseMinutes}
          onChange={(e) => setPauseMinutes(Number(e.target.value))}
          className="mt-2 w-full accent-[#7c6ff0]"
        />
        <p className="text-xs text-[var(--dim)]">Five minutes is the sweet spot — long enough for an urge to peak and fade.</p>

        <label className="mt-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={escalationEnabled}
            onChange={(e) => setEscalationEnabled(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#7c6ff0]"
          />
          <span>
            <span className="block text-sm font-semibold">Double the pause when I come back quickly</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[var(--dim)]">
              If another pause starts within 30 minutes of the last one ending, its timer doubles —
              {pauseMinutes} → {pauseMinutes * 2} → {pauseMinutes * 4} minutes — up to a 60-minute cap.
              Thirty quiet minutes resets it. Slipping once is human; slipping on a loop is what this is for.
            </span>
          </span>
        </label>

        <label htmlFor="exit-url" className="mt-5 block text-sm font-semibold">Emergency exit takes me to</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: "Google", url: "https://www.google.com" },
            { label: "A random Wikipedia article", url: "https://en.wikipedia.org/wiki/Special:Random" },
          ].map((preset) => (
            <button
              key={preset.url}
              type="button"
              onClick={() => setExitUrl(preset.url)}
              aria-pressed={exitUrl.trim() === preset.url}
              className={`rounded-full px-4 py-2 text-sm font-semibold ring-1 transition ${exitUrl.trim() === preset.url ? "bg-[var(--accent)] text-white ring-[var(--accent)]" : "bg-[var(--surface2)] ring-[var(--border)]"}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <input
          id="exit-url"
          {...FIELDS.updateSettings.emergencyExitUrl}
          value={exitUrl}
          onChange={(e) => setExitUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          className="mt-2 w-full rounded-full bg-[var(--surface2)] px-4 py-2.5 text-[15px] outline-none ring-1 ring-[var(--border)] placeholder:text-[var(--dim)]"
        />
        <p className="mt-1.5 text-xs text-[var(--dim)]">Pick a page that's boring in the best way — somewhere your brain can land safely. Or paste any address of your own.</p>

        <label htmlFor="custom-aff" className="mt-5 block text-sm font-semibold">Your own affirmation (optional)</label>
        <textarea
          id="custom-aff"
          {...FIELDS.updateSettings.customAffirmation}
          value={customAff}
          onChange={(e) => setCustomAff(e.target.value)}
          rows={2}
          placeholder="Write one in your own words — it'll join the rotation."
          className="mt-2 w-full rounded-2xl bg-[var(--surface2)] px-4 py-3 text-[15px] outline-none ring-1 ring-[var(--border)] placeholder:text-[var(--dim)]"
        />
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => saveSettings.mutate()}
            disabled={saveSettings.isPending}
            className="rounded-full bg-[var(--text)] px-6 py-2.5 text-sm font-bold text-[var(--bg)] disabled:opacity-50"
          >
            Save settings
          </button>
          {settingsMsg && <span className="text-sm font-medium text-[var(--mint)]">{settingsMsg}</span>}
        </div>
      </section>

      <p className="mt-8 px-2 text-center text-xs leading-relaxed text-[var(--dim)]">
        Pause is a fallback, not a cage — it can't lock your whole phone from inside a browser, and its
        emergency exit can't force-close other apps from here. The full $5 app wraps this same pause in a
        tiny native shell (Screen Time on Apple, Accessibility on Android) so it can step in system-wide —
        and there, the emergency exit really does close the app you were in. Nothing you do here is ever
        uploaded: your history and voice stay on your device.
      </p>
    </main>
  );
}

/* ------------------------------ Intervention ------------------------------- */

function Intervention(props: {
  totalSeconds: number;
  trigger: string;
  customAffirmation: string;
  multiplier: number;
  onFinish: (path: Path | "none", completed: boolean) => void;
  onEmergencyExit: (path: Path | "none") => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(props.totalSeconds);
  const [path, setPath] = useState<Path | null>(null);
  const [donePaths, setDonePaths] = useState<Set<Path>>(new Set());
  const done = secondsLeft <= 0;

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const progress = props.totalSeconds > 0 ? 1 - secondsLeft / props.totalSeconds : 1;
  const R = 52;
  const CIRC = 2 * Math.PI * R;

  const markDone = (p: Path) => setDonePaths((prev) => new Set(prev).add(p));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)] text-[var(--text)]" role="dialog" aria-modal="true" aria-label="Pause in progress">
      <BrushBackdrop />
      <div className="relative mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 pb-10 pt-safe">
        <div className="flex flex-col items-center pt-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Pause caught it</p>
          <h2 className="mt-2 max-w-sm text-2xl font-extrabold leading-snug">
            Hold on. Let's give this a minute — literally.
          </h2>
          <p className="mt-1.5 max-w-sm text-sm text-[var(--dim)]">
            {props.trigger && props.trigger !== "Practice run" ? <>You were headed to <b className="text-[var(--text)]">{props.trigger}</b>. </> : null}
            Nothing here is judging you. Pick something to do with the next few minutes while the urge burns itself out.
          </p>
          {props.multiplier > 1 && (
            <p className="mt-3 max-w-sm rounded-2xl bg-[#fff3e8] px-4 py-2.5 text-sm font-semibold ring-1 ring-[#f5cf9f] dark:bg-[#3a2c1c] dark:ring-[#6b4d26]">
              ⚡ This pause is {props.multiplier}× longer — you came back within 30 minutes of the last one.
              Each quick return doubles the timer again, up to 60 minutes.
            </p>
          )}

          {/* Countdown ring */}
          <div className="relative mt-6 h-36 w-36">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle cx="60" cy="60" r={R} fill="none" stroke="var(--border)" strokeWidth="9" />
              <circle
                cx="60" cy="60" r={R} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)}
                style={{ transition: "stroke-dashoffset 1s linear" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-extrabold tabular-nums">{done ? "0:00" : fmtClock(secondsLeft)}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">{done ? "you did it" : "remaining"}</span>
            </div>
          </div>
          {donePaths.size > 0 && (
            <p className="mt-3 text-sm font-semibold text-[var(--mint)]">
              {[...donePaths].map((p) => `${PATH_META[p].emoji} ${PATH_META[p].label}`).join("  ·  ")} — done ✓
            </p>
          )}
        </div>

        {/* Path picker / active path */}
        {!path ? (
          <div className="mt-7 grid grid-cols-2 gap-3">
            {(Object.keys(PATH_META) as Path[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPath(p)}
                className="rounded-[22px] bg-[var(--surface)] p-5 text-left shadow-sm ring-1 ring-[var(--border)] transition active:scale-[0.97]"
                style={{ animation: "popIn 0.35s ease both" }}
              >
                <span className="text-4xl" aria-hidden>{PATH_META[p].emoji}</span>
                <span className="mt-2 block text-lg font-bold">{PATH_META[p].label}{donePaths.has(p) ? " ✓" : ""}</span>
                <span className="block text-sm text-[var(--dim)]">{PATH_META[p].blurb}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-[24px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--border)] sm:p-6" style={{ animation: "popIn 0.3s ease both" }}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{PATH_META[path].emoji} {PATH_META[path].label}</h3>
              <button type="button" onClick={() => setPath(null)} className="rounded-full bg-[var(--surface2)] px-4 py-1.5 text-sm font-semibold ring-1 ring-[var(--border)]">
                ← All options
              </button>
            </div>
            {path === "breathe" && <BreatheView onDone={() => markDone("breathe")} />}
            {path === "affirmation" && <AffirmationView custom={props.customAffirmation} onDone={() => markDone("affirmation")} />}
            {path === "challenge" && <ChallengeView onDone={() => markDone("challenge")} />}
            {path === "cats" && <CatsView onDone={() => markDone("cats")} />}
          </div>
        )}

        {/* Exit area */}
        <div className="mt-auto pt-8 text-center">
          <button
            type="button"
            disabled={!done}
            onClick={() => props.onFinish(path ?? (donePaths.values().next().value as Path | undefined) ?? "none", true)}
            className="w-full rounded-full bg-[var(--accent)] px-6 py-4 text-base font-bold text-white shadow-lg shadow-[#7c6ff0]/30 transition enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-10"
          >
            {done ? "The urge passed — let me go ✓" : `Locked until the pause ends · ${fmtClock(secondsLeft)}`}
          </button>
          <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed text-[var(--dim)]">
            {done
              ? "Notice how different you feel from five minutes ago? That's the whole trick. It works every time you let it."
              : "The pause stays up while the timer runs — that's the point. Do one of the activities; the craving peaks and fades on its own."}
          </p>
          <div className="mt-5">
            <button
              type="button"
              onClick={() => props.onEmergencyExit(path ?? "none")}
              className="w-full rounded-full bg-red-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-red-500/25 transition active:scale-[0.98] sm:w-auto sm:px-8"
            >
              🚨 Emergency exit — get me out of here
            </button>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-[var(--dim)]">
              Opens your safe page in a new tab and clears this screen. It ends the pause early —
              and coming back within 30 minutes makes the next one longer.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Breathe --------------------------------- */

function BreatheView({ onDone }: { onDone: () => void }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [cycles, setCycles] = useState(0);
  const phases = [
    { label: "Breathe in…", secs: 4 },
    { label: "Hold…", secs: 2 },
    { label: "Let it go…", secs: 4 },
  ] as const;

  useEffect(() => {
    const phase = phases[phaseIdx];
    if (!phase) return;
    const t = setTimeout(() => {
      if (phaseIdx === phases.length - 1) setCycles((c) => c + 1);
      setPhaseIdx((i) => (i + 1) % phases.length);
    }, phase.secs * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseIdx]);

  const finished = cycles >= 3;

  return (
    <div className="flex flex-col items-center py-2 text-center">
      <div className="relative flex h-56 w-56 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-[#c9c2ff]/50 blur-xl" style={{ animation: "breathePulse 10s ease-in-out infinite" }} />
        <div
          className="relative flex h-44 w-44 items-center justify-center rounded-full shadow-inner"
          style={{
            background: "radial-gradient(circle at 35% 30%, #d9d2ff, #7c6ff0 70%)",
            animation: "breathePulse 10s ease-in-out infinite",
          }}
        >
          <span className="px-4 text-lg font-bold text-white drop-shadow">{phases[phaseIdx]?.label}</span>
        </div>
      </div>
      <p className="mt-4 text-sm text-[var(--dim)]">
        Follow the orb — it swells from the center as you breathe in, and settles as you let go.
      </p>
      <p className="mt-2 text-sm font-semibold">
        {finished ? "Three full cycles. Notice your shoulders?" : `Cycle ${Math.min(cycles + 1, 3)} of 3`}
      </p>
      <div className="mt-3 flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-2.5 w-8 rounded-full ${cycles > i ? "bg-[var(--mint)]" : "bg-[var(--border)]"}`} />
        ))}
      </div>
      <button
        type="button"
        disabled={!finished}
        onClick={onDone}
        className="mt-5 rounded-full bg-[var(--mint)] px-6 py-2.5 font-bold text-white disabled:opacity-40"
      >
        {finished ? "That helped ✓" : "Keep breathing…"}
      </button>
    </div>
  );
}

/* ------------------------------- Affirmation ------------------------------- */

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function AffirmationView({ custom, onDone }: { custom: string; onDone: () => void }) {
  const list = useMemo(() => (custom.trim() ? [custom.trim(), ...AFFIRMATIONS] : AFFIRMATIONS), [custom]);
  const [idx, setIdx] = useState(0);
  const [saidCount, setSaidCount] = useState(0);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [feedback, setFeedback] = useState("");
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [saidAloud, setSaidAloud] = useState(false);
  const [typed, setTyped] = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const current = list[idx % list.length] ?? AFFIRMATIONS[0] ?? "";
  const goal = 3;
  const finished = saidCount >= goal;

  const advance = useCallback(() => {
    setSaidCount((c) => c + 1);
    setIdx((i) => i + 1);
    setHeard("");
    setAudioUrl(null);
    setSaidAloud(false);
    setTyped("");
    setFeedback("That one's in. 💪");
  }, []);

  const checkTyped = () => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    const targetWords = norm(current).split(" ").filter(Boolean);
    const typedWords = new Set(norm(typed).split(" ").filter(Boolean));
    const matched = targetWords.filter((word) => typedWords.has(word)).length;
    if (targetWords.length > 0 && matched / targetWords.length >= 0.8) {
      advance();
    } else {
      setFeedback("Not quite — type the affirmation word for word, exactly as it's written above. Feeling each word is the point.");
    }
  };

  const startListening = () => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setMicBlocked(true);
      setFeedback("This browser can't listen for your voice — no problem, use one of the no-mic options below.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = (e.results[0]?.[0]?.transcript ?? "").trim();
      setHeard(transcript);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      const targetWords = norm(current).split(" ").filter(Boolean);
      const heardWords = new Set(norm(transcript).split(" ").filter(Boolean));
      const matched = targetWords.filter((word) => heardWords.has(word)).length;
      if (targetWords.length > 0 && matched / targetWords.length >= 0.55) {
        advance();
      } else {
        setFeedback("I heard you, but not quite the words — try once more, nice and clear.");
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed" || e?.error === "audio-capture") {
        setMicBlocked(true);
        setFeedback("The mic is blocked for this window — that's the browser or app shell saying no, not you doing anything wrong. Use a no-mic option below; they count just the same.");
      } else {
        setFeedback("Couldn't hear that — try again, or use one of the no-mic options below.");
      }
    };
    recRef.current = rec;
    setFeedback("Listening… say the words out loud.");
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicBlocked(true);
      setFeedback("This window doesn't expose a microphone at all — use one of the no-mic options below instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      setFeedback("Recording — say it like you mean it.");
    } catch (err) {
      setMicBlocked(true);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setFeedback("Mic access was blocked for this window — the browser or app shell denied it. The no-mic options below work just as well.");
      } else {
        setFeedback("The mic didn't start. The no-mic options below work just as well.");
      }
    }
  };

  return (
    <div className="text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--dim)]">Say this out loud — your voice, not just your eyes</p>
      <blockquote className="mx-auto mt-3 max-w-md text-xl font-bold leading-snug sm:text-2xl">“{current}”</blockquote>
      <p className="mt-3 text-sm font-semibold">{saidCount} of {goal} said</p>
      <div className="mx-auto mt-2 flex max-w-[180px] gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-2.5 flex-1 rounded-full ${saidCount > i ? "bg-[var(--mint)]" : "bg-[var(--border)]"}`} />
        ))}
      </div>

      {!finished ? (
        <>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={startListening}
              disabled={listening}
              className="rounded-full bg-[var(--accent)] px-6 py-3 font-bold text-white disabled:opacity-50"
            >
              {listening ? "🎙️ Listening…" : "🎙️ Say it — I'm listening"}
            </button>
            {!recording ? (
              <button type="button" onClick={startRecording} className="rounded-full bg-[var(--surface2)] px-6 py-3 font-bold ring-1 ring-[var(--border)]">
                ● Record instead
              </button>
            ) : (
              <button type="button" onClick={() => mediaRef.current?.stop()} className="rounded-full bg-red-500 px-6 py-3 font-bold text-white">
                ■ Stop recording
              </button>
            )}
          </div>
          {audioUrl && (
            <div className="mx-auto mt-4 max-w-sm">
              <audio controls src={audioUrl} className="w-full" aria-label="Your recorded affirmation playback" />
              <p className="mt-2 text-xs text-[var(--dim)]">That's you, saying it. Tick the box below to count it.</p>
            </div>
          )}
          {heard && <p className="mt-3 text-sm text-[var(--dim)]">Heard: “{heard}”</p>}
          {feedback && <p className="mt-2 text-sm font-medium text-[var(--accent)]">{feedback}</p>}

          {/* No-mic routes — always available, essential when the embedding window blocks mic permission */}
          <div className={`mx-auto mt-5 max-w-sm rounded-2xl bg-[var(--surface2)] p-4 text-left ring-1 ${micBlocked ? "ring-[var(--accent)]" : "ring-[var(--border)]"}`}>
            <p className="text-sm font-bold">No mic? No problem.</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
              Browsers and app windows often block the microphone. Either way below counts — the point was never the mic, it's you actually engaging with the words:
            </p>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={saidAloud}
                onChange={(e) => setSaidAloud(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#2fbfa0]"
              />
              I read the words above out loud, for real
            </label>
            <button
              type="button"
              disabled={!saidAloud}
              onClick={advance}
              className="mt-2.5 w-full rounded-full bg-[var(--mint)] px-6 py-2.5 font-bold text-white disabled:opacity-40"
            >
              Count it ✓
            </button>
            <div className="my-3 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-[var(--dim)]" aria-hidden>
              <span className="h-px flex-1 bg-[var(--border)]" />
              or type it
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
            <label htmlFor="affirmation-typed" className="sr-only">Type the affirmation</label>
            <input
              id="affirmation-typed"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checkTyped()}
              placeholder="Type the affirmation word for word…"
              className="w-full rounded-full bg-[var(--surface)] px-4 py-2.5 text-sm outline-none ring-1 ring-[var(--border)] placeholder:text-[var(--dim)]"
            />
            <button
              type="button"
              onClick={checkTyped}
              className="mt-2.5 w-full rounded-full bg-[var(--text)] px-6 py-2.5 text-sm font-bold text-[var(--bg)]"
            >
              Check my typing
            </button>
          </div>
          <p className="mx-auto mt-3 max-w-sm text-xs text-[var(--dim)]">Your voice is checked and recorded only on this device — nothing is uploaded, ever.</p>
        </>
      ) : (
        <div className="mt-5">
          <p className="text-lg font-bold text-[var(--mint)]">Three affirmations, out loud. That's not nothing — that's you, choosing. 🎉</p>
          <button type="button" onClick={onDone} className="mt-4 rounded-full bg-[var(--mint)] px-6 py-2.5 font-bold text-white">
            Done ✓
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Challenge -------------------------------- */

type Problem = { text: string; answer: number; level: number };

function makeProblem(level: number): Problem {
  const r = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  if (level <= 1) {
    const a = r(12, 58), b = r(11, 47);
    return { text: `${a} + ${b}`, answer: a + b, level };
  }
  if (level === 2) {
    if (Math.random() < 0.5) {
      const a = r(6, 12), b = r(4, 9);
      return { text: `${a} × ${b}`, answer: a * b, level };
    }
    const a = r(60, 140), b = r(25, 59);
    return { text: `${a} − ${b}`, answer: a - b, level };
  }
  if (level === 3) {
    const a = r(7, 15), b = r(6, 12), c = r(15, 60);
    return { text: `${a} × ${b} + ${c}`, answer: a * b + c, level };
  }
  if (Math.random() < 0.5) {
    const base = r(40, 200);
    const pct = [10, 20, 25, 50][r(0, 3)] ?? 25;
    return { text: `${pct}% of ${base}`, answer: (base * pct) / 100, level };
  }
  const a = r(13, 29), b = r(3, 9), c = r(20, 80);
  return { text: `${a} × ${b} − ${c}`, answer: a * b - c, level };
}

function ChallengeView({ onDone }: { onDone: () => void }) {
  const GOAL = 8;
  const [solved, setSolved] = useState(0);
  const [streak, setStreak] = useState(0);
  const [problem, setProblem] = useState<Problem>(() => makeProblem(1));
  const [input, setInput] = useState("");
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState("");
  const finished = solved >= GOAL;
  const level = Math.min(4, 1 + Math.floor(solved / 2));

  const submit = () => {
    const val = Number(input.trim());
    if (input.trim() === "" || Number.isNaN(val)) { setFlash("Type your answer first."); return; }
    if (val === problem.answer) {
      const next = solved + 1;
      setSolved(next);
      setStreak((s) => s + 1);
      setInput("");
      setFlash(streak + 1 >= 3 ? `🔥 ${streak + 1} in a row!` : "Correct! +10 focus points");
      if (next < GOAL) setProblem(makeProblem(Math.min(4, 1 + Math.floor(next / 2))));
    } else {
      setStreak(0);
      setShake(true);
      setFlash("Not quite — slow down, work it through.");
      setTimeout(() => setShake(false), 450);
    }
  };

  if (finished) {
    return (
      <div className="relative overflow-hidden py-4 text-center">
        {["#7c6ff0", "#ffb38a", "#5ed3b3", "#f06fa8", "#ffd166"].map((c, i) => (
          <span key={i} aria-hidden className="absolute top-0 inline-block h-3 w-2 rounded-sm" style={{ left: `${12 + i * 18}%`, background: c, animation: `confettiFall ${0.9 + i * 0.15}s ease-in ${i * 0.08}s both` }} />
        ))}
        <p className="text-5xl" aria-hidden>🏆</p>
        <p className="mt-3 text-xl font-extrabold">Challenge cleared!</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--dim)]">
          Eight problems, escalating to multi-step math — and your brain took the dopamine from <em>finishing something hard</em> instead. That's the trade working.
        </p>
        <button type="button" onClick={onDone} className="mt-5 rounded-full bg-[var(--mint)] px-6 py-2.5 font-bold text-white">Done ✓</button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>Level {level} of 4</span>
        <span className="text-[var(--dim)]">{solved} / {GOAL} solved</span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-[var(--surface2)]" role="progressbar" aria-valuenow={solved} aria-valuemin={0} aria-valuemax={GOAL} aria-label="Challenge progress">
        <div className="h-full rounded-full bg-gradient-to-r from-[#ff9d5c] to-[#f06fa8] transition-all" style={{ width: `${(solved / GOAL) * 100}%` }} />
      </div>
      <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-[var(--dim)]">Solve it — no calculator, that's the point</p>
      <p className="mt-2 text-5xl font-extrabold tabular-nums" style={shake ? { animation: "popIn 0.2s ease" } : undefined}>{problem.text} = ?</p>
      <div className="mx-auto mt-5 flex max-w-xs gap-2">
        <label htmlFor="challenge-answer" className="sr-only">Your answer</label>
        <input
          id="challenge-answer"
          type="number"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Answer"
          className={`min-w-0 flex-1 rounded-full bg-[var(--surface2)] px-5 py-3 text-center text-xl font-bold outline-none ring-2 ${shake ? "ring-red-400" : "ring-[var(--border)]"}`}
        />
        <button type="button" onClick={submit} className="shrink-0 rounded-full bg-[#ff9d5c] px-6 py-3 font-bold text-white">Check</button>
      </div>
      {flash && <p className="mt-3 text-sm font-semibold text-[var(--accent)]" aria-live="polite">{flash}</p>}
      <p className="mt-2 text-xs text-[var(--dim)]">It gets harder every two solves — percentages and two-steppers by the end.</p>
    </div>
  );
}

/* ---------------------------------- Cats ----------------------------------- */

function CatsView({ onDone }: { onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const [seen, setSeen] = useState(1);
  const line = CAT_LINES[idx % CAT_LINES.length] ?? CAT_LINES[0];
  const ready = seen >= 3;

  return (
    <div className="text-center">
      <div className="overflow-hidden rounded-[20px] ring-1 ring-[var(--border)]" style={{ animation: "floaty 5s ease-in-out infinite" }}>
        <img src={catImg} alt="A very happy orange cat floating among painterly purple cosmic clouds, wearing tiny headphones" className="w-full object-cover" />
      </div>
      {line && (
        <p className="mx-auto mt-4 max-w-md text-[15px] font-medium leading-relaxed" aria-live="polite">
          <span className="mr-1 text-xl" aria-hidden>{line.emoji}</span> {line.text}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => { setIdx((i) => i + 1); setSeen((s) => s + 1); }}
          className="rounded-full bg-[#f06fa8] px-6 py-3 font-bold text-white"
        >
          Another one 😹
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={onDone}
          className="rounded-full bg-[var(--mint)] px-6 py-3 font-bold text-white disabled:opacity-40"
        >
          {ready ? "Okay, I'm smiling ✓" : `Smile first (${Math.min(seen, 3)}/3)`}
        </button>
      </div>
    </div>
  );
}
