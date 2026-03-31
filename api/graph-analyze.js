import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge', maxDuration: 25 };

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured', analysis: null }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const graphDesc = body.graph;

    if (!graphDesc || typeof graphDesc !== 'string' || graphDesc.length < 10) {
      return new Response(JSON.stringify({ error: 'Invalid graph data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Truncate to prevent abuse
    const truncated = graphDesc.slice(0, 4000);

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are a senior intelligence analyst examining a link analysis graph. The user has built a graph of entities (countries, people, organizations, events, topics) with discovered connections between them.

Your task: Analyze the graph structure and provide actionable intelligence insights. Cover these areas in 3-5 paragraphs (250 words max):

1. NETWORK STRUCTURE: Identify the central hub(s), any clusters, and what the overall topology reveals about power dynamics or influence flows.

2. CRITICAL LINKS: Which connections are the most strategically significant? Which connections, if severed, would most disrupt the network?

3. HIDDEN PATTERNS: What patterns emerge from the connection strengths and entity categories? Any unexpected clusters or absence of expected connections?

4. RISK ASSESSMENT: Based on the graph, what are the top 2-3 escalation risks or emerging threats?

5. GAPS: What entities or connections are conspicuously absent that an analyst should investigate?

Be direct, factual, and specific. Reference actual entity names and connections from the graph. No generic boilerplate. Date: ${new Date().toISOString().split('T')[0]}.`,
          },
          {
            role: 'user',
            content: `Analyze this intelligence link graph:\n\n${truncated}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      return new Response(JSON.stringify({ error: `Groq API error: ${resp.status}`, detail: errText, analysis: null }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const analysis = data.choices?.[0]?.message?.content?.trim() || null;

    return new Response(JSON.stringify({ analysis }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Analysis failed', detail: String(err), analysis: null }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
