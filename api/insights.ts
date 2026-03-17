/**
 * /api/insights.ts — Groq AI Insights Endpoint
 * World Monitor OSINT Platform
 *
 * Vercel Edge Function that:
 * 1. Reads aggregated intelligence data from Redis
 * 2. Sends it to Groq API for structured analysis
 * 3. Returns formatted insights for the dashboard
 *
 * Drop into: api/insights.ts (Vercel edge functions directory)
 *
 * Required env vars:
 *   GROQ_API_KEY — Groq API key
 *   KV_REST_API_URL — Upstash Redis REST URL
 *   KV_REST_API_TOKEN — Upstash Redis REST token
 */

interface Env {
  GROQ_API_KEY: string;
  KV_REST_API_URL: string;
  KV_REST_API_TOKEN: string;
}

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  model: string;
}

// ── Redis helper ─────────────────────────────────────────────────────────────

async function redisGet(key: string, env: Env): Promise<unknown | null> {
  try {
    const res = await fetch(`${env.KV_REST_API_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${env.KV_REST_API_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.result && typeof data.result === 'string') {
      try {
        return JSON.parse(data.result);
      } catch {
        return data.result;
      }
    }
    return data.result;
  } catch {
    return null;
  }
}

// ── Groq API call ────────────────────────────────────────────────────────────

async function callGroq(messages: GroqMessage[], env: Env): Promise<{ content: string; model: string }> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      messages,
      temperature: 0.3,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data: GroqResponse = await res.json();
  return {
    content: data.choices[0]?.message?.content || '{}',
    model: data.model || 'llama-3.1-70b-versatile',
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(request: Request): Promise<Response> {
  const env: Env = {
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    KV_REST_API_URL: process.env.KV_REST_API_URL || '',
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN || '',
  };

  if (!env.GROQ_API_KEY || !env.KV_REST_API_URL) {
    return new Response(
      JSON.stringify({
        brief: 'Groq API not configured. Set GROQ_API_KEY environment variable.',
        generatedAt: new Date().toISOString(),
        model: 'offline',
        insights: [],
        threatLevel: 'stable',
        topTrends: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // ── Gather intelligence data from Redis ──────────────────────────────

    const [poiData, threatsData, marketsData, newsData, quakesData] = await Promise.all([
      redisGet('intelligence:poi:v1', env),
      redisGet('intelligence:threats', env),
      redisGet('intelligence:markets', env),
      redisGet('intelligence:news', env),
      redisGet('intelligence:quakes', env),
    ]);

    // Build context summary for Groq (token-efficient)
    const contextParts: string[] = [];

    if (poiData && typeof poiData === 'object' && 'persons' in (poiData as Record<string, unknown>)) {
      const persons = (poiData as { persons: Array<Record<string, unknown>> }).persons;
      const poiSummary = persons.slice(0, 15).map((p) =>
        `${p.name} (${p.role}): risk=${p.riskLevel}, activity=${p.activityScore}, tone=${p.averageTone}, location=${p.lastKnownLocation}`
      ).join('\n');
      contextParts.push(`## Tracked Persons of Interest (${persons.length} total)\n${poiSummary}`);
    }

    if (threatsData) {
      const threats = typeof threatsData === 'string' ? threatsData : JSON.stringify(threatsData).slice(0, 1500);
      contextParts.push(`## Current Threat Reports\n${threats}`);
    }

    if (marketsData) {
      const markets = typeof marketsData === 'string' ? marketsData : JSON.stringify(marketsData).slice(0, 800);
      contextParts.push(`## Market Data\n${markets}`);
    }

    if (newsData) {
      const news = typeof newsData === 'string' ? newsData : JSON.stringify(newsData).slice(0, 1200);
      contextParts.push(`## Recent News Headlines\n${news}`);
    }

    if (quakesData) {
      const quakes = typeof quakesData === 'string' ? quakesData : JSON.stringify(quakesData).slice(0, 500);
      contextParts.push(`## Seismic Activity\n${quakes}`);
    }

    const context = contextParts.join('\n\n');

    // ── Call Groq for analysis ───────────────────────────────────────────

    const systemPrompt = `You are an elite OSINT intelligence analyst for the World Monitor platform. 
Analyze the provided intelligence data and produce a structured JSON assessment.

Respond with ONLY valid JSON matching this exact schema:
{
  "brief": "2-4 sentence executive summary of the current global intelligence picture",
  "threatLevel": "stable" | "elevated" | "high" | "critical",
  "topTrends": ["trend1", "trend2", "trend3"],
  "insights": [
    {
      "id": "unique-id",
      "type": "brief" | "threat" | "poi_highlight" | "trend" | "entity_link" | "market" | "geopolitical",
      "title": "Short insight title",
      "content": "Detailed analysis (2-3 sentences)",
      "severity": "info" | "watch" | "warning" | "critical",
      "confidence": 0.0-1.0,
      "timestamp": "ISO date string",
      "sources": ["source names"],
      "relatedPOIs": ["person names from POI data"],
      "tags": ["relevant tags"],
      "region": "optional region name"
    }
  ]
}

Generate 5-12 insights covering:
- Threat assessments (any critical/high risk POIs or threat patterns)
- POI activity highlights (notable changes in activity scores or sentiment)
- Geopolitical trends (based on news + POI movements)
- Market-relevant intelligence (if market data available)
- Entity network connections (link related POIs and events)

Be specific, analytical, and actionable. Use real names and data from the input.
Current timestamp: ${new Date().toISOString()}`;

    const userMessage = context.length > 100
      ? `Analyze this intelligence data and produce your assessment:\n\n${context}`
      : 'No intelligence data currently available. Produce a brief status report noting the data gap.';

    const { content, model } = await callGroq(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      env
    );

    // Parse Groq response
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid JSON from Groq');
      }
    }

    // Validate and fill defaults
    const response = {
      brief: parsed.brief || 'Analysis unavailable.',
      generatedAt: new Date().toISOString(),
      model,
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      threatLevel: ['stable', 'elevated', 'high', 'critical'].includes(parsed.threatLevel)
        ? parsed.threatLevel
        : 'stable',
      topTrends: Array.isArray(parsed.topTrends) ? parsed.topTrends.slice(0, 5) : [],
    };

    // Ensure each insight has required fields
    response.insights = response.insights.map((insight: Record<string, unknown>, i: number) => ({
      id: insight.id || `insight-${i}`,
      type: insight.type || 'brief',
      title: insight.title || 'Untitled Insight',
      content: insight.content || '',
      severity: ['info', 'watch', 'warning', 'critical'].includes(insight.severity as string)
        ? insight.severity
        : 'info',
      confidence: typeof insight.confidence === 'number' ? insight.confidence : 0.5,
      timestamp: insight.timestamp || new Date().toISOString(),
      sources: Array.isArray(insight.sources) ? insight.sources : [],
      relatedPOIs: Array.isArray(insight.relatedPOIs) ? insight.relatedPOIs : [],
      tags: Array.isArray(insight.tags) ? insight.tags : [],
      region: insight.region || undefined,
    }));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=120, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[/api/insights] Error:', err);
    return new Response(
      JSON.stringify({
        brief: `Analysis temporarily unavailable: ${(err as Error).message}`,
        generatedAt: new Date().toISOString(),
        model: 'error',
        insights: [],
        threatLevel: 'stable',
        topTrends: [],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export const config = {
  runtime: 'edge',
};
import { GroqInsightsPanel } from './components/GroqInsightsPanel';

const insightsContainer = document.getElementById('panel-insights');
const insights = new GroqInsightsPanel(insightsContainer);
await insights.init();

// Optional: wire POI clicks to switch to POI panel
insights.onPOIClicked((name) => {
  switchToPanel('poi');
  // Could also highlight/search for this person in POI panel
});