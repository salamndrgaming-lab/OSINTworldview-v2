/**
 * /api/poi.ts — Persons of Interest API Endpoint
 * World Monitor OSINT Platform
 *
 * Reads the intelligence:poi:v1 key from Upstash Redis
 * and returns the POI data for the frontend panel.
 *
 * Drop into: api/poi.ts
 */

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request): Promise<Response> {
  const KV_REST_API_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    return new Response(
      JSON.stringify({
        persons: [],
        error: 'Redis not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN.',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  try {
    const redisRes = await fetch(
      `${KV_REST_API_URL}/get/intelligence:poi:v1`,
      {
        headers: {
          Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        },
      }
    );

    if (!redisRes.ok) {
      throw new Error(`Redis HTTP ${redisRes.status}`);
    }

    const redisData = await redisRes.json();

    if (!redisData.result) {
      // Key doesn't exist yet — seed hasn't run
      return new Response(
        JSON.stringify({
          persons: [],
          _meta: { source: 'redis', key: 'intelligence:poi:v1', status: 'empty — run /seed or wait for GitHub Actions' },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
          },
        }
      );
    }

    // Redis stores as string — parse it
    let poiData;
    if (typeof redisData.result === 'string') {
      poiData = JSON.parse(redisData.result);
    } else {
      poiData = redisData.result;
    }

    // Ensure it has the expected shape
    if (!poiData.persons) {
      poiData = { persons: Array.isArray(poiData) ? poiData : [] };
    }

    return new Response(JSON.stringify(poiData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=120, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[/api/poi] Error:', err);
    return new Response(
      JSON.stringify({
        persons: [],
        error: `Failed to read POI data: ${(err as Error).message}`,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
