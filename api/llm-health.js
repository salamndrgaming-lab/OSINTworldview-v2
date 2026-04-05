import { getCorsHeaders } from './_cors.js';

export const config = { runtime: 'edge' };

// GET /api/llm-health
// Returns LLM provider availability status for the LlmStatusIndicator header widget.
// Checks Groq API reachability with a minimal request.

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  const providers = [];

  // Check Groq
  if (groqKey) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: 'Bearer ' + groqKey },
        signal: AbortSignal.timeout(5000),
      });
      providers.push({
        name: 'Groq',
        url: 'api.groq.com',
        available: resp.ok,
      });
    } catch {
      providers.push({ name: 'Groq', url: 'api.groq.com', available: false });
    }
  }

  // Check OpenRouter
  if (openrouterKey) {
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: 'Bearer ' + openrouterKey },
        signal: AbortSignal.timeout(5000),
      });
      providers.push({
        name: 'OpenRouter',
        url: 'openrouter.ai',
        available: resp.ok,
      });
    } catch {
      providers.push({ name: 'OpenRouter', url: 'openrouter.ai', available: false });
    }
  }

  if (providers.length === 0) {
    providers.push({ name: 'None', url: '', available: false });
  }

  const available = providers.some(p => p.available);

  return new Response(JSON.stringify({
    available,
    providers,
    checkedAt: Date.now(),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=30, stale-while-revalidate=30',
      ...corsHeaders,
    },
  });
}
