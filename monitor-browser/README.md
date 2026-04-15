# Monitor Browser

> The browser built for intelligence analysts. **Every new tab is a live threat
> picture.**

Monitor Browser is a real, standalone web browser — like Firefox or Microsoft
Edge — whose new-tab / homepage IS the OSINT Worldview intelligence dashboard.
Open it, and you immediately see live threat feeds, commodity pulses, and
active-conflict chokepoints. Type a URL and it browses the web normally via
Chromium.

Built on **Electron** (bundled Chromium). No Rust toolchain required. If you
have Node.js, you can run it.

---

## Prerequisites

- **Node.js 18+** (20 LTS recommended)
- **npm 9+** (ships with Node)
- Windows 10/11, macOS 11+, or a modern Linux desktop

That's it. No Rust, no Cargo, no Python, no system-wide C++ toolchain.

---

## Run it

```bash
cd monitor-browser
npm install
npm start
```

The first `npm install` downloads Electron (~150 MB). Subsequent starts are
instant. `npm start` launches the browser with a single tab pointing at the
Monitor home dashboard.

---

## Build a distributable

```bash
npm run build           # auto-detects host OS
npm run build:win       # NSIS installer (.exe)
npm run build:mac       # DMG
npm run build:linux     # AppImage + .deb
```

Output goes to `monitor-browser/dist/`. Code-signing is **not** configured by
default — see `package.json` → `build` to wire in certificates.

---

## Keyboard shortcuts

| Shortcut                | Action              |
| ----------------------- | ------------------- |
| `Ctrl` / `Cmd` + `T`    | New tab             |
| `Ctrl` / `Cmd` + `W`    | Close current tab   |
| `Ctrl` / `Cmd` + `L`    | Focus URL bar       |
| `Ctrl` / `Cmd` + `R`    | Reload              |
| `F5`                    | Reload              |
| `Ctrl` / `Cmd` + `Tab`  | Next tab            |
| `Ctrl`+`Shift`+`Tab`    | Previous tab        |
| `Alt` + `←`             | Back                |
| `Alt` + `→`             | Forward             |
| Middle-click tab        | Close tab           |

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  BaseWindow (frame: false, custom titlebar)               │
│ ┌───────────────────────────────────────────────────────┐ │
│ │  chromeView  (WebContentsView, 76px tall, z-top)      │ │
│ │  • titlebar + tab strip + window controls             │ │
│ │  • toolbar: back / fwd / reload / home / URL / dev    │ │
│ │  • preload-chrome.js  →  window.browser.*             │ │
│ └───────────────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────────────────┐ │
│ │  active tab's contentView (WebContentsView)           │ │
│ │  • real Chromium surface — bypasses X-Frame-Options   │ │
│ │    and CSP frame-ancestors (no iframe hack)           │ │
│ │  • preload-content.js  →  window.monitorApi.*         │ │
│ │  • new-tab URL = file://…/homepage/index.html         │ │
│ └───────────────────────────────────────────────────────┘ │
│  inactive tabs: parked at 0×0 bounds, still alive         │
└───────────────────────────────────────────────────────────┘
```

**Tab model.** Each tab is a `WebContentsView`. The main process keeps a `Map`
of tabs and an ordered array; the active one is positioned to fill the area
below the 76px chrome, the rest are parked at zero size. Switching tabs
re-stacks the views so the chrome stays on top. This is the modern Electron
API (replaces the deprecated `BrowserView`).

**Chrome ↔ main IPC.** `preload-chrome.js` exposes `window.browser` to the
renderer that draws the tab strip + URL bar. Methods (`newTab`, `navigate`,
`back`, `switchTab`, `reload`, `devtools`, `closeWindow`, …) round-trip to
`ipcMain` handlers in `main.js`. The main process broadcasts a `tabs:updated`
snapshot after every state change so the renderer is purely reactive.

**Homepage dashboard.** `homepage/index.html` loads as a real web page from
`file://`. Three live panels (Threat Feed / Commodity Pulse / Active
Conflicts) poll the public OSINT Worldview API on 5 / 10 / 10 minute
intervals. The inline OSINT Toolkit (Domain / IP Geo / DNS / Subnet) runs
domain/IP lookups against `dns.google` and `ip-api.com`, and a pure-JS subnet
calculator for CIDR math.

---

## Security model

**`intel:fetch` IPC proxy is origin-gated.** The homepage's live panels can't
hit third-party APIs directly because of CORS. So `preload-content.js`
exposes `window.monitorApi.fetchIntel(url)` to every tab — but the main
process only fulfills the request if the caller's URL starts with `file://`.
Arbitrary websites you browse to **cannot** use this proxy, even though the
preload is loaded into every tab.

Additional hardening:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every
  WebContentsView
- `setWindowOpenHandler` routes `window.open` / `target="_blank"` to new tabs
  (no popup spam, no uncontrolled BrowserWindows)
- `will-navigate` is not intercepted — normal top-frame navigation is allowed
  because that's what a browser does — but the preload surface is minimal
- `intel:fetch` is `http` / `https` only, 20 s timeout, response body capped
  by Node's default fetch behavior
- CSP meta tag on the chrome renderer locks its own sources down

---

## File map

```
monitor-browser/
├── main.js                     Electron main process — tabs, IPC, window
├── preload-chrome.js           exposes window.browser to the chrome renderer
├── preload-content.js          exposes window.monitorApi to tab contents
├── package.json                Electron + electron-builder config
├── assets/
│   └── icon.png                256×256 radar-motif app icon
├── renderer/                   the browser chrome UI (tab strip + URL bar)
│   ├── index.html
│   ├── chrome.css
│   └── chrome.js
└── homepage/                   the new-tab OSINT dashboard
    ├── index.html
    ├── homepage.css
    └── homepage.js
```

---

## Troubleshooting

- **`Error: Electron failed to install correctly`** — delete
  `node_modules/electron` and re-run `npm install`. Corporate proxies often
  block the postinstall; set `ELECTRON_MIRROR` if needed.
- **Live panels show "OFFLINE" on first boot** — the dashboard requires the
  content preload. If you see it, `preload-content.js` wasn't attached —
  check that `main.js` references it with `path.join(__dirname,
  'preload-content.js')`.
- **Blank tab after navigation** — open devtools for the tab via the toolbar
  button. `did-fail-load` renders a branded error page; if you see nothing,
  the page is probably still loading (watch the tab-strip spinner).
