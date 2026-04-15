# Monitor Browser

> The browser built for intelligence analysts. **Every new tab is a live threat
> picture.**

Monitor Browser is a real, standalone web browser — like Firefox or Microsoft
Edge — whose new-tab / homepage is a fully-customizable first-party OSINT
intelligence dashboard. Open it and you immediately see:

- **World Situation Map** (Leaflet + OpenStreetMap) with toggleable layers:
  conflicts, intel hotspots, military bases, maritime chokepoints, key cities
- **Live News** from BBC, Al Jazeera, DW, AP, CNBC (tabbed, 5-min auto-refresh)
- **Intel Feed** sourced from GDELT's global doc API
- **Threat Level** — DEFCON-style indicator
- **Active Conflicts** — curated list of ongoing state & non-state conflicts
- **Markets** (commodities / equities / FX via Stooq: Gold, WTI, S&P, VIX, …)
- **Crypto** (BTC, ETH, SOL, BNB, XRP, ADA, DOGE, TRX via CoinGecko)
- **OSINT Sources** — 16 quick-launch tiles (Bellingcat, ACLED, Flightradar24,
  MarineTraffic, Shodan, GreyNoise, ISW, GDELT, FIRMS, EMSC, …)
- **OSINT Toolkit** — inline Domain, IP Geo, DNS, Subnet calculator

Every panel is **add/remove-able** through the <kbd>+ Add panel</kbd> button;
layout + map-layer state persist across sessions via `localStorage`. Ships
with 5 one-click layout **presets** (Full OSINT / Geopolitical / Markets /
Minimal / Analyst toolkit).

Type a URL and it browses the web normally via Chromium.

Built on **Electron** (bundled Chromium). Ships a branded Chrome
user-agent (`… Chrome/… MonitorBrowser/1.0`) so servers serve modern
pages. No Rust toolchain required — if you have Node.js you can run it.

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
npm run build:linux     # AppImage + .deb + .rpm + .tar.gz
```

Output goes to `monitor-browser/dist/`. Code-signing is **not** configured by
default — see `package.json` → `build` to wire in certificates.

### Linux install

After `npm run build:linux`:

```bash
# AppImage (any distro) — single-file, no install
chmod +x dist/Monitor\ Browser-*.AppImage
./dist/Monitor\ Browser-*.AppImage

# Debian / Ubuntu
sudo apt install ./dist/monitor-browser_*.deb

# Fedora / RHEL
sudo dnf install ./dist/monitor-browser-*.rpm

# Portable tarball
tar -xzf dist/monitor-browser-*.tar.gz && cd monitor-browser-* && ./monitor-browser
```

The `.desktop` entry registers Monitor Browser under
`Network → Security → Web Browser` in GNOME/KDE app menus. It shows up
with the radar icon from `assets/icon.png`.

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

**Homepage dashboard.** The new-tab page is a first-party dashboard at
`homepage/index.html`, driven by `homepage.js`. A panel registry defines
all available panels (map, news, intel, markets, crypto, threat level,
conflicts, sources, toolkit). Users add/remove panels via the picker
modal; the selection + map-layer toggles persist to `localStorage` under
the key `monitor:dashboard:v2`. Live panels pull public OSINT APIs
(BBC/AlJazeera/DW/AP RSS, GDELT, Stooq, CoinGecko, dns.google,
ip-api.com) through the `intel:fetch` IPC proxy — origin-gated to
`file://` senders so arbitrary websites you browse to can't abuse it.

---

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every
  `WebContentsView` (both the chrome renderer and every tab's content view).
- `setWindowOpenHandler` routes `window.open` / `target="_blank"` to new tabs;
  rogue pages cannot spawn arbitrary Electron windows.
- `will-navigate` is not intercepted — that's what a browser does — but the
  preload surface exposed to tab content (`window.monitorApi`) is minimal.
- The `intel:fetch` IPC proxy (optionally used by the offline fallback page)
  is **origin-gated** to `file://` senders in `main.js`. Arbitrary websites
  you browse to cannot invoke it even though the preload is shared.
- A CSP meta tag on the chrome renderer locks its own sources down.
- User-agent presents as `Chrome/… MonitorBrowser/1.0` — the Electron
  fingerprint is stripped so sites see a standard Chromium browser.

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
└── homepage/                   new-tab OSINT dashboard
    ├── index.html              shell
    ├── homepage.css            dashboard styling (grid, panels, map, modal)
    └── homepage.js             panel registry, dashboard engine, all panels
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
