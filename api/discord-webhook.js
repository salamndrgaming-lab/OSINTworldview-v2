/**
 * Discord Bot Interactions Webhook Handler
 *
 * Mirrors the Telegram bot's functionality for Discord.
 * Uses Discord Interactions API (webhook-based, no gateway/WebSocket needed).
 *
 * Slash commands: /report /markets /threats /quakes /poi /status /help
 *
 * Setup:
 *   1. Create a Discord application at https://discord.com/developers/applications
 *   2. Create a bot user and copy the token → DISCORD_BOT_TOKEN
 *   3. Copy the application's public key → DISCORD_PUBLIC_KEY
 *   4. Set the Interactions Endpoint URL to: https://osintworldview.vercel.app/api/discord-webhook
 *   5. Register slash commands (run the /api/discord-webhook?register=true endpoint once)
 *   6. Invite the bot to your server with applications.commands + bot scopes
 *
 * Location: api/discord-webhook.js
 */

export const config = { runtime: 'edge' };

const NEG_SENTINEL = '__WM_NEG__';

// ── Helpers ──

function esc(text) {
  return String(text || '');
}

function timeAgo(ts) {
  if (!ts) return '';
  var now = Date.now();
  var diff = now - (typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  if (diff < 0) diff = 0;
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function unwrap(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (var k of ['results', 'data', 'items', 'events', 'quotes', 'earthquakes',
    'features', 'articles', 'threats', 'outages', 'fires', 'advisories']) {
    if (data[k] && Array.isArray(data[k])) return data[k];
  }
  if (data.features && Array.isArray(data.features)) {
    return data.features.map(function(f) { return Object.assign({}, f.properties, f.geometry ? { _coords: f.geometry.coordinates } : {}); });
  }
  return [];
}

function asArray(val) {
  return Array.isArray(val) ? val : val ? [val] : [];
}

// ── Redis bootstrap (same as telegram-webhook.js) ──

async function getBootstrapData() {
  var url = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { _error: 'Redis not configured' };

  var keyMap = {
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
    weatherAlerts:   'weather:alerts:v1',
    naturalEvents:   'natural:events:v1',
    cryptoQuotes:    'market:crypto:v1',
    gdeltIntel:      'intelligence:gdelt-intel:v1',
    poi:             'intelligence:poi:v1',
    agentSitrep:     'intelligence:agent-sitrep:v1',
    missileEvents:   'intelligence:missile-events:v1',
    diseaseOutbreaks:'health:outbreaks:v1',
    conflictForecast:'forecast:conflict:v1',
    radiationData:   'environment:radiation:v1',
  };

  var names = Object.keys(keyMap);
  var keys = Object.values(keyMap);
  var pipeline = keys.map(function(k) { return ['GET', k]; });

  try {
    var resp = await fetch(url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return { _error: 'Redis HTTP ' + resp.status };

    var results = await resp.json();
    var data = { _keysFound: 0, _keysTotal: keys.length };

    for (var i = 0; i < names.length; i++) {
      var raw = results[i] && results[i].result ? results[i].result : null;
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          if (parsed !== NEG_SENTINEL) {
            data[names[i]] = parsed;
            data._keysFound++;
          }
        } catch (e) { /* skip */ }
      }
    }
    return data;
  } catch (err) {
    return { _error: String(err.message || err) };
  }
}

// ── Report generators (Discord uses Markdown, not HTML) ──

function generateFullReport(data) {
  var ts = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  var s = [];
  s.push('# 🌐 INTELLIGENCE BRIEF');
  s.push('*' + ts + ' UTC*');
  s.push('*Redis: ' + (data._keysFound || 0) + '/' + (data._keysTotal || 0) + ' sources*');
  s.push('');

  // Agent SITREP executive summary
  var sitrep = data.agentSitrep;
  if (sitrep && sitrep.executive_summary) {
    var threatBadge = (sitrep.overall_threat_level || 'unknown').toUpperCase();
    s.push('## AI EXECUTIVE SUMMARY [' + threatBadge + ']');
    s.push(esc(sitrep.executive_summary).slice(0, 400));
    s.push('');

    if (sitrep.watch_list && sitrep.watch_list.length > 0) {
      s.push('**⚠️ WATCH LIST**');
      for (var wi = 0; wi < Math.min(sitrep.watch_list.length, 5); wi++) {
        s.push('• ' + esc(String(sitrep.watch_list[wi]).slice(0, 120)));
      }
      s.push('');
    }
  }

  // Missile strikes
  var missiles = data.missileEvents;
  if (missiles && missiles.events && missiles.events.length > 0) {
    var sixH = Date.now() - 6 * 3600000;
    var recentStrikes = missiles.events.filter(function(e) { return e.timestamp >= sixH; });
    s.push('## 🚀 MISSILE/DRONE STRIKES');
    s.push(recentStrikes.length + ' events in 6h');
    for (var si2 = 0; si2 < Math.min(recentStrikes.length, 4); si2++) {
      var se = recentStrikes[si2];
      s.push('> ' + esc(se.locationName || '?') + ': ' + esc((se.title || '').slice(0, 80)));
    }
    s.push('');
  }

  // Conflict forecast
  var forecasts = data.conflictForecast;
  if (forecasts && forecasts.forecasts && forecasts.forecasts.length > 0) {
    var highRisk = forecasts.forecasts.filter(function(f) { return f.predictedLogFatalities > 3; }).slice(0, 5);
    if (highRisk.length > 0) {
      s.push('## 📊 CONFLICT FORECAST');
      for (var fi = 0; fi < highRisk.length; fi++) {
        var fr = highRisk[fi];
        var riskLbl = fr.predictedLogFatalities > 5 ? '🔴 EXTREME' : '🟠 HIGH';
        s.push(riskLbl + ' ' + esc(fr.countryName || fr.countryCode) + ' (~' + (fr.estimatedFatalities || 0) + ' fatalities/mo)');
      }
      s.push('');
    }
  }

  // Disease outbreaks
  var diseases = data.diseaseOutbreaks;
  if (diseases && diseases.events && diseases.events.length > 0) {
    var critDiseases = diseases.events.filter(function(e) {
      return e.severity === 'critical' || e.diseaseType === 'hemorrhagic';
    });
    if (critDiseases.length > 0) {
      s.push('## 🦠 DISEASE OUTBREAKS');
      for (var di = 0; di < Math.min(critDiseases.length, 4); di++) {
        s.push('> ' + esc(critDiseases[di].country || '?') + ': ' + esc((critDiseases[di].title || '').slice(0, 80)));
      }
      s.push('');
    }
  }

  // Earthquakes
  var quakes = unwrap(data.earthquakes).filter(function(q) { return (q.magnitude || q.mag || 0) >= 4.5; }).slice(0, 5);
  if (quakes.length > 0) {
    s.push('## 🌍 SEISMIC ACTIVITY');
    for (var qi = 0; qi < quakes.length; qi++) {
      var q = quakes[qi];
      s.push('> M' + Number(q.magnitude || q.mag || 0).toFixed(1) + ' - ' + esc(q.place || 'Unknown') + ' ' + timeAgo(q.occurredAt));
    }
    s.push('');
  }

  // Markets
  var mktQ = unwrap(data.marketQuotes);
  var cmdQ = unwrap(data.commodityQuotes);
  var allQ = mktQ.concat(cmdQ);
  if (allQ.length > 0) {
    s.push('## 📈 MARKETS');
    var sorted = allQ.filter(function(q) { return q.changePercent != null; })
      .sort(function(a, b) { return Math.abs(b.changePercent) - Math.abs(a.changePercent); }).slice(0, 8);
    for (var mi = 0; mi < sorted.length; mi++) {
      var mq = sorted[mi];
      var pct = mq.changePercent;
      var emoji = pct >= 0 ? '+' : '';
      var price = Number(mq.price);
      var priceStr = price >= 1000 ? Math.round(price).toLocaleString() : price.toFixed(2);
      s.push('`' + esc(mq.symbol) + '` ' + priceStr + ' (' + emoji + pct.toFixed(2) + '%)');
    }
    s.push('');
  }

  // POI
  var poiData = data.poi;
  if (poiData && poiData.persons && poiData.persons.length > 0) {
    var topPoi = poiData.persons.filter(function(p) { return p.riskLevel === 'critical' || p.riskLevel === 'high'; }).slice(0, 4);
    if (topPoi.length > 0) {
      s.push('## 👤 KEY PERSONS OF INTEREST');
      for (var pi = 0; pi < topPoi.length; pi++) {
        var pp = topPoi[pi];
        s.push('> **' + esc(pp.name) + '** (' + esc(pp.role || '?') + ') — ' + (pp.riskLevel || '?').toUpperCase());
      }
      s.push('');
    }
  }

  s.push('*World Monitor Intelligence Brief*');
  s.push('🔗 https://osintworldview.vercel.app/?variant=godmode');
  return s.join('\n');
}

function generateHelpMessage() {
  return '# World Monitor Discord Bot\n\n' +
    '**Available Commands:**\n' +
    '`/report` — Full intelligence brief\n' +
    '`/markets` — Market summary\n' +
    '`/threats` — Active threats\n' +
    '`/quakes` — Seismic activity\n' +
    '`/poi` — Persons of interest\n' +
    '`/status` — System status\n' +
    '`/help` — This message\n\n' +
    '🔗 Dashboard: https://osintworldview.vercel.app';
}

// ── Discord crypto verification ──

async function verifyDiscordRequest(req, publicKey) {
  const signature = req.headers.get('X-Signature-Ed25519');
  const timestamp = req.headers.get('X-Signature-Timestamp');
  const body = await req.text();

  if (!signature || !timestamp) return { valid: false, body };

  // Use SubtleCrypto to verify Ed25519 signature
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(publicKey),
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify'],
    );
    const encoder = new TextEncoder();
    const message = encoder.encode(timestamp + body);
    const valid = await crypto.subtle.verify('Ed25519', key, hexToUint8Array(signature), message);
    return { valid, body };
  } catch {
    return { valid: false, body };
  }
}

function hexToUint8Array(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ── Slash command registration ──

async function registerCommands(appId, botToken) {
  const commands = [
    { name: 'report', description: 'Full intelligence brief with all data sources' },
    { name: 'markets', description: 'Market and commodity price summary' },
    { name: 'threats', description: 'Active threats and security alerts' },
    { name: 'quakes', description: 'Significant seismic activity' },
    { name: 'poi', description: 'Persons of interest summary' },
    { name: 'status', description: 'System and data feed status' },
    { name: 'help', description: 'Show available commands' },
  ];

  const resp = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return { error: `Failed to register commands: ${resp.status} — ${err.slice(0, 200)}` };
  }

  return { success: true, commands: commands.length };
}

// ── Send follow-up message (for deferred responses) ──

async function sendFollowUp(appId, interactionToken, content) {
  const MAX = 2000; // Discord message limit
  const chunks = [];
  if (content.length <= MAX) {
    chunks.push(content);
  } else {
    var parts = content.split('\n\n');
    var buf = '';
    for (var i = 0; i < parts.length; i++) {
      if ((buf + '\n\n' + parts[i]).length > MAX && buf.length > 0) {
        chunks.push(buf.trim());
        buf = parts[i];
      } else {
        buf = buf ? buf + '\n\n' + parts[i] : parts[i];
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }

  for (var j = 0; j < chunks.length; j++) {
    await fetch(`https://discord.com/api/v10/webhooks/${appId}/${interactionToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: chunks[j] }),
    });
    if (j < chunks.length - 1) await new Promise(function(r) { setTimeout(r, 500); });
  }
}

// ── Main handler ──

export default async function handler(req) {
  const url = new URL(req.url);

  // Registration endpoint: GET /api/discord-webhook?register=true
  if (req.method === 'GET' && url.searchParams.get('register') === 'true') {
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!appId || !botToken) {
      return new Response(JSON.stringify({ error: 'Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    const result = await registerCommands(appId, botToken);
    return new Response(JSON.stringify(result), {
      status: result.error ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Discord Webhook Endpoint', { status: 200 });
  }

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return new Response('DISCORD_PUBLIC_KEY not configured', { status: 500 });
  }

  // Verify request signature
  const { valid, body } = await verifyDiscordRequest(req, publicKey);
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const interaction = JSON.parse(body);

  // Handle Discord PING (required for endpoint verification)
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Handle slash commands (type 2 = APPLICATION_COMMAND)
  if (interaction.type === 2) {
    const command = interaction.data?.name;
    const appId = process.env.DISCORD_APP_ID;
    const interactionToken = interaction.token;

    // Acknowledge immediately with deferred response (type 5)
    // Then send the actual content as a follow-up
    // This avoids the 3-second timeout on interaction responses
    const deferResponse = new Response(
      JSON.stringify({ type: 5 }), // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      { headers: { 'Content-Type': 'application/json' } },
    );

    // Process the command asynchronously after deferring
    // We use waitUntil-style by starting the promise before returning
    const processCommand = (async () => {
      try {
        var data = await getBootstrapData();
        var report = '';

        switch (command) {
          case 'report':
            report = data._error ? 'Error: ' + data._error : generateFullReport(data);
            break;
          case 'markets': {
            var mkt = unwrap(data.marketQuotes);
            var cmd = unwrap(data.commodityQuotes);
            var all = mkt.concat(cmd);
            if (all.length === 0) { report = 'No market data available.'; break; }
            var lines = ['## 📈 Markets'];
            var top = all.filter(function(q) { return q.changePercent != null; })
              .sort(function(a, b) { return Math.abs(b.changePercent) - Math.abs(a.changePercent); }).slice(0, 12);
            for (var mi = 0; mi < top.length; mi++) {
              var mq = top[mi];
              var p = Number(mq.price);
              lines.push('`' + esc(mq.symbol) + '` ' + (p >= 1000 ? Math.round(p).toLocaleString() : p.toFixed(2)) + ' (' + (mq.changePercent >= 0 ? '+' : '') + mq.changePercent.toFixed(2) + '%)');
            }
            report = lines.join('\n');
            break;
          }
          case 'threats': {
            var threats = [];
            var cyber = unwrap(data.cyberThreats).filter(function(t) { return t.severity === 'critical' || t.severity === 'high'; });
            for (var ci = 0; ci < Math.min(cyber.length, 4); ci++) {
              threats.push('[' + (cyber[ci].severity || '').toUpperCase() + '] ' + esc(cyber[ci].name || ''));
            }
            var missiles = data.missileEvents;
            if (missiles && missiles.events) {
              var recent = missiles.events.slice(0, 3);
              for (var ri = 0; ri < recent.length; ri++) {
                threats.push('🚀 ' + esc(recent[ri].locationName || '') + ': ' + esc((recent[ri].title || '').slice(0, 60)));
              }
            }
            report = threats.length > 0 ? '## ⚠️ Active Threats\n' + threats.join('\n') : 'No critical threats detected.';
            break;
          }
          case 'quakes': {
            var quakes = unwrap(data.earthquakes).filter(function(q) { return (q.magnitude || q.mag || 0) >= 4.0; }).slice(0, 8);
            if (quakes.length === 0) { report = 'No significant earthquakes detected.'; break; }
            var qlines = ['## 🌍 Seismic Activity'];
            for (var qi = 0; qi < quakes.length; qi++) {
              var q = quakes[qi];
              qlines.push('M' + Number(q.magnitude || q.mag || 0).toFixed(1) + ' - ' + esc(q.place || 'Unknown') + ' ' + timeAgo(q.occurredAt));
            }
            report = qlines.join('\n');
            break;
          }
          case 'poi': {
            var poiData = data.poi;
            if (!poiData || !poiData.persons || poiData.persons.length === 0) { report = 'No POI data available.'; break; }
            var plines = ['## 👤 Persons of Interest (' + poiData.persons.length + ')'];
            for (var pi = 0; pi < Math.min(poiData.persons.length, 8); pi++) {
              var pp = poiData.persons[pi];
              plines.push('**' + esc(pp.name) + '** (' + esc(pp.role || '?') + ') — ' + (pp.riskLevel || '?').toUpperCase() + ' — ' + esc(pp.region || '?'));
            }
            report = plines.join('\n');
            break;
          }
          case 'status': {
            var redisStatus = data._error ? 'Error: ' + data._error : 'Connected (' + (data._keysFound || 0) + '/' + (data._keysTotal || 0) + ' keys)';
            report = '## World Monitor Status\nTime: ' + new Date().toISOString() + '\nRedis: ' + redisStatus;
            break;
          }
          case 'help':
          default:
            report = generateHelpMessage();
        }

        await sendFollowUp(appId, interactionToken, report);
      } catch (err) {
        await sendFollowUp(appId, interactionToken, '❌ Error: ' + String(err.message || err));
      }
    })();

    // Start processing but don't await — return the deferred response immediately
    // Edge runtime doesn't have waitUntil, but the fetch promises will complete
    processCommand.catch(() => {});

    return deferResponse;
  }

  return new Response(JSON.stringify({ type: 1 }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
