# Pause — status and next steps

_Last updated: 2026-11-21 (night session with Claude)_

## Where things stand

| Piece | Status | Get it |
| --- | --- | --- |
| **Mac app** (`mac/`) | ✅ Tested by owner on macOS + Vivaldi: catches watched sites, covers the screen, lock held. v1.0.4. | Release `Pause-mac.zip` |
| **Android app** (`android/`) | 🟡 Tested v1.0.0: site blocking worked. Two gaps found → fixed in v1.1.0 (**not yet tested**). | `releases/latest/download/Pause.apk` |
| **Browser extension** (`browser-extension/`) | ✅ Verified in headless Chrome. Works in Chrome/Edge/Brave/Arc/Vivaldi via Load unpacked. | Release `Pause-browser-extension.zip` |
| **iPhone / iPad** | ❌ Not started. | — |

Every push to `main` builds all three and publishes a GitHub release (`.github/workflows/build.yml`).

### Mac install / update (one line, Terminal)
```
pkill -x Pause; cd /tmp && curl -sL -o Pause-mac.zip https://github.com/maciastevin/Pause_Urge_Gate/releases/latest/download/Pause-mac.zip && rm -rf Pause.app && ditto -xk Pause-mac.zip . && rm -rf /Applications/Pause.app && mv Pause.app /Applications/ && xattr -dr com.apple.quarantine /Applications/Pause.app && open /Applications/Pause.app
```
Debug: `cat ~/Library/Logs/Pause.log`; crash reports in `~/Library/Logs/DiagnosticReports/Pause-*.ips`.

## Next steps (in order)

1. **Test Android v1.1.0** (install the APK over the old one):
   - Open X / Reddit → a pause should start. Edit the list under *Watched apps*.
   - During a pause, press Home or open another app → a dark "Pause is still running" cover
     should block it and the pause should come back. Phone/emergency calls must still work.
   - If anything is off, `adb logcat | grep -i pause` with the phone on USB.
2. **Move development to Claude Code on the Mac** — it can build, run, read logs and crash
   reports directly (tonight's Mac fixes took 5 install/log round-trips through chat).
   `git clone https://github.com/maciastevin/Pause_Urge_Gate && cd Pause_Urge_Gate && claude`
3. **Mac polish**
   - Firefox isn't covered (no AppleScript). Option: Accessibility API to read the address bar.
   - Watched *apps* on Mac (like Android's list) — watch frontmost bundle id.
   - Signing + notarization (Apple Developer account, $99/yr) so Automation permission
     survives updates and Gatekeeper stops warning.
4. **Shared stats** — Mac app, extension and phone keep separate stats/fall timers.
   Decide: keep separate, or sync (needs a small backend or iCloud/Drive file).
5. **iPhone / iPad** — needs Xcode + Apple Developer account + FamilyControls
   (Screen Time) entitlement request to Apple (takes days–weeks; apply early).
   Reuse `browser-extension/gate/` as the UI in a WKWebView.
6. **Sell it ($5 one-time)** — Play Store: accessibility-service apps need a policy
   declaration + video; Mac: notarized download (Gumroad/Lemon Squeezy) or Mac App Store
   (App Store requires sandboxing — would need a different blocking approach).

## Known limits / decisions
- Android reads the address bar of Chrome, Samsung Internet, Firefox, Brave, Edge, Opera,
  Vivaldi, Kiwi, DuckDuckGo. Android 13+ sideloads need *Allow restricted settings* before
  the Accessibility toggle works.
- Watch-list keywords match host + path, not search queries (searching "how to quit porn" works).
- "Continue anyway" after a finished pause = 10-minute pass for that site/app.
- During an Android pause, Settings is covered too (so protection can't be switched off
  mid-pause). Phone/dialer stays reachable.

## Code map
- `browser-extension/gate/` — the shared pause UI + `core.js` logic (single source of truth;
  Android copies it at build time, Mac bundles it, extension uses it directly).
- `android/app/src/main/java/app/pause/urgegate/UrgeWatchService.kt` — blocker service.
- `mac/Sources/main.swift` — menu-bar app; `mac/build.sh` builds it.
- `client/`, `server/` — original Muse prototype (reference only).
