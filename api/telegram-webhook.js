/**
 * Telegram Bot Webhook Handler v2
 * 
 * Reads directly from Upstash Redis, unwraps nested data formats,
 * and sends formatted intelligence reports via Telegram.
 * 
 * Commands: /report /markets /threats /quakes /status /help
 * 
 * Location: api/telegram-webhook.js
 */

export const config = { runtime: 'edge' };

const NEG_SENTINEL = '__WM_NEG__';

function esc(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeAgo(ts) {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function asArray(val) {
  if (Array.isArray(val)) return val;
  return [];
}

/**
 * Unwrap nested data from Redis.
 * Seed scripts store data as { earthquakes: [...] } or { events: [...] } etc.
 * This function extracts the inner array from the wrapper object.
 */
function unwrap(raw, ...keys) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const key of keys) {
      if (Array.isArray(raw[key])) return raw[key];
    }
    // Try any array value in the object
    for (const val of Object.values(raw)) {
      if (Array.isArray(val)) return val;
    }
  }
  return [];
}

// ── Redis ──

async function getBootstrapData() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { _error: 'Redis not configured' };

  const keyMap = {
    earthquakes:     'seismology:earthquakes:v1',
    marketQuotes:    'market:stocks-bootstrap:v1',
    commodityQuotes: 'market:commodities-bootstrap:v1',
    cyberThreats:    'cyber:threats-bootstrap:v2',
    ucdpEvents:      'conflict:ucdp-events:v1',
    unrestEvents:    'unrest:events:v1',
    insights:        'news:insights:v1',
    predictions:     'prediction:markets-bootstrap:v1',
    outages:         'infra:outages:v1',
    wildfires:       'wildfire:fires:v1',
    chokepoints:     'supply_chain:chokepoints:v4',
    weatherAlerts:   'weather:alerts:v1',
    naturalEvents:   'natural:events:v1',
    cryptoQuotes:    'market:crypto:v1',
    gdeltIntel:      'intelligence:gdelt-intel:v1',
  };

  const names = Object.keys(keyMap);
  const keys = Object.values(keyMap);
  const pipeline = keys.map((k) => ['GET', k]);

  try {
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return { _error: `Redis HTTP ${resp.status}` };

    const results = await resp.json();
    const data = { _keysFound: 0, _keysTotal: keys.length };

    for (let i = 0; i < names.length; i++) {
      const raw = results[i]?.result;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed !== NEG_SENTINEL) {
            data[names[i]] = parsed;
            data._keysFound++;
          }
        } catch { /* skip */ }
      }
    }
    return data;
  } catch (err) {
    return { _error: `Redis fetch failed: ${err.message}` };
  }
}

// ── Reports ──

function generateFullReport(data) {
  const ts = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  const s = [];
  s.push('<b>🌐 INTELLIGENCE BRIEF</b>');
  s.push(`<i>${ts} UTC</i>`);
  s.push(`<i>Redis: ${data._keysFound ?? 0}/${data._keysTotal ?? 0} data sources loaded</i>`);
  s.push('');

  let hasData = false;

  // Insights — stored as array or { insights: [...] }
  const insights = unwrap(data.insights, 'insights');
  if (insights.length > 0) {
    hasData = true;
    s.push('<b>━━ 🧠 EXECUTIVE SUMMARY ━━</b>');
    for (const i of insights.slice(0, 5)) {
      const sev = i.severity ? ` [${String(i.severity).toUpperCase()}]` : '';
      s.push(`▸ ${esc(i.title)}${sev}`);
      if (i.summary) s.push(`  <i>${esc(String(i.summary).slice(0, 150))}</i>`);
    }
    s.push('');
  }

  // Earthquakes — stored as { earthquakes: [...] }
  const quakes = unwrap(data.earthquakes, 'earthquakes')
    .filter(q => (q.magnitude ?? q.mag ?? 0) >= 4.5).slice(0, 5);
  if (quakes.length > 0) {
    hasData = true;
    s.push('<b>━━ 🌍 SEISMIC ACTIVITY ━━</b>');
    for (const q of quakes) {
      const mag = q.magnitude ?? q.mag ?? 0;
      const place = q.place ?? 'Unknown';
      const time = q.occurredAt ? timeAgo(q.occurredAt) : '';
      s.push(`▸ <b>M${Number(mag).toFixed(1)}</b> — ${esc(place)} ${time}`);
    }
    s.push('');
  }

  // Markets — stored as { quotes: [...] }
  const mktQuotes = unwrap(data.marketQuotes, 'quotes', 'marketQuotes');
  const cmdQuotes = unwrap(data.commodityQuotes, 'quotes', 'commodityQuotes');
  const allQuotes = [...mktQuotes, ...cmdQuotes];
  if (allQuotes.length > 0) {
    hasData = true;
    s.push('<b>━━ 📊 MARKETS ━━</b>');
    const sorted = allQuotes.filter(q => q.changePercent != null)
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 8);
    for (const q of sorted) {
      const pct = q.changePercent;
      const emoji = pct >= 0 ? '🟢' : '🔴';
      const sign = pct >= 0 ? '+' : '';
      const price = Number(q.price);
      const priceStr = price >= 1000 ? price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : price.toFixed(2);
      s.push(`${emoji} <b>${esc(q.symbol)}</b> ${priceStr} (${sign}${pct.toFixed(2)}%)`);
    }
    s.push('');
  }

  // Conflicts — stored as { events: [...] } or plain array
  const ucdp = unwrap(data.ucdpEvents, 'events', 'ucdpEvents');
  const unrest = unwrap(data.unrestEvents, 'events', 'unrestEvents');
  const conflicts = [...ucdp, ...unrest];
  if (conflicts.length > 0) {
    hasData = true;
    s.push('<b>━━ ⚔️ CONFLICT &amp; UNREST ━━</b>');
    for (const c of conflicts.slice(0, 5)) {
      const type = c.event_type ?? c.type ?? 'Event';
      const loc = c.location ? `${c.location}, ${c.country ?? ''}` : (c.country ?? 'Unknown');
      const fat = (c.fatalities > 0) ? ` — <b>${c.fatalities} fatalities</b>` : '';
      s.push(`▸ <b>${esc(type)}</b>: ${esc(String(loc).trim())}${fat}`);
    }
    s.push('');
  }

  // Cyber — stored as { threats: [...] }
  const cyber = unwrap(data.cyberThreats, 'threats', 'cyberThreats')
    .filter(t => ['critical', 'high'].includes(String(t.severity ?? '').toLowerCase()));
  if (cyber.length > 0) {
    hasData = true;
    s.push('<b>━━ 🛡️ CYBER THREATS ━━</b>');
    for (const t of cyber.slice(0, 4)) {
      s.push(`▸ [${String(t.severity ?? '').toUpperCase()}] <b>${esc(t.name)}</b>`);
    }
    s.push('');
  }

  // Predictions — stored as { markets: [...] } or array
  const preds = unwrap(data.predictions, 'markets', 'predictions');
  if (preds.length > 0) {
    hasData = true;
    s.push('<b>━━ 🔮 PREDICTIONS ━━</b>');
    for (const p of preds.slice(0, 5)) {
      const prob = p.probability > 1 ? p.probability : (p.probability ?? 0) * 100;
      const bar = prob >= 70 ? '🟢' : prob >= 40 ? '🟡' : '🔴';
      s.push(`${bar} <b>${prob.toFixed(0)}%</b> — ${esc(p.title)}`);
    }
    s.push('');
  }

  // Infrastructure
  const outages = unwrap(data.outages, 'outages');
  const fires = unwrap(data.wildfires, 'fireDetections', 'wildfires', 'fires');
  const weather = unwrap(data.weatherAlerts, 'alerts', 'weatherAlerts');
  if (outages.length > 0 || fires.length > 0 || weather.length > 0) {
    hasData = true;
    s.push('<b>━━ ⚡ INFRASTRUCTURE ━━</b>');
    if (outages.length > 0) s.push(`▸ <b>${outages.length}</b> active outages`);
    if (fires.length > 0) s.push(`▸ <b>${fires.length}</b> wildfires detected`);
    if (weather.length > 0) s.push(`▸ <b>${weather.length}</b> weather alerts`);
    s.push('');
  }

  // Natural events — stored as { events: [...] }
  const natural = unwrap(data.naturalEvents, 'events', 'naturalEvents');
  if (natural.length > 0) {
    hasData = true;
    s.push('<b>━━ 🌋 NATURAL EVENTS ━━</b>');
    for (const e of natural.slice(0, 4)) {
      const title = e.title ?? e.name ?? e.type ?? 'Event';
      s.push(`▸ ${esc(title)}`);
    }
    s.push('');
  }

  // GDELT — stored as { topics: [...] }
  const gdelt = unwrap(data.gdeltIntel, 'topics', 'gdeltIntel');
  if (gdelt.length > 0) {
    hasData = true;
    s.push('<b>━━ 🔍 INTELLIGENCE ━━</b>');
    for (const topic of gdelt.slice(0, 3)) {
      const articles = asArray(topic.articles ?? topic.events);
      if (articles.length > 0) {
        const topicName = topic.topic ?? topic.name ?? 'Intel';
        s.push(`<b>${esc(topicName)}:</b>`);
        for (const a of articles.slice(0, 2)) {
          s.push(`  ▸ ${esc(a.title ?? a.headline ?? '')}`);
        }
      }
    }
    s.push('');
  }

  if (!hasData) {
    s.push('⚠️ No data in Redis cache. Run seed scripts on your local machine to populate:');
    s.push('<code>node scripts/seed-earthquakes.mjs</code>');
    s.push('<code>node scripts/seed-unrest-events.mjs</code>');
    s.push('<code>node scripts/seed-prediction-markets.mjs</code>');
    s.push('<code>node scripts/seed-gdelt-intel.mjs</code>');
    s.push('');
  }

  s.push('<i>— World Monitor Intelligence Brief</i>');
  return s.join('\n');
}

function generateMarketsReport(data) {
  const mkt = unwrap(data.marketQuotes, 'quotes', 'marketQuotes');
  const cmd = unwrap(data.commodityQuotes, 'quotes', 'commodityQuotes');
  const crypto = unwrap(data.cryptoQuotes, 'quotes', 'cryptoQuotes');
  const all = [...mkt, ...cmd, ...crypto];
  if (all.length === 0) return '📊 <b>MARKETS</b>\n\nNo market data in Redis. Run <code>node scripts/seed-market-quotes.mjs</code>';

  const s = ['📊 <b>MARKET REPORT</b>', ''];
  const sorted = all.filter(q => q.changePercent != null)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 15);
  for (const q of sorted) {
    const pct = q.changePercent;
    const emoji = pct >= 0 ? '🟢' : '🔴';
    const sign = pct >= 0 ? '+' : '';
    const price = Number(q.price);
    const priceStr = price >= 1000 ? price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : price.toFixed(2);
    s.push(`${emoji} <b>${esc(q.symbol)}</b> ${priceStr} (${sign}${pct.toFixed(2)}%)`);
  }
  return s.join('\n');
}

function generateThreatsReport(data) {
  const s = ['⚔️ <b>THREAT REPORT</b>', ''];
  const conflicts = [...unwrap(data.ucdpEvents, 'events'), ...unwrap(data.unrestEvents, 'events')];
  if (conflicts.length > 0) {
    s.push('<b>Conflict Events:</b>');
    for (const c of conflicts.slice(0, 8)) {
      const type = c.event_type ?? c.type ?? 'Event';
      const loc = c.location ? `${c.location}, ${c.country ?? ''}` : (c.country ?? 'Unknown');
      s.push(`▸ ${esc(type)} — ${esc(String(loc).trim())}`);
    }
    s.push('');
  }
  const cyber = unwrap(data.cyberThreats, 'threats');
  if (cyber.length > 0) {
    s.push('<b>Cyber Threats:</b>');
    for (const t of cyber.slice(0, 6)) {
      s.push(`▸ [${String(t.severity ?? '?').toUpperCase()}] ${esc(t.name)}`);
    }
  }
  if (conflicts.length === 0 && cyber.length === 0) s.push('No threat data in Redis.');
  return s.join('\n');
}

function generateQuakesReport(data) {
  const quakes = unwrap(data.earthquakes, 'earthquakes').slice(0, 10);
  if (quakes.length === 0) return '🌍 <b>SEISMOLOGY</b>\n\nNo earthquake data in Redis.';
  const s = ['🌍 <b>SEISMIC ACTIVITY</b>', ''];
  for (const q of quakes) {
    const mag = q.magnitude ?? q.mag ?? 0;
    const depth = q.depthKm ?? q.depth ?? 0;
    const time = q.occurredAt ? timeAgo(q.occurredAt) : '';
    const tsunami = q.tsunami ? ' ⚠️ TSUNAMI' : '';
    s.push(`▸ <b>M${Number(mag).toFixed(1)}</b> — ${esc(q.place ?? 'Unknown')} (${Number(depth).toFixed(0)}km) ${time}${tsunami}`);
  }
  return s.join('\n');
}

function generateHelpMessage() {
  return [
    '<b>🌐 World Monitor Bot</b>', '',
    '/report — Full intelligence brief',
    '/markets — Market overview',
    '/threats — Conflicts + cyber threats',
    '/quakes — Seismic activity',
    '/status — Bot health check',
    '/help — This message',
  ].join('\n');
}

// ── Telegram send ──

async function sendTelegramMessage(botToken, chatId, html) {
  const MAX = 4000;
  const chunks = [];
  if (html.length <= MAX) { chunks.push(html); }
  else {
    const parts = html.split('\n\n');
    let buf = '';
    for (const part of parts) {
      if ((buf + '\n\n' + part).length > MAX && buf.length > 0) { chunks.push(buf.trim()); buf = part; }
      else { buf = buf ? buf + '\n\n' + part : part; }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  for (let i = 0; i < chunks.length; i++) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunks[i], parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1100));
  }
}

// ── Main handler ──

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not set' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); } catch { return new Response('OK', { status: 200 }); }

  const message = body.message;
  if (!message || !message.text) return new Response('OK', { status: 200 });

  const chatId = message.chat.id;
  const text = message.text.trim().toLowerCase();
  const command = text.split(' ')[0].split('@')[0];

  const allowedChat = process.env.TELEGRAM_CHAT_ID;
  if (allowedChat && String(chatId) !== String(allowedChat)) {
    await sendTelegramMessage(botToken, chatId, '⛔ Unauthorized.');
    return new Response('OK', { status: 200 });
  }

  try {
    let report;
    switch (command) {
      case '/report': case '/brief': {
        const data = await getBootstrapData();
        if (data._error) { report = `❌ ${data._error}`; break; }
        report = generateFullReport(data);
        break;
      }
      case '/markets': {
        const data = await getBootstrapData();
        report = generateMarketsReport(data);
        break;
      }
      case '/threats': {
        const data = await getBootstrapData();
        report = generateThreatsReport(data);
        break;
      }
      case '/quakes': case '/earthquakes': {
        const data = await getBootstrapData();
        report = generateQuakesReport(data);
        break;
      }
      case '/status': {
        const data = await getBootstrapData();
        report = `✅ <b>World Monitor Bot Online</b>\n\nTime: ${new Date().toISOString()}\nRedis: ${data._error ? '❌ ' + data._error : '✅ connected (' + (data._keysFound ?? 0) + '/' + (data._keysTotal ?? 0) + ' keys populated)'}`;
        break;
      }
      case '/help': case '/start': {
        report = generateHelpMessage();
        break;
      }
      default: {
        report = `Unknown command: <code>${esc(command)}</code>\n\nType /help for available commands.`;
        break;
      }
    }
    await sendTelegramMessage(botToken, chatId, report);
  } catch (err) {
    await sendTelegramMessage(botToken, chatId, `❌ Error: ${esc(String(err.message || err))}`);
  }
  return new Response('OK', { status: 200 });
}
