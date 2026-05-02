# Monitor Browser — Beta Install Guide

Thank you for testing **Monitor Browser Beta** — a Chromium-based browser whose
new-tab page is a live OSINT intelligence dashboard.

## Download

Download the artifact for your platform from the GitHub Releases page or the
build output in `dist/` after running the build commands below.

| Platform | File | Notes |
|----------|------|-------|
| Windows 10/11 (x64) | `monitor-browser-1.0.0-beta.1-win-x64.exe` | NSIS installer with shortcuts |
| Windows 10/11 (x64) | `monitor-browser-1.0.0-beta.1-portable.exe` | No-install portable build |
| Linux (x64) | `monitor-browser-1.0.0-beta.1-linux-x86_64.AppImage` | Universal — runs on most distros |
| Linux (x64) | `monitor-browser-1.0.0-beta.1-linux-amd64.deb` | Debian / Ubuntu / Mint |
| Linux (x64) | `monitor-browser-1.0.0-beta.1-linux-x86_64.rpm` | Fedora / RHEL / openSUSE |
| Linux (x64) | `monitor-browser-1.0.0-beta.1-linux-x64.tar.gz` | Manual extract |
| macOS (x64/arm64) | `monitor-browser-1.0.0-beta.1-mac-x64.dmg` | Drag-to-Applications |

## Installation

### Windows

**Installer (recommended)**
1. Download `monitor-browser-1.0.0-beta.1-win-x64.exe`.
2. Double-click. Windows SmartScreen may warn — click **More info → Run anyway**
   (the build is unsigned during beta).
3. Pick an install directory or accept the default.
4. Launch from the Start menu or desktop shortcut.

**Portable**
1. Download `monitor-browser-1.0.0-beta.1-portable.exe`.
2. Move it anywhere — USB stick, Downloads folder, etc.
3. Double-click to run. No install, no admin rights needed.

### Linux — AppImage (recommended)

```bash
chmod +x monitor-browser-1.0.0-beta.1-linux-x86_64.AppImage
./monitor-browser-1.0.0-beta.1-linux-x86_64.AppImage
```

Optional — integrate with your menu using
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher).

### Linux — Debian / Ubuntu

```bash
sudo dpkg -i monitor-browser-1.0.0-beta.1-linux-amd64.deb
sudo apt-get install -f   # if any deps missing
```

Launch from your application menu or run `monitor-browser` from a terminal.

### Linux — Fedora / RHEL / openSUSE

```bash
sudo rpm -i monitor-browser-1.0.0-beta.1-linux-x86_64.rpm
```

### macOS

1. Open the `.dmg`.
2. Drag **Monitor Browser** to your **Applications** folder.
3. First launch: right-click → **Open** → confirm (Gatekeeper prompt — beta is unsigned).

## First Run

On first launch you'll see a **6-step setup wizard**:

1. **Welcome** — feature overview
2. **Operator Profile** — optional name, role, organization (stays local)
3. **Theme** — Amber / Cyan / Phosphor / Magenta / Monochrome
4. **Search Engine** — DuckDuckGo / Startpage / Brave / Google / Bing
5. **Privacy** — Ad block, HTTPS-only, Stealth UA, Bookmarks bar
6. **Confirm & Launch** — review and open the dashboard

You can skip the wizard at any time. All choices can be changed later from
Settings (`Ctrl+,`).

## Quick Reference

| Action | Shortcut |
|--------|----------|
| New tab | `Ctrl+T` |
| Close tab | `Ctrl+W` |
| Reopen closed tab | `Ctrl+Shift+T` |
| Bookmark this page | `Ctrl+D` (or **★** in toolbar) |
| Bookmarks panel | `Ctrl+Shift+B` |
| History | `Ctrl+Shift+H` |
| Downloads | `Ctrl+J` |
| Intel Sidebar | `Ctrl+B` |
| Settings | `Ctrl+,` |
| DevTools | `F12` |

## Building From Source

```bash
git clone https://github.com/salamndrgaming-lab/osintworldview-v2.git
cd osintworldview-v2/monitor-browser
npm install
npm start                 # run in dev
npm run build:win         # Windows installer + portable
npm run build:linux       # AppImage + deb + rpm + tar.gz
npm run build:mac         # macOS DMG
npm run build:all         # everything (requires platform support)
npm run pack              # unpacked dir (test packaging without installer)
```

Output appears in `dist/`.

## Reporting Issues

Beta feedback welcome — file issues at
<https://github.com/salamndrgaming-lab/osintworldview-v2/issues>.

When reporting, please include:
- OS + version
- Build artifact name
- Steps to reproduce
- DevTools console output (`F12 → Console` tab)
- Whether the issue persists with the VPN on/off

## Privacy

- No telemetry. Settings, history, bookmarks, and operations stay on your machine.
- Live OSINT data is fetched directly from public APIs (USGS, NASA EONET,
  ReliefWeb, GDELT, OpenSky, etc.) routed through the main process to bypass
  CORS — no third-party intermediary.
- VPN feature uses Tor (bundled or system) or a SOCKS5 proxy of your choice.

## License

AGPL-3.0-or-later. See `LICENSE`.
