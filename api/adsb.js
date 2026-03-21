import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const ADSB_URL = 'https://api.adsb.one/v2/all';

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  // Block disallowed origins
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const upstream = await fetch(ADSB_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(25000),
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `ADSB upstream HTTP ${upstream.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const body = await upstream.text();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache for 15s at the edge, serve stale for 30s while revalidating
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `ADSB proxy error: ${err.message}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
