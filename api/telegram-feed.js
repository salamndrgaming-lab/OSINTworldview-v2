import { getRelayBaseUrl, getRelayHeaders, fetchWithTimeout } from './_relay.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

/** Try to read cached telegram data from Redis */
async function getRedisNarratives() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return null;

  try {
    const resp = await fetch(`${redisUrl}/get/telegram:narratives:v1`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json.result) return null;
    const data = typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
    return data;
  } catch {
    return null;
  }
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
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const relayBaseUrl = getRelayBaseUrl();

  // If relay is not configured, try Redis narrative cache as fallback
  if (!relayBaseUrl) {
    const cached = await getRedisNarratives();
    if (cached) {
      return new Response(JSON.stringify({
        items: cached.messages || [],
        count: (cached.messages || []).length,
        configured: false,
        source: 'redis-narrative-cache',
        cachedAt: cached.cachedAt || null,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60',
          ...corsHeaders,
        },
      });
    }

    return new Response(JSON.stringify({
      items: [],
      count: 0,
      configured: false,
      note: 'Telegram feed requires WS_RELAY_URL. Set it in Vercel environment variables.',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        ...corsHeaders,
      },
    });
  }

  // Relay is configured — proxy through to it
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const topic = (url.searchParams.get('topic') || '').trim();
    const channel = (url.searchParams.get('channel') || '').trim();
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (topic) params.set('topic', encodeURIComponent(topic));
    if (channel) params.set('channel', encodeURIComponent(channel));

    const relayUrl = `${relayBaseUrl}/telegram/feed?${params}`;
    const response = await fetchWithTimeout(relayUrl, {
      headers: getRelayHeaders({ Accept: 'application/json' }),
    }, 15000);

    const body = await response.text();

    let cacheControl = 'public, max-age=30, s-maxage=120, stale-while-revalidate=60, stale-if-error=120';
    try {
      const parsed = JSON.parse(body);
      if (!parsed || parsed.count === 0 || !parsed.items || parsed.items.length === 0) {
        cacheControl = 'public, max-age=0, s-maxage=15, stale-while-revalidate=10';
      }
    } catch {}

    return new Response(body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': cacheControl,
        ...corsHeaders,
      },
    });
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';

    // On relay failure, try Redis fallback before returning empty
    const cached = await getRedisNarratives();
    if (cached) {
      return new Response(JSON.stringify({
        items: cached.messages || [],
        count: (cached.messages || []).length,
        configured: true,
        source: 'redis-narrative-cache',
        relayError: isTimeout ? 'timeout' : 'failed',
        cachedAt: cached.cachedAt || null,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
          ...corsHeaders,
        },
      });
    }

    return new Response(JSON.stringify({
      items: [],
      count: 0,
      configured: true,
      error: isTimeout ? 'Relay timeout' : 'Relay request failed',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        ...corsHeaders,
      },
    });
  }
}
