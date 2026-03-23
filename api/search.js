import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Upstash Vector search endpoint.
// Accepts a natural language query via ?q= parameter, searches the vector index
// using Upstash's built-in embedding model, and returns the top-K most
// semantically similar intelligence items with metadata.
//
// Usage:
//   GET /api/search?q=missile+strikes+in+ukraine
//   GET /api/search?q=disease+outbreak+africa&type=disease-outbreak
//   GET /api/search?q=nuclear+threat&k=20
//
// Query params:
//   q       - Natural language search query (required)
//   k       - Number of results to return (default: 10, max: 50)
//   type    - Filter by metadata type (optional: gdelt-intel, missile-strike,
//             disease-outbreak, conflict-forecast, poi, agent-sitrep, alert, unrest)

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function vectorQueryData(query, topK, filter) {
  const vectorUrl = process.env.UPSTASH_VECTOR_REST_URL;
  const vectorToken = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!vectorUrl || !vectorToken) return null;

  const body = {
    data: query,
    topK,
    includeMetadata: true,
    includeData: true,
  };

  // Add metadata filter if specified
  if (filter) {
    body.filter = filter;
  }

  const resp = await fetch(`${vectorUrl}/query-data`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vectorToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error(`Vector query failed: ${resp.status} — ${errText.slice(0, 200)}`);
    return null;
  }

  return resp.json();
}

function renderHtml(query, results, generatedAt) {
  const dateStr = new Date(generatedAt).toUTCString();

  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Intelligence Search — ${escHtml(query)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 18px; margin-bottom: 4px; color: #fff; }
  .meta { font-size: 12px; color: #888; margin-bottom: 16px; }
  .search-box { display: flex; gap: 8px; margin-bottom: 20px; }
  .search-box input { flex: 1; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 10px 14px; color: #fff; font-size: 14px; outline: none; }
  .search-box input:focus { border-color: #4a90d9; }
  .search-box button { background: #4a90d9; color: #fff; border: none; border-radius: 6px; padding: 10px 18px; font-size: 14px; cursor: pointer; }
  .result { background: #141414; border: 1px solid #252525; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
  .result-score { font-size: 11px; color: #4a90d9; font-weight: 700; float: right; }
  .result-type { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; padding: 2px 6px; border-radius: 3px; display: inline-block; margin-bottom: 6px; }
  .result-text { font-size: 13px; line-height: 1.5; color: #ccc; }
  .result-meta { font-size: 11px; color: #888; margin-top: 6px; }
  .empty { color: #666; font-style: italic; padding: 20px; text-align: center; }
</style></head><body>
<h1>🔍 Intelligence Search</h1>
<div class="meta">${results.length} results · ${dateStr}</div>
<form class="search-box" method="GET" action="/api/search">
  <input type="text" name="q" value="${escHtml(query)}" placeholder="Search intelligence...">
  <button type="submit">Search</button>
</form>`;

  if (results.length === 0) {
    html += `<div class="empty">No results found for "${escHtml(query)}"</div>`;
  }

  const typeColors = {
    'gdelt-intel': '#3b82f6', 'missile-strike': '#ef4444', 'disease-outbreak': '#f59e0b',
    'conflict-forecast': '#dc2626', 'poi': '#8b5cf6', 'agent-sitrep': '#06b6d4',
    'alert': '#f97316', 'unrest': '#eab308',
  };

  for (const r of results) {
    const score = ((r.score || 0) * 100).toFixed(1);
    const type = r.metadata?.type || 'unknown';
    const color = typeColors[type] || '#888';
    const text = r.data || '';
    const metaParts = [];
    if (r.metadata?.country || r.metadata?.country_name) metaParts.push(r.metadata.country_name || r.metadata.country);
    if (r.metadata?.location) metaParts.push(r.metadata.location);
    if (r.metadata?.severity || r.metadata?.risk_level) metaParts.push((r.metadata.severity || r.metadata.risk_level).toUpperCase());
    if (r.metadata?.source) metaParts.push(r.metadata.source);
    if (r.metadata?.url) metaParts.push(`<a href="${escHtml(r.metadata.url)}" target="_blank" rel="noopener" style="color:#4a90d9">source</a>`);

    html += `<div class="result">
      <span class="result-score">${score}% match</span>
      <span class="result-type" style="background:${color};color:#fff">${escHtml(type)}</span>
      <div class="result-text">${escHtml(text)}</div>
      ${metaParts.length > 0 ? `<div class="result-meta">${metaParts.join(' · ')}</div>` : ''}
    </div>`;
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

  const url = new URL(req.url);
  const query = url.searchParams.get('q')?.trim();
  const topK = Math.min(parseInt(url.searchParams.get('k') || '10', 10) || 10, 50);
  const typeFilter = url.searchParams.get('type');
  const format = url.searchParams.get('format') || 'html';

  if (!query) {
    if (format === 'json') {
      return new Response(JSON.stringify({ error: 'Missing query parameter "q"', results: [] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    // Show empty search page
    const html = renderHtml('', [], Date.now());
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
    });
  }

  // Build metadata filter if type specified
  const filter = typeFilter ? `type = '${typeFilter.replace(/'/g, '')}'` : undefined;

  const vectorResult = await vectorQueryData(query, topK, filter);

  if (!vectorResult) {
    const errMsg = !process.env.UPSTASH_VECTOR_REST_URL
      ? 'Upstash Vector not configured. Add UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN environment variables.'
      : 'Vector search temporarily unavailable';
    if (format === 'json') {
      return new Response(JSON.stringify({ error: errMsg, results: [] }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    return new Response(`<html><body style="background:#0a0a0a;color:#e0e0e0;padding:24px;font-family:sans-serif"><h1>Search Unavailable</h1><p>${errMsg}</p></body></html>`, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
    });
  }

  // Upstash Vector returns { result: [...] } with score, id, metadata, data
  const results = (vectorResult.result || vectorResult || []).map(r => ({
    id: r.id,
    score: r.score,
    data: r.data || '',
    metadata: r.metadata || {},
  }));

  if (format === 'json') {
    return new Response(JSON.stringify({ query, results, count: results.length, generatedAt: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=30', ...corsHeaders },
    });
  }

  const html = renderHtml(query, results, Date.now());
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 's-maxage=30', ...corsHeaders },
  });
}
