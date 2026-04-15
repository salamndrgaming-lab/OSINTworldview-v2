import { bus, type SidebarMode } from '../events/bus';
import { panelRegistry } from './panel-registry';

/**
 * Sidebar — collapsible intelligence rail.
 *
 * Modes:
 *   - expanded  : 280px pinned, webview shrinks
 *   - collapsed : 48px icon rail
 *   - overlay   : full-height floating panel over webview with backdrop
 *
 * All transitions use CSS `transform` (not width) for 60fps compositing.
 */
export class Sidebar {
  private root: HTMLElement;
  private panelsEl!: HTMLElement;
  private railEl!: HTMLElement;
  private backdrop!: HTMLElement;
  private mode: SidebarMode = 'expanded';

  constructor(root: HTMLElement) {
    this.root = root;
  }

  get currentMode(): SidebarMode {
    return this.mode;
  }

  mount(): void {
    this.root.classList.add('sidebar');
    this.root.innerHTML = '';

    // Backdrop is attached to body so it covers the entire window in overlay mode.
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'sidebar-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', () => this.setMode('collapsed'));
    document.body.appendChild(this.backdrop);

    this.railEl = document.createElement('div');
    this.railEl.className = 'sidebar-rail';
    this.railEl.appendChild(this.buildRailButton('⚡', 'Expand Intel panel', () => this.setMode('expanded')));
    this.railEl.appendChild(this.buildRailButton('◈', 'Open overlay', () => this.setMode('overlay')));
    this.root.appendChild(this.railEl);

    const body = document.createElement('div');
    body.className = 'sidebar-body';

    const header = document.createElement('header');
    header.className = 'sidebar-header';

    const heading = document.createElement('div');
    heading.className = 'sidebar-heading';
    const wordmark = document.createElement('span');
    wordmark.className = 'sidebar-wordmark';
    wordmark.textContent = 'INTEL';
    const divider = document.createElement('span');
    divider.className = 'sidebar-wordmark-divider';
    divider.textContent = '·';
    const subheading = document.createElement('span');
    subheading.className = 'sidebar-subheading';
    subheading.textContent = 'LIVE FEED';
    heading.appendChild(wordmark);
    heading.appendChild(divider);
    heading.appendChild(subheading);
    header.appendChild(heading);

    const controls = document.createElement('div');
    controls.className = 'sidebar-controls';

    const overlayBtn = document.createElement('button');
    overlayBtn.className = 'sidebar-btn';
    overlayBtn.type = 'button';
    overlayBtn.title = 'Open overlay (⌘I)';
    overlayBtn.setAttribute('aria-label', 'Open overlay');
    overlayBtn.textContent = '◈';
    overlayBtn.addEventListener('click', () => this.setMode('overlay'));
    controls.appendChild(overlayBtn);

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'sidebar-btn';
    collapseBtn.type = 'button';
    collapseBtn.title = 'Collapse (⌘B)';
    collapseBtn.setAttribute('aria-label', 'Collapse');
    collapseBtn.textContent = '«';
    collapseBtn.addEventListener('click', () => this.setMode('collapsed'));
    controls.appendChild(collapseBtn);

    header.appendChild(controls);
    body.appendChild(header);

    this.panelsEl = document.createElement('div');
    this.panelsEl.className = 'sidebar-panels';
    body.appendChild(this.panelsEl);

    const footer = document.createElement('footer');
    footer.className = 'sidebar-footer';
    footer.innerHTML = `
      <button class="sidebar-footer-btn" type="button" data-action="monitor">MONITOR</button>
      <button class="sidebar-footer-btn" type="button" data-action="map">MAP</button>
    `;
    footer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset['action'];
      if (!action) return;
      bus.emit('nav:navigate', {
        url:
          action === 'map'
            ? 'https://osint-worldview.vercel.app/map'
            : 'https://osint-worldview.vercel.app',
      });
    });
    body.appendChild(footer);

    this.root.appendChild(body);

    panelRegistry.mount(this.panelsEl);
    this.applyMode();

    bus.on('shortcut:intel-overlay', () => this.toggleOverlay());
  }

  private buildRailButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'sidebar-rail-btn';
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.textContent = glyph;
    btn.addEventListener('click', onClick);
    return btn;
  }

  setMode(mode: SidebarMode): void {
    this.mode = mode;
    this.applyMode();
    bus.emit('sidebar:toggle', { mode });
  }

  toggle(): void {
    this.setMode(this.mode === 'collapsed' ? 'expanded' : 'collapsed');
  }

  toggleOverlay(): void {
    this.setMode(this.mode === 'overlay' ? 'expanded' : 'overlay');
  }

  private applyMode(): void {
    this.root.dataset['mode'] = this.mode;
    this.root.classList.remove('is-expanded', 'is-collapsed', 'is-overlay');
    this.root.classList.add(`is-${this.mode}`);
    this.backdrop.hidden = this.mode !== 'overlay';
    // Reflect on document root so the layout grid can react.
    document.documentElement.dataset['sidebar'] = this.mode;
  }
}
