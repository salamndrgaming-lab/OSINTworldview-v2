// Copyright (C) 2026 Chip / salamndrgaming-lab
import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

// GET /api/council/synthesis
// Returns the Chair's cross-domain synthesis from council:synthesis:v1
// Also supports ?agent=<id> to fetch individual agent reports.

async function redisGet(url, token, key) {
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return null; }
}

const AGENT_KEYS = {
  'game-theorist':       'council:game-theory:v1',
  'network-analyst':     'council:network-analysis:v1',
  'complexity-theorist': 'council:complexity-analysis:v1',
  'behavioral-analyst':  'council:behavioral-analysis:v1',
  'historian':           'council:historical-analogues:v1',
  'signals-officer':     'council:signal-analysis:v1',
};

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return new Response(JSON.stringify({ error: 'Redis not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent');

  // Individual agent report
  if (agentId && AGENT_KEYS[agentId]) {
    const data = await redisGet(redisUrl, redisToken, AGENT_KEYS[agentId]);
    return new Response(JSON.stringify(data || { findings: [], summary: '', agentId }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=120, stale-if-error=3600',
        ...corsHeaders,
      },
    });
  }

  // Full synthesis
  const data = await redisGet(redisUrl, redisToken, 'council:synthesis:v1');

  if (!data) {
    return new Response(JSON.stringify({
      crossDomainFindings: [],
      overallAssessment: '',
      threatLevel: 'guarded',
      topPriority: '',
      watchItems: [],
      agentReports: [],
      meta: null,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        ...corsHeaders,
      },
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=120, stale-if-error=3600',
      ...corsHeaders,
    },
  });
}
