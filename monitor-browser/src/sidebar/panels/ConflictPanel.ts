import { IntelPanel, escapeHtml, formatRelative } from '../panel-base';

interface Chokepoint {
  id?: string;
  name?: string;
  title?: string;
  region?: string;
  risk?: string;
  risk_level?: string;
  riskLevel?: string;
  status?: string;
  updated_at?: string;
  updatedAt?: string;
  last_updated?: string;
  description?: string;
}

interface ChokepointsPayload {
  chokepoints?: Chokepoint[];
  items?: Chokepoint[];
  data?: Chokepoint[];
}

const API_BASE =
  (import.meta.env['VITE_INTEL_API_BASE'] as string | undefined) ??
  'https://osint-worldview.vercel.app';
const CHOKEPOINTS_URL = `${API_BASE}/api/supply-chain/chokepoints`;

export class ConflictPanel extends IntelPanel {
  readonly id = 'conflicts';
  readonly title = 'Active Conflicts';
  readonly icon = '⚔';

  private list!: HTMLElement;

  constructor(container: HTMLElement) {
    super(container, { pollIntervalMs: 10 * 60 * 1000 });
  }

  protected buildUI(): void {
    this.contentEl.innerHTML = '';
    this.list = document.createElement('ul');
    this.list.className = 'conflict-list';
    this.contentEl.appendChild(this.list);
    this.renderLoadingState();
  }

  protected async fetchData(): Promise<void> {
    const payload = await this.fetchIntelJson<ChokepointsPayload | Chokepoint[]>(CHOKEPOINTS_URL);
    const items = normalize(payload).slice(0, 8);
    this.renderList(items);
  }

  private renderList(items: Chokepoint[]): void {
    this.list.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'conflict-empty';
      empty.textContent = 'No active chokepoints reported.';
      this.list.appendChild(empty);
      return;
    }
    for (const it of items) {
      this.list.appendChild(this.renderItem(it));
    }
  }

  private renderItem(it: Chokepoint): HTMLElement {
    const el = document.createElement('li');
    el.className = 'conflict-item';

    const risk = normalizeRisk(it.risk ?? it.risk_level ?? it.riskLevel ?? it.status);
    el.dataset['risk'] = risk;

    const top = document.createElement('div');
    top.className = 'conflict-top';

    const name = document.createElement('span');
    name.className = 'conflict-name';
    name.textContent = it.name ?? it.title ?? 'Chokepoint';
    top.appendChild(name);

    const pill = document.createElement('span');
    pill.className = 'conflict-pill';
    pill.dataset['risk'] = risk;
    pill.textContent = risk.toUpperCase();
    top.appendChild(pill);

    el.appendChild(top);

    const sub = document.createElement('div');
    sub.className = 'conflict-sub';
    const updated = parseTs(it);
    sub.innerHTML = `
      <span>${escapeHtml(it.region ?? '—')}</span>
      <span>${escapeHtml(updated ? formatRelative(updated) : 'unknown')}</span>
    `;
    el.appendChild(sub);

    return el;
  }
}

function normalize(payload: ChokepointsPayload | Chokepoint[]): Chokepoint[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.chokepoints)) return payload.chokepoints;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function normalizeRisk(raw: string | undefined): string {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('crit') || s.includes('severe')) return 'critical';
  if (s.includes('high')) return 'high';
  if (s.includes('med') || s.includes('elev')) return 'medium';
  if (s.includes('low') || s.includes('stable')) return 'low';
  return 'unknown';
}

function parseTs(it: Chokepoint): number | null {
  const raw = it.updated_at ?? it.updatedAt ?? it.last_updated;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}
