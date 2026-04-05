import { getRelayBaseUrl, getRelayHeaders, fetchWithTimeout } from './_relay.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { validateApiKey } from './_api-key.js';

export const config = { runtime: 'edge' };

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

  const relayBaseUrl = getRelayBaseUrl();

  // If relay is not configured, try Redis snapshot from seed-ais-vessels
  if (!relayBaseUrl) {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (redisUrl && redisToken) {
      try {
        const resp = await fetch(`${redisUrl}/get/${encodeURIComponent('ais:snapshot:latest')}`, {
          headers: { Authorization: `Bearer ${redisToken}` },
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const body = await resp.json();
          if (body.result) {
            const data = typeof body.result === 'string' ? JSON.parse(body.result) : body.result;
            if (data.vessels && data.vessels.length > 0) {
              return new Response(JSON.stringify(data), {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120',
                  ...corsHeaders,
                },
              });
            }
          }
        }
      } catch {
        // Redis read failed — fall through to empty response
      }
    }

    return new Response(JSON.stringify({
      vessels: [],
      timestamp: new Date().toISOString(),
      configured: false,
      note: 'AIS vessel tracking: no relay configured and no seed snapshot available. Run seed-ais-vessels.mjs or configure WS_RELAY_URL.',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120',
        ...corsHeaders,
      },
    });
  }

  // Relay is configured — proxy through
  const keyCheck = validateApiKey(req);
  if (keyCheck.required && !keyCheck.valid) {
    return new Response(JSON.stringify({ error: keyCheck.error }), {
      status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const requestUrl = new URL(req.url);
    const search = requestUrl.search || '';
    const relayUrl = `${relayBaseUrl}/ais/snapshot${search}`;
    const response = await fetchWithTimeout(relayUrl, {
      headers: getRelayHeaders({ Accept: 'application/json' }),
    }, 12000);

    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': response.ok
          ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=900'
          : 'public, max-age=10, s-maxage=30, stale-while-revalidate=120',
        ...corsHeaders,
      },
    });
  } catch (error) {
    // On relay failure, return empty gracefully
    return new Response(JSON.stringify({
      vessels: [],
      timestamp: new Date().toISOString(),
      configured: true,
      error: `AIS relay error: ${error?.message || 'unknown'}`,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        ...corsHeaders,
      },
    });
  }
}
