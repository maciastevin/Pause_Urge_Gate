// Pause for Mac — a menu-bar app that watches your browser's current address
// and, on a watch-list match, covers the screen with the pause.
// The pause UI is the shared web gate in Resources/gate (from browser-extension/gate).

import Cocoa
import ServiceManagement
import WebKit

// MARK: - Shared state (same JSON the gate UI writes)

final class Store {
    static let shared = Store()
    private let fileURL: URL
    private(set) var json: String
    private(set) var parsed: [String: Any]?

    private init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Pause", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("state.json")
        json = (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
        parsed = Store.parse(json)
    }

    static func parse(_ s: String) -> [String: Any]? {
        guard let d = s.data(using: .utf8), !d.isEmpty else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    func save(_ s: String) {
        json = s
        parsed = Store.parse(s)
        try? s.write(to: fileURL, atomically: true, encoding: .utf8)
    }
}

// MARK: - Matching rules (port of gate/core.js — keep in sync)

enum Core {
    static let defaultWatch = [
        "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com",
        "youporn.com", "spankbang.com", "onlyfans.com", "chaturbate.com",
        "porn", "xxx", "nsfw", "hentai",
    ]

    private static func stripScheme(_ s: inout String) {
        if let r = s.range(of: "^[a-z][a-z0-9+.-]*://", options: .regularExpression) {
            s.removeSubrange(r)
        }
    }

    static func clean(_ x: String) -> String {
        var s = x.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        stripScheme(&s)
        if s.hasPrefix("www.") { s.removeFirst(4) }
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    static func parse(_ url: String) -> (host: String, hostPath: String) {
        var u = url.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        stripScheme(&u)
        let cut = u.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" })
        var host = cut.map { String(u[..<$0]) } ?? u
        let rest = cut.map { String(u[$0...]) } ?? ""
        if host.hasPrefix("www.") { host.removeFirst(4) }
        if let r = host.range(of: ":[0-9]+$", options: .regularExpression) { host.removeSubrange(r) }
        let q = rest.firstIndex(where: { $0 == "?" || $0 == "#" })
        let path = q.map { String(rest[..<$0]) } ?? rest
        return (host, host + path)
    }

    static func match(_ url: String, _ watch: [String]) -> String? {
        let p = parse(url)
        if p.host.isEmpty { return nil }
        for raw in watch {
            let e = clean(raw)
            if e.isEmpty { continue }
            if e.contains("/") {
                if p.hostPath.hasPrefix(e) || p.hostPath.contains("." + e) { return e }
            } else if e.contains(".") {
                if p.host == e || p.host.hasSuffix("." + e) { return e }
            } else if p.hostPath.contains(e) {
                return e
            }
        }
        return nil
    }

    static let searchParams: Set<String> = ["q", "query", "search_query", "search", "p", "text", "k", "wd", "term", "keywords", "kw"]
    static let recoveryWords: Set<String> = [
        "quit", "quitting", "stop", "stopping", "addiction", "addicted", "addict", "recovery", "recover",
        "overcome", "nofap", "sober", "sobriety", "therapy", "therapist", "blocker", "support", "relapse",
    ]

    static func words(_ s: String) -> [String] {
        s.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
    }

    static func searchTerms(_ url: String) -> String {
        guard let qi = url.firstIndex(of: "?") else { return "" }
        var query = String(url[url.index(after: qi)...])
        if let h = query.firstIndex(of: "#") { query = String(query[..<h]) }
        var out: [String] = []
        for pair in query.split(separator: "&") {
            guard let eq = pair.firstIndex(of: "=") else { continue }
            let key = pair[..<eq].lowercased()
            if !searchParams.contains(key) { continue }
            let raw = String(pair[pair.index(after: eq)...]).replacingOccurrences(of: "+", with: " ")
            let v = raw.removingPercentEncoding ?? raw
            if !v.trimmingCharacters(in: .whitespaces).isEmpty { out.append(v) }
        }
        return out.joined(separator: " ")
    }

    /// Free text (a search) against the watch list. See matchText in core.js.
    static func matchText(_ text: String, _ watch: [String]) -> String? {
        let t = text.lowercased()
        if t.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
        let ws = words(t)
        if ws.contains(where: { recoveryWords.contains($0) }) { return nil }
        let squashed = ws.joined()
        for raw in watch {
            let e = clean(raw)
            if e.isEmpty { continue }
            if !e.contains("/") && !e.contains(".") {
                if t.contains(e) { return e }
            } else {
                let name = String(e.split(separator: "/").first?.split(separator: ".").first ?? "")
                if name.count >= 4 && squashed.contains(name) { return e }
            }
        }
        return nil
    }

    static func matchAll(_ url: String, _ watch: [String]) -> String? {
        match(url, watch) ?? matchText(searchTerms(url), watch)
    }

    static func watchList(_ st: [String: Any]?) -> [String] {
        guard let arr = st?["watch"] as? [Any] else { return defaultWatch }
        return arr.compactMap { $0 as? String }
    }

    static func hasPass(_ st: [String: Any]?, _ hit: String, _ now: Double) -> Bool {
        guard let passes = st?["passes"] as? [String: Any], let v = passes[hit] as? NSNumber else { return false }
        return v.doubleValue > now
    }

    static func activePause(_ st: [String: Any]?, _ now: Double) -> [String: Any]? {
        guard let ap = st?["activePause"] as? [String: Any],
              let ends = ap["endsAt"] as? NSNumber,
              ends.doubleValue > now else { return nil }
        return ap
    }
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

// MARK: - Browsers (AppleScript via osascript, off the main thread)

enum Browsers {
    enum Kind { case safari, chromium }

    static let known: [String: Kind] = [
        "com.apple.Safari": .safari,
        "com.apple.SafariTechnologyPreview": .safari,
        "com.google.Chrome": .chromium,
        "com.google.Chrome.beta": .chromium,
        "com.google.Chrome.canary": .chromium,
        "com.brave.Browser": .chromium,
        "com.microsoft.edgemac": .chromium,
        "company.thebrowser.Browser": .chromium,
        "com.vivaldi.Vivaldi": .chromium,
        "com.operasoftware.Opera": .chromium,
        "org.chromium.Chromium": .chromium,
    ]

    /// Browsers where macOS said "not allowed" (error -1743). Main thread only.
    static var denied = Set<String>()
    private static let queue = DispatchQueue(label: "app.pause.urgegate.osascript")
    private static var busy = false

    /// Runs osascript with a timeout. Never call on the main thread.
    private static func osascript(_ source: String, timeout: TimeInterval) -> (out: String?, err: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", source]
        let outPipe = Pipe()
        let errPipe = Pipe()
        p.standardOutput = outPipe
        p.standardError = errPipe
        do { try p.run() } catch { return (nil, "\(error)") }
        let deadline = Date().addingTimeInterval(timeout)
        while p.isRunning && Date() < deadline { usleep(50_000) }
        if p.isRunning {
            p.terminate()
            return (nil, "timeout")
        }
        let out = String(data: outPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let err = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return (p.terminationStatus == 0 ? out : nil, err)
    }

    private static func script(_ bid: String, _ body: String) -> String {
        "tell application id \"\(bid)\"\n\(body)\nend tell"
    }

    /// Reads the front tab's URL in the background and calls back on the main thread.
    /// Skips the call if a previous read is still running (e.g. a permission prompt is open).
    static func readURL(_ bid: String, _ kind: Kind, completion: @escaping (String?, String) -> Void) {
        if busy { return }
        busy = true
        let body: String
        switch kind {
        case .safari: body = "if (count of windows) > 0 then return URL of current tab of front window"
        case .chromium: body = "if (count of windows) > 0 then return URL of active tab of front window"
        }
        let src = script(bid, body)
        queue.async {
            // Long timeout so a first-time permission prompt can be answered.
            let r = osascript(src, timeout: 60)
            DispatchQueue.main.async {
                busy = false
                if r.err.contains("-1743") { denied.insert(bid) } else if r.out != nil { denied.remove(bid) }
                completion(r.out, r.err)
            }
        }
    }

    static func blank(_ bid: String, _ kind: Kind) {
        let body: String
        switch kind {
        case .safari: body = "set URL of current tab of front window to \"about:blank\""
        case .chromium: body = "set URL of active tab of front window to \"about:blank\""
        }
        let src = script(bid, body)
        queue.async { _ = osascript(src, timeout: 5) }
    }
}

// MARK: - Serves the gate files from the app bundle as pause://app/...

final class GateSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "pause"
    let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var rel = url.path
        if rel.isEmpty || rel == "/" { rel = "/index.html" }
        let file = root.appendingPathComponent(String(rel.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            return
        }
        let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "svg": "image/svg+xml", "png": "image/png", "json": "application/json"]
        let mime = types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = ["Content-Type": mime + "; charset=utf-8", "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        if let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) {
            task.didReceive(resp)
        }
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// MARK: - Windows

final class KeyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// Small diagnostics log: ~/Library/Logs/Pause.log
enum Log {
    static let url: URL = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Logs/Pause.log")
    static func write(_ msg: String) {
        let line = ISO8601DateFormatter().string(from: Date()) + "  " + msg + "\n"
        NSLog("Pause: %@", msg)
        guard let data = line.data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile()
            h.write(data)
            try? h.close()
        } else {
            try? data.write(to: url)
        }
    }
}

let bgColor = NSColor(name: nil) { appearance in
    if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
        return NSColor(srgbRed: 0x17 / 255.0, green: 0x14 / 255.0, blue: 0x2a / 255.0, alpha: 1)
    }
    return NSColor(srgbRed: 0xf7 / 255.0, green: 0xf6 / 255.0, blue: 0xfc / 255.0, alpha: 1)
}

func jsString(_ s: String) -> String {
    if let d = try? JSONSerialization.data(withJSONObject: [s]), let arr = String(data: d, encoding: .utf8) {
        return arr + "[0]"
    }
    return "\"\""
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    var statusItem: NSStatusItem?
    var homeWindow: NSWindow?
    var homeWeb: WKWebView?
    var overlay: KeyPanel?
    var overlayWeb: WKWebView?
    var covers: [NSWindow] = []
    var locked = false
    var timer: Timer?
    var lastKey = ""
    var lastAt = 0.0
    var lastFront = ""
    var loginItem: NSMenuItem?
    var statusLine: NSMenuItem?
    var diag = "Starting…" {
        didSet {
            if diag != oldValue {
                statusLine?.title = diag
                Log.write(diag)
            }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let ver = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        Log.write("Launched Pause \(ver) from \(Bundle.main.bundlePath)")
        NSApp.setActivationPolicy(.regular)
        buildMainMenu()
        buildStatusItem()
        timer = Timer.scheduledTimer(timeInterval: 1.0, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
        Log.write("Watcher started")
        firstLaunchSetup()
        showHome()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showHome()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        locked ? .terminateCancel : .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    // MARK: menus

    func buildMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(item("Open Pause", #selector(openHome), "0"))
        appMenu.addItem(item("Practice a pause", #selector(practice), ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Hide Pause", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: "Quit Pause", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        edit.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
        edit.addItem(.separator())
        edit.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        edit.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        edit.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        edit.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = edit

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        win.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        winItem.submenu = win

        NSApp.mainMenu = main
    }

    func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    func buildStatusItem() {
        let s = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let b = s.button {
            let img = NSImage(systemSymbolName: "pause.circle", accessibilityDescription: "Pause")
            img?.isTemplate = true
            b.image = img
        }
        let m = NSMenu()
        let ver = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let v = NSMenuItem(title: "Pause \(ver)", action: nil, keyEquivalent: "")
        v.isEnabled = false
        m.addItem(v)
        let line = NSMenuItem(title: diag, action: nil, keyEquivalent: "")
        line.isEnabled = false
        statusLine = line
        m.addItem(line)
        m.addItem(.separator())
        m.addItem(item("Open Pause", #selector(openHome), ""))
        m.addItem(item("Practice a pause", #selector(practice), ""))
        m.addItem(.separator())
        let login = item("Start Pause at login", #selector(toggleLogin(_:)), "")
        login.state = loginEnabled() ? .on : .off
        loginItem = login
        m.addItem(login)
        m.addItem(.separator())
        m.addItem(NSMenuItem(title: "Quit Pause", action: #selector(NSApplication.terminate(_:)), keyEquivalent: ""))
        s.menu = m
        statusItem = s
    }

    func firstLaunchSetup() {
        let key = "didFirstLaunch"
        if UserDefaults.standard.bool(forKey: key) { return }
        UserDefaults.standard.set(true, forKey: key)
        if #available(macOS 13.0, *) {
            try? SMAppService.mainApp.register()
            loginItem?.state = loginEnabled() ? .on : .off
        }
    }

    func loginEnabled() -> Bool {
        if #available(macOS 13.0, *) { return SMAppService.mainApp.status == .enabled }
        return false
    }

    @objc func toggleLogin(_ sender: NSMenuItem) {
        if #available(macOS 13.0, *) {
            do {
                if SMAppService.mainApp.status == .enabled {
                    try SMAppService.mainApp.unregister()
                } else {
                    try SMAppService.mainApp.register()
                }
            } catch {
                NSLog("Pause login item: \(error)")
            }
        }
        sender.state = loginEnabled() ? .on : .off
    }

    @objc func openHome() { showHome() }

    @objc func practice() { showOverlay(target: "", hit: "Practice run") }

    // MARK: web views

    func makeWeb() -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "pause")
        if let root = Bundle.main.resourceURL?.appendingPathComponent("gate", isDirectory: true) {
            cfg.setURLSchemeHandler(GateSchemeHandler(root: root), forURLScheme: GateSchemeHandler.scheme)
        }
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        if #available(macOS 12.0, *) { wv.underPageBackgroundColor = bgColor }
        return wv
    }

    func bridgeScript() -> String {
        let protect = Browsers.denied.isEmpty ? "true" : "false"
        return """
        (function () {
          var post = function (m) { try { window.webkit.messageHandlers.pause.postMessage(m); } catch (e) {} };
          window.PauseNative = {
            _state: \(jsString(Store.shared.json)),
            _protect: \(protect),
            load: function () { return this._state; },
            save: function (j) { this._state = j; post({ op: 'save', json: j }); },
            platform: function () { return 'mac'; },
            isProtectionOn: function () { return this._protect; },
            openProtectionSettings: function () { post({ op: 'automation' }); },
            openUrl: function (u) { post({ op: 'openUrl', url: String(u) }); },
            close: function () { post({ op: 'close' }); },
            setLocked: function (b) { post({ op: 'locked', value: !!b }); },
            canListen: function () { return false; },
            listen: function () {},
            openHome: function () { post({ op: 'home' }); },
            practice: function () { post({ op: 'practice' }); }
          };
        })();
        """
    }

    func load(_ wv: WKWebView, query: String) {
        let uc = wv.configuration.userContentController
        uc.removeAllUserScripts()
        uc.addUserScript(WKUserScript(source: bridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let address = "\(GateSchemeHandler.scheme)://app/index.html" + (query.isEmpty ? "" : "?" + query)
        guard let u = URL(string: address) else {
            Log.write("Bad gate address: \(address)")
            return
        }
        wv.load(URLRequest(url: u))
    }

    func broadcast(except: WKWebView?) {
        let lit = jsString(Store.shared.json)
        for wv in [homeWeb, overlayWeb].compactMap({ $0 }) where wv !== except {
            wv.evaluateJavaScript("if (window.PauseNative) { PauseNative._state = \(lit); } window.__pauseOnChange && window.__pauseOnChange();", completionHandler: nil)
        }
    }

    // MARK: home window

    func showHome() {
        if let ap = Core.activePause(Store.shared.parsed, nowMs()) {
            showOverlay(target: ap["target"] as? String ?? "", hit: ap["hit"] as? String ?? "")
            return
        }
        if homeWindow == nil {
            let w = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 560, height: 820),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered, defer: false)
            w.title = "Pause"
            w.isReleasedWhenClosed = false
            w.backgroundColor = bgColor
            w.minSize = NSSize(width: 380, height: 500)
            w.collectionBehavior = [.moveToActiveSpace]
            w.center()
            let wv = makeWeb()
            w.contentView = wv
            homeWindow = w
            homeWeb = wv
            load(wv, query: "")
        } else if let wv = homeWeb {
            // refresh protection status + state
            load(wv, query: "")
        }
        NSApp.activate(ignoringOtherApps: true)
        homeWindow?.makeKeyAndOrderFront(nil)
        homeWindow?.orderFrontRegardless()
        Log.write("Home window shown")
    }

    // MARK: overlay

    func showOverlay(target: String, hit: String) {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        if overlay == nil {
            let w = KeyPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            w.isFloatingPanel = true
            w.hidesOnDeactivate = false
            w.becomesKeyOnlyIfNeeded = false
            w.level = .statusBar
            w.isReleasedWhenClosed = false
            w.backgroundColor = bgColor
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            let wv = makeWeb()
            w.contentView = wv
            overlay = w
            overlayWeb = wv
        }
        guard let w = overlay, let wv = overlayWeb else { return }
        if w.isVisible && locked {
            bringOverlayFront()
            return
        }
        w.setFrame(screen.frame, display: true)
        let enc: (String) -> String = { $0.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "" }
        load(wv, query: "mode=pause&target=\(enc(target))&hit=\(enc(hit))")

        covers.forEach { $0.orderOut(nil) }
        covers = []
        for s in NSScreen.screens where s != screen {
            let c = NSPanel(contentRect: s.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            c.hidesOnDeactivate = false
            c.level = .statusBar
            c.isReleasedWhenClosed = false
            c.backgroundColor = bgColor
            c.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            c.setFrame(s.frame, display: true)
            covers.append(c)
        }
        homeWindow?.orderOut(nil)
        bringOverlayFront()
        Log.write("Pause shown for \(hit.isEmpty ? "?" : hit)")
    }

    func bringOverlayFront() {
        overlay?.orderFrontRegardless()
        overlay?.makeKey()
        covers.forEach { $0.orderFrontRegardless() }
        NSApp.activate(ignoringOtherApps: true)
    }

    func hideOverlay() {
        setLocked(false)
        overlay?.orderOut(nil)
        covers.forEach { $0.orderOut(nil) }
        covers = []
    }

    func setLocked(_ value: Bool) {
        locked = value
        NSApp.presentationOptions = value
            ? [.hideDock, .hideMenuBar, .disableProcessSwitching, .disableHideApplication, .disableAppleMenu]
            : []
    }

    // MARK: watcher

    @objc func tick() {
        let now = nowMs()
        let st = Store.shared.parsed

        if let ap = Core.activePause(st, now) {
            if overlay?.isVisible != true {
                showOverlay(target: ap["target"] as? String ?? "", hit: ap["hit"] as? String ?? "")
            } else if locked, overlay?.isKeyWindow != true || overlay?.isOnActiveSpace != true {
                bringOverlayFront()
            }
            return
        }

        guard let front = NSWorkspace.shared.frontmostApplication, let bid = front.bundleIdentifier else { return }
        if bid != lastFront {
            lastFront = bid
            Log.write("Front app: \(bid)")
        }
        guard let kind = Browsers.known[bid] else { return }
        let name = front.localizedName ?? bid
        Browsers.readURL(bid, kind) { [weak self] url, err in
            guard let self = self else { return }
            if let url = url {
                self.diag = "\(name): watching ✓"
                _ = url
            } else if err.contains("-1743") {
                self.diag = "\(name): not allowed — turn on in Settings › Automation"
            } else if err == "timeout" {
                self.diag = "\(name): waiting for permission…"
            } else if !err.isEmpty {
                self.diag = "\(name): error \(err.prefix(80))"
            }
            self.handle(url: url, bid: bid, kind: kind)
        }
    }

    func handle(url: String?, bid: String, kind: Browsers.Kind) {
        let now = nowMs()
        let st = Store.shared.parsed
        if Core.activePause(st, now) != nil { return }
        guard let url = url, !url.isEmpty,
              let hit = Core.matchAll(url, Core.watchList(st))
        else { return }
        if Core.hasPass(st, hit, now) { return }

        let key = bid + "|" + url
        if key == lastKey && now - lastAt < 4000 { return }
        lastKey = key
        lastAt = now

        Browsers.blank(bid, kind)
        showOverlay(target: url, hit: hit)
    }

    // MARK: bridge messages

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        let fromOverlay = message.webView != nil && message.webView === overlayWeb
        switch op {
        case "save":
            if let j = body["json"] as? String {
                Store.shared.save(j)
                broadcast(except: message.webView)
            }
        case "openUrl":
            if let s = body["url"] as? String,
               let u = URL(string: s.lowercased().hasPrefix("http") ? s : "https://" + s) {
                NSWorkspace.shared.open(u)
            }
        case "close":
            if fromOverlay { hideOverlay() } else { homeWindow?.orderOut(nil) }
        case "locked":
            if fromOverlay { setLocked(body["value"] as? Bool ?? false) }
        case "home":
            if fromOverlay { hideOverlay() }
            showHome()
        case "practice":
            practice()
        case "automation":
            if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
                NSWorkspace.shared.open(u)
            }
        default:
            break
        }
    }

    // MARK: web delegates

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = navigationAction.request.url else { return decisionHandler(.allow) }
        if u.scheme == GateSchemeHandler.scheme || u.scheme == "about" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(u)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Log.write("Page loaded in \(webView === overlayWeb ? "pause" : "home") window")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Log.write("Page failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Log.write("Page failed to start: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.write("Web content process crashed; reloading")
        webView.reload()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.runModal()
        completionHandler()
    }

    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
