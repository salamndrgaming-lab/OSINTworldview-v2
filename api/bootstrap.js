export const config = { runtime: 'edge' };

import { cors } from './_cors.js';

const BOOTSTRAP_CACHE_KEYS = {
  earthquakes: 'earthquakes:v3',
  threats: 'threats:v2',
  planes: 'planes:v2',
  markets: 'market:commodities-bootstrap:v1',
  chokepoints: 'supply_chain:chokepoints:v4',
  poi: 'intelligence:poi:v1',
  telegramNarratives: 'telegram:narratives:v1',
  entityGraph: 'intelligence:entity-graph:v1' // Added in Session 8
};

const SLOW_KEYS = new Set([
  'supply_chain:chokepoints:v4', 
  'market:commodities-bootstrap:v1',
  'intelligence:poi:v1',
  'telegram:narratives:v1',
  'intelligence:entity-graph:v1' // Added in Session 8
]);

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors() });
  }

  try {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error("Missing Redis configuration credentials.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const keysToFetch = Object.values(BOOTSTRAP_CACHE_KEYS);

    const mgetRes = await fetch(`${upstashUrl}/mget`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${upstashToken}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(keysToFetch),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!mgetRes.ok) {
      throw new Error(`Redis MGET failed with status ${mgetRes.status}`);
    }

    const mgetData = await mgetRes.json();
    const resultsArray = mgetData.result ||[];

    const aggregate = {};
    const friendlyKeys = Object.keys(BOOTSTRAP_CACHE_KEYS);

    friendlyKeys.forEach((friendlyKey, index) => {
      const rawValue = resultsArray[index];
      let parsed =[];
      
      if (rawValue) {
        try {
          const decoded = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
          // Seed wrapped object unwrapping pattern
          parsed = decoded[friendlyKey] || decoded.data || decoded.items || decoded;
          
          // Graceful fallback for empty/invalid wrapper scenarios
          if (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0) {
            parsed =[];
          }
        } catch (e) {
          console.error(`[Bootstrap] Error parsing key ${friendlyKey}:`, e);
          parsed = [];
        }
      }
      
      aggregate[friendlyKey] = parsed;
    });

    return new Response(JSON.stringify(aggregate), {
      status: 200,
      headers: {
        ...cors(),
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=60, stale-while-revalidate=30'
      }
    });

  } catch (error) {
    console.error('[Bootstrap] Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors(), 'Content-Type': 'application/json' }
    });
  }
}