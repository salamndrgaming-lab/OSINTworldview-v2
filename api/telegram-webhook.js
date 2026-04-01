/**
 * Telegram Bot Webhook Handler v3
 * 
 * Reads directly from Upstash Redis, unwraps nested data formats,
 * and sends formatted intelligence reports via Telegram.
 * 
 * Commands: /report /markets /threats /quakes /poi /seed /status /help
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
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

function asArray(val) {
  if (Array.isArray(val)) return val;
  return [];
}

function unwrap(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const val of Object.values(raw)) {
      if (Array.isArray(val)) return val;
    }
  }
  return [];
}

// ── Redis ──

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
    chokepoints:     'supply_chain:chokepoints:v4',
    weatherAlerts:   'weather:alerts:v1',
    naturalEvents:   'natural:events:v1',
    cryptoQuotes:    'market:crypto:v1',
    gdeltIntel:      'intelligence:gdelt-intel:v1',
    poi:             'intelligence:poi:v1',
    // God-mode additions
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
    return { _error: 'Redis fetch failed: ' + err.message };
  }
}

// ── Reports ──

function generateFullReport(data) {
  var ts = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  var s = [];
  s.push('<b>🌐 INTELLIGENCE BRIEF</b>');
  s.push('<i>' + ts + ' UTC</i>');
  s.push('<i>Redis: ' + (data._keysFound || 0) + '/' + (data._keysTotal || 0) + ' sources</i>');
  s.push('');

  var hasData = false;

  // If we have an agent-generated SITREP, use its executive summary as the lead section
  var sitrep = data.agentSitrep;
  if (sitrep && sitrep.executive_summary) {
    hasData = true;
    var threatBadge = (sitrep.overall_threat_level || 'unknown').toUpperCase();
    s.push('<b>AI EXECUTIVE SUMMARY</b> [' + threatBadge + ']');
    // Trim to ~400 chars for Telegram readability
    var summary = String(sitrep.executive_summary).slice(0, 400);
    s.push(esc(summary));
    s.push('');

    // Include watch list if present
    if (sitrep.watch_list && sitrep.watch_list.length > 0) {
      s.push('<b>⚠️ WATCH LIST</b>');
      for (var wi = 0; wi < Math.min(sitrep.watch_list.length, 5); wi++) {
        s.push('• ' + esc(String(sitrep.watch_list[wi]).slice(0, 120)));
      }
      s.push('');
    }
  }

  // Missile/drone strikes section (new)
  var missiles = data.missileEvents;
  if (missiles && missiles.events && missiles.events.length > 0) {
    hasData = true;
    var sixH = Date.now() - 6 * 3600000;
    var recentStrikes = missiles.events.filter(function(e) { return e.timestamp >= sixH; });
    var critStrikes = recentStrikes.filter(function(e) { return e.severity === 'critical' || e.severity === 'high'; });
    s.push('<b>🚀 MISSILE/DRONE STRIKES</b>');
    s.push(recentStrikes.length + ' events in 6h (' + critStrikes.length + ' critical/high)');
    for (var si2 = 0; si2 < Math.min(recentStrikes.length, 4); si2++) {
      var se = recentStrikes[si2];
      s.push('> ' + esc(se.locationName || '?') + ': ' + esc((se.title || '').slice(0, 80)));
    }
    s.push('');
  }

  // Conflict forecast section (new)
  var forecasts = data.conflictForecast;
  if (forecasts && forecasts.forecasts && forecasts.forecasts.length > 0) {
    var highRisk = forecasts.forecasts.filter(function(f) { return f.predictedLogFatalities > 3; }).slice(0, 5);
    if (highRisk.length > 0) {
      hasData = true;
      s.push('<b>📊 CONFLICT FORECAST</b>');
      for (var fi = 0; fi < highRisk.length; fi++) {
        var fr = highRisk[fi];
        var riskLbl = fr.predictedLogFatalities > 5 ? '🔴 EXTREME' : '🟠 HIGH';
        s.push(riskLbl + ' ' + esc(fr.countryName || fr.countryCode) + ' (~' + (fr.estimatedFatalities || 0) + ' fatalities/mo)');
      }
      s.push('');
    }
  }

  // Disease outbreaks section (new)
  var diseases = data.diseaseOutbreaks;
  if (diseases && diseases.events && diseases.events.length > 0) {
    var critDiseases = diseases.events.filter(function(e) {
      return e.severity === 'critical' || e.diseaseType === 'hemorrhagic';
    });
    if (critDiseases.length > 0) {
      hasData = true;
      s.push('<b>🦠 DISEASE OUTBREAKS</b>');
      for (var di = 0; di < Math.min(critDiseases.length, 4); di++) {
        var de = critDiseases[di];
        s.push('> ' + esc(de.country || '?') + ': ' + esc((de.title || de.diseaseType || '').slice(0, 80)));
      }
      s.push('');
    }
  }

  // Radiation anomalies section (new)
  var radiation = data.radiationData;
  if (radiation && radiation.anomalyCount > 0) {
    hasData = true;
    s.push('<b>☢️ RADIATION</b>');
    s.push(radiation.anomalyCount + ' anomalous readings (threshold: ' + (radiation.anomalyThreshold || '?') + ' CPM)');
    s.push('');
  }

  // Original sections follow — executive summary from insights
  var insights = unwrap(data.insights);
  if (insights.length > 0 && !sitrep) {
    // Only show if agent sitrep wasn't available (to avoid duplication)
    hasData = true;
    s.push('<b>EXECUTIVE SUMMARY</b>');
    for (var ii = 0; ii < Math.min(insights.length, 5); ii++) {
      var ins = insights[ii];
      var sev = ins.severity ? ' [' + String(ins.severity).toUpperCase() + ']' : '';
      s.push('> ' + esc(ins.title || '') + sev);
      if (ins.summary) s.push('  <i>' + esc(String(ins.summary).slice(0, 150)) + '</i>');
    }
    s.push('');
  }

  var quakes = unwrap(data.earthquakes).filter(function(q) { return (q.magnitude || q.mag || 0) >= 4.5; }).slice(0, 5);
  if (quakes.length > 0) {
    hasData = true;
    s.push('<b>SEISMIC ACTIVITY</b>');
    for (var qi = 0; qi < quakes.length; qi++) {
      var q = quakes[qi];
      var mag = q.magnitude || q.mag || 0;
      var place = q.place || 'Unknown';
      var time = q.occurredAt ? timeAgo(q.occurredAt) : '';
      s.push('> M' + Number(mag).toFixed(1) + ' - ' + esc(place) + ' ' + time);
    }
    s.push('');
  }

  var mktQ = unwrap(data.marketQuotes);
  var cmdQ = unwrap(data.commodityQuotes);
  var allQ = mktQ.concat(cmdQ);
  if (allQ.length > 0) {
    hasData = true;
    s.push('<b>MARKETS</b>');
    var sorted = allQ.filter(function(q) { return q.changePercent != null; })
      .sort(function(a, b) { return Math.abs(b.changePercent) - Math.abs(a.changePercent); }).slice(0, 8);
    for (var mi = 0; mi < sorted.length; mi++) {
      var mq = sorted[mi];
      var pct = mq.changePercent;
      var emoji = pct >= 0 ? '+' : '';
      var price = Number(mq.price);
      var priceStr = price >= 1000 ? Math.round(price).toLocaleString() : price.toFixed(2);
      s.push(esc(mq.symbol) + ' ' + priceStr + ' (' + emoji + pct.toFixed(2) + '%)');
    }
    s.push('');
  }

  var ucdp = unwrap(data.ucdpEvents);
  var unrest = unwrap(data.unrestEvents);
  var conflicts = ucdp.concat(unrest);
  if (conflicts.length > 0) {
    hasData = true;
    s.push('<b>CONFLICT AND UNREST</b>');
    for (var ci = 0; ci < Math.min(conflicts.length, 5); ci++) {
      var c = conflicts[ci];
      var ctype = c.event_type || c.type || 'Event';
      var cloc = c.location ? c.location + ', ' + (c.country || '') : (c.country || 'Unknown');
      var fat = (c.fatalities > 0) ? ' - ' + c.fatalities + ' fatalities' : '';
      s.push('> ' + esc(ctype) + ': ' + esc(cloc.trim()) + fat);
    }
    s.push('');
  }

  var cyber = unwrap(data.cyberThreats).filter(function(t) {
    var sev = String(t.severity || '').toLowerCase();
    return sev === 'critical' || sev === 'high';
  });
  if (cyber.length > 0) {
    hasData = true;
    s.push('<b>CYBER THREATS</b>');
    for (var cyi = 0; cyi < Math.min(cyber.length, 4); cyi++) {
      s.push('> [' + String(cyber[cyi].severity || '').toUpperCase() + '] ' + esc(cyber[cyi].name || ''));
    }
    s.push('');
  }

  var preds = unwrap(data.predictions);
  if (preds.length > 0) {
    hasData = true;
    s.push('<b>PREDICTIONS</b>');
    for (var pi = 0; pi < Math.min(preds.length, 5); pi++) {
      var p = preds[pi];
      var prob = p.probability > 1 ? p.probability : (p.probability || 0) * 100;
      s.push(prob.toFixed(0) + '% - ' + esc(p.title || ''));
    }
    s.push('');
  }

  var outages = unwrap(data.outages);
  var fires = unwrap(data.wildfires);
  var weather = unwrap(data.weatherAlerts);
  if (outages.length > 0 || fires.length > 0 || weather.length > 0) {
    hasData = true;
    s.push('<b>INFRASTRUCTURE</b>');
    if (outages.length > 0) s.push('> ' + outages.length + ' active outages');
    if (fires.length > 0) s.push('> ' + fires.length + ' wildfires detected');
    if (weather.length > 0) s.push('> ' + weather.length + ' weather alerts');
    s.push('');
  }

  var natural = unwrap(data.naturalEvents);
  if (natural.length > 0) {
    hasData = true;
    s.push('<b>NATURAL EVENTS</b>');
    for (var ni = 0; ni < Math.min(natural.length, 4); ni++) {
      var ne = natural[ni];
      s.push('> ' + esc(ne.title || ne.name || ne.type || 'Event'));
    }
    s.push('');
  }

  var gdelt = unwrap(data.gdeltIntel);
  if (gdelt.length > 0) {
    hasData = true;
    s.push('<b>INTELLIGENCE</b>');
    for (var gi = 0; gi < Math.min(gdelt.length, 3); gi++) {
      var topic = gdelt[gi];
      var articles = asArray(topic.articles || topic.events);
      if (articles.length > 0) {
        var topicName = topic.topic || topic.name || 'Intel';
        s.push('<b>' + esc(topicName) + ':</b>');
        for (var ai = 0; ai < Math.min(articles.length, 2); ai++) {
          s.push('  > ' + esc(articles[ai].title || articles[ai].headline || ''));
        }
      }
    }
    s.push('');
  }

  if (!hasData) {
    s.push('No data in Redis. Run seed scripts to populate.');
    s.push('');
  }

  s.push('<i>World Monitor Intelligence Brief</i>');
  return s.join('\n');
}

function generateMarketsReport(data) {
  var mkt = unwrap(data.marketQuotes);
  var cmd = unwrap(data.commodityQuotes);
  var crypto = unwrap(data.cryptoQuotes);
  var all = mkt.concat(cmd).concat(crypto);
  if (all.length === 0) return 'MARKETS\n\nNo market data in Redis.';

  var s = ['<b>MARKET REPORT</b>', ''];
  var sorted = all.filter(function(q) { return q.changePercent != null; })
    .sort(function(a, b) { return Math.abs(b.changePercent) - Math.abs(a.changePercent); }).slice(0, 15);
  for (var i = 0; i < sorted.length; i++) {
    var q = sorted[i];
    var pct = q.changePercent;
    var sign = pct >= 0 ? '+' : '';
    var price = Number(q.price);
    var priceStr = price >= 1000 ? Math.round(price).toLocaleString() : price.toFixed(2);
    s.push(esc(q.symbol) + ' ' + priceStr + ' (' + sign + pct.toFixed(2) + '%)');
  }
  return s.join('\n');
}

function generateThreatsReport(data) {
  var s = ['<b>THREAT REPORT</b>', ''];
  var conflicts = unwrap(data.ucdpEvents).concat(unwrap(data.unrestEvents));
  if (conflicts.length > 0) {
    s.push('<b>Conflict Events:</b>');
    for (var i = 0; i < Math.min(conflicts.length, 8); i++) {
      var c = conflicts[i];
      var type = c.event_type || c.type || 'Event';
      var loc = c.location ? c.location + ', ' + (c.country || '') : (c.country || 'Unknown');
      s.push('> ' + esc(type) + ' - ' + esc(loc.trim()));
    }
    s.push('');
  }
  var cyber = unwrap(data.cyberThreats);
  if (cyber.length > 0) {
    s.push('<b>Cyber Threats:</b>');
    for (var j = 0; j < Math.min(cyber.length, 6); j++) {
      s.push('> [' + String(cyber[j].severity || '?').toUpperCase() + '] ' + esc(cyber[j].name || ''));
    }
  }
  if (conflicts.length === 0 && cyber.length === 0) s.push('No threat data in Redis.');
  return s.join('\n');
}

function generateQuakesReport(data) {
  var quakes = unwrap(data.earthquakes).slice(0, 10);
  if (quakes.length === 0) return '<b>SEISMOLOGY</b>\n\nNo earthquake data in Redis.';
  var s = ['<b>SEISMIC ACTIVITY</b>', ''];
  for (var i = 0; i < quakes.length; i++) {
    var q = quakes[i];
    var mag = q.magnitude || q.mag || 0;
    var depth = q.depthKm || q.depth || 0;
    var time = q.occurredAt ? timeAgo(q.occurredAt) : '';
    var tsunami = q.tsunami ? ' TSUNAMI' : '';
    s.push('> M' + Number(mag).toFixed(1) + ' - ' + esc(q.place || 'Unknown') + ' (' + Number(depth).toFixed(0) + 'km) ' + time + tsunami);
  }
  return s.join('\n');
}

function generatePoiReport(data) {
  var persons = unwrap(data.poi);
  if (persons.length === 0) return '<b>PERSONS OF INTEREST</b>\n\nNo POI data. Run seed-persons-of-interest.mjs';
  var s = ['<b>PERSONS OF INTEREST</b>', ''];
  for (var i = 0; i < Math.min(persons.length, 10); i++) {
    var p = persons[i];
    var risk = p.riskLevel === 'critical' ? '[!!!]' : p.riskLevel === 'high' ? '[!!]' : p.riskLevel === 'elevated' ? '[!]' : '[ok]';
    s.push(risk + ' <b>' + esc(p.name) + '</b> - ' + esc(p.role || ''));
    s.push('   Location: ' + esc(p.lastKnownLocation || 'Unknown') + ' (' + (p.locationConfidence || '?') + ')');
    if (p.recentActivity) s.push('   Activity: <i>' + esc(String(p.recentActivity).slice(0, 120)) + '</i>');
    s.push('   Mentions: ' + (p.mentionCount || 0) + ' | Score: ' + (p.activityScore || 0));
    s.push('');
  }
  return s.join('\n');
}

function generatePoiSearch(data, query) {
  var persons = unwrap(data.poi);
  if (persons.length === 0) return '<b>POI SEARCH</b>\n\nNo POI data available.';
  var q = query.toLowerCase();
  var matches = persons.filter(function(p) {
    var name = (p.name || '').toLowerCase();
    var role = (p.role || '').toLowerCase();
    var loc = (p.lastKnownLocation || '').toLowerCase();
    var country = (p.country || '').toLowerCase();
    return name.indexOf(q) !== -1 || role.indexOf(q) !== -1 || loc.indexOf(q) !== -1 || country.indexOf(q) !== -1;
  });
  if (matches.length === 0) return '<b>POI SEARCH</b>\n\nNo matches for "' + esc(query) + '".\nTry /poi to see all tracked persons.';
  var s = ['<b>POI SEARCH: ' + esc(query) + '</b>', '(' + matches.length + ' match' + (matches.length > 1 ? 'es' : '') + ')', ''];
  for (var i = 0; i < Math.min(matches.length, 5); i++) {
    var p = matches[i];
    var risk = p.riskLevel === 'critical' ? '[!!!]' : p.riskLevel === 'high' ? '[!!]' : p.riskLevel === 'elevated' ? '[!]' : '[ok]';
    s.push(risk + ' <b>' + esc(p.name) + '</b>');
    s.push('   Role: ' + esc(p.role || 'Unknown'));
    s.push('   Location: ' + esc(p.lastKnownLocation || 'Unknown') + ' (' + (p.locationConfidence || '?') + ')');
    if (p.recentActivity) s.push('   Activity: <i>' + esc(String(p.recentActivity).slice(0, 200)) + '</i>');
    if (p.aiProfile) s.push('   Profile: <i>' + esc(String(p.aiProfile).slice(0, 200)) + '</i>');
    s.push('   Mentions: ' + (p.mentionCount || 0) + ' | Score: ' + (p.activityScore || 0));
    s.push('');
  }
  if (matches.length > 5) s.push('... and ' + (matches.length - 5) + ' more');
  return s.join('\n');
}

function generateHelpMessage() {
  return [
    '<b>World Monitor Bot</b>', '',
    'Intelligence:',
    '/report - Full intelligence brief',
    '/poi - Persons of interest',
    '/poi &lt;name&gt; - Search POI by name/role/location',
    '/threats - Conflicts + cyber',
    '',
    'Data:',
    '/markets - Market overview',
    '/quakes - Seismic activity',
    '',
    'System:',
    '/seed - Refresh all data',
    '/status - Health check',
    '/help - This message',
  ].join('\n');
}

// ── Telegram send ──

async function sendTelegramMessage(botToken, chatId, html) {
  var MAX = 4000;
  var chunks = [];
  if (html.length <= MAX) {
    chunks.push(html);
  } else {
    var parts = html.split('\n\n');
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
    await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunks[j], parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (j < chunks.length - 1) await new Promise(function(r) { setTimeout(r, 1100); });
  }
}

// ── Main handler ──

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not set' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  var body;
  try { body = await req.json(); } catch (e) { return new Response('OK', { status: 200 }); }

  var message = body.message;
  if (!message || !message.text) return new Response('OK', { status: 200 });

  var chatId = message.chat.id;
  var text = message.text.trim().toLowerCase();
  var command = text.split(' ')[0].split('@')[0];

  var allowedChat = process.env.TELEGRAM_CHAT_ID;
  if (allowedChat && String(chatId) !== String(allowedChat)) {
    await sendTelegramMessage(botToken, chatId, 'Unauthorized.');
    return new Response('OK', { status: 200 });
  }

  try {
    var report;
    switch (command) {
      case '/report':
      case '/brief': {
        var rdata = await getBootstrapData();
        if (rdata._error) { report = 'Error: ' + rdata._error; break; }
        report = generateFullReport(rdata);
        break;
      }
      case '/markets': {
        var mdata = await getBootstrapData();
        report = generateMarketsReport(mdata);
        break;
      }
      case '/threats': {
        var tdata = await getBootstrapData();
        report = generateThreatsReport(tdata);
        break;
      }
      case '/quakes':
      case '/earthquakes': {
        var qdata = await getBootstrapData();
        report = generateQuakesReport(qdata);
        break;
      }
      case '/poi': {
        var pdata = await getBootstrapData();
        var poiArgs = text.slice(4).trim();
        if (poiArgs.length > 0) {
          report = generatePoiSearch(pdata, poiArgs);
        } else {
          report = generatePoiReport(pdata);
        }
        break;
      }
      case '/seed': {
        try {
          // Verify GITHUB_PAT is in Vercel Env Variables
          const ghToken = process.env.GITHUB_PAT;
          if (!ghToken) {
            report = '❌ Error: GITHUB_PAT is not configured in Vercel.';
            break;
          }

          const triggerResp = await fetch('https://api.github.com/repos/salamndrgaming-lab/OSINTworldview-v2/actions/workflows/seed.yml/dispatches', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ghToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
              'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({ ref: 'main' }),
          });

          if (triggerResp.status === 204 || triggerResp.ok) {
            report = '✅ <b>Seed Triggered</b>\nData is being refreshed. Check /status in ~5 mins.';
          } else {
            const err = await triggerResp.text();
            report = `⚠️ <b>Trigger Failed</b>\nHTTP ${triggerResp.status}: ${err}`;
          }
        } catch (e) {
          report = `❌ <b>System Error</b>\n${e.message}`;
        }
        break;
      }
      case '/refresh': {
        var ghToken = process.env.GITHUB_TOKEN;
        var ghRepo = process.env.GITHUB_REPO;
        if (!ghToken || !ghRepo) {
          report = 'Seed not configured. Add GITHUB_TOKEN and GITHUB_REPO to Vercel env vars.';
          break;
        }
        try {
          var seedUrl = 'https://api.github.com/repos/' + ghRepo + '/actions/workflows/seed.yml/dispatches';
          var triggerResp = await fetch(seedUrl, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + ghToken,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ref: 'main' }),
          });
          if (triggerResp.status === 204 || triggerResp.ok) {
            report = 'Seed triggered! Refreshing all data. Takes 3-5 min. You will be notified when complete.';
          } else {
            report = 'Trigger failed: HTTP ' + triggerResp.status;
          }
        } catch (seedErr) {
          report = 'Seed error: ' + String(seedErr.message || seedErr);
        }
        break;
      }
      case '/status': {
        var sdata = await getBootstrapData();
        var redisStatus = sdata._error ? 'Error: ' + sdata._error : 'Connected (' + (sdata._keysFound || 0) + '/' + (sdata._keysTotal || 0) + ' keys)';
        report = '<b>World Monitor Bot Online</b>\n\nTime: ' + new Date().toISOString() + '\nRedis: ' + redisStatus;
        break;
      }
      case '/help':
      case '/start': {
        report = generateHelpMessage();
        break;
      }
      default: {
        report = 'Unknown command: ' + esc(command) + '\n\nType /help for commands.';
        break;
      }
    }
    await sendTelegramMessage(botToken, chatId, report);
  } catch (err) {
    await sendTelegramMessage(botToken, chatId, 'Error: ' + esc(String(err.message || err)));
  }
  return new Response('OK', { status: 200 });
}
