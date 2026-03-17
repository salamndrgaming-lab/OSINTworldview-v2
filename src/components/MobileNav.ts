/**
 * MobileNav.ts — Bottom Tab Navigation + Gesture Support
 * World Monitor OSINT Platform
 *
 * Drop into: src/components/MobileNav.ts
 * DO NOT paste integration code into main.ts yet — wire it later.
 */

export interface MobileNavTab {
  id: string;
  label: string;
  icon: string;
  badge?: number;
  panel?: string;
}

export interface MobileNavConfig {
  tabs: MobileNavTab[];
  initialTab?: string;
  onTabChange?: (tabId: string) => void;
  enableSwipe?: boolean;
  hideOnScroll?: boolean;
  position?: 'bottom' | 'top';
}

const DEFAULT_TABS: MobileNavTab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', panel: 'dashboard' },
  { id: 'map', label: 'Map', icon: '🗺️', panel: 'map' },
  { id: 'poi', label: 'POI', icon: '👤', panel: 'poi' },
  { id: 'threats', label: 'Threats', icon: '⚠️', panel: 'threats' },
  { id: 'intel', label: 'Intel', icon: '🧠', panel: 'intel' },
];

function injectMobileNavStyles(): void {
  if (document.getElementById('mobile-nav-styles')) return;
  const style = document.createElement('style');
  style.id = 'mobile-nav-styles';
  style.textContent = `
    @media(min-width:769px){.mobile-nav{display:none!important}.mobile-nav-spacer{display:none!important}}
    :root{--mnav-height:64px;--mnav-bg:rgba(10,14,23,.92);--mnav-border:#1e293b;--mnav-text:#64748b;--mnav-active:var(--accent-color,#3b82f6);--mnav-active-bg:color-mix(in srgb,var(--mnav-active) 12%,transparent);--mnav-radius:16px;--mnav-transition:250ms cubic-bezier(.4,0,.2,1)}
    .mobile-nav-spacer{height:var(--mnav-height);flex-shrink:0}
    .mobile-nav{position:fixed;bottom:0;left:0;right:0;z-index:9000;height:var(--mnav-height);background:var(--mnav-bg);backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);border-top:1px solid var(--mnav-border);display:flex;align-items:stretch;justify-content:space-around;padding:0 4px;padding-bottom:env(safe-area-inset-bottom,0px);transform:translateY(0);transition:transform var(--mnav-transition);touch-action:none;user-select:none;-webkit-user-select:none}
    .mobile-nav.top-position{bottom:auto;top:0;border-top:none;border-bottom:1px solid var(--mnav-border);padding-bottom:0;padding-top:env(safe-area-inset-top,0px)}
    .mobile-nav.hidden{transform:translateY(100%)}
    .mobile-nav.top-position.hidden{transform:translateY(-100%)}
    .mobile-nav-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px 2px;background:none;border:none;color:var(--mnav-text);font-family:'JetBrains Mono','SF Mono',monospace;font-size:9px;letter-spacing:.3px;text-transform:uppercase;cursor:pointer;position:relative;outline:none;-webkit-tap-highlight-color:transparent;transition:color var(--mnav-transition);min-width:0}
    .mobile-nav-tab:active{transform:scale(.92)}
    .mobile-nav-tab.active{color:var(--mnav-active)}
    .mobile-nav-tab.active::after{content:'';position:absolute;bottom:4px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:var(--mnav-active);animation:mnav-dot-in 200ms ease both}
    @keyframes mnav-dot-in{from{transform:translateX(-50%) scale(0)}to{transform:translateX(-50%) scale(1)}}
    .mobile-nav-icon{font-size:20px;line-height:1;transition:transform var(--mnav-transition);position:relative}
    .mobile-nav-tab.active .mobile-nav-icon{transform:scale(1.1)}
    .mobile-nav-tab.active .mobile-nav-icon::before{content:'';position:absolute;inset:-8px;border-radius:12px;background:var(--mnav-active-bg);z-index:-1;animation:mnav-glow-in 300ms ease both}
    @keyframes mnav-glow-in{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
    .mobile-nav-label{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:opacity var(--mnav-transition)}
    .mobile-nav-badge{position:absolute;top:4px;right:calc(50% - 18px);min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ef4444;color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1;animation:mnav-badge-pop 300ms ease both}
    @keyframes mnav-badge-pop{0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}}
    .mobile-nav-swipe-indicator{position:fixed;top:50%;transform:translateY(-50%);width:4px;height:60px;border-radius:2px;background:var(--mnav-active);opacity:0;z-index:9001;transition:opacity 150ms ease;pointer-events:none}
    .mobile-nav-swipe-indicator.left{left:2px}
    .mobile-nav-swipe-indicator.right{right:2px}
    .mobile-nav-swipe-indicator.visible{opacity:.6}
    .mobile-panel-transition{transition:transform 300ms cubic-bezier(.4,0,.2,1),opacity 200ms ease}
    .mobile-panel-enter-left{transform:translateX(-30px);opacity:0}
    .mobile-panel-enter-right{transform:translateX(30px);opacity:0}
    .mobile-panel-enter-active{transform:translateX(0);opacity:1}
  `;
  document.head.appendChild(style);
}

interface FullMobileNavConfig {
  tabs: MobileNavTab[];
  initialTab: string;
  onTabChange: (tabId: string) => void;
  enableSwipe: boolean;
  hideOnScroll: boolean;
  position: 'bottom' | 'top';
}

export class MobileNav {
  private config: FullMobileNavConfig;
  private navEl: HTMLElement | null = null;
  private spacerEl: HTMLElement | null = null;
  private activeTabId: string;
  private tabs: MobileNavTab[];
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;
  private swiping = false;
  private swipeLeftIndicator: HTMLElement | null = null;
  private swipeRightIndicator: HTMLElement | null = null;
  private lastScrollY = 0;
  private scrollTicking = false;
  private isHidden = false;

  constructor(config: Partial<MobileNavConfig> = {}) {
    this.tabs = config.tabs || DEFAULT_TABS;
    this.config = {
      tabs: this.tabs,
      initialTab: config.initialTab || this.tabs[0]?.id || '',
      onTabChange: config.onTabChange || (() => { /* noop */ }),
      enableSwipe: config.enableSwipe ?? true,
      hideOnScroll: config.hideOnScroll ?? true,
      position: config.position || 'bottom',
    };
    this.activeTabId = this.config.initialTab;
    injectMobileNavStyles();
  }

  mount(): void {
    this.destroy();
    this.navEl = document.createElement('nav');
    this.navEl.className = `mobile-nav ${this.config.position === 'top' ? 'top-position' : ''}`;
    this.navEl.setAttribute('role', 'tablist');
    this.navEl.setAttribute('aria-label', 'Main navigation');
    this.renderTabs();
    document.body.appendChild(this.navEl);
    this.spacerEl = document.createElement('div');
    this.spacerEl.className = 'mobile-nav-spacer';
    document.body.appendChild(this.spacerEl);
    if (this.config.enableSwipe) {
      this.swipeLeftIndicator = this.createSwipeIndicator('left');
      this.swipeRightIndicator = this.createSwipeIndicator('right');
      document.body.appendChild(this.swipeLeftIndicator);
      document.body.appendChild(this.swipeRightIndicator);
    }
    this.bindTabEvents();
    if (this.config.enableSwipe) this.bindSwipeEvents();
    if (this.config.hideOnScroll) this.bindScrollEvents();
  }

  private renderTabs(): void {
    if (!this.navEl) return;
    this.navEl.innerHTML = this.tabs.map((tab) => `
      <button class="mobile-nav-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab-id="${tab.id}" role="tab" aria-selected="${tab.id === this.activeTabId}" aria-label="${tab.label}">
        <span class="mobile-nav-icon">${tab.icon}</span>
        <span class="mobile-nav-label">${tab.label}</span>
        ${tab.badge && tab.badge > 0 ? `<span class="mobile-nav-badge">${tab.badge > 99 ? '99+' : tab.badge}</span>` : ''}
      </button>
    `).join('');
  }

  private bindTabEvents(): void {
    if (!this.navEl) return;
    this.navEl.querySelectorAll('.mobile-nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabId = (btn as HTMLElement).dataset.tabId;
        if (tabId && tabId !== this.activeTabId) this.setActiveTab(tabId);
      });
    });
  }

  setActiveTab(tabId: string, silent = false): void {
    const nextIndex = this.tabs.findIndex((t) => t.id === tabId);
    if (nextIndex === -1) return;
    this.activeTabId = tabId;
    this.renderTabs();
    this.bindTabEvents();
    if (!silent) this.config.onTabChange(tabId);
  }

  setBadge(tabId: string, count: number): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) { tab.badge = count; this.renderTabs(); this.bindTabEvents(); }
  }

  getActiveTab(): string { return this.activeTabId; }

  private createSwipeIndicator(side: 'left' | 'right'): HTMLElement {
    const el = document.createElement('div');
    el.className = `mobile-nav-swipe-indicator ${side}`;
    return el;
  }

  private bindSwipeEvents(): void {
    document.addEventListener('touchstart', this.onTouchStart, { passive: true });
    document.addEventListener('touchmove', this.onTouchMove, { passive: true });
    document.addEventListener('touchend', this.onTouchEnd, { passive: true });
  }

  private onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (!t) return;
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
    this.touchStartTime = Date.now();
    this.swiping = false;
  };

  private onTouchMove = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;
    if (Math.abs(dx) > 20 && Math.abs(dy) < Math.abs(dx) * 0.6) {
      this.swiping = true;
      if (dx > 0) {
        this.swipeLeftIndicator?.classList.add('visible');
        this.swipeRightIndicator?.classList.remove('visible');
      } else {
        this.swipeRightIndicator?.classList.add('visible');
        this.swipeLeftIndicator?.classList.remove('visible');
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    this.swipeLeftIndicator?.classList.remove('visible');
    this.swipeRightIndicator?.classList.remove('visible');
    if (!this.swiping) return;
    this.swiping = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - this.touchStartX;
    const dt = Date.now() - this.touchStartTime;
    const minDist = 60;
    const maxTime = 400;
    if (Math.abs(dx) < minDist || dt > maxTime) return;
    const currentIndex = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
    if (currentIndex === -1) return;
    if (dx > 0 && currentIndex > 0) {
      const prevTab = this.tabs[currentIndex - 1];
      if (prevTab) this.setActiveTab(prevTab.id);
    } else if (dx < 0 && currentIndex < this.tabs.length - 1) {
      const nextTab = this.tabs[currentIndex + 1];
      if (nextTab) this.setActiveTab(nextTab.id);
    }
  };

  private bindScrollEvents(): void {
    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  private onScroll = (): void => {
    if (this.scrollTicking) return;
    this.scrollTicking = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const delta = currentY - this.lastScrollY;
      if (delta > 10 && currentY > 80 && !this.isHidden) {
        this.navEl?.classList.add('hidden');
        this.isHidden = true;
      } else if (delta < -5 && this.isHidden) {
        this.navEl?.classList.remove('hidden');
        this.isHidden = false;
      }
      this.lastScrollY = currentY;
      this.scrollTicking = false;
    });
  };

  show(): void { this.navEl?.classList.remove('hidden'); this.isHidden = false; }
  hide(): void { this.navEl?.classList.add('hidden'); this.isHidden = true; }

  destroy(): void {
    this.navEl?.remove();
    this.spacerEl?.remove();
    this.swipeLeftIndicator?.remove();
    this.swipeRightIndicator?.remove();
    this.navEl = null;
    this.spacerEl = null;
    this.swipeLeftIndicator = null;
    this.swipeRightIndicator = null;
    document.removeEventListener('touchstart', this.onTouchStart);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('scroll', this.onScroll);
  }
}

export function initMobileViewport(): void {
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'viewport'); document.head.appendChild(meta); }
  meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  if (document.getElementById('mobile-viewport-styles')) return;
  const style = document.createElement('style');
  style.id = 'mobile-viewport-styles';
  style.textContent = `
    @media(max-width:768px){html,body{height:100%;height:-webkit-fill-available;overflow-x:hidden}body{overscroll-behavior-y:none}.app-container,#app,main{padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)}.panel-container,.dashboard-grid{padding:8px!important;gap:8px!important}.dashboard-grid{grid-template-columns:1fr!important}.sidebar,.side-panel{position:fixed!important;z-index:8000;transform:translateX(-100%);transition:transform 300ms ease}.sidebar.open,.side-panel.open{transform:translateX(0)}.panel-title{font-size:14px!important}button,a,[role="button"]{min-height:44px;min-width:44px}.mobile-nav,.panel-header,.tab-bar{user-select:none;-webkit-user-select:none}}
    @media(min-width:769px) and (max-width:1024px){.dashboard-grid{grid-template-columns:repeat(2,1fr)!important}}
  `;
  document.head.appendChild(style);
}

export function isMobile(): boolean {
  return window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;
}

export default MobileNav;
