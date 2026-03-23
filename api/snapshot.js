import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Snapshot API — retrieves archived intelligence data for a specific date.
//
// Usage:
//   GET /api/snapshot              → returns list of available dates
//   GET /api/snapshot?date=2026-03-23  → returns the snapshot for that date
//   GET /api/snapshot?date=2026-03-23&format=json  → JSON format

const SNAPSHOT_PREFIX = 'snapshots:';

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

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderIndexHtml(dates) {
  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Time Machine — Available Snapshots</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 600px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 16px; color: #fff; }
  .date-link { display: block; background: #141414; border: 1px solid #252525; border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; color: #4a90d9; text-decoration: none; font-size: 14px; }
  .date-link:hover { background: #1a1a2a; border-color: #4a90d9; }
  .empty { color: #666; font-style: italic; padding: 20px; text-align: center; }
</style></head><body>
<h1>⏱️ Time Machine — Snapshots</h1>`;

  if (dates.length === 0) {
    html += `<div class="empty">No snapshots available yet. Snapshots are created daily during seed runs.</div>`;
  } else {
    for (const date of dates) {
      html += `<a class="date-link" href="/api/snapshot?date=${escHtml(date)}">${escHtml(date)}</a>`;
    }
  }

  html += `</body></html>`;
  return html;
}

function renderSnapshotHtml(snapshot) {
  const date = snapshot.date || 'Unknown';
  const created = snapshot.createdAt ? new Date(snapshot.createdAt).toUTCString() : 'Unknown';
  const sources = snapshot.sources || {};

  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snapshot — ${escHtml(date)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #fff; }
  .meta { font-size: 12px; color: #888; margin-bottom: 20px; }
  .section { background: #141414; border: 1px solid #252525; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .section-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; color: #fff; }
  .section-detail { font-size: 13px; color: #ccc; line-height: 1.5; margin-bottom: 4px; }
  .nav { margin-bottom: 16px; }
  .nav a { color: #4a90d9; text-decoration: none; font-size: 13px; }
</style></head><body>
<div class="nav"><a href="/api/snapshot">← All Snapshots</a></div>
<h1>⏱️ Snapshot: ${escHtml(date)}</h1>
<div class="meta">Archived ${created} · ${Object.keys(sources).length} data sources</div>`;

  // Render each source section
  const sectionIcons = {
    missiles: '🚀', gdeltIntel: '🔍', poi: '👤', conflictForecast: '📊',
    diseaseOutbreaks: '🦠', radiation: '☢️', unrest: '📢', earthquakes: '🌍',
    cyberThreats: '🔓', marketQuotes: '📈', commodityQuotes: '🛢️',
    predictions: '🔮', iranEvents: '🇮🇷', naturalEvents: '🌊',
    weatherAlerts: '⛈️', outages: '📡', agentSitrep: '🤖', insights: '💡',
  };

  for (const [key, data] of Object.entries(sources)) {
    const icon = sectionIcons[key] || '📄';
    const title = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
    html += `<div class="section"><div class="section-title">${icon} ${escHtml(title)}</div>`;

    // Render key details from each summarized source
    if (data.eventCount != null) html += `<div class="section-detail">Events: ${data.eventCount}</div>`;
    if (data.forecastCount != null) html += `<div class="section-detail">Forecasts: ${data.forecastCount}</div>`;
    if (data.personCount != null) html += `<div class="section-detail">Persons: ${data.personCount}</div>`;
    if (data.readingCount != null) html += `<div class="section-detail">Readings: ${data.readingCount} (${data.anomalyCount || 0} anomalies)</div>`;
    if (data.overall_threat_level) html += `<div class="section-detail">Threat level: ${escHtml(data.overall_threat_level.toUpperCase())}</div>`;
    if (data.executive_summary) html += `<div class="section-detail">${escHtml(data.executive_summary)}</div>`;
    if (data.count != null) html += `<div class="section-detail">Items: ${data.count}</div>`;
    if (data.total != null) html += `<div class="section-detail">Total: ${data.total}</div>`;

    // Show top items if present
    const items = data.events || data.forecasts || data.persons || data.topMovers || data.significant || [];
    for (const item of items.slice(0, 5)) {
      const label = item.title || item.countryName || item.name || item.symbol || item.place || '';
      if (label) html += `<div class="section-detail" style="opacity:.7">• ${escHtml(String(label).slice(0, 120))}</div>`;
    }

    if (data.topics) {
      for (const t of data.topics.slice(0, 6)) {
        html += `<div class="section-detail" style="opacity:.7">• ${escHtml(t.id)}: ${t.articleCount || 0} articles</div>`;
      }
    }

    html += `</div>`;
  }

  html += `</body></html>`;
  return html;
}

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

  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const format = url.searchParams.get('format') || 'html';

  // No date specified → return index of available snapshots
  if (!date) {
    const index = await redisGet(redisUrl, redisToken, `${SNAPSHOT_PREFIX}index`);
    const dates = Array.isArray(index) ? index : [];

    if (format === 'json') {
      return new Response(JSON.stringify({ dates }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=60', ...corsHeaders },
      });
    }

    return new Response(renderIndexHtml(dates), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 's-maxage=60', ...corsHeaders },
    });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Fetch the snapshot
  const snapshot = await redisGet(redisUrl, redisToken, `${SNAPSHOT_PREFIX}${date}`);

  if (!snapshot) {
    return new Response(JSON.stringify({ error: `No snapshot found for ${date}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (format === 'json') {
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=300', ...corsHeaders },
    });
  }

  return new Response(renderSnapshotHtml(snapshot), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 's-maxage=300', ...corsHeaders },
  });
}
