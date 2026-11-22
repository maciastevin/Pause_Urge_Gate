# Pause — Urge Gate

A $5 one-time, lightweight porn-blocker fallback for Mac, iPhone, iPad, and Android.

When a suspected site is visited, Pause shows a full-screen overlay and locks
you in for 5 minutes, with four ways through the urge:

- **Breathe** — an orb pulsing from the center on a 4-2-4 rhythm
- **Affirmation** — say the words out loud. Checked with speech recognition
  or on-device voice recording. A no-mic fallback is included: read aloud
  and tick confirm, or type the affirmation (80% word match).
- **Challenge** — 8 math problems that escalate from simple addition to
  percentages and two-step problems, for a completion hit
- **Funny Cats** — a painterly cosmic-cat illustration with rotating humor

Other features:

- Streak, urges ridden out, pause history, watch list, custom affirmation
- Pause length 1–15 minutes (default 5)
- **Fall-timer escalation:** if you come back within 30 minutes of a pause,
  the next lock doubles — 5 → 10 → 20 minutes, up to a 60-minute cap.
  It resets after 30 quiet minutes and can be turned off in settings.
- **Emergency Exit:** a big red button that opens a safe page in a new tab
  (Google or a random Wikipedia article by default, or any address you set),
  tries to close the tab, and lands on a calm "You're out" screen.

## Where this code came from

This is the working prototype built in Muse on 2026-11-21, exported from
the Muse web artifact `porn-blocker` (called "Pause" in the app).

It is a Muse TypeScript space:

- React 19 client in `client/` (`client/src/App.tsx` is most of the UI)
- Server actions in `server/src/actions.ts`, schema in `server/src/schema.ts`
- Drizzle SQL migrations in `drizzle/`
- `space.json` is the Muse runtime manifest — it is kept here for reference,
  not needed for a standalone build

## Running it

In Muse, this runs as-is as a hosted web app.

Standalone, it is **not** a drop-in Vite / Capacitor / React Native project
yet. The main Muse-specific piece is in `package.json`:

```json
"@hatch/space-sdk": "file:/opt/hatch/skills/spaces/ts-runtime/dist/space-sdk.tgz"
```

That SDK provides the server-action bridge and the local database in Muse.
To take this to real apps, plan on one of these:

1. **Web / PWA first (fastest):** replace the `@hatch/space-sdk` action
   calls in `client/src/api.ts` / `server/src/actions.ts` with a small
   REST/JSON API or with local storage, and ship it as a PWA that can be
   added to the home screen on iPhone, iPad, Android, and Mac.
2. **Capacitor wrapper:** wrap that PWA for the App Store / Google Play.
   The web UI stays the same; native plugins add the blocking.
3. **Native blocking (the real $5 version):** a web page alone cannot
   force-close Reddit, X, or a browser, and cannot lock a whole phone.
   System-wide blocking needs:
   - Apple: Screen Time / FamilyControls + Managed Settings
   - Android: VPN / DNS filtering or Accessibility Service
   - Mac: a Network Extension / DNS filter

   The pause, breathing, affirmation, challenge, cats, escalation, and
   emergency-exit logic in `App.tsx` and `actions.ts` is the part to reuse
   inside that native shell.

## What was left out of this export

- `node_modules/`, build output (`dist/`, `.space-build/`), and `app.db`
  (the Muse-local SQLite data with your watch list / history) — install
  and rebuild those locally, do not commit them
- Binary images: `icon.webp` and the cosmic-cat `.webp`
  (`client/src/assets/media-generation-cosmic-cat-*.webp`). The JSON
  metadata for the cat image is included; re-add your own cat image
  under the same path, or point the Funny Cats view at an image URL.
- Muse-internal build/audit logs (`.harness/`, `audits/`)

## Development notes

- `bun install`, then `bun run typecheck` and `bun run build`
  (see `package.json` scripts — they use Bun 1.3.10)
- Do not commit `app.db`, `node_modules/`, or `dist/`. See `.gitignore`.
