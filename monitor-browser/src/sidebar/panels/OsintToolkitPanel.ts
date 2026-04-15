import { IntelPanel, escapeHtml } from '../panel-base';

type ToolId = 'domain' | 'ip' | 'dns' | 'subnet';

interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DnsResponse {
  Status: number;
  Answer?: DnsAnswer[];
  Authority?: DnsAnswer[];
  Question?: Array<{ name: string; type: number }>;
}

interface IpGeoResponse {
  status: 'success' | 'fail';
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  query?: string;
  message?: string;
}

const DNS_TYPES: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  257: 'CAA',
};

export class OsintToolkitPanel extends IntelPanel {
  readonly id = 'osint-toolkit';
  readonly title = 'OSINT Toolkit';
  readonly icon = '⚒';

  private activeTool: ToolId = 'domain';
  private toolContent!: HTMLElement;

  constructor(container: HTMLElement) {
    super(container, { pollIntervalMs: 0, startExpanded: false });
  }

  protected buildUI(): void {
    this.contentEl.innerHTML = '';

    const tabs = document.createElement('div');
    tabs.className = 'toolkit-tabs';
    (
      [
        ['domain', 'Domain'],
        ['ip', 'IP Geo'],
        ['dns', 'DNS'],
        ['subnet', 'Subnet'],
      ] as const
    ).forEach(([id, label]) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'toolkit-tab';
      tab.dataset['tool'] = id;
      tab.textContent = label;
      if (id === this.activeTool) tab.classList.add('is-active');
      tab.addEventListener('click', () => {
        this.activeTool = id;
        Array.from(tabs.querySelectorAll('.toolkit-tab')).forEach((el) =>
          el.classList.toggle('is-active', (el as HTMLElement).dataset['tool'] === id),
        );
        this.renderTool();
      });
      tabs.appendChild(tab);
    });
    this.contentEl.appendChild(tabs);

    this.toolContent = document.createElement('div');
    this.toolContent.className = 'toolkit-content';
    this.contentEl.appendChild(this.toolContent);

    this.renderTool();
  }

  protected async fetchData(): Promise<void> {
    return Promise.resolve();
  }

  private renderTool(): void {
    this.toolContent.innerHTML = '';
    switch (this.activeTool) {
      case 'domain':
        this.renderDomainTool();
        break;
      case 'ip':
        this.renderIpTool();
        break;
      case 'dns':
        this.renderDnsTool();
        break;
      case 'subnet':
        this.renderSubnetTool();
        break;
    }
  }

  private renderDomainTool(): void {
    const form = this.buildForm('Domain name', 'example.com', async (value) => {
      const url = `https://dns.google/resolve?name=${encodeURIComponent(value)}&type=ANY`;
      const raw = await this.fetchIntel(url);
      return formatDnsResponse(JSON.parse(raw) as DnsResponse);
    });
    this.toolContent.appendChild(form);
  }

  private renderIpTool(): void {
    const form = this.buildForm('IP address', '8.8.8.8', async (value) => {
      const url = `http://ip-api.com/json/${encodeURIComponent(value)}`;
      const raw = await this.fetchIntel(url);
      return formatIpGeo(JSON.parse(raw) as IpGeoResponse);
    });
    this.toolContent.appendChild(form);
  }

  private renderDnsTool(): void {
    const wrap = document.createElement('div');
    wrap.className = 'toolkit-form';

    const row = document.createElement('div');
    row.className = 'toolkit-row';

    const input = document.createElement('input');
    input.className = 'toolkit-input';
    input.placeholder = 'example.com';
    input.type = 'text';

    const select = document.createElement('select');
    select.className = 'toolkit-select';
    ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'].forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      select.appendChild(opt);
    });

    const submit = document.createElement('button');
    submit.className = 'toolkit-submit';
    submit.type = 'button';
    submit.textContent = 'Lookup';

    row.appendChild(input);
    row.appendChild(select);
    row.appendChild(submit);
    wrap.appendChild(row);

    const out = document.createElement('div');
    out.className = 'toolkit-output';
    wrap.appendChild(out);

    const run = async (): Promise<void> => {
      const domain = input.value.trim();
      if (!domain) return;
      out.innerHTML = '<span class="toolkit-spinner">Querying…</span>';
      try {
        const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${select.value}`;
        const raw = await this.fetchIntel(url);
        out.innerHTML = formatDnsResponse(JSON.parse(raw) as DnsResponse);
      } catch (err) {
        out.innerHTML = `<div class="toolkit-error">${escapeHtml((err as Error).message)}</div>`;
      }
    };

    submit.addEventListener('click', () => void run());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void run();
    });

    this.toolContent.appendChild(wrap);
  }

  private renderSubnetTool(): void {
    const wrap = document.createElement('div');
    wrap.className = 'toolkit-form';

    const row = document.createElement('div');
    row.className = 'toolkit-row';

    const input = document.createElement('input');
    input.className = 'toolkit-input';
    input.placeholder = '192.168.1.0/24';
    input.type = 'text';

    const submit = document.createElement('button');
    submit.className = 'toolkit-submit';
    submit.type = 'button';
    submit.textContent = 'Calculate';

    row.appendChild(input);
    row.appendChild(submit);
    wrap.appendChild(row);

    const out = document.createElement('div');
    out.className = 'toolkit-output';
    wrap.appendChild(out);

    const run = (): void => {
      const cidr = input.value.trim();
      if (!cidr) return;
      try {
        out.innerHTML = calculateSubnet(cidr);
      } catch (err) {
        out.innerHTML = `<div class="toolkit-error">${escapeHtml((err as Error).message)}</div>`;
      }
    };

    submit.addEventListener('click', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') run();
    });

    this.toolContent.appendChild(wrap);
  }

  private buildForm(
    placeholder: string,
    sample: string,
    runner: (value: string) => Promise<string>,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'toolkit-form';

    const row = document.createElement('div');
    row.className = 'toolkit-row';

    const input = document.createElement('input');
    input.className = 'toolkit-input';
    input.type = 'text';
    input.placeholder = sample;
    input.setAttribute('aria-label', placeholder);

    const submit = document.createElement('button');
    submit.className = 'toolkit-submit';
    submit.type = 'button';
    submit.textContent = 'Run';

    row.appendChild(input);
    row.appendChild(submit);
    wrap.appendChild(row);

    const out = document.createElement('div');
    out.className = 'toolkit-output';
    wrap.appendChild(out);

    const run = async (): Promise<void> => {
      const value = input.value.trim();
      if (!value) return;
      out.innerHTML = '<span class="toolkit-spinner">Querying…</span>';
      try {
        out.innerHTML = await runner(value);
      } catch (err) {
        out.innerHTML = `<div class="toolkit-error">${escapeHtml((err as Error).message)}</div>`;
      }
    };

    submit.addEventListener('click', () => void run());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void run();
    });

    return wrap;
  }
}

function formatDnsResponse(data: DnsResponse): string {
  if (!data.Answer || data.Answer.length === 0) {
    return '<div class="toolkit-empty">No records returned.</div>';
  }
  const rows = data.Answer
    .map((a) => {
      const type = DNS_TYPES[a.type] ?? String(a.type);
      return `<tr>
        <td class="toolkit-cell-type">${escapeHtml(type)}</td>
        <td class="toolkit-cell-ttl">${escapeHtml(String(a.TTL))}</td>
        <td class="toolkit-cell-data">${escapeHtml(a.data)}</td>
      </tr>`;
    })
    .join('');
  return `<table class="toolkit-table">
    <thead><tr><th>Type</th><th>TTL</th><th>Data</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function formatIpGeo(data: IpGeoResponse): string {
  if (data.status !== 'success') {
    return `<div class="toolkit-error">Lookup failed: ${escapeHtml(data.message ?? 'unknown')}</div>`;
  }
  const rows: Array<[string, string]> = [
    ['Query', data.query ?? '—'],
    ['Country', `${data.country ?? '—'}${data.countryCode ? ` (${data.countryCode})` : ''}`],
    ['Region', `${data.regionName ?? '—'}${data.region ? ` (${data.region})` : ''}`],
    ['City', data.city ?? '—'],
    ['ZIP', data.zip ?? '—'],
    ['ISP', data.isp ?? '—'],
    ['Org', data.org ?? '—'],
    ['AS', data.as ?? '—'],
    ['Lat/Lon', data.lat !== undefined && data.lon !== undefined ? `${data.lat}, ${data.lon}` : '—'],
    ['Timezone', data.timezone ?? '—'],
  ];
  return `<dl class="toolkit-dl">${rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('')}</dl>`;
}

function calculateSubnet(cidr: string): string {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) throw new Error('Expected format: 192.168.1.0/24');
  const [, o1, o2, o3, o4, pfx] = match;
  const octets = [o1, o2, o3, o4].map(Number);
  const prefix = Number(pfx);
  if (octets.some((n) => n < 0 || n > 255) || prefix < 0 || prefix > 32) {
    throw new Error('IP octets 0-255 and prefix 0-32.');
  }
  const ipInt = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  const maskInt = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipInt & maskInt) >>> 0;
  const broadcast = (network | (~maskInt >>> 0)) >>> 0;
  const totalHosts = prefix >= 31 ? 2 ** (32 - prefix) : 2 ** (32 - prefix) - 2;
  const firstHost = prefix >= 31 ? network : network + 1;
  const lastHost = prefix >= 31 ? broadcast : broadcast - 1;

  const rows: Array<[string, string]> = [
    ['Network', intToIp(network)],
    ['Broadcast', intToIp(broadcast)],
    ['Netmask', intToIp(maskInt)],
    ['Prefix', `/${prefix}`],
    ['Host range', `${intToIp(firstHost)} – ${intToIp(lastHost)}`],
    ['Usable hosts', totalHosts.toLocaleString()],
  ];
  return `<dl class="toolkit-dl">${rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('')}</dl>`;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}
