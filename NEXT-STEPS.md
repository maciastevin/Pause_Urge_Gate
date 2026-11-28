# Pause — status and next steps

_Last updated: 2026-11-28_

## Where things stand

| Piece | Status | Get it |
| --- | --- | --- |
| **Mac app** (`mac/`) | ✅ v1.0.4 tested by owner on macOS + Vivaldi (sites caught, lock held). v1.1.0 adds search catching + glass look — **not yet tested**. | Release `Pause-mac.zip` |
| **Android app** (`android/`) | 🟡 v1.1.0 tested 11/28: worked, but searches weren't caught and Back/Recents still worked mid-pause. Both addressed in **v1.2.0 (not yet tested)**. | `releases/latest/download/Pause.apk` |
| **Browser extension** (`browser-extension/`) | ✅ Verified in headless Chrome. Works in Chrome/Edge/Brave/Arc/Vivaldi via Load unpacked. | Release `Pause-browser-extension.zip` |
| **iPhone / iPad** | ❌ Not started. | — |

Every push to `main` builds all three and publishes a GitHub release (`.github/workflows/build.yml`).

### Mac install / update (one line, Terminal)
```
pkill -x Pause; cd /tmp && curl -sL -o Pause-mac.zip https://github.com/maciastevin/Pause_Urge_Gate/releases/latest/download/Pause-mac.zip && rm -rf Pause.app && ditto -xk Pause-mac.zip . && rm -rf /Applications/Pause.app && mv Pause.app /Applications/ && xattr -dr com.apple.quarantine /Applications/Pause.app && open /Applications/Pause.app
```
Debug: `cat ~/Library/Logs/Pause.log`; crash reports in `~/Library/Logs/DiagnosticReports/Pause-*.ips`.

## Next steps (in order)

1. **Test Android v1.2.0** (install the APK over the old one):
   - Search for a watched word in Chrome, the Google app, X or YouTube → a pause should start.
     A search like "how to quit porn" should *not* trigger it.
   - Turn on **App pinning** (Settings › Security › App pinning, ideally with "Ask for PIN
     before unpinning"), then turn on **Strict lock** in Pause settings. During a pause,
     Back / Home / Recents should do nothing.
   - Without Strict lock: pressing Home/Recents mid-pause should show the dark cover instantly.
   - Watched apps (X, Reddit…) should start a pause when opened.
   - Debug: `adb logcat | grep -i pause` with the phone on USB.
2. **Test Mac v1.1.0** — Google search for a watched word in Vivaldi/Safari → pause. Check the
   new glass look in light and dark mode. Install/update with the one-liner above.
3. **Move development to Claude Code on the Mac** — it can build, run, read logs and crash
   reports directly. `git clone https://github.com/maciastevin/Pause_Urge_Gate && cd Pause_Urge_Gate && claude`
4. **Mac polish**
   - Search boxes inside Mac apps aren't watched (only browser addresses/search URLs).
   - Firefox isn't covered (no AppleScript). Option: Accessibility API to read the address bar.
   - Watched *apps* on Mac (like Android's list) — watch frontmost bundle id.
   - Signing + notarization (Apple Developer account, $99/yr) so Automation permission
     survives updates and Gatekeeper stops warning.
5. **Shared stats** — Mac app, extension and phone keep separate stats/fall timers.
   Decide: keep separate, or sync (needs a small backend or iCloud/Drive file).
6. **iPhone / iPad** — needs Xcode + Apple Developer account + FamilyControls
   (Screen Time) entitlement request to Apple (takes days–weeks; apply early).
   Reuse `browser-extension/gate/` as the UI in a WKWebView.
7. **Sell it ($5 one-time)** — Play Store: accessibility-service apps need a policy
   declaration + video; Mac: notarized download (Gumroad/Lemon Squeezy) or Mac App Store
   (App Store requires sandboxing — would need a different blocking approach).

## Known limits / decisions
- Android reads the address bar of Chrome, Samsung Internet, Firefox, Brave, Edge, Opera,
  Vivaldi, Kiwi, DuckDuckGo. Android 13+ sideloads need *Allow restricted settings* before
  the Accessibility toggle works.
- Watch-list keywords and site names ("pornhub" for pornhub.com) are matched in addresses **and searches**.
  Searches containing recovery words (quit, stop, addiction, recovery, therapy, relapse…) are never blocked.
- Android search catching only watches fields that look like search/address boxes (id, hint or
  class mentions search/query/url…), so typing in chats/messages isn't affected.
- "Continue anyway" after a finished pause = 10-minute pass for that site/app.
- During an Android pause, Settings is covered too (so protection can't be switched off
  mid-pause). Phone/dialer stays reachable.
- Android can't fully disable Back/Home/Recents for a normal app; **Strict lock** uses Android
  screen pinning (user can still unpin deliberately by holding Back + Recents; a PIN makes that harder).
- Look: "liquid glass" layer at the end of `browser-extension/gate/app.css` (falls back to solid
  surfaces when backdrop-filter or transparency is unavailable).

## Code map
- `browser-extension/gate/` — the shared pause UI + `core.js` logic (single source of truth;
  Android copies it at build time, Mac bundles it, extension uses it directly).
- `android/app/src/main/java/app/pause/urgegate/UrgeWatchService.kt` — blocker service.
- `mac/Sources/main.swift` — menu-bar app; `mac/build.sh` builds it.
- `client/`, `server/` — original Muse prototype (reference only).
