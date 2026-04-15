// Monitor Browser — homepage / new-tab dashboard.
//
// Renders the live OSINT dashboard. All network requests are routed
// through the preload-exposed `window.monitorApi.fetchIntel(url)` IPC,
// which proxies through the main process and bypasses browser CORS.

'use strict';

(function () {
  const API_BASE = 'https://osint-worldview.vercel.app';
  const API = {
    insights: `${API_BASE}/api/insights`,
    commodities: `${API_BASE}/api/market/commodity-quotes`,
    chokepoints: `${API_BASE}/api/supply-chain/chokepoints`,
  };

  const REFRESH = {
    threat: 5 * 60 * 1000,
    commodity: 10 * 60 * 1000,
    conflict: 10 * 60 * 1000,
  };

  const hasApi = !!(window.monitorApi && typeof window.monitorApi.fetchIntel === 'function');

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  function pad(n) { return n < 10 ? `0${n}` : String(n); }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function relTime(ts) {
    if (!ts) return '';
    const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (delta < 5) return 'just now';
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return `${Math.floor(delta / 86400)}d ago`;
  }
  function parseTs(raw) {
    if (!raw) return null;
    if (typeof raw === 'number') return raw;
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : t;
  }
  function setStatus(panel, variant, text) {
    const el = document.querySelector(`[data-panel="${panel}"] .card-status`);
    if (!el) return;
    el.dataset.status = variant;
    el.textContent = text;
  }

  async function fetchJson(url) {
    if (!hasApi) {
      // Last-ditch fallback if preload somehow didn't attach.
      const res = await fetch(url);
      return res.json();
    }
    const raw = await window.monitorApi.fetchIntel(url);
    return JSON.parse(raw);
  }

  // ---------------------------------------------------------------
  // Clock
  // ---------------------------------------------------------------

  const clockTime = document.getElementById('clock-time');
  const clockDate = document.getElementById('clock-date');
  const footerDate = document.getElementById('footer-date');

  function tickClock() {
    const now = new Date();
    const time = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
    if (clockTime) clockTime.textContent = time;
    if (clockDate) clockDate.textContent = date;
    if (footerDate) footerDate.textContent = date;
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------------------------------------------------------------
  // Search / URL bar
  // ---------------------------------------------------------------

  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');

  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = searchInput.value.trim();
      if (!raw) return;
      const looksLikeUrl =
        /^[a-z]+:\/\//i.test(raw) ||
        (/\./.test(raw) && !/\s/.test(raw) && /^[^\s]+\.[a-z]{2,}/i.test(raw));
      const target = looksLikeUrl
        ? (/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
        : `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
      // Navigate the current tab. Because we're inside the real Chromium
      // webview, this is a first-class navigation — Chromium handles
      // security, cookies, and history.
      window.location.href = target;
    });
  }

  // ---------------------------------------------------------------
  // Source quick-launch cards
  // ---------------------------------------------------------------

  const SOURCES = [
    { name: 'Bellingcat',           url: 'https://www.bellingcat.com',           desc: 'Open-source investigation platform, techniques & casework.' },
    { name: 'ACLED',                url: 'https://acleddata.com',                desc: 'Armed Conflict Location & Event Data, global incidents.' },
    { name: 'Global Incident Map',  url: 'https://www.globalincidentmap.com',    desc: 'Real-time mapping of terrorism, outbreaks, and breaking events.' },
    { name: 'Flightradar24',        url: 'https://www.flightradar24.com',        desc: 'Live global flight tracking, ADS-B coverage.' },
    { name: 'MarineTraffic',        url: 'https://www.marinetraffic.com',        desc: 'Live AIS tracking of commercial vessels worldwide.' },
    { name: 'OSINT Framework',      url: 'https://osintframework.com',           desc: 'Curated directory of OSINT tools organised by category.' },
    { name: 'IntelligenceX',        url: 'https://intelx.io',                    desc: 'Darknet, breach data, and document search engine.' },
    { name: 'Shodan',               url: 'https://www.shodan.io',                desc: 'Search engine for internet-connected devices and banners.' },
    { name: 'GreyNoise',            url: 'https://viz.greynoise.io',             desc: 'Internet background noise intel, scanner fingerprinting.' },
    { name: 'Recorded Future Free', url: 'https://www.recordedfuture.com/free-tools', desc: 'Free threat-intel lookup tools and daily reporting.' },
    { name: 'ISW',                  url: 'https://www.understandingwar.org',     desc: 'Institute for the Study of War — conflict assessments & maps.' },
    { name: 'GDELT',                url: 'https://www.gdeltproject.org',         desc: 'Global events database, 100+ languages, near real-time.' },
  ];

  const sourcesEl = document.getElementById('sources');
  if (sourcesEl) {
    for (const src of SOURCES) {
      const card = document.createElement('a');
      card.className = 'source-card';
      card.href = src.url;
      card.rel = 'noopener';
      card.innerHTML = `
        <div class="source-title"></div>
        <div class="source-url"></div>
        <div class="source-desc"></div>
      `;
      card.querySelector('.source-title').textContent = src.name;
      card.querySelector('.source-url').textContent = src.url.replace(/^https?:\/\//, '');
      card.querySelector('.source-desc').textContent = src.desc;
      sourcesEl.appendChild(card);
    }
  }

  // ---------------------------------------------------------------
  // Live threat feed
  // ---------------------------------------------------------------

  const threatBody = document.getElementById('threat-body');

  function normalizeSeverity(raw) {
    const s = String(raw ?? '').toLowerCase();
    if (s.includes('crit')) return 'critical';
    if (s === 'high' || s === '3') return 'high';
    if (s.startsWith('med') || s === '2') return 'medium';
    if (s === 'low' || s === '1') return 'low';
    return 'info';
  }

  function extractItems(payload, keys) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (const k of keys) {
      if (Array.isArray(payload[k])) return payload[k];
    }
    return [];
  }

  async function loadThreatFeed() {
    if (!threatBody) return;
    setStatus('threat', 'loading', 'SYNC…');
    try {
      const payload = await fetchJson(API.insights);
      const items = extractItems(payload, ['items', 'insights', 'data']).slice(0, 6);
      if (items.length === 0) {
        threatBody.innerHTML = '<div class="empty">No signals reported.</div>';
      } else {
        threatBody.innerHTML = '';
        for (const it of items) {
          const el = document.createElement('div');
          el.className = 'threat-item';
          el.dataset.severity = normalizeSeverity(it.severity);
          const ts = parseTs(it.published_at ?? it.publishedAt ?? it.timestamp);
          el.innerHTML = `
            <span class="threat-bar"></span>
            <div class="threat-body">
              <div class="threat-head"></div>
              <div class="threat-meta">
                <span class="threat-source"></span>
                <span class="threat-time"></span>
              </div>
            </div>
          `;
          el.querySelector('.threat-head').textContent =
            it.headline ?? it.title ?? 'Untitled signal';
          el.querySelector('.threat-source').textContent =
            it.source ?? it.region ?? 'OSINT';
          el.querySelector('.threat-time').textContent = ts ? relTime(ts) : '—';
          const url = it.url ?? it.link;
          if (url) {
            el.addEventListener('click', () => {
              window.location.href = url;
            });
          }
          threatBody.appendChild(el);
        }
      }
      setStatus('threat', 'ok', 'LIVE');
    } catch (err) {
      renderError(threatBody, err, loadThreatFeed);
      setStatus('threat', 'error', 'OFFLINE');
    }
  }

  // ---------------------------------------------------------------
  // Commodity pulse
  // ---------------------------------------------------------------

  const commodityBody = document.getElementById('commodity-body');

  function toNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/[%,+]/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  function fmtPrice(v) {
    const n = toNum(v);
    if (n === null) return '—';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (Math.abs(n) >= 10)   return n.toFixed(2);
    return n.toFixed(3);
  }
  function fmtPct(n) {
    if (n === null) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(2)}%`;
  }

  async function loadCommodities() {
    if (!commodityBody) return;
    setStatus('commodity', 'loading', 'SYNC…');
    try {
      const payload = await fetchJson(API.commodities);
      const items = extractItems(payload, ['quotes', 'data', 'items']).slice(0, 6);
      if (items.length === 0) {
        commodityBody.innerHTML = '<div class="empty">No quotes available.</div>';
      } else {
        commodityBody.innerHTML = '<div class="commodity-grid"></div>';
        const grid = commodityBody.querySelector('.commodity-grid');
        for (const q of items) {
          const pct = toNum(q.changePercent ?? q.change_percent ?? q.change);
          const dir = pct === null ? 0 : pct >= 0 ? 1 : -1;
          const cell = document.createElement('div');
          cell.className = 'commodity-cell';
          cell.dataset.dir = String(dir);
          cell.innerHTML = `
            <div class="commodity-name"></div>
            <div class="commodity-price"></div>
            <div class="commodity-change">
              <span class="commodity-arrow"></span>
              <span class="commodity-pct"></span>
            </div>
          `;
          cell.querySelector('.commodity-name').textContent =
            q.name ?? q.symbol ?? '—';
          cell.querySelector('.commodity-price').textContent = fmtPrice(q.price);
          cell.querySelector('.commodity-arrow').textContent =
            dir > 0 ? '▲' : dir < 0 ? '▼' : '·';
          cell.querySelector('.commodity-pct').textContent = fmtPct(pct);
          grid.appendChild(cell);
        }
      }
      setStatus('commodity', 'ok', 'LIVE');
    } catch (err) {
      renderError(commodityBody, err, loadCommodities);
      setStatus('commodity', 'error', 'OFFLINE');
    }
  }

  // ---------------------------------------------------------------
  // Active conflicts
  // ---------------------------------------------------------------

  const conflictBody = document.getElementById('conflict-body');

  function normalizeRisk(raw) {
    const s = String(raw ?? '').toLowerCase();
    if (s.includes('crit') || s.includes('severe')) return 'critical';
    if (s.includes('high')) return 'high';
    if (s.includes('med') || s.includes('elev')) return 'medium';
    if (s.includes('low') || s.includes('stable')) return 'low';
    return 'unknown';
  }

  async function loadConflicts() {
    if (!conflictBody) return;
    setStatus('conflict', 'loading', 'SYNC…');
    try {
      const payload = await fetchJson(API.chokepoints);
      const items = extractItems(payload, ['chokepoints', 'items', 'data']).slice(0, 6);
      if (items.length === 0) {
        conflictBody.innerHTML = '<div class="empty">No active chokepoints reported.</div>';
      } else {
        conflictBody.innerHTML = '';
        for (const it of items) {
          const risk = normalizeRisk(it.risk ?? it.risk_level ?? it.riskLevel ?? it.status);
          const updated = parseTs(it.updated_at ?? it.updatedAt ?? it.last_updated);
          const el = document.createElement('div');
          el.className = 'conflict-item';
          el.dataset.risk = risk;
          el.innerHTML = `
            <div class="conflict-top">
              <span class="conflict-name"></span>
              <span class="conflict-pill"></span>
            </div>
            <div class="conflict-sub">
              <span class="conflict-region"></span>
              <span class="conflict-time"></span>
            </div>
          `;
          el.querySelector('.conflict-name').textContent = it.name ?? it.title ?? 'Chokepoint';
          const pill = el.querySelector('.conflict-pill');
          pill.textContent = risk.toUpperCase();
          pill.dataset.risk = risk;
          el.querySelector('.conflict-region').textContent = it.region ?? '—';
          el.querySelector('.conflict-time').textContent = updated ? relTime(updated) : 'unknown';
          conflictBody.appendChild(el);
        }
      }
      setStatus('conflict', 'ok', 'LIVE');
    } catch (err) {
      renderError(conflictBody, err, loadConflicts);
      setStatus('conflict', 'error', 'OFFLINE');
    }
  }

  function renderError(container, err, retryFn) {
    if (!container) return;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'error';
    wrap.textContent = `Intel unavailable — ${err.message || 'fetch failed'}`;
    const retry = document.createElement('button');
    retry.className = 'retry-btn';
    retry.type = 'button';
    retry.textContent = 'Retry now';
    retry.addEventListener('click', () => retryFn());
    wrap.appendChild(document.createElement('br'));
    wrap.appendChild(retry);
    container.appendChild(wrap);
  }

  // ---------------------------------------------------------------
  // OSINT toolkit
  // ---------------------------------------------------------------

  const DNS_TYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 257: 'CAA' };

  const toolkitBody = document.getElementById('toolkit-body');
  const toolkitTabs = document.getElementById('toolkit-tabs');
  let activeTool = 'domain';

  function renderToolkit() {
    if (!toolkitBody) return;
    toolkitBody.innerHTML = '';
    switch (activeTool) {
      case 'domain': return renderDomainTool();
      case 'ip':     return renderIpTool();
      case 'dns':    return renderDnsTool();
      case 'subnet': return renderSubnetTool();
    }
  }

  function buildToolForm(placeholder, onSubmit, extra) {
    const wrap = document.createElement('div');
    wrap.className = 'toolkit-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    wrap.appendChild(input);

    let extraControl = null;
    if (extra) {
      extraControl = extra();
      wrap.appendChild(extraControl);
    }

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'toolkit-submit';
    submit.textContent = 'Run';
    wrap.appendChild(submit);

    toolkitBody.appendChild(wrap);

    const out = document.createElement('div');
    out.className = 'toolkit-output';
    toolkitBody.appendChild(out);

    const go = async () => {
      const value = input.value.trim();
      if (!value) return;
      out.innerHTML = '<div class="empty">Querying…</div>';
      try {
        out.innerHTML = await onSubmit(value, extraControl ? extraControl.value : undefined);
      } catch (err) {
        out.innerHTML = `<div class="error">${esc(err.message || 'Lookup failed')}</div>`;
      }
    };
    submit.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  function renderDomainTool() {
    buildToolForm('example.com', async (value) => {
      const data = await fetchJson(`https://dns.google/resolve?name=${encodeURIComponent(value)}&type=ANY`);
      return formatDns(data);
    });
  }

  function renderIpTool() {
    buildToolForm('8.8.8.8', async (value) => {
      const data = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(value)}`);
      return formatIp(data);
    });
  }

  function renderDnsTool() {
    buildToolForm('example.com', async (value, type) => {
      const data = await fetchJson(`https://dns.google/resolve?name=${encodeURIComponent(value)}&type=${type || 'A'}`);
      return formatDns(data);
    }, () => {
      const sel = document.createElement('select');
      ['A','AAAA','MX','TXT','NS','CNAME','SOA','CAA'].forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        sel.appendChild(opt);
      });
      return sel;
    });
  }

  function renderSubnetTool() {
    buildToolForm('192.168.1.0/24', async (value) => {
      return calcSubnet(value);
    });
  }

  function formatDns(data) {
    if (!data || !Array.isArray(data.Answer) || data.Answer.length === 0) {
      return '<div class="empty">No records returned.</div>';
    }
    const rows = data.Answer.map((a) => {
      const type = DNS_TYPES[a.type] ?? String(a.type);
      return `<tr>
        <td class="toolkit-cell-type">${esc(type)}</td>
        <td class="toolkit-cell-ttl">${esc(String(a.TTL))}</td>
        <td class="toolkit-cell-data">${esc(a.data)}</td>
      </tr>`;
    }).join('');
    return `<table class="toolkit-table">
      <thead><tr><th>Type</th><th>TTL</th><th>Data</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function formatIp(data) {
    if (!data || data.status !== 'success') {
      return `<div class="error">Lookup failed: ${esc(data && data.message ? data.message : 'unknown')}</div>`;
    }
    const rows = [
      ['Query',    data.query ?? '—'],
      ['Country',  `${data.country ?? '—'}${data.countryCode ? ` (${data.countryCode})` : ''}`],
      ['Region',   `${data.regionName ?? '—'}${data.region ? ` (${data.region})` : ''}`],
      ['City',     data.city ?? '—'],
      ['ZIP',      data.zip ?? '—'],
      ['ISP',      data.isp ?? '—'],
      ['Org',      data.org ?? '—'],
      ['AS',       data.as ?? '—'],
      ['Lat/Lon',  (data.lat !== undefined && data.lon !== undefined) ? `${data.lat}, ${data.lon}` : '—'],
      ['Timezone', data.timezone ?? '—'],
    ];
    return `<dl class="toolkit-dl">${rows
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join('')}</dl>`;
  }

  function calcSubnet(cidr) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
    if (!m) throw new Error('Expected format: 192.168.1.0/24');
    const oct = [m[1], m[2], m[3], m[4]].map(Number);
    const pfx = Number(m[5]);
    if (oct.some((n) => n < 0 || n > 255) || pfx < 0 || pfx > 32) {
      throw new Error('IP octets 0-255 and prefix 0-32.');
    }
    const ipInt = ((oct[0] << 24) | (oct[1] << 16) | (oct[2] << 8) | oct[3]) >>> 0;
    const mask  = pfx === 0 ? 0 : (0xffffffff << (32 - pfx)) >>> 0;
    const net   = (ipInt & mask) >>> 0;
    const bcast = (net | (~mask >>> 0)) >>> 0;
    const usable = pfx >= 31 ? 2 ** (32 - pfx) : 2 ** (32 - pfx) - 2;
    const first = pfx >= 31 ? net : net + 1;
    const last  = pfx >= 31 ? bcast : bcast - 1;
    const ip = (n) => `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
    const rows = [
      ['Network',      ip(net)],
      ['Broadcast',    ip(bcast)],
      ['Netmask',      ip(mask)],
      ['Prefix',       `/${pfx}`],
      ['Host range',   `${ip(first)} – ${ip(last)}`],
      ['Usable hosts', usable.toLocaleString()],
    ];
    return `<dl class="toolkit-dl">${rows
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join('')}</dl>`;
  }

  if (toolkitTabs) {
    toolkitTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.toolkit-tab');
      if (!btn) return;
      const tool = btn.dataset.tool;
      if (!tool || tool === activeTool) return;
      activeTool = tool;
      Array.from(toolkitTabs.querySelectorAll('.toolkit-tab')).forEach((el) =>
        el.classList.toggle('is-active', el.dataset.tool === activeTool),
      );
      renderToolkit();
    });
  }
  renderToolkit();

  // ---------------------------------------------------------------
  // Boot: load feeds and schedule refreshes
  // ---------------------------------------------------------------

  if (!hasApi) {
    // Preload missing — show error state everywhere but keep page usable.
    const msg = 'Intel proxy unavailable — running outside Monitor Browser?';
    [threatBody, commodityBody, conflictBody].forEach((el) => {
      if (el) el.innerHTML = `<div class="error">${esc(msg)}</div>`;
    });
    ['threat','commodity','conflict'].forEach((p) => setStatus(p, 'error', 'OFFLINE'));
  } else {
    loadThreatFeed();
    loadCommodities();
    loadConflicts();
    setInterval(loadThreatFeed,  REFRESH.threat);
    setInterval(loadCommodities, REFRESH.commodity);
    setInterval(loadConflicts,   REFRESH.conflict);
  }
})();
