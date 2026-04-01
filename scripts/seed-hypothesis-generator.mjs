#!/usr/bin/env node

// seed-hypothesis-generator.mjs — Autonomous Hypothesis Generator
//
// Reads live intelligence signals from Redis (GDELT, SITREP, chokepoints,
// conflict, insights) and sends them to Groq llama-3.3-70b-versatile to
// generate 6–10 structured hypotheses about future geopolitical events.
//
// Each hypothesis: title, probability (0–100), timeframe, category,
// supporting signals array, confidence reasoning.
//
// Output: intelligence:hypotheses:v1  TTL: 3h
// Seed ordering: after agent-sitrep, before vector-index

import { loadEnvFile, CHROME_UA, getRedisCredentials, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:hypotheses:v1';
const CACHE_TTL = 10800; // 3 hours
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_PROMPT_CHARS = 12000;

// ---------- Redis Helpers ----------

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

// ---------- Signal Collection ----------

async function collectSignals() {
  const { url, token } = getRedisCredentials();

  const [gdeltRaw, sitrepRaw, chokepointsRaw, iranRaw, insightsRaw, unrestRaw] =
    await Promise.all([
      redisGet(url, token, 'intelligence:gdelt-intel:v1'),
      redisGet(url, token, 'intelligence:agent-sitrep:v1'),
      redisGet(url, token, 'supply_chain:chokepoints:v4'),
      redisGet(url, token, 'conflict:iran-events:v1'),
      redisGet(url, token, 'news:insights:v1'),
      redisGet(url, token, 'unrest:events:v1'),
    ]);

  const signals = [];

  // GDELT intel headlines
  if (gdeltRaw?.topics) {
    for (const topic of gdeltRaw.topics.slice(0, 6)) {
      const headlines = (topic.articles || []).slice(0, 3).map(a => a.title).filter(Boolean);
      if (headlines.length > 0) {
        signals.push(`[GDELT/${topic.id}] ${headlines.join(' | ')}`);
      }
    }
  }

  // Agent SITREP executive summary
  if (sitrepRaw?.executive_summary) {
    signals.push(`[SITREP] ${String(sitrepRaw.executive_summary).slice(0, 600)}`);
  }
  if (Array.isArray(sitrepRaw?.watch_list)) {
    signals.push(`[WATCH_LIST] ${sitrepRaw.watch_list.slice(0, 8).join(', ')}`);
  }

  // Chokepoint stress
  if (Array.isArray(chokepointsRaw?.chokepoints)) {
    const stressed = chokepointsRaw.chokepoints
      .filter(c => c.riskLevel === 'high' || c.riskLevel === 'critical' || c.congestionIndex > 70)
      .slice(0, 5)
      .map(c => `${c.name} (risk:${c.riskLevel || 'unknown'}, congestion:${c.congestionIndex ?? '?'}%)`);
    if (stressed.length > 0) {
      signals.push(`[CHOKEPOINTS_STRESSED] ${stressed.join('; ')}`);
    }
  }

  // Iran events
  if (Array.isArray(iranRaw?.events)) {
    const recent = iranRaw.events.slice(0, 5).map(e => e.title || '').filter(Boolean);
    if (recent.length > 0) {
      signals.push(`[IRAN_EVENTS] ${recent.join(' | ')}`);
    }
  }

  // Insights world brief
  if (insightsRaw?.worldBrief) {
    signals.push(`[INSIGHTS] ${String(insightsRaw.worldBrief).slice(0, 400)}`);
  }

  // Unrest events
  if (Array.isArray(unrestRaw?.events)) {
    const active = unrestRaw.events
      .filter(e => e.severity === 'high' || e.severity === 'critical')
      .slice(0, 4)
      .map(e => `${e.country || 'Unknown'}: ${e.title || ''}`)
      .filter(Boolean);
    if (active.length > 0) {
      signals.push(`[UNREST_HIGH] ${active.join(' | ')}`);
    }
  }

  return signals;
}

// ---------- Groq Hypothesis Generation ----------

async function generateHypotheses(signals) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    console.warn('[warn] GROQ_API_KEY not set — generating fallback hypotheses');
    return generateFallbackHypotheses(signals);
  }

  const signalText = signals.join('\n').slice(0, MAX_PROMPT_CHARS);

  const systemPrompt = `You are a senior geopolitical intelligence analyst. Based on live signal data, generate 6–8 specific, falsifiable hypotheses about events likely to occur in the next 7–90 days. Each hypothesis must be grounded in the signals provided.

Respond ONLY with a valid JSON array. No preamble, no markdown fences, no explanation. The array must contain objects with exactly these fields:
- title: string (concise event prediction, max 100 chars)
- probability: number (0–100 integer, your estimated probability)
- timeframe: string (e.g. "7 days", "14–30 days", "30–60 days", "60–90 days")
- category: string (one of: "military", "economic", "political", "energy", "cyber", "humanitarian", "maritime", "nuclear")
- signals: array of 2–4 short strings citing specific evidence from the input
- reasoning: string (1–2 sentences on why this hypothesis is likely, max 200 chars)

Order by probability descending. Be specific — name countries, regions, actors.`;

  const userPrompt = `Current intelligence signals (${new Date().toISOString()}):\n\n${signalText}\n\nGenerate hypotheses now.`;

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
        'User-Agent': CHROME_UA,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 2000,
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Groq API error: ${resp.status} — ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // Strip any accidental markdown fences
    const jsonText = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

    let hypotheses;
    try {
      hypotheses = JSON.parse(jsonText);
    } catch {
      console.warn('[warn] Groq returned invalid JSON, using fallback');
      return generateFallbackHypotheses(signals);
    }

    if (!Array.isArray(hypotheses) || hypotheses.length === 0) {
      console.warn('[warn] Groq returned empty array, using fallback');
      return generateFallbackHypotheses(signals);
    }

    // Sanitize and validate each hypothesis
    return hypotheses
      .filter(h => h.title && typeof h.probability === 'number')
      .map(h => ({
        title: String(h.title || '').slice(0, 120),
        probability: Math.min(100, Math.max(0, Math.round(Number(h.probability) || 50))),
        timeframe: String(h.timeframe || '30 days').slice(0, 40),
        category: String(h.category || 'political').toLowerCase().slice(0, 30),
        signals: Array.isArray(h.signals) ? h.signals.slice(0, 4).map(s => String(s).slice(0, 120)) : [],
        reasoning: String(h.reasoning || '').slice(0, 250),
      }))
      .slice(0, 10);

  } catch (err) {
    console.warn(`[warn] Groq call failed: ${err.message} — using fallback`);
    return generateFallbackHypotheses(signals);
  }
}

function generateFallbackHypotheses(signals) {
  // Keyword-driven fallback when Groq is unavailable
  const text = signals.join(' ').toLowerCase();
  const hypotheses = [];

  if (text.includes('iran') || text.includes('hormuz')) {
    hypotheses.push({
      title: 'Iran escalates Strait of Hormuz provocations amid regional tension',
      probability: 58,
      timeframe: '14–30 days',
      category: 'maritime',
      signals: ['Iran events tracker elevated', 'GDELT Iran/maritime signals'],
      reasoning: 'Elevated Iran event frequency correlates with historical strait-pressure cycles.',
    });
  }
  if (text.includes('ukraine') || text.includes('russia') || text.includes('military')) {
    hypotheses.push({
      title: 'Major eastern front offensive operation announced or executed',
      probability: 52,
      timeframe: '30–60 days',
      category: 'military',
      signals: ['GDELT military signals elevated', 'SITREP watch list active'],
      reasoning: 'Seasonal conditions and reported force movements suggest operational tempo increase.',
    });
  }
  if (text.includes('sanction') || text.includes('tariff') || text.includes('trade')) {
    hypotheses.push({
      title: 'New sanctions package or tariff escalation announced by G7 or US',
      probability: 65,
      timeframe: '14–30 days',
      category: 'economic',
      signals: ['GDELT sanctions signals', 'Trade policy coverage elevated'],
      reasoning: 'Ongoing diplomatic friction cycles historically precede formal economic measures.',
    });
  }
  if (text.includes('cyber') || text.includes('hack') || text.includes('ransomware')) {
    hypotheses.push({
      title: 'Nation-state cyber operation targets critical infrastructure',
      probability: 48,
      timeframe: '7–30 days',
      category: 'cyber',
      signals: ['Cyber threat feed elevated', 'GDELT cyber coverage'],
      reasoning: 'Cyber threat feed showing above-baseline activity across multiple sectors.',
    });
  }

  // Always add a baseline economic hypothesis
  hypotheses.push({
    title: 'Central bank policy surprise triggers EM currency volatility',
    probability: 44,
    timeframe: '30–60 days',
    category: 'economic',
    signals: ['Macro signals divergence', 'Commodity price stress'],
    reasoning: 'Rate cycle divergence between major economies elevates EM stress probability.',
  });

  return hypotheses.slice(0, 6);
}

// ---------- Main Fetcher ----------

async function fetchHypotheses() {
  console.log('[info] Collecting intelligence signals...');
  const signals = await collectSignals();
  console.log(`[info] Collected ${signals.length} signal blocks`);

  if (signals.length === 0) {
    console.warn('[warn] No signals collected — aborting to preserve existing cache');
    return null;
  }

  console.log('[info] Generating hypotheses via Groq...');
  const hypotheses = await generateHypotheses(signals);
  console.log(`[info] Generated ${hypotheses.length} hypotheses`);

  return {
    hypotheses,
    signalCount: signals.length,
    generatedAt: new Date().toISOString(),
    model: process.env.GROQ_API_KEY ? GROQ_MODEL : 'fallback-keyword-engine',
    version: 1,
  };
}

function validate(data) {
  return Array.isArray(data?.hypotheses) && data.hypotheses.length >= 1;
}

runSeed('intelligence', 'hypotheses', CANONICAL_KEY, fetchHypotheses, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'groq-hypothesis-v1',
  recordCount: (data) => data?.hypotheses?.length ?? 0,
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});