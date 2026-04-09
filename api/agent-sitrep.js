import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const REDIS_KEY = 'intelligence:agent-sitrep:v1';

let cached = null;
let cachedAt = 0;
const CACHE_TTL = 60_000; // 1min edge cache

async function readFromRedis(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3_000),
  });
  if (!resp.ok) return null;

  const data = await resp.json();
  if (!data.result) return null;

  try { return JSON.parse(data.result); } catch { return null; }
}

async function fetchData() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL) return cached;

  const data = await readFromRedis(REDIS_KEY);
  if (!data) return null;

  cached = data;
  cachedAt = now;
  return data;
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHtml(sitrep) {
  const dateStr = new Date(sitrep.generated_at || Date.now()).toUTCString();
  const threatColors = { critical: '#ef4444', high: '#f97316', elevated: '#eab308', moderate: '#22c55e', low: '#6b7280' };
  const threatColor = threatColors[sitrep.overall_threat_level] || '#888';

  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent SITREP — ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #fff; }
  .threat-badge { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .meta { font-size: 12px; color: #888; margin-bottom: 20px; }
  .executive { background: #0c1a2a; border: 1px solid #1a3050; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .executive p { font-size: 14px; line-height: 1.7; color: #d0d8e0; margin-bottom: 8px; }
  .executive-label { font-size: 11px; color: #4a90d9; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .section { background: #141414; border: 1px solid #252525; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .section-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; color: #fff; display: flex; align-items: center; gap: 8px; }
  .section-risk { font-size: 10px; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; font-weight: 700; }
  .section-content { font-size: 13px; line-height: 1.6; color: #ccc; }
  .watchlist { background: #1a1200; border: 1px solid #3a2a00; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .watchlist-title { font-size: 15px; font-weight: 700; color: #fbbf24; margin-bottom: 8px; }
  .watchlist-item { font-size: 13px; color: #ccc; padding: 4px 0; }
  .footer { font-size: 11px; color: #555; text-align: center; margin-top: 20px; }
  @media print { body { background: #fff; color: #000; } .section { border-color: #ccc; background: #f9f9f9; } .executive { background: #f0f4ff; border-color: #c0d0e0; } }
</style></head><body>
<h1>🤖 AGENT SITREP</h1>
<div class="meta">
  <span class="threat-badge" style="background:${threatColor};color:#fff">${escHtml(sitrep.overall_threat_level || 'unknown')} threat</span>
  · Generated ${dateStr} · Model: ${escHtml(sitrep.model || 'unknown')}
</div>`;

  // Executive summary
  if (sitrep.executive_summary) {
    html += `<div class="executive"><div class="executive-label">Executive Summary</div>`;
    const paragraphs = sitrep.executive_summary.split('\n').filter(p => p.trim());
    for (const p of paragraphs) {
      html += `<p>${escHtml(p)}</p>`;
    }
    html += `</div>`;
  }

  // Sections
  for (const section of (sitrep.sections || [])) {
    const riskColor = threatColors[section.risk_level] || '#888';
    const riskBadge = section.risk_level
      ? `<span class="section-risk" style="background:${riskColor};color:#fff">${escHtml(section.risk_level)}</span>`
      : '';
    html += `<div class="section"><div class="section-title">${escHtml(section.title)} ${riskBadge}</div>`;
    html += `<div class="section-content">${escHtml(section.content)}</div>`;
    html += `</div>`;
  }

  // Watch list
  if (sitrep.watch_list && sitrep.watch_list.length > 0) {
    html += `<div class="watchlist"><div class="watchlist-title">⚠️ Watch List</div>`;
    for (const item of sitrep.watch_list) {
      html += `<div class="watchlist-item">• ${escHtml(item)}</div>`;
    }
    html += `</div>`;
  }

  html += `<div class="footer">OSINTview Agent SITREP · osintworldview.vercel.app · Powered by Groq + Llama 3.1</div>`;
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

  const data = await fetchData();

  if (!data) {
    return new Response(JSON.stringify({ error: 'Agent SITREP not yet generated. Run agent-sitrep.mjs seed to generate.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...corsHeaders },
    });
  }

  // Support JSON format
  const url = new URL(req.url);
  if (url.searchParams.get('format') === 'json') {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=60', ...corsHeaders },
    });
  }

  const html = renderHtml(data);
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 's-maxage=60', ...corsHeaders },
  });
}
