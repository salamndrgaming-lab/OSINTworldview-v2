# Monitor Browser

**The browser built for intelligence analysts.** Every new tab is a live global threat picture.
Every website you visit, your OSINT workspace is one keystroke away.

Monitor Browser is a standalone Tauri v2 desktop application where the new-tab/homepage **is** the
OSINTworldview geopolitical dashboard, and browser chrome is the primary UI shell — Arc Browser's
sidebar-first philosophy applied to intelligence analysis.

---

## Prerequisites

- **Rust** (stable toolchain) — install via <https://rustup.rs>
- **Node.js** 18 or newer
- **Tauri CLI v2** — automatically installed as a dev dependency
- **Platform dependencies**:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `libwebkit2gtk-4.1-dev`, `build-essential`, `libayatana-appindicator3-dev`, `librsvg2-dev`
  - **Windows:** WebView2 runtime (ships with Windows 11; downloadable for Win10)

See the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for the authoritative list.

---

## Setup

```bash
npm install
npm run dev
```

`npm run dev` launches the Vite dev server (port 5173) **and** the Tauri shell in one command.
The first run compiles the Rust backend and may take a few minutes.

---

## Build

```bash
npm run build
```

Produces installers under `src-tauri/target/release/bundle/` (`.dmg` on macOS, `.msi`/`.exe` on
Windows, `.deb`/`.AppImage` on Linux).

---

## Keyboard shortcuts

| Shortcut          | Action                         |
| ----------------- | ------------------------------ |
| ⌘/Ctrl + T        | New tab (opens homepage)       |
| ⌘/Ctrl + W        | Close current tab              |
| ⌘/Ctrl + L        | Focus URL bar                  |
| ⌘/Ctrl + R        | Reload current page            |
| ⌘/Ctrl + \[       | Back                           |
| ⌘/Ctrl + \]       | Forward                        |
| ⌘/Ctrl + B        | Toggle Intel sidebar (pinned)  |
| ⌘/Ctrl + I        | Toggle Intel overlay mode      |

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  [titlebar]  tabs  ─  [+ new tab]       [─] [▢] [×]        │  32px
├────────────────────────────────────────────────────────────┤
│  [← → ↻]  [url bar ...........................]  [⚡🔔⚙]  │  44px
├──────────┬─────────────────────────────────────────────────┤
│          │                                                 │
│  INTEL   │                                                 │
│ SIDEBAR  │              MAIN WEBVIEW                       │
│ (280px)  │   • asset://homepage (new tab)                  │
│          │   • arbitrary https URL (navigation)            │
│  panels: │                                                 │
│   ◉ Threat Feed                                            │
│   ⧗ Commodity Pulse                                        │
│   ⚔ Active Conflicts                                       │
│   ⚠ Breaking Intel                                         │
│   ⚒ OSINT Toolkit                                          │
│          │                                                 │
│ [MONITOR]│                                                 │
│ [ MAP   ]│                                                 │
└──────────┴─────────────────────────────────────────────────┘
```

**Rust backend** (`src-tauri/src/`)

- `main.rs` — thin entry point
- `lib.rs` — Tauri builder + plugin registration
- `browser.rs` — tab/history state (`BrowserState`)
- `commands.rs` — IPC handlers: `navigate`, `new_tab`, `close_tab`, `get_tabs`, `go_back`,
  `go_forward`, `reload`, `set_tab_meta`, **`fetch_intel`** (CORS-bypassing HTTP proxy),
  `open_devtools`, `window_*`

**TypeScript frontend** (`src/`)

- `main.ts` — boot sequence + keyboard shortcuts + `postMessage` relay
- `browser/chrome.ts` — titlebar, tabs, toolbar, URL bar, window controls
- `browser/tabs.ts` — `TabManager` mirrors backend state, emits bus events
- `browser/webview-bridge.ts` — typed `invoke()` wrapper + `fetchIntel()` helper
- `sidebar/sidebar.ts` — expanded/collapsed/overlay modes (CSS transforms, 60fps)
- `sidebar/panel-base.ts` — abstract base: polling, error state, collapsible chrome
- `sidebar/panels/*.ts` — five intel panels
- `homepage/index.html` — self-contained OSINT dashboard (opens on new tab)
- `events/bus.ts` — typed pub/sub

### The `fetch_intel` IPC flow — end-to-end

1. A panel calls `this.fetchIntelJson<T>(url)` in `IntelPanel`.
2. That delegates to `fetchIntelJson` in `src/browser/webview-bridge.ts`, which calls
   `fetchIntel` → `invokeBackend<string>('fetch_intel', { url })`.
3. The Tauri bridge routes the call to `commands::fetch_intel` in `src-tauri/src/commands.rs`.
4. That function parses & validates the URL (`http`/`https` only), builds a `reqwest` client with
   a 20-second timeout, performs the GET, and returns the body as a UTF-8 `String`.
5. On any failure it returns a `CommandError` (serializable) that the TS layer surfaces via
   `IntelPanel.renderErrorState()` and schedules a retry after 30 s.

Because the request is made from Rust, CORS preflights never happen — the panel can pull from
**any** origin (ACLED, DNS, ip-api, etc.) regardless of the webview's origin policy.

---

## Custom OSINTworldview instance

By default all live panels pull from `https://osint-worldview.vercel.app`. Point the build at
your own deployment by exporting an env var before `npm run dev` / `npm run build`:

```bash
export VITE_INTEL_API_BASE="https://my-deployment.example.com"
npm run dev
```

The base URL is consumed by `ThreatFeedPanel`, `CommodityPanel`, and `ConflictPanel`. Endpoints
consumed:

- `GET {base}/api/insights`
- `GET {base}/api/market/commodity-quotes`
- `GET {base}/api/supply-chain/chokepoints`

---

## Notes on the embedded webview

The main content area is a styled `<iframe>` that loads the active tab's URL. Many high-profile
sites ship `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'` headers,
which will block rendering inside the iframe — this is a limitation of the generic shell, not of
Monitor Browser itself. For production pentesting/analyst workflows you would typically swap the
iframe for a separate Tauri `WebviewWindow` attached to the same window frame. The codebase is
architected so that swap is a one-file change in `src/browser/chrome.ts::loadInWebview`.

---

## License

MIT © 2026 OSINT Worldview
