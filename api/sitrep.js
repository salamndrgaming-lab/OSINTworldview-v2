import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge', maxDuration: 30 };

// ---------- Redis Keys to Aggregate ----------

const DATA_SOURCES = {
  missiles:     'intelligence:missile-events:v1',
  conflicts:    'forecast:conflict:v1',
  diseases:     'health:outbreaks:v1',
  radiation:    'environment:radiation:v1',
  gdeltIntel:   'intelligence:gdelt-intel:v1',
  poi:          'intelligence:poi:v1',
  unrest:       'unrest:events:v1',
  earthquakes:  'natural:earthquakes:v1',
  alerts:       'alerts:stream:v1',
};

// ---------- Redis Helpers ----------

async function redisGet(url, token, key) {
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return null; }
}

async function redisLRange(url, token, key, start, stop) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['LRANGE', key, String(start), String(stop)]),
    signal: AbortSignal.timeout(3_000),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  if (!Array.isArray(data.result)) return [];
  return data.result.map(item => { try { return JSON.parse(item); } catch { return null; } }).filter(Boolean);
}

// ---------- Section Builders ----------

function buildAlertSection(alerts) {
  if (!alerts || alerts.length === 0) return null;
  const lines = alerts.slice(0, 10).map(a => {
    const sevBadge = a.severity === 'critical' ? '🔴' : a.severity === 'high' ? '🟠' : '🟡';
    const age = Math.round((Date.now() - a.timestamp) / 60_000);
    const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
    return `${sevBadge} <strong>${escHtml(a.title)}</strong> <small>(${ageStr} · ${escHtml(a.source)})</small>`;
  });
  return { title: 'Active Alerts', icon: '🚨', items: lines };
}

function buildMissileSection(data) {
  if (!data?.events || data.events.length === 0) return null;
  const sixH = Date.now() - 6 * 3600_000;
  const recent = data.events.filter(e => e.timestamp >= sixH);
  if (recent.length === 0) return null;

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  recent.forEach(e => { bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1; });

  const lines = [
    `${recent.length} strike events in the last 6 hours`,
    `Severity breakdown: ${bySeverity.critical} critical, ${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low`,
  ];
  const top3 = recent.slice(0, 3).map(e =>
    `• <strong>${escHtml(e.locationName)}</strong>: ${escHtml(e.title?.slice(0, 80) || e.eventType)}`
  );
  return { title: 'Missile & Drone Strikes', icon: '🚀', items: [...lines, ...top3] };
}

function buildConflictSection(data) {
  if (!data?.forecasts || data.forecasts.length === 0) return null;
  const top5 = data.forecasts
    .filter(f => f.predictedLogFatalities > 1)
    .slice(0, 5);
  if (top5.length === 0) return null;

  const lines = top5.map(f => {
    const risk = f.predictedLogFatalities > 5 ? '🔴 EXTREME' : f.predictedLogFatalities > 3 ? '🟠 HIGH' : '🟡 ELEVATED';
    return `${risk} <strong>${escHtml(f.countryName || f.countryCode)}</strong> — ~${f.estimatedFatalities} predicted fatalities/mo`;
  });
  return { title: 'Conflict Forecast (VIEWS)', icon: '📊', items: lines };
}

function buildDiseaseSection(data) {
  if (!data?.events || data.events.length === 0) return null;
  const recent = data.events.slice(0, 5);
  const lines = recent.map(e => {
    const icon = e.diseaseType === 'hemorrhagic' ? '🩸' : e.diseaseType === 'respiratory' ? '🫁' : '🦠';
    return `${icon} <strong>${escHtml(e.country)}</strong>: ${escHtml(e.title?.slice(0, 100) || e.diseaseType)}`;
  });
  return { title: 'Disease Outbreaks (WHO)', icon: '🏥', items: lines };
}

function buildRadiationSection(data) {
  if (!data?.readings) return null;
  const anomalies = data.readings.filter(r => r.isAnomaly);
  if (anomalies.length === 0) return null;

  const maxCpm = Math.max(...anomalies.map(r => r.cpm));
  const lines = [
    `${anomalies.length} anomalous readings detected (threshold: ${data.anomalyThreshold} CPM)`,
    `Peak reading: ${maxCpm.toFixed(0)} CPM (${(maxCpm * 0.0057).toFixed(3)} µSv/h)`,
  ];
  return { title: 'Radiation Anomalies', icon: '☢️', items: lines };
}

function buildIntelSection(data) {
  if (!data?.topics) return null;
  const populated = data.topics.filter(t => t.articles?.length > 0);
  if (populated.length === 0) return null;

  const lines = populated.map(t => {
    const topArticle = t.articles[0];
    return `<strong>${escHtml(t.id)}</strong>: ${escHtml(topArticle?.title?.slice(0, 100) || 'No headline')} <small>(${t.articles.length} articles)</small>`;
  });
  return { title: 'Intelligence Feed (GDELT)', icon: '🔍', items: lines };
}

function buildPOISection(data) {
  if (!data?.persons) return null;
  const highRisk = data.persons.filter(p => {
    const risk = (p.riskLevel || '').toLowerCase();
    return risk === 'critical' || risk === 'high';
  });
  if (highRisk.length === 0) return null;

  const lines = highRisk.slice(0, 5).map(p =>
    `<strong>${escHtml(p.name)}</strong> (${escHtml(p.role || '?')}) — ${escHtml(p.riskLevel?.toUpperCase() || '?')} risk`
  );
  return { title: 'High-Risk Persons of Interest', icon: '👤', items: lines };
}

function buildQuakeSection(data) {
  if (!data?.earthquakes) return null;
  const recent = data.earthquakes.filter(q => q.magnitude >= 4.5);
  if (recent.length === 0) return null;

  const lines = recent.slice(0, 5).map(q =>
    `M${q.magnitude?.toFixed(1)} — <strong>${escHtml(q.place || 'Unknown')}</strong>`
  );
  return { title: 'Significant Earthquakes', icon: '🌍', items: lines };
}

function buildUnrestSection(data) {
  if (!data?.events && !data?.topics) return null;
  const events = data.events || (data.topics?.flatMap(t => t.events || []) || []);
  const recent = events.filter(e => {
    const sev = (e.severityLevel || e.severity || '').toLowerCase();
    return sev.includes('high');
  });
  if (recent.length === 0) return null;

  const lines = recent.slice(0, 5).map(e => {
    const loc = e.location?.name || e.country || '?';
    return `<strong>${escHtml(loc)}</strong>: ${escHtml((e.description || e.title || '').slice(0, 80))}`;
  });
  return { title: 'Civil Unrest', icon: '📢', items: lines };
}

// ---------- HTML Renderer ----------

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSitrepHtml(sections, generatedAt, aiNarrative) {
  const dateStr = new Date(generatedAt).toUTCString();

  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OSINTview SITREP — ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #fff; }
  .meta { font-size: 12px; color: #888; margin-bottom: 20px; }
  .section { background: #141414; border: 1px solid #252525; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .section-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; color: #fff; }
  .section-item { font-size: 13px; line-height: 1.5; margin-bottom: 4px; color: #ccc; }
  .section-item small { color: #888; }
  .section-item strong { color: #fff; }
  .narrative { background: #0c1a2a; border: 1px solid #1a3050; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .narrative p { font-size: 14px; line-height: 1.7; color: #d0d8e0; margin-bottom: 8px; }
  .narrative-label { font-size: 11px; color: #4a90d9; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .empty { color: #666; font-style: italic; padding: 20px; text-align: center; }
  @media print { body { background: #fff; color: #000; } .section { border-color: #ccc; background: #f9f9f9; } .section-item { color: #333; } .section-item strong { color: #000; } }
</style></head><body>
<h1>🌐 OSINTVIEW SITREP</h1>
<div class="meta">Generated ${dateStr} · Classification: OPEN SOURCE</div>`;

  if (aiNarrative) {
    html += `<div class="narrative"><div class="narrative-label">AI Executive Summary</div>`;
    const paragraphs = aiNarrative.split('\n').filter(p => p.trim());
    for (const p of paragraphs) {
      html += `<p>${escHtml(p)}</p>`;
    }
    html += `</div>`;
  }

  if (sections.length === 0) {
    html += `<div class="empty">No significant intelligence to report at this time.</div>`;
  }

  for (const section of sections) {
    html += `<div class="section"><div class="section-title">${section.icon} ${escHtml(section.title)}</div>`;
    for (const item of section.items) {
      // Items contain pre-escaped HTML with <strong> and <small> tags — pass through
      html += `<div class="section-item">${item}</div>`;
    }
    html += `</div>`;
  }

  html += `<div class="meta" style="margin-top:20px;text-align:center">OSINTview · osintworldview.vercel.app · Data sources: GDELT, VIEWS, WHO, Safecast, USGS, ACLED</div>`;
  html += `</body></html>`;
  return html;
}

// ---------- Optional Groq Narrative ----------

async function generateNarrative(sections) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  // Build a condensed text summary for Groq
  const sectionText = sections.map(s => {
    const itemsText = s.items.map(i => i.replace(/<[^>]+>/g, '')).join('; ');
    return `${s.title}: ${itemsText}`;
  }).join('\n\n');

  if (sectionText.length < 50) return null;

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `You are an intelligence analyst writing an executive summary for a daily situation report (SITREP). Write 2-3 paragraphs (150 words max) synthesizing the key themes across all data sections. Focus on: what's most urgent, geographic clusters of activity, and potential escalation risks. Be direct and factual — no speculation, no flowery language. Use present tense. Do NOT list individual items — synthesize patterns. Date: ${new Date().toISOString().split('T')[0]}.`,
          },
          {
            role: 'user',
            content: `Generate an executive summary from these intelligence sections:\n\n${sectionText}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

// ---------- Handler ----------

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return new Response(JSON.stringify({ error: 'Redis not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Parse query params
  const url = new URL(req.url);
  const format = url.searchParams.get('format') || 'html'; // 'html' or 'json'
  const includeAI = url.searchParams.get('ai') !== 'false'; // default: true

  // Fetch all data sources in parallel
  const [missiles, conflicts, diseases, radiation, gdeltIntel, poi, unrest, earthquakes] = await Promise.all([
    redisGet(redisUrl, redisToken, DATA_SOURCES.missiles),
    redisGet(redisUrl, redisToken, DATA_SOURCES.conflicts),
    redisGet(redisUrl, redisToken, DATA_SOURCES.diseases),
    redisGet(redisUrl, redisToken, DATA_SOURCES.radiation),
    redisGet(redisUrl, redisToken, DATA_SOURCES.gdeltIntel),
    redisGet(redisUrl, redisToken, DATA_SOURCES.poi),
    redisGet(redisUrl, redisToken, DATA_SOURCES.unrest),
    redisGet(redisUrl, redisToken, DATA_SOURCES.earthquakes),
  ]);
  const alerts = await redisLRange(redisUrl, redisToken, DATA_SOURCES.alerts, 0, 9);

  // Build sections
  const sections = [
    buildAlertSection(alerts),
    buildMissileSection(missiles),
    buildConflictSection(conflicts),
    buildDiseaseSection(diseases),
    buildRadiationSection(radiation),
    buildIntelSection(gdeltIntel),
    buildPOISection(poi),
    buildUnrestSection(unrest),
    buildQuakeSection(earthquakes),
  ].filter(Boolean);

  const generatedAt = Date.now();

  // Optionally generate AI narrative
  let aiNarrative = null;
  if (includeAI && sections.length >= 2) {
    aiNarrative = await generateNarrative(sections);
  }

  if (format === 'json') {
    return new Response(JSON.stringify({ sections, aiNarrative, generatedAt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=60', ...corsHeaders },
    });
  }

  const html = renderSitrepHtml(sections, generatedAt, aiNarrative);
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 's-maxage=60', ...corsHeaders },
  });
}
