import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Warcam API — serves geolocated conflict zone media entries.
// Each entry has coordinates, timestamp, title, social image, source, and severity.

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

  try {
    const resp = await fetch(`${redisUrl}/get/${encodeURIComponent('intelligence:warcam:v1')}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ entries: [], error: 'Redis error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const data = await resp.json();
    if (!data.result) {
      return new Response(JSON.stringify({ entries: [], entryCount: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=60', ...corsHeaders },
      });
    }

    const parsed = JSON.parse(data.result);
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=60', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err), entries: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
