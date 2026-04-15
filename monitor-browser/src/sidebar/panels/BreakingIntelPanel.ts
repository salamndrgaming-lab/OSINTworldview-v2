import { bus, type BreakingAlert } from '../../events/bus';
import { IntelPanel, escapeHtml, formatRelative } from '../panel-base';

const MAX_ALERTS = 50;

export class BreakingIntelPanel extends IntelPanel {
  readonly id = 'breaking-intel';
  readonly title = 'Breaking Intel';
  readonly icon = '⚠';

  private alerts: BreakingAlert[] = [];
  private readIds = new Set<string>();
  private listEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement) {
    super(container, { pollIntervalMs: 0 });
  }

  protected buildUI(): void {
    this.contentEl.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'breaking-toolbar';

    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'breaking-badge';
    this.badgeEl.textContent = '0 unread';
    toolbar.appendChild(this.badgeEl);

    const markAll = document.createElement('button');
    markAll.type = 'button';
    markAll.className = 'breaking-mark-all';
    markAll.textContent = 'Mark all read';
    markAll.addEventListener('click', () => this.markAllRead());
    toolbar.appendChild(markAll);

    this.contentEl.appendChild(toolbar);

    this.listEl = document.createElement('ul');
    this.listEl.className = 'breaking-list';
    this.contentEl.appendChild(this.listEl);

    this.renderEmpty();

    this.unsubscribe?.();
    this.unsubscribe = bus.on('intel:breaking', ({ alert }) => this.pushAlert(alert));
  }

  protected async fetchData(): Promise<void> {
    // This panel is event-driven, not fetch-driven.
    return Promise.resolve();
  }

  pushAlert(alert: BreakingAlert): void {
    this.alerts.unshift(alert);
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts.length = MAX_ALERTS;
    }
    this.renderList();
    this.emitUnread();
  }

  private renderList(): void {
    this.listEl.innerHTML = '';
    if (this.alerts.length === 0) {
      this.renderEmpty();
      return;
    }
    for (const alert of this.alerts) {
      this.listEl.appendChild(this.renderAlert(alert));
    }
  }

  private renderEmpty(): void {
    const empty = document.createElement('li');
    empty.className = 'breaking-empty';
    empty.textContent = 'No breaking intel. Feeds will push here as they arrive.';
    this.listEl.appendChild(empty);
  }

  private renderAlert(alert: BreakingAlert): HTMLElement {
    const el = document.createElement('li');
    el.className = 'breaking-item';
    el.dataset['severity'] = alert.severity;
    if (!this.readIds.has(alert.id)) el.classList.add('is-unread');

    const dot = document.createElement('span');
    dot.className = 'breaking-dot';
    el.appendChild(dot);

    const body = document.createElement('div');
    body.className = 'breaking-body';

    const headline = document.createElement('div');
    headline.className = 'breaking-headline';
    headline.textContent = alert.headline;
    body.appendChild(headline);

    const meta = document.createElement('div');
    meta.className = 'breaking-meta';
    meta.innerHTML = `
      <span>${escapeHtml(alert.source)}</span>
      <span>${escapeHtml(formatRelative(alert.timestamp))}</span>
    `;
    body.appendChild(meta);

    el.appendChild(body);

    el.addEventListener('click', () => {
      this.readIds.add(alert.id);
      el.classList.remove('is-unread');
      if (alert.url) {
        bus.emit('nav:navigate', { url: alert.url });
      }
      this.emitUnread();
    });

    return el;
  }

  private markAllRead(): void {
    for (const alert of this.alerts) this.readIds.add(alert.id);
    this.renderList();
    this.emitUnread();
  }

  private emitUnread(): void {
    const unread = this.alerts.filter((a) => !this.readIds.has(a.id)).length;
    this.badgeEl.textContent = unread === 1 ? '1 unread' : `${unread} unread`;
    bus.emit('intel:count', { unread });
  }

  override destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }
}
