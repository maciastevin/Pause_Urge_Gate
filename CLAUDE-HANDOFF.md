# Pause — Claude Handoff

Copy this file (or point Claude at it) when continuing Pause in Claude.
Source of truth is this repo: `maciastevin/Pause_Urge_Gate`, `main`.

## What I am trying to achieve

Build **Pause**, a $5 one-time, lightweight porn-blocker fallback to help
people with addiction ride out an urge. Not a full parental-control suite.

It runs on Mac, iPhone, iPad, and Android. When a suspected site is visited,
it shows a full-screen overlay and locks for 5 minutes, with four ways
through the urge instead of just saying no:

- **Breathe** — an orb pulsing from the center on a 4-2-4 rhythm
- **Affirmation** — say the words out loud, checked by voice. No-mic
  fallback: read aloud and tick confirm, or type the affirmation
  word-for-word (80% word match required)
- **Challenge** — 8 math problems that escalate from simple addition to
  percentages and two-step problems, for a completion dopamine hit
- **Funny Cats** — a painterly cosmic-cat illustration with rotating humor

Plus:

- Streak, urges ridden out, pause history, watch list, custom affirmation
- Pause length 1–15 minutes (default 5)
- **Fall-timer escalation:** if you get through a pause and come back
  within 30 minutes, the next lock doubles — 5 → 10 → 20 minutes, up to
  a 60-minute cap. It resets after 30 quiet minutes and can be turned
  off in settings.
- **Emergency Exit:** a big red button that opens a safe page in a new
  tab (Google or a random Wikipedia article by default, or any address
  you set), tries to close the tab, and lands on a calm "You're out" screen.

Design: light, modern, techy, soft painterly gradient spaces.

## Current state

- Working prototype built in Muse on 2026-11-21, exported here.
- `client/src/App.tsx` holds most of the UI. Server actions are in
  `server/src/actions.ts`, schema in `server/src/schema.ts`, Drizzle
  migrations in `drizzle/`.
- See `README.md` for the full export notes.

## Known limits — do not lose these

- This web prototype **cannot lock a whole phone by itself** and
  **cannot force-close Reddit, X, or a browser**. That needs the real
  native version:
  - Apple: Screen Time / FamilyControls + Managed Settings
  - Android: VPN / DNS filtering or Accessibility Service
  - Mac: a Network Extension / DNS filter
- The repo depends on Muse's `@hatch/space-sdk` in `package.json`
  (`file:/opt/hatch/skills/spaces/ts-runtime/dist/space-sdk.tgz`).
  That SDK provides the server-action bridge and local database in
  Muse. It must be replaced for a standalone build — with a small
  REST/JSON API or with local storage.
- `node_modules/`, build output, `app.db` (Muse-local SQLite data with
  watch list / history), and binary images (`icon.webp`, cosmic-cat
  `.webp`) were not exported. The cat metadata JSON is included.
- The mic was blocked in Muse's embedded window. That is why the
  no-mic Affirmation fallback exists — keep it. Mic listen/record
  should still work where the browser allows it.

## Context to provide Claude

1. This repo, `main`, as source of truth.
2. `README.md` — export notes, Muse-specific dependency, native path.
3. This file — goal, features, limits, and what not to lose.
4. One next step, chosen by the owner (pick one, do not do all at once):
   - Make it a standalone PWA (replace the Space SDK bridge)
   - Wrap it in Capacitor for the App Store / Google Play
   - Build the native blocking shell

## Copy-paste prompt for Claude

```
I'm porting Pause from Muse to you. Source of truth is
https://github.com/maciastevin/Pause_Urge_Gate, main.

Pause is a $5 one-time, lightweight porn-blocker fallback for
Mac, iPhone, iPad, and Android, to help people with addiction.

When a suspected site is visited, show a full-screen overlay and
lock for 5 minutes (adjustable 1-15 min) with four options:
Breathe (center-pulsing orb, 4-2-4), Affirmation (voice check,
with a no-mic fallback: read aloud + tick confirm, or type it
at 80% match), Challenge (8 escalating math problems), and
Funny Cats.

Also keep: streak / urges ridden out, watch list, custom
affirmation, fall-timer escalation (return within 30 min =
double the lock, 5 → 10 → 20, cap 60 min, reset after 30
quiet minutes, toggleable in settings), and Emergency Exit
(opens a safe page, tries to close the tab, lands on a calm
"You're out" screen).

Design: light, modern, techy, soft painterly gradients.

Known limits: this web prototype cannot lock a whole phone or
force-close Reddit / X / a browser. That needs native Screen
Time on Apple and VPN/DNS or Accessibility on Android.
The repo also depends on Muse's @hatch/space-sdk — see the
README — that needs replacing for a standalone build.
node_modules, app.db, and binary images were not exported.

First step I want from you: [standalone PWA / Capacitor
wrapper / native blocking shell — pick one]
```
