# Data Plan

## Context provenance
- `I want it to block the device from doing anything for 5 mins. to give the user time re calulate.` (verbatim request; drives the locked 5-minute intervention timer that cannot be skipped)
- `Breathe, Affirmation, Challenge, and Maybe another option like cats being funny.` (verbatim request; drives the four intervention paths)
- `When the click breath I want the screen to puls form tehcenter like breating.` (verbatim request; drives the center-pulsing breathing orb animation)
- `I chalenge to be diffiicult enough so they get dopmine hit from its complete. Maybe like simple math and then get more challenging.` (verbatim request; drives escalating math challenge levels)
- `I want affirmation to be something wher you have to say the words and the app records the audio to know you said them` (verbatim request; drives voice-recorded affirmation using browser Speech Recognition + MediaRecorder fallback)
- `modern and little light and techy. With smoth graphics that are remencient of the agents space paint brushy spaces.` (verbatim request; drives light airy painterly cosmic visual direction)
- `cost $5.00 dollars that runs on mac, iphone, ipad, andriod` + `a one time purchase that runs on their devices and acts as a fall back. It should be light weight.` (verbatim request; shown as product info — $5 one-time, works in browser on all devices)
- `I can't test the mic right now. It keeps getting blocked` (verbatim follow-up; drives the mic-blocked fix — the embedding window can deny microphone permission, which previously dead-ended Affirmation because the read-aloud confirm only appeared after a successful recording. Affirmation now always offers two no-mic routes: read it aloud and tick a confirm box, or type the affirmation word-for-word with an 80% word-match check; mic errors now explain the block and highlight those routes)
- `Lets add a system where it can have a fall timer say you get pass the fist and you come a again very soon the timer gets doubled.` (verbatim follow-up; drives the quick-return escalation system — computed server-side in getState from session timestamps: an unbroken chain of pauses each starting within 30 minutes of the previous one's end doubles the next timer per chain link (×2, ×4, ×8…), capped at 60 minutes; 30+ quiet minutes resets it. User-toggleable in settings; the current multiplier and effective length are shown on Home and inside the pause overlay)
- `I also would like for the emergeny exit to close whatever app your are in if its reddit or x or a browser.` (verbatim follow-up; drives the upgraded Emergency Exit — a prominent button on Home and inside every pause that opens the user's chosen safe page in a new tab, attempts window.close(), logs the pause as ended early, and swaps to a calm "You're out" screen. A web page cannot force-close other apps, and the UI says so plainly in three places; the native shell (Screen Time / Accessibility) is where the same button kills the foreground app. Destination is a user setting with Google and random-Wikipedia presets plus a custom URL, validated server-side to http(s))

## Tested sources
No external API or feed is used. All intervention content (affirmations, math generation, cat humor lines, breathing timings) is generated locally in the client for lightweight offline behavior, matching the user's lightweight requirement. Voice affirmation uses the browser's built-in Web Speech API (SpeechRecognition) and MediaRecorder — no server audio upload, audio stays on device. Because the artifact runs in an embedded window whose host can deny mic permission, Affirmation also ships mic-free completion routes (read-aloud confirm, type-it word-match) that need no permission at all.

## Imagery
- One generated decorative illustration for the Cats path: a painterly, brush-stroke cosmic cat illustration in a drawn/painted style (not photorealistic), generated with media.generate_image into client/src/assets and imported. This is decoration for the user's own custom app concept, not a depiction of a real specific cat.
- All other visuals are CSS/SVG: painterly aurora brush-stroke gradients, breathing orb, timer ring. No remote image URLs are rendered.

## Long-term data behavior
- **Refresh policy**: No external refresh; all data is user-generated in the artifact DB.
- **Growth**: One row per intervention session logged (path, completed, timestamp); one row per blocklist domain the user adds; one settings row (gained escalation_enabled and emergency_exit_url columns in migration 0003). Escalation level is derived from session timestamps at read time, never stored, so it can never drift out of sync with the history.
- **Ordering**: Sessions and blocklist newest first.
- **Time semantics**: Session timestamps are creation instants rendered viewer-local; the 5-minute pause is a client countdown (default 5 min, user-adjustable 1–15 min in settings). Device-level OS blocking cannot be done by a web artifact — the artifact honestly presents the in-app locked pause experience and a demo trigger, and labels the native-wrapper step for true system-wide blocking.
