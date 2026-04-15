import { fetchIntel, fetchIntelJson } from '../browser/webview-bridge';

export interface PanelOptions {
  pollIntervalMs?: number;
  startExpanded?: boolean;
}

/**
 * Abstract base class for intel panels in the sidebar.
 *
 * Each concrete panel implements `buildUI()` (one-shot DOM construction) and
 * `fetchData()` (periodic refresh). The base class handles:
 *   - collapsible card chrome (header + content + toggle)
 *   - polling lifecycle (start/stop)
 *   - graceful fetch failure state
 */
export abstract class IntelPanel {
  abstract readonly id: string;
  abstract readonly title: string;
  abstract readonly icon: string;

  protected container: HTMLElement;
  protected contentEl!: HTMLElement;
  protected statusEl!: HTMLElement;
  protected isExpanded = true;
  protected isLoading = false;
  protected hasError = false;
  protected lastUpdated: number | null = null;

  private pollTimer: number | null = null;
  private pollIntervalMs = 0;
  private rootEl: HTMLElement;

  constructor(container: HTMLElement, options: PanelOptions = {}) {
    this.container = container;
    this.isExpanded = options.startExpanded ?? true;
    this.pollIntervalMs = options.pollIntervalMs ?? 0;
    this.rootEl = document.createElement('section');
  }

  protected abstract buildUI(): void;
  protected abstract fetchData(): Promise<void>;

  render(): HTMLElement {
    this.rootEl.className = 'intel-panel';
    this.rootEl.dataset['panelId'] = this.id;
    this.rootEl.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'intel-panel-header';
    header.addEventListener('click', () => this.toggle());

    const titleWrap = document.createElement('div');
    titleWrap.className = 'intel-panel-title';

    const iconEl = document.createElement('span');
    iconEl.className = 'intel-panel-icon';
    iconEl.textContent = this.icon;
    titleWrap.appendChild(iconEl);

    const titleText = document.createElement('span');
    titleText.className = 'intel-panel-title-text';
    titleText.textContent = this.title;
    titleWrap.appendChild(titleText);

    header.appendChild(titleWrap);

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'intel-panel-status';
    header.appendChild(this.statusEl);

    const chevron = document.createElement('span');
    chevron.className = 'intel-panel-chevron';
    chevron.textContent = '▾';
    header.appendChild(chevron);

    this.rootEl.appendChild(header);

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'intel-panel-content';
    this.rootEl.appendChild(this.contentEl);

    this.applyExpandedState();
    this.buildUI();
    this.updateStatus();

    return this.rootEl;
  }

  toggle(): void {
    this.isExpanded = !this.isExpanded;
    this.applyExpandedState();
  }

  private applyExpandedState(): void {
    this.rootEl.classList.toggle('is-collapsed', !this.isExpanded);
  }

  protected setStatus(text: string, variant: 'idle' | 'loading' | 'error' | 'ok' = 'idle'): void {
    this.statusEl.dataset['variant'] = variant;
    this.statusEl.textContent = text;
  }

  protected updateStatus(): void {
    if (this.isLoading) {
      this.setStatus('SYNC…', 'loading');
    } else if (this.hasError) {
      this.setStatus('OFFLINE', 'error');
    } else if (this.lastUpdated) {
      this.setStatus(relativeTime(this.lastUpdated), 'ok');
    } else {
      this.setStatus('—', 'idle');
    }
  }

  protected renderErrorState(message: string): void {
    this.contentEl.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'intel-panel-error';
    err.textContent = `Intel unavailable — ${message}`;
    const retry = document.createElement('button');
    retry.className = 'intel-panel-retry';
    retry.type = 'button';
    retry.textContent = 'Retry now';
    retry.addEventListener('click', () => void this.refresh());
    err.appendChild(retry);
    this.contentEl.appendChild(err);
  }

  protected renderLoadingState(): void {
    if (this.contentEl.childElementCount === 0) {
      const shimmer = document.createElement('div');
      shimmer.className = 'intel-panel-shimmer';
      for (let i = 0; i < 3; i++) {
        const row = document.createElement('div');
        row.className = 'intel-panel-shimmer-row';
        shimmer.appendChild(row);
      }
      this.contentEl.appendChild(shimmer);
    }
  }

  async refresh(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;
    this.updateStatus();
    try {
      await this.fetchData();
      this.hasError = false;
      this.lastUpdated = Date.now();
    } catch (err) {
      this.hasError = true;
      this.renderErrorState((err as Error).message || 'fetch failed');
      // Retry once after 30s on failure as per spec.
      window.setTimeout(() => void this.refresh(), 30_000);
    } finally {
      this.isLoading = false;
      this.updateStatus();
    }
  }

  startPolling(intervalMs?: number): void {
    this.stopPolling();
    if (intervalMs !== undefined) this.pollIntervalMs = intervalMs;
    if (this.pollIntervalMs <= 0) {
      void this.refresh();
      return;
    }
    void this.refresh();
    this.pollTimer = window.setInterval(() => {
      void this.refresh();
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  destroy(): void {
    this.stopPolling();
    this.rootEl.remove();
  }

  protected async fetchIntel(url: string): Promise<string> {
    return fetchIntel(url);
  }

  protected async fetchIntelJson<T>(url: string): Promise<T> {
    return fetchIntelJson<T>(url);
  }
}

function relativeTime(ts: number): string {
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86_400)}d ago`;
}

export function formatRelative(ts: number): string {
  return relativeTime(ts);
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
