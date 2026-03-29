/**
 * TV Mode Controller — fullscreen panel cycling for all variants.
 *
 * Creates a floating exit overlay that appears on mouse movement
 * and auto-hides after 3 seconds of inactivity. The overlay shows:
 *   - Current panel name and position (e.g., "3 / 12")
 *   - Previous / Next / Exit buttons
 *   - Progress dots
 *
 * Escape key exits TV mode. If the browser exits fullscreen first
 * (which consumes the Escape event), we detect the fullscreen change
 * and exit TV mode automatically.
 */

const TV_INTERVAL_KEY = 'tv-mode-interval';
const MIN_INTERVAL = 15_000;  // 15 seconds
const MAX_INTERVAL = 120_000; // 2 minutes
const DEFAULT_INTERVAL = 45_000; // 45 seconds
const OVERLAY_HIDE_DELAY = 3000; // 3 seconds

function clampInterval(ms: number): number {
  return Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, ms));
}

export class TvModeController {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentIndex = 0;
  private panelKeys: string[];
  private intervalMs: number;
  private onPanelChange?: (key: string) => void;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundMouseHandler: (() => void) | null = null;
  private boundFullscreenHandler: (() => void) | null = null;
  private overlayEl: HTMLElement | null = null;
  private overlayHideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    panelKeys: string[];
    intervalMs?: number;
    onPanelChange?: (key: string) => void;
  }) {
    this.panelKeys = opts.panelKeys;
    this.onPanelChange = opts.onPanelChange;

    const stored = localStorage.getItem(TV_INTERVAL_KEY);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    this.intervalMs = clampInterval(
      Number.isFinite(parsed) ? parsed : (opts.intervalMs ?? DEFAULT_INTERVAL)
    );
  }

  get active(): boolean {
    return !!document.documentElement.dataset.tvMode;
  }

  enter(): void {
    document.documentElement.dataset.tvMode = 'true';

    // Request fullscreen
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (el.requestFullscreen) {
      try { void el.requestFullscreen()?.catch(() => {}); } catch { /* noop */ }
    } else if (el.webkitRequestFullscreen) {
      try { el.webkitRequestFullscreen(); } catch { /* noop */ }
    }

    this.currentIndex = 0;
    this.showPanel(this.currentIndex);
    this.startCycling();
    this.createOverlay();
    this.bindListeners();
  }

  exit(): void {
    if (!this.active) return;
    delete document.documentElement.dataset.tvMode;

    if (document.fullscreenElement) {
      try { void document.exitFullscreen()?.catch(() => {}); } catch { /* noop */ }
    }

    this.stopCycling();
    this.unbindListeners();
    this.removeOverlay();
    this.showAllPanels();
  }

  toggle(): void {
    if (this.active) this.exit(); else this.enter();
  }

  setIntervalMs(ms: number): void {
    this.intervalMs = clampInterval(ms);
    localStorage.setItem(TV_INTERVAL_KEY, String(this.intervalMs));
    if (this.intervalId !== null) {
      this.stopCycling();
      this.startCycling();
    }
  }

  updatePanelKeys(keys: string[]): void {
    this.panelKeys = keys;
    if (this.currentIndex >= this.panelKeys.length) {
      this.currentIndex = 0;
    }
  }

  destroy(): void {
    this.exit();
    this.onPanelChange = undefined;
  }

  // ── Overlay ──────────────────────────────────────────────

  private createOverlay(): void {
    this.removeOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'tv-overlay';
    overlay.innerHTML = ''
      + '<div class="tv-overlay-bar">'
      +   '<div class="tv-overlay-info">'
      +     '<span class="tv-overlay-label" id="tvOverlayLabel">Map</span>'
      +     '<span class="tv-overlay-pos" id="tvOverlayPos">1 / ' + this.panelKeys.length + '</span>'
      +   '</div>'
      +   '<div class="tv-overlay-controls">'
      +     '<button class="tv-ctl-btn" id="tvPrev" title="Previous">'
      +       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>'
      +     '</button>'
      +     '<button class="tv-ctl-btn" id="tvNext" title="Next">'
      +       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>'
      +     '</button>'
      +     '<button class="tv-ctl-btn tv-exit-main" id="tvExit">EXIT</button>'
      +   '</div>'
      + '</div>';

    overlay.querySelector('#tvPrev')?.addEventListener('click', () => {
      this.stopCycling();
      this.currentIndex = (this.currentIndex - 1 + this.panelKeys.length) % this.panelKeys.length;
      this.showPanel(this.currentIndex);
      this.startCycling();
    });

    overlay.querySelector('#tvNext')?.addEventListener('click', () => {
      this.stopCycling();
      this.nextPanel();
      this.startCycling();
    });

    overlay.querySelector('#tvExit')?.addEventListener('click', () => {
      this.exit();
      window.dispatchEvent(new CustomEvent('tv-mode-changed', { detail: { active: false } }));
    });

    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    // Show briefly on enter, then auto-hide
    this.showOverlay();
  }

  private removeOverlay(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (this.overlayHideTimer) {
      clearTimeout(this.overlayHideTimer);
      this.overlayHideTimer = null;
    }
  }

  private showOverlay(): void {
    if (!this.overlayEl) return;
    this.overlayEl.classList.add('visible');
    if (this.overlayHideTimer) clearTimeout(this.overlayHideTimer);
    this.overlayHideTimer = setTimeout(() => {
      this.overlayEl?.classList.remove('visible');
    }, OVERLAY_HIDE_DELAY);
  }

  private updateOverlayInfo(): void {
    const label = this.overlayEl?.querySelector('#tvOverlayLabel');
    const pos = this.overlayEl?.querySelector('#tvOverlayPos');
    if (!label || !pos) return;

    const key = this.panelKeys[this.currentIndex] ?? 'map';
    // Try to read the panel's title from the DOM
    let name = key === 'map' ? 'Map' : key;
    if (key !== 'map') {
      const panelEl = document.querySelector('[data-panel="' + key + '"] .panel-title');
      if (panelEl?.textContent) name = panelEl.textContent;
    }
    label.textContent = name;
    pos.textContent = (this.currentIndex + 1) + ' / ' + this.panelKeys.length;
  }

  // ── Event listeners ──────────────────────────────────────

  private bindListeners(): void {
    // Escape key
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.exit();
        window.dispatchEvent(new CustomEvent('tv-mode-changed', { detail: { active: false } }));
      }
    };
    document.addEventListener('keydown', this.boundKeyHandler);

    // Mouse movement shows overlay
    this.boundMouseHandler = () => this.showOverlay();
    document.addEventListener('mousemove', this.boundMouseHandler);

    // Detect browser exiting fullscreen (which eats the Escape event)
    this.boundFullscreenHandler = () => {
      if (!document.fullscreenElement && this.active) {
        this.exit();
        window.dispatchEvent(new CustomEvent('tv-mode-changed', { detail: { active: false } }));
      }
    };
    document.addEventListener('fullscreenchange', this.boundFullscreenHandler);
  }

  private unbindListeners(): void {
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
    if (this.boundMouseHandler) {
      document.removeEventListener('mousemove', this.boundMouseHandler);
      this.boundMouseHandler = null;
    }
    if (this.boundFullscreenHandler) {
      document.removeEventListener('fullscreenchange', this.boundFullscreenHandler);
      this.boundFullscreenHandler = null;
    }
  }

  // ── Cycling ──────────────────────────────────────────────

  private startCycling(): void {
    this.stopCycling();
    this.intervalId = setInterval(() => this.nextPanel(), this.intervalMs);
  }

  private stopCycling(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private nextPanel(): void {
    this.currentIndex = (this.currentIndex + 1) % this.panelKeys.length;
    this.showPanel(this.currentIndex);
  }

  private showPanel(index: number): void {
    const panelsGrid = document.getElementById('panelsGrid');
    const mapSection = document.getElementById('mapSection');
    if (!panelsGrid) return;

    const allPanels = panelsGrid.querySelectorAll<HTMLElement>('.panel');

    if (index === 0) {
      if (mapSection) mapSection.style.display = '';
      allPanels.forEach(p => {
        p.classList.add('tv-hidden');
        p.classList.remove('tv-active');
      });
    } else {
      if (mapSection) mapSection.style.display = 'none';
      const panelIndex = index - 1;
      allPanels.forEach((p, i) => {
        if (i === panelIndex) {
          p.classList.remove('tv-hidden');
          p.classList.add('tv-active');
        } else {
          p.classList.add('tv-hidden');
          p.classList.remove('tv-active');
        }
      });
    }

    const key = this.panelKeys[index];
    if (key) this.onPanelChange?.(key);
    this.updateOverlayInfo();
  }

  private showAllPanels(): void {
    const panelsGrid = document.getElementById('panelsGrid');
    const mapSection = document.getElementById('mapSection');
    if (panelsGrid) {
      panelsGrid.querySelectorAll<HTMLElement>('.panel').forEach(p => {
        p.classList.remove('tv-hidden', 'tv-active');
      });
    }
    if (mapSection) mapSection.style.display = '';
  }
}
