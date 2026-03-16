/**
 * Telegram Bot Webhook Handler
 * 
 * Vercel Edge Function that receives incoming Telegram messages
 * and responds with intelligence reports when commanded.
 * 
 * Supported commands:
 *   /report — Full intelligence brief (all categories)
 *   /markets — Market overview only
 *   /threats — Conflicts + cyber threats only
 *   /quakes — Seismic activity only
 *   /status — Bot health check
 *   /help — List available commands
 * 
 * Setup:
 *   1. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to Vercel env vars
 *   2. Set the webhook URL by visiting in your browser:
 *      https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR-VERCEL-URL.vercel.app/api/telegram-webhook
 * 
 * Location in repo: api/telegram-webhook.js
 */

export const config = { runtime: 'edge' };

const NEG_SENTINEL = '__WM_NEG__';

// ── Helpers ──

function esc(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ── Redis fetch ──

async function getBootstrapData() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return {};

  const keys = [
    'seismology:earthquakes:v1',
    'market:stocks-bootstrap:v1',
    'market:commodities-bootstrap:v1',
    'cyber:threats-bootstrap:v2',
    'conflict:ucdp-events:v1',
    'unrest:events:v1',
    'news:insights:v1',
    'prediction:markets-bootstrap:v1',
    'infra:outages:v1',
    'wildfire:fires:v1',
    'supply_chain:chokepoints:v4',
    'weather:alerts:v1',
    'conflict:iran-events:v1',
    'natural:events:v1',
    'market:crypto:v1',
    'market:gulf-quotes:v1',
    'intelligence:gdelt-intel:v1',
  ];

  const pipeline = keys.map((k) => ['GET', k]);

  try {
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return {};

    const results = await resp.json();
    const data = {};
    const names = [
      'earthquakes', 'marketQuotes', 'commodityQuotes', 'cyberThreats',
      'ucdpEvents', 'unrestEvents', 'insights', 'predictions',
      'outages', 'wildfires', 'chokepoints', 'weatherAlerts',
      'iranEvents', 'naturalEvents', 'cryptoQuotes', 'gulfQuotes',
      'gdeltIntel',
    ];

    for (let i = 0; i < keys.length; i++) {
      const raw = results[i]?.result;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed !== NEG_SENTINEL) data[names[i]] = parsed;
        } catch { /* skip */ }
      }
    }
    return data;
  } catch {
    return {};
  }
}

// ── Report Generators ──

function asArray(val) {
  if (Array.isArray(val)) return val;
  return [];
}

function generateFullReport(data) {
  const now = new Date();
  const ts = now.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  const s = [];
  s.push(`<b>🌐 INTELLIGENCE BRIEF</b>`);
  s.push(`<i>${ts} UTC</i>`);
  s.push('');

  // Insights
  const insights = asArray(data.insights);
  if (insights.length > 0) {
    s.push('<b>━━ 🧠 EXECUTIVE SUMMARY ━━</b>');
    for (const i of insights.slice(0, 5)) {
      const sev = i.severity ? ` [${String(i.severity).toUpperCase()}]` : '';
      s.push(`▸ ${esc(String(i.title ?? ''))}${sev}`);
      if (i.summary) s.push(`  <i>${esc(String(i.summary).slice(0, 150))}</i>`);
    }
    s.push('');
  }

  // Earthquakes
  const quakes = asArray(data.earthquakes).filter(q => (q.magnitude ?? q.mag ?? 0) >= 4.5).slice(0, 5);
  if (quakes.length > 0) {
    s.push('<b>━━ 🌍 SEISMIC ACTIVITY ━━</b>');
    for (const q of quakes) {
      const mag = q.magnitude ?? q.mag ?? 0;
      const place = q.place ?? 'Unknown';
      const time = q.occurredAt ? timeAgo(q.occurredAt) : '';
      s.push(`▸ <b>M${Number(mag).toFixed(1)}</b> — ${esc(String(place))} ${time}`);
    }
    s.push('');
  }

  // Markets
  const markets = [...asArray(data.marketQuotes), ...asArray(data.commodityQuotes)];
  if (markets.length > 0) {
    s.push('<b>━━ 📊 MARKETS ━━</b>');
    const sorted = markets.filter(q => q.changePercent != null)
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 8);
    for (const q of sorted) {
      const pct = q.changePercent;
      const emoji = pct >= 0 ? '🟢' : '🔴';
      const sign = pct >= 0 ? '+' : '';
      const price = Number(q.price);
      const priceStr = price >= 1000 ? price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : price.toFixed(2);
      s.push(`${emoji} <b>${esc(String(q.symbol))}</b> ${priceStr} (${sign}${pct.toFixed(2)}%)`);
    }
    const up = markets.filter(q => (q.changePercent ?? 0) > 0).length;
    const down = markets.filter(q => (q.changePercent ?? 0) < 0).length;
    s.push(`\n📈 ${up} advancing, ${down} declining`);
    s.push('');
  }

  // Conflicts
  const conflicts = [...asArray(data.ucdpEvents), ...asArray(data.unrestEvents)];
  if (conflicts.length > 0) {
    s.push('<b>━━ ⚔️ CONFLICT & UNREST ━━</b>');
    for (const c of conflicts.slice(0, 5)) {
      const type = c.event_type ?? c.type ?? 'Event';
      const loc = c.location ? `${c.location}, ${c.country ?? ''}` : (c.country ?? 'Unknown');
      const fat = (c.fatalities > 0) ? ` — <b>${c.fatalities} fatalities</b>` : '';
      s.push(`▸ <b>${esc(String(type))}</b>: ${esc(String(loc).trim())}${fat}`);
    }
    s.push('');
  }

  // Cyber
  const cyber = asArray(data.cyberThreats).filter(t => ['critical', 'high'].includes(String(t.severity ?? '').toLowerCase()));
  if (cyber.length > 0) {
    s.push('<b>━━ 🛡️ CYBER THREATS ━━</b>');
    for (const t of cyber.slice(0, 4)) {
      s.push(`▸ [${String(t.severity ?? '').toUpperCase()}] <b>${esc(String(t.name ?? ''))}</b>`);
    }
    s.push('');
  }

  // Predictions
  const preds = asArray(data.predictions);
  if (preds.length > 0) {
    s.push('<b>━━ 🔮 PREDICTIONS ━━</b>');
    for (const p of preds.slice(0, 5)) {
      const prob = p.probability > 1 ? p.probability : (p.probability ?? 0) * 100;
      const bar = prob >= 70 ? '🟢' : prob >= 40 ? '🟡' : '🔴';
      s.push(`${bar} <b>${prob.toFixed(0)}%</b> — ${esc(String(p.title ?? ''))}`);
    }
    s.push('');
  }

  // Infrastructure
  const outages = asArray(data.outages);
  const fires = asArray(data.wildfires);
  const weather = asArray(data.weatherAlerts);
  if (outages.length > 0 || fires.length > 0 || weather.length > 0) {
    s.push('<b>━━ ⚡ INFRASTRUCTURE ━━</b>');
    if (outages.length > 0) s.push(`▸ <b>${outages.length}</b> active outages`);
    if (fires.length > 0) s.push(`▸ <b>${fires.length}</b> wildfires detected`);
    if (weather.length > 0) s.push(`▸ <b>${weather.length}</b> weather alerts`);
    s.push('');
  }

  // Supply chain
  const chokepoints = asArray(data.chokepoints).filter(cp => cp.status && cp.status !== 'normal');
  if (chokepoints.length > 0) {
    s.push('<b>━━ 🚢 SUPPLY CHAIN ━━</b>');
    for (const cp of chokepoints) {
      s.push(`▸ <b>${esc(String(cp.name))}</b>: ${String(cp.status ?? 'disrupted').toUpperCase()}`);
    }
    s.push('');
  }

  // GDELT Intel
  const gdelt = asArray(data.gdeltIntel);
  if (gdelt.length > 0) {
    s.push('<b>━━ 🔍 INTELLIGENCE ━━</b>');
    for (const g of gdelt.slice(0, 4)) {
      s.push(`▸ ${esc(String(g.title ?? g.headline ?? ''))}`);
    }
    s.push('');
  }

  if (s.length <= 3) {
    s.push('⚠️ No data available. Ensure seed scripts have been run and Redis is populated.');
    s.push('');
  }

  s.push('<i>— World Monitor Intelligence Brief</i>');
  return s.join('\n');
}

function generateMarketsReport(data) {
  const markets = [...asArray(data.marketQuotes), ...asArray(data.commodityQuotes), ...asArray(data.cryptoQuotes)];
  if (markets.length === 0) return '📊 <b>MARKETS</b>\n\nNo market data available. Run seed-market-quotes.mjs to populate.';

  const s = ['📊 <b>MARKET REPORT</b>', ''];
  const sorted = markets.filter(q => q.changePercent != null)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 15);
  for (const q of sorted) {
    const pct = q.changePercent;
    const emoji = pct >= 0 ? '🟢' : '🔴';
    const sign = pct >= 0 ? '+' : '';
    const price = Number(q.price);
    const priceStr = price >= 1000 ? price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : price.toFixed(2);
    s.push(`${emoji} <b>${esc(String(q.symbol))}</b> ${priceStr} (${sign}${pct.toFixed(2)}%)`);
  }
  return s.join('\n');
}

function generateThreatsReport(data) {
  const s = ['⚔️ <b>THREAT REPORT</b>', ''];

  const conflicts = [...asArray(data.ucdpEvents), ...asArray(data.unrestEvents)];
  if (conflicts.length > 0) {
    s.push('<b>Conflict Events:</b>');
    for (const c of conflicts.slice(0, 8)) {
      const type = c.event_type ?? c.type ?? 'Event';
      const loc = c.location ? `${c.location}, ${c.country ?? ''}` : (c.country ?? 'Unknown');
      s.push(`▸ ${esc(String(type))} — ${esc(String(loc).trim())}`);
    }
    s.push('');
  }

  const cyber = asArray(data.cyberThreats);
  if (cyber.length > 0) {
    s.push('<b>Cyber Threats:</b>');
    for (const t of cyber.slice(0, 6)) {
      s.push(`▸ [${String(t.severity ?? '?').toUpperCase()}] ${esc(String(t.name ?? ''))}`);
    }
  }

  if (conflicts.length === 0 && cyber.length === 0) {
    s.push('No active threats in cache. Run seed scripts to populate.');
  }
  return s.join('\n');
}

function generateQuakesReport(data) {
  const quakes = asArray(data.earthquakes).slice(0, 10);
  if (quakes.length === 0) return '🌍 <b>SEISMOLOGY</b>\n\nNo earthquake data. Run seed-earthquakes.mjs to populate.';

  const s = ['🌍 <b>SEISMIC ACTIVITY</b>', ''];
  for (const q of quakes) {
    const mag = q.magnitude ?? q.mag ?? 0;
    const place = q.place ?? 'Unknown';
    const depth = q.depthKm ?? q.depth ?? 0;
    const time = q.occurredAt ? timeAgo(q.occurredAt) : '';
    const tsunami = q.tsunami ? ' ⚠️ TSUNAMI' : '';
    s.push(`▸ <b>M${Number(mag).toFixed(1)}</b> — ${esc(String(place))} (${Number(depth).toFixed(0)}km) ${time}${tsunami}`);
  }
  return s.join('\n');
}

function generateHelpMessage() {
  return [
    '<b>🌐 World Monitor Bot</b>',
    '',
    'Available commands:',
    '',
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
  if (html.length <= MAX) {
    chunks.push(html);
  } else {
    const parts = html.split('\n\n');
    let buf = '';
    for (const part of parts) {
      if ((buf + '\n\n' + part).length > MAX && buf.length > 0) {
        chunks.push(buf.trim());
        buf = part;
      } else {
        buf = buf ? buf + '\n\n' + part : part;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }

  for (let i = 0; i < chunks.length; i++) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunks[i],
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1100));
  }
}

// ── Main handler ──

export default async function handler(req) {
  // Only accept POST (Telegram sends webhooks as POST)
  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('OK', { status: 200 });
  }

  const message = body.message;
  if (!message || !message.text) {
    return new Response('OK', { status: 200 });
  }

  const chatId = message.chat.id;
  const text = message.text.trim().toLowerCase();
  const command = text.split(' ')[0].split('@')[0]; // handle /command@botname

  // Optional: restrict to specific chat ID
  const allowedChat = process.env.TELEGRAM_CHAT_ID;
  if (allowedChat && String(chatId) !== String(allowedChat)) {
    await sendTelegramMessage(botToken, chatId, '⛔ Unauthorized. This bot is restricted to a specific chat.');
    return new Response('OK', { status: 200 });
  }

  try {
    let report;

    switch (command) {
      case '/report':
      case '/brief': {
        const data = await getBootstrapData();
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
      case '/quakes':
      case '/earthquakes': {
        const data = await getBootstrapData();
        report = generateQuakesReport(data);
        break;
      }
      case '/status': {
        report = `✅ <b>World Monitor Bot Online</b>\n\nTime: ${new Date().toISOString()}\nRedis: ${process.env.UPSTASH_REDIS_REST_URL ? 'configured' : '❌ not set'}\nBot Token: configured`;
        break;
      }
      case '/help':
      case '/start': {
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
    await sendTelegramMessage(botToken, chatId, `❌ Error generating report: ${esc(String(err.message || err))}`);
  }

  return new Response('OK', { status: 200 });
}
