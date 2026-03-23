import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const ALERTS_KEY = 'alerts:stream:v1';

let cached = null;
let cachedAt = 0;
const CACHE_TTL = 15_000; // 15s edge cache — alerts should feel responsive

async function readAlertList() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  // LRANGE returns the full list (up to 50 items based on seed trim)
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['LRANGE', ALERTS_KEY, '0', '49']),
    signal: AbortSignal.timeout(3_000),
  });
  if (!resp.ok) return null;

  const data = await resp.json();
  if (!data.result || !Array.isArray(data.result)) return null;

  // Each item is a JSON string — parse them
  const alerts = data.result
    .map(item => { try { return JSON.parse(item); } catch { return null; } })
    .filter(Boolean);

  return alerts;
}

async function fetchData() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL) return cached;

  const alerts = await readAlertList();

  // Return empty array (not null) when no alerts — this is a valid state
  const result = { alerts: alerts || [], fetchedAt: now };
  cached = result;
  cachedAt = now;
  return result;
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

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=15, stale-while-revalidate=10',
      ...corsHeaders,
    },
  });
}
