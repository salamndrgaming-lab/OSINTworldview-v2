import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Primary and fallback ADS-B aggregators (both free, no key required)
const ADSB_SOURCES = [
  'https://api.adsb.one/v2/all',
  'https://api.adsb.lol/v2/all',
];

// Browser-like UA — many ADS-B aggregators reject bare server fetches
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function tryFetch(url, timeoutMs = 25000) {
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': BROWSER_UA,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res;
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const errors = [];

  // Try each source in order; first success wins
  for (const url of ADSB_SOURCES) {
    try {
      const upstream = await tryFetch(url);
      const body = await upstream.text();

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
          'X-ADSB-Source': new URL(url).hostname,
          ...corsHeaders,
        },
      });
    } catch (err) {
      errors.push(`${new URL(url).hostname}: ${err.message}`);
    }
  }

  // All sources failed
  return new Response(JSON.stringify({ error: 'All ADSB sources failed', details: errors }), {
    status: 502,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
