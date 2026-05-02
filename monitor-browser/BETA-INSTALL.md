# Monitor Browser — Beta Install Guide

Welcome! Installation is **download → double-click → done**. No terminal, no
commands. The browser walks you through a quick setup wizard the first time
you open it.

## Pick Your Platform

### Windows 10 / 11

1. Download **`monitor-browser-1.0.0-beta.1-win-x64.exe`**.
2. Double-click the file.
3. Windows SmartScreen may say *"Windows protected your PC"* — click
   **More info → Run anyway**. (Beta builds aren't code-signed yet.)
4. The installer runs silently for ~15 seconds, places a desktop shortcut and
   a Start menu entry, and **launches the browser automatically**.
5. The setup wizard appears in the new window. Pick a theme, search engine,
   and privacy options — about 30 seconds. Done.

To uninstall later: **Settings → Apps → Monitor Browser → Uninstall**.

> Prefer no install at all? Download the **portable** EXE instead — it runs
> from anywhere (USB stick, Desktop, etc.) without writing to Program Files.

### macOS (Intel or Apple Silicon)

1. Download **`monitor-browser-1.0.0-beta.1-mac-x64.dmg`** (Intel) or
   **`-mac-arm64.dmg`** (M1/M2/M3/M4).
2. Double-click the DMG to open it.
3. Drag the **Monitor Browser** icon onto the **Applications** folder shortcut.
4. Open Launchpad or Applications and click **Monitor Browser**.
5. macOS Gatekeeper will say *"unidentified developer"* — close that, then
   right-click the app icon → **Open** → **Open**. (Beta builds aren't
   notarized yet. You only have to do this once.)
6. The setup wizard appears. Configure and you're in.

### Linux — Ubuntu / Debian / Mint / Pop!_OS (recommended)

The cleanest path on Linux is the **`.deb`** package — it works just like
double-clicking an installer on Windows.

1. Download **`monitor-browser-1.0.0-beta.1-linux-amd64.deb`**.
2. Double-click the downloaded file.
3. Your system's software installer opens (GNOME Software / KDE Discover /
   Ubuntu Software Center). Click **Install**, enter your password.
4. **Monitor Browser** now appears in your Applications menu. Click to launch.
5. The setup wizard appears. Configure and you're in.

To uninstall: open the same software-installer app and click Remove.

### Linux — AppImage (any distro)

Use this if your distro doesn't accept `.deb` files (Fedora, Arch, openSUSE,
NixOS, etc.).

1. Download **`monitor-browser-1.0.0-beta.1-linux-x86_64.AppImage`**.
2. Right-click the file → **Properties** → **Permissions** tab → check
   **Allow executing file as program** (wording varies by file manager).
3. Double-click the AppImage. The browser opens.
4. The setup wizard appears.

> Tip — install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher)
> first and step 2 is automatic: AppImageLauncher offers to integrate the
> AppImage into your menu the first time you run it.

### Linux — Fedora / RHEL / openSUSE (`.rpm`)

1. Download **`monitor-browser-1.0.0-beta.1-linux-x86_64.rpm`**.
2. Double-click — your software installer opens and offers to install.
3. Launch from your Applications menu.

## First Run — Setup Wizard

Whichever platform you installed on, the **first launch** opens a 6-step
wizard:

1. **Welcome** — quick tour of features
2. **Operator Profile** — optional name / role / org (stored locally)
3. **Theme** — Amber, Cyan, Phosphor, Magenta, or Monochrome
4. **Search Engine** — DuckDuckGo, Startpage, Brave, Google, or Bing
5. **Privacy** — ad blocking, HTTPS-only, stealth UA, bookmarks bar
6. **Confirm** — review and launch the dashboard

You can hit **Skip setup** at any step. All choices can be changed later in
**Settings** (`Ctrl+,` or the gear icon). To rerun the wizard, type
**`monitor:setup`** in the address bar.

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
| Rerun setup wizard | type `monitor:setup` |

## Reporting Issues

Beta feedback welcome:
<https://github.com/salamndrgaming-lab/osintworldview-v2/issues>.

Please include OS + version, the exact filename you installed, what you did,
what you expected, what actually happened. Screenshots help.

## Privacy

- No telemetry. Settings, history, bookmarks, and operations stay on your
  device.
- Live OSINT data is fetched directly from public APIs (USGS, NASA EONET,
  ReliefWeb, GDELT, OpenSky, …) routed through the browser's main process —
  no third-party intermediary.
- VPN feature uses Tor (bundled or system) or a SOCKS5 proxy of your choice.

## License

AGPL-3.0-or-later. See `LICENSE`.

---

### Building From Source (developers only)

If you want to build the installers yourself, see `README.md`.
