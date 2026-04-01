export const config = { runtime: 'edge' };

// Simplified CORS helper mimicking existing _cors.js pattern
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
      throw new Error('Missing Redis credentials');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${redisUrl}/get/intelligence:entity-graph:v1`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Redis fetch failed with status: ${res.status}`);

    const data = await res.json();
    let unwrappedData = { nodes: [], links:[] };

    if (data.result) {
      const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      // Seed wrapped object unwrapping pattern
      unwrappedData = parsed.entityGraph || parsed; 
    }

    return new Response(JSON.stringify(unwrappedData), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=120, stale-while-revalidate=60'
      }
    });

  } catch (error) {
    console.error('[API] Entity Graph Error:', error.message);
    // Graceful fallback empty graph
    return new Response(JSON.stringify({ nodes: [], links:[] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}