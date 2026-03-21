import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Browser-like UA — free ADS-B aggregators commonly block bare server fetches
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Multiple free ADS-B aggregators with the same v2 API shape.
// airplanes.live is the most permissive with server-side access.
const SOURCES = [
  'https://api.airplanes.live/v2',
  'https://api.adsb.lol/v2',
  'https://api.adsb.one/v2',
];

async function tryFetch(url, timeoutMs = 20000) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Support optional geographic query params: ?lat=X&lon=Y&dist=Z
  // Falls back to /all if no params given
  const url = new URL(req.url);
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  const dist = url.searchParams.get('dist') || '250';

  // Build the path — either regional or global
  const path = lat && lon ? `/lat/${lat}/lon/${lon}/dist/${dist}` : '/all';

  const errors = [];

  for (const base of SOURCES) {
    try {
      const upstream = await tryFetch(`${base}${path}`);
      const body = await upstream.text();

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20',
          'X-ADSB-Source': new URL(base).hostname,
          ...corsHeaders,
        },
      });
    } catch (err) {
      errors.push(`${new URL(base).hostname}: ${err.message}`);
    }
  }

  return new Response(JSON.stringify({ error: 'All ADSB sources failed', details: errors }), {
    status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
