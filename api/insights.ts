export const config = {
  runtime: 'edge',
};

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqResponse {
  choices: Array<{ message: { content: string } }>;
  model: string;
}

async function redisGet(key: string, url: string, token: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${url}/get/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.result && typeof data.result === 'string') {
      try { return JSON.parse(data.result); } catch { return data.result; }
    }
    return data.result;
  } catch { return null; }
}

async function callGroq(messages: GroqMessage[], apiKey: string): Promise<{ content: string; model: string }> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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

export default async function handler(_request: Request): Promise<Response> {
  const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
  const KV_REST_API_URL = process.env.KV_REST_API_URL || '';
  const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || '';

  if (!GROQ_API_KEY || !KV_REST_API_URL) {
    return new Response(
      JSON.stringify({ brief: 'Groq API not configured.', generatedAt: new Date().toISOString(), model: 'offline', insights: [], threatLevel: 'stable', topTrends: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const [poiData, threatsData, marketsData, newsData, quakesData] = await Promise.all([
      redisGet('intelligence:poi:v1', KV_REST_API_URL, KV_REST_API_TOKEN),
      redisGet('intelligence:threats', KV_REST_API_URL, KV_REST_API_TOKEN),
      redisGet('intelligence:markets', KV_REST_API_URL, KV_REST_API_TOKEN),
      redisGet('intelligence:news', KV_REST_API_URL, KV_REST_API_TOKEN),
      redisGet('intelligence:quakes', KV_REST_API_URL, KV_REST_API_TOKEN),
    ]);

    const contextParts: string[] = [];

    if (poiData && typeof poiData === 'object' && 'persons' in (poiData as Record<string, unknown>)) {
      const persons = (poiData as { persons: Array<Record<string, unknown>> }).persons;
      const poiSummary = persons.slice(0, 15).map((p) =>
        `${String(p.name)} (${String(p.role)}): risk=${String(p.riskLevel)}, activity=${String(p.activityScore)}, tone=${String(p.averageTone)}, location=${String(p.lastKnownLocation)}`
      ).join('\n');
      contextParts.push(`## Tracked Persons of Interest (${persons.length} total)\n${poiSummary}`);
    }

    if (threatsData) {
      contextParts.push(`## Current Threat Reports\n${typeof threatsData === 'string' ? threatsData : JSON.stringify(threatsData).slice(0, 1500)}`);
    }
    if (marketsData) {
      contextParts.push(`## Market Data\n${typeof marketsData === 'string' ? marketsData : JSON.stringify(marketsData).slice(0, 800)}`);
    }
    if (newsData) {
      contextParts.push(`## Recent News Headlines\n${typeof newsData === 'string' ? newsData : JSON.stringify(newsData).slice(0, 1200)}`);
    }
    if (quakesData) {
      contextParts.push(`## Seismic Activity\n${typeof quakesData === 'string' ? quakesData : JSON.stringify(quakesData).slice(0, 500)}`);
    }

    const context = contextParts.join('\n\n');

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

Generate 5-12 insights. Be specific, analytical, and actionable.
Current timestamp: ${new Date().toISOString()}`;

    const userMessage = context.length > 100
      ? `Analyze this intelligence data and produce your assessment:\n\n${context}`
      : 'No intelligence data currently available. Produce a brief status report noting the data gap.';

    const { content, model } = await callGroq(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
      GROQ_API_KEY
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid JSON from Groq');
      }
    }

    const response = {
      brief: (parsed.brief as string) || 'Analysis unavailable.',
      generatedAt: new Date().toISOString(),
      model,
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      threatLevel: ['stable', 'elevated', 'high', 'critical'].includes(parsed.threatLevel as string)
        ? parsed.threatLevel as string
        : 'stable',
      topTrends: Array.isArray(parsed.topTrends) ? (parsed.topTrends as string[]).slice(0, 5) : [],
    };

    response.insights = response.insights.map((insight: Record<string, unknown>, i: number) => ({
      id: insight.id || `insight-${i}`,
      type: insight.type || 'brief',
      title: insight.title || 'Untitled Insight',
      content: insight.content || '',
      severity: ['info', 'watch', 'warning', 'critical'].includes(insight.severity as string) ? insight.severity : 'info',
      confidence: typeof insight.confidence === 'number' ? insight.confidence : 0.5,
      timestamp: insight.timestamp || new Date().toISOString(),
      sources: Array.isArray(insight.sources) ? insight.sources : [],
      relatedPOIs: Array.isArray(insight.relatedPOIs) ? insight.relatedPOIs : [],
      tags: Array.isArray(insight.tags) ? insight.tags : [],
      region: insight.region || undefined,
    }));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=120, stale-while-revalidate=300' },
    });
  } catch (err) {
    console.error('[/api/insights] Error:', err);
    return new Response(
      JSON.stringify({ brief: `Analysis temporarily unavailable: ${(err as Error).message}`, generatedAt: new Date().toISOString(), model: 'error', insights: [], threatLevel: 'stable', topTrends: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
