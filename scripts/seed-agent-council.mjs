#!/usr/bin/env node

// Copyright (C) 2026 Chip / salamndrgaming-lab
// seed-agent-council.mjs — Agent Council: 6 specialist analysts + Chair synthesis
//
// Reads all existing seed data from Redis, dispatches it to 6 concurrent
// AI "agents" (game-theorist, network-analyst, complexity, behavioral,
// historian, signals-officer), then a Chair agent synthesizes their outputs
// into a unified cross-domain intelligence brief.
//
// Redis keys written:
//   council:game-theory:v1
//   council:network-analysis:v1
//   council:complexity-analysis:v1
//   council:behavioral-analysis:v1
//   council:historical-analogues:v1
//   council:signal-analysis:v1
//   council:synthesis:v1
//   council:meta:v1              (timestamps + status)
//
// Requires: GROQ_API_KEY (or OPENROUTER_API_KEY fallback)
// Runs after: all other seeds (wave 6+ in run-seeds.sh)

import {
  loadEnvFile,
  getRedisCredentials,
  writeExtraKeyWithMeta,
  withRetry,
  runSeed,
} from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'council:synthesis:v1';
const CACHE_TTL = 10800; // 3h — matches seed cron interval
const GROQ_MODEL = 'llama-3.1-70b-versatile';
const GROQ_FAST_MODEL = 'llama-3.1-8b-instant';

// ── Source keys to read from Redis ─────────────────────────────────────────
const SOURCE_KEYS = {
  gdeltIntel:        'intelligence:gdelt-intel:v1',
  earthquakes:       'seismology:earthquakes:v1',
  unrest:            'unrest:events:v1',
  cyber:             'cyber:threats-bootstrap:v2',
  natural:           'natural:events:v1',
  predictions:       'prediction:markets-bootstrap:v1',
  commodities:       'market:commodities-bootstrap:v1',
  stocks:            'market:stocks-bootstrap:v1',
  conflicts:         'conflict:ucdp-events:v1',
  iranEvents:        'conflict:iran-events:v1',
  missiles:          'conflict:missile-events:v1',
  theaterPosture:    'theater-posture:sebuf:stale:v1',
  riskScores:        'risk:scores:sebuf:stale:v1',
  outages:           'infra:outages:v1',
  shipping:          'supply_chain:shipping:v2',
  chokepoints:       'supply_chain:chokepoints:v4',
  displacement:      'giving:summary:v1',
  climate:           'climate:anomalies:v1',
  wildfires:         'wildfire:fires:v1',
  macroSignals:      'economic:macro-signals:v1',
  entityGraph:       'intelligence:entity-graph:v1',
  crossSignals:      'intelligence:cross-source-signals:v1',
  correlationCards:  'correlation:cards-bootstrap:v1',
  telegramNarratives:'telegram:narratives:v1',
  insights:          'news:insights:v1',
  poi:               'intelligence:poi:v1',
};

// ── Redis batch read ───────────────────────────────────────────────────────
async function readAllSourceKeys() {
  const { url, token } = getRedisCredentials();
  const keys = Object.values(SOURCE_KEYS);
  const pipeline = keys.map(k => ['GET', k]);

  const resp = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) throw new Error(`Redis pipeline failed: ${resp.status}`);
  const results = await resp.json();
  const data = {};
  const names = Object.keys(SOURCE_KEYS);

  for (let i = 0; i < names.length; i++) {
    const raw = results[i]?.result;
    if (raw) {
      try { data[names[i]] = JSON.parse(raw); } catch { /* skip malformed */ }
    }
  }
  return data;
}

// ── Build context digest for agents ────────────────────────────────────────
// Compresses all source data into a concise text digest (~2000 tokens)
// that fits within Groq's context window for each agent call.
function buildContextDigest(data) {
  const sections = [];

  // GDELT headlines
  const topics = Array.isArray(data.gdeltIntel?.topics)
    ? data.gdeltIntel.topics : [];
  const headlines = [];
  for (const topic of topics) {
    const arts = Array.isArray(topic?.articles) ? topic.articles
      : Array.isArray(topic?.events) ? topic.events : [];
    for (const a of arts.slice(0, 2)) {
      const t = a.title || a.headline || '';
      if (t.length > 15) headlines.push(t.slice(0, 200));
    }
  }
  if (headlines.length > 0) {
    sections.push(`HEADLINES (${headlines.length}):\n${headlines.slice(0, 15).map((h, i) => `${i + 1}. ${h}`).join('\n')}`);
  }

  // Insights brief
  if (data.insights?.worldBrief) {
    sections.push(`AI BRIEF:\n${data.insights.worldBrief.slice(0, 500)}`);
  }

  // Conflict events
  const conflicts = unwrapArray(data.conflicts, 'events');
  if (conflicts.length > 0) {
    const summary = conflicts.slice(0, 5).map(e =>
      `${e.type_of_violence || e.event_type || 'conflict'} in ${e.country || e.location || '?'}: ${(e.description || e.notes || '').slice(0, 100)}`
    ).join('\n');
    sections.push(`CONFLICTS (${conflicts.length}):\n${summary}`);
  }

  // Iran events
  const iran = unwrapArray(data.iranEvents, 'events');
  if (iran.length > 0) {
    sections.push(`IRAN EVENTS (${iran.length}): ${iran.slice(0, 3).map(e => e.title || e.headline || '').join('; ').slice(0, 300)}`);
  }

  // Theater posture
  if (data.theaterPosture) {
    const tp = data.theaterPosture;
    const postureSummary = typeof tp === 'object'
      ? JSON.stringify(tp).slice(0, 400) : String(tp).slice(0, 400);
    sections.push(`THEATER POSTURE:\n${postureSummary}`);
  }

  // Risk scores
  if (data.riskScores) {
    const rs = data.riskScores;
    const riskSummary = typeof rs === 'object'
      ? JSON.stringify(rs).slice(0, 400) : String(rs).slice(0, 400);
    sections.push(`RISK SCORES:\n${riskSummary}`);
  }

  // Economic signals
  const macro = data.macroSignals;
  if (macro) {
    const ms = typeof macro === 'object'
      ? JSON.stringify(macro).slice(0, 300) : String(macro).slice(0, 300);
    sections.push(`MACRO SIGNALS:\n${ms}`);
  }

  // Commodities
  const commodities = unwrapArray(data.commodities, 'quotes', 'commodities');
  if (commodities.length > 0) {
    const top = commodities.slice(0, 5).map(c =>
      `${c.symbol || c.name || '?'}: $${c.price ?? '?'} (${c.change > 0 ? '+' : ''}${c.change?.toFixed?.(1) ?? '?'}%)`
    ).join(', ');
    sections.push(`COMMODITIES: ${top}`);
  }

  // Supply chain / chokepoints
  const chokepoints = unwrapArray(data.chokepoints, 'chokepoints');
  if (chokepoints.length > 0) {
    const cp = chokepoints.slice(0, 4).map(c =>
      `${c.name || c.id || '?'}: risk=${c.riskLevel || c.risk || '?'}`
    ).join('; ');
    sections.push(`CHOKEPOINTS: ${cp}`);
  }

  // Cyber threats
  const cyber = unwrapArray(data.cyber, 'threats');
  if (cyber.length > 0) {
    const ct = cyber.filter(t => ['critical', 'high'].includes(String(t.severity || '').toLowerCase()))
      .slice(0, 3).map(t => `${t.name || 'unnamed'} (${t.severity})`).join('; ');
    if (ct) sections.push(`CYBER THREATS: ${ct}`);
  }

  // Natural events
  const natural = unwrapArray(data.natural, 'events');
  if (natural.length > 0) {
    sections.push(`NATURAL EVENTS (${natural.length}): ${natural.slice(0, 3).map(e => e.title || e.name || e.type || '').join('; ').slice(0, 200)}`);
  }

  // Earthquakes
  const quakes = unwrapArray(data.earthquakes, 'earthquakes');
  const bigQuakes = quakes.filter(q => (q.magnitude ?? q.mag ?? 0) >= 5.0);
  if (bigQuakes.length > 0) {
    sections.push(`EARTHQUAKES (M5+): ${bigQuakes.slice(0, 3).map(q => `M${(q.magnitude ?? q.mag).toFixed(1)} ${q.place || ''}`).join('; ')}`);
  }

  // Entity graph
  if (data.entityGraph) {
    const eg = data.entityGraph;
    const nodeCount = Array.isArray(eg.nodes) ? eg.nodes.length : 0;
    const edgeCount = Array.isArray(eg.edges) ? eg.edges.length : 0;
    if (nodeCount > 0) {
      const topNodes = (eg.nodes || [])
        .sort((a, b) => (b.centrality || b.weight || 0) - (a.centrality || a.weight || 0))
        .slice(0, 5).map(n => n.label || n.name || n.id).join(', ');
      sections.push(`ENTITY GRAPH: ${nodeCount} nodes, ${edgeCount} edges. Top entities: ${topNodes}`);
    }
  }

  // Cross-source signals
  const signals = unwrapArray(data.crossSignals, 'signals');
  if (signals.length > 0) {
    sections.push(`CROSS-SOURCE SIGNALS (${signals.length}): ${signals.slice(0, 3).map(s => s.title || s.summary || '').join('; ').slice(0, 300)}`);
  }

  // Telegram narratives
  const tg = unwrapArray(data.telegramNarratives, 'narratives');
  if (tg.length > 0) {
    sections.push(`TELEGRAM NARRATIVES: ${tg.slice(0, 3).map(n => n.title || n.summary || '').join('; ').slice(0, 200)}`);
  }

  // Correlation cards
  const cards = unwrapArray(data.correlationCards, 'cards');
  if (cards.length > 0) {
    sections.push(`CORRELATION CARDS (${cards.length}): ${cards.slice(0, 3).map(c => c.title || c.summary || '').join('; ').slice(0, 200)}`);
  }

  // POI
  const poi = unwrapArray(data.poi, 'persons');
  if (poi.length > 0) {
    sections.push(`PERSONS OF INTEREST: ${poi.slice(0, 5).map(p => p.name || '').join(', ')}`);
  }

  const dateStr = new Date().toISOString().split('T')[0];
  return `Intelligence digest for ${dateStr}:\n\n${sections.join('\n\n')}`;
}

function unwrapArray(raw, ...keys) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const key of keys) {
      if (Array.isArray(raw[key])) return raw[key];
    }
    for (const val of Object.values(raw)) {
      if (Array.isArray(val)) return val;
    }
  }
  return [];
}

// ── Agent definitions ──────────────────────────────────────────────────────
const AGENTS = [
  {
    id: 'game-theorist',
    key: 'council:game-theory:v1',
    system: `You are a game theory analyst on an intelligence council. Current date: {date}.
Analyze the provided intelligence digest through the lens of strategic game theory.
Focus on:
- Defection signals: where actors deviate from cooperative equilibria
- Commitment devices being deployed (arms buildups, sanctions, treaty withdrawals)
- Payoff matrix shifts that change the calculus for key actors
- Nash equilibrium breakdowns in ongoing conflicts or negotiations
- Credible vs non-credible threats based on revealed preferences
Output a JSON object: { "findings": [{ "title": string, "analysis": string, "actors": string[], "confidence": "high"|"medium"|"low", "defectionRisk": number (0-1) }], "summary": string (under 100 words) }`,
  },
  {
    id: 'network-analyst',
    key: 'council:network-analysis:v1',
    system: `You are a network topology analyst on an intelligence council. Current date: {date}.
Analyze the intelligence digest for network structure and vulnerability:
- Identify nodes with high betweenness centrality (single points of failure)
- Detect network fragmentation risks (what happens if key nodes are removed)
- Map information flow bottlenecks and cascade pathways
- Assess supply chain network resilience from chokepoint and shipping data
- Track alliance network topology changes
Output a JSON object: { "findings": [{ "title": string, "analysis": string, "criticalNodes": string[], "cascadeRisk": "high"|"medium"|"low", "networkType": string }], "summary": string (under 100 words) }`,
  },
  {
    id: 'complexity-theorist',
    key: 'council:complexity-analysis:v1',
    system: `You are a complexity science analyst on an intelligence council. Current date: {date}.
Analyze the intelligence digest for complex systems dynamics:
- Proximity-to-tipping-point scores across geopolitical systems
- Feedback loops (positive/negative) that could amplify or dampen events
- Emergent phenomena from interacting subsystems
- Phase transition indicators (sudden qualitative shifts in system behavior)
- Self-organized criticality signals (sandpile effects in conflict regions)
Output a JSON object: { "findings": [{ "title": string, "analysis": string, "systemId": string, "tippingPointProximity": number (0-1), "feedbackType": "positive"|"negative"|"mixed" }], "summary": string (under 100 words) }`,
  },
  {
    id: 'behavioral-analyst',
    key: 'council:behavioral-analysis:v1',
    system: `You are a behavioral psychology analyst on an intelligence council. Current date: {date}.
Analyze the intelligence digest for behavioral patterns:
- Cognitive biases affecting decision-makers (groupthink, sunk cost, anchoring)
- Signaling behavior vs actual capability deployment
- Audience costs constraining leader behavior
- Escalation commitment patterns (point of no return indicators)
- Deception indicators (mismatches between stated intent and observed action)
Output a JSON object: { "findings": [{ "title": string, "analysis": string, "actors": string[], "biasType": string, "deceptionProbability": number (0-1) }], "summary": string (under 100 words) }`,
  },
  {
    id: 'historian',
    key: 'council:historical-analogues:v1',
    system: `You are a historical analogy analyst on an intelligence council. Current date: {date}.
Analyze the intelligence digest by finding historical parallels:
- Match current patterns to specific historical episodes (with dates and outcomes)
- Assess how closely current conditions match prior escalation trajectories
- Identify "rhymes" — partial matches where some conditions differ
- Flag which historical analogies are misleading and why
- Track pattern breaks: where history suggests X but conditions have changed
Output a JSON object: { "findings": [{ "title": string, "analysis": string, "historicalEvent": string, "year": number, "similarity": number (0-1), "keyDifference": string }], "summary": string (under 100 words) }`,
  },
  {
    id: 'signals-officer',
    key: 'council:signal-analysis:v1',
    system: `You are a signals intelligence officer on an intelligence council. Current date: {date}.
Analyze the intelligence digest for signal quality and gaps:
- ABSENCE of expected signals (silence from actors who should be reacting)
- Coordinated timing of events across different domains
- Signal-to-noise ratio assessment (genuine signals vs background noise)
- Information denial indicators (deliberate blackouts, censorship spikes)
- Early warning indicators that precede major events by 24-72 hours
Output a JSON object: { "findings": [{ "title": string, "analysis": string, "signalType": "presence"|"absence"|"timing"|"denial", "urgency": "immediate"|"watch"|"background", "reliability": "high"|"medium"|"low" }], "summary": string (under 100 words) }`,
  },
];

// ── LLM call (Groq primary, OpenRouter fallback) ──────────────────────────
async function callLLM(systemPrompt, userPrompt, opts = {}) {
  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const model = opts.model || GROQ_MODEL;
  const maxTokens = opts.maxTokens || 800;
  const temperature = opts.temperature ?? 0.4;

  if (!groqKey && !openrouterKey) {
    throw new Error('No LLM key available (GROQ_API_KEY or OPENROUTER_API_KEY)');
  }

  // Try Groq first
  if (groqKey) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) {
        const json = await resp.json();
        const text = json.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 10) return { text, provider: 'groq', model: json.model || model };
      } else {
        const errText = await resp.text().catch(() => '');
        console.warn(`  Groq ${resp.status}: ${errText.slice(0, 150)}`);
      }
    } catch (err) {
      console.warn(`  Groq failed: ${err.message}`);
    }
  }

  // Fallback to OpenRouter
  if (openrouterKey) {
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://osintview.app',
          'X-Title': 'OSINTview Agent Council',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) {
        const json = await resp.json();
        const text = json.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 10) return { text, provider: 'openrouter', model: json.model || 'gemini-2.5-flash' };
      }
    } catch (err) {
      console.warn(`  OpenRouter failed: ${err.message}`);
    }
  }

  return null;
}

function parseJsonSafe(text) {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ── Run a single agent ─────────────────────────────────────────────────────
async function runAgent(agent, digest) {
  const dateStr = new Date().toISOString().split('T')[0];
  const systemPrompt = agent.system.replace('{date}', dateStr);
  const userPrompt = `Analyze this intelligence digest and respond with the specified JSON format.\n\n${digest}`;

  console.log(`  [${agent.id}] Starting analysis...`);
  const startMs = Date.now();

  const result = await withRetry(
    () => callLLM(systemPrompt, userPrompt, { model: GROQ_FAST_MODEL, maxTokens: 800 }),
    1, // 1 retry
    2000,
  );

  const elapsed = Date.now() - startMs;

  if (!result) {
    console.warn(`  [${agent.id}] FAILED (${elapsed}ms)`);
    return null;
  }

  const parsed = parseJsonSafe(result.text);
  if (!parsed) {
    console.warn(`  [${agent.id}] Invalid JSON response (${elapsed}ms)`);
    return null;
  }

  console.log(`  [${agent.id}] Done (${elapsed}ms, ${result.provider})`);
  return {
    agentId: agent.id,
    ...parsed,
    meta: {
      provider: result.provider,
      model: result.model,
      generatedAt: new Date().toISOString(),
      durationMs: elapsed,
    },
  };
}

// ── Chair synthesis ────────────────────────────────────────────────────────
async function runChair(agentResults, digest) {
  const dateStr = new Date().toISOString().split('T')[0];

  const agentSummaries = agentResults
    .filter(r => r !== null)
    .map(r => `[${r.agentId}]: ${r.summary || JSON.stringify(r.findings?.slice(0, 2) || []).slice(0, 300)}`)
    .join('\n\n');

  const systemPrompt = `You are the Chair of an intelligence analysis council. Current date: ${dateStr}.
You have received analysis from 6 specialist agents. Your role is to:
1. Identify CROSS-DOMAIN connections that no single agent could see alone
2. Resolve conflicting assessments between agents with your reasoning
3. Produce the highest-priority actionable intelligence findings
4. Assign an overall threat level and confidence assessment
5. Highlight the single most important thing a decision-maker needs to know RIGHT NOW

Output a JSON object: {
  "crossDomainFindings": [{ "title": string, "synthesis": string, "contributingAgents": string[], "confidence": "high"|"medium"|"low", "priority": 1-5 }],
  "conflicts": [{ "topic": string, "agentA": string, "agentB": string, "resolution": string }],
  "overallAssessment": string (200 words max),
  "threatLevel": "critical"|"elevated"|"guarded"|"low",
  "topPriority": string (one sentence: the single most important finding),
  "watchItems": string[] (3-5 items to monitor in the next 24h)
}`;

  const userPrompt = `AGENT REPORTS:\n${agentSummaries}\n\nORIGINAL DIGEST:\n${digest.slice(0, 1500)}`;

  console.log('  [chair] Synthesizing council reports...');
  const startMs = Date.now();

  const result = await withRetry(
    () => callLLM(systemPrompt, userPrompt, { model: GROQ_MODEL, maxTokens: 1200, temperature: 0.3 }),
    1,
    3000,
  );

  const elapsed = Date.now() - startMs;

  if (!result) {
    console.warn(`  [chair] FAILED (${elapsed}ms)`);
    return null;
  }

  const parsed = parseJsonSafe(result.text);
  if (!parsed) {
    console.warn(`  [chair] Invalid JSON response (${elapsed}ms)`);
    return null;
  }

  console.log(`  [chair] Done (${elapsed}ms, ${result.provider})`);
  return {
    ...parsed,
    meta: {
      provider: result.provider,
      model: result.model,
      generatedAt: new Date().toISOString(),
      durationMs: elapsed,
      agentCount: agentResults.filter(r => r !== null).length,
    },
  };
}

// ── Main fetch function ────────────────────────────────────────────────────
async function fetchCouncilAnalysis() {
  console.log('  Reading all source data from Redis...');
  const data = await readAllSourceKeys();
  const sourceCount = Object.keys(data).length;
  console.log(`  Found ${sourceCount} data sources`);

  if (sourceCount < 3) {
    throw new Error(`Insufficient data sources (${sourceCount}/26). Run upstream seeds first.`);
  }

  const digest = buildContextDigest(data);
  console.log(`  Context digest: ${digest.length} chars`);

  // Phase 1: Run agents in batches of 3 with minimal delay.
  // Groq allows 30 req/min on the free tier — 6 small calls in 2 batches is well under.
  // Each call is ~3-8s with 30s abort cap. BATCH_SIZE=3 cuts total wall time vs BATCH_SIZE=2.
  console.log('\n  Phase 1: Running 6 specialist agents (batched)...');
  const BATCH_SIZE = 3;
  const BATCH_DELAY_MS = 800; // 0.8s between batches (was 3s — excessive, Groq handles burst fine)
  const agentResults = [];
  for (let i = 0; i < AGENTS.length; i += BATCH_SIZE) {
    const batch = AGENTS.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(agent => runAgent(agent, digest)));
    agentResults.push(...batchResults);
    if (i + BATCH_SIZE < AGENTS.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const successCount = agentResults.filter(r => r !== null).length;
  console.log(`\n  Phase 1 complete: ${successCount}/${AGENTS.length} agents succeeded`);

  if (successCount === 0) {
    throw new Error('All agents failed. Cannot produce synthesis.');
  }

  // Write individual agent results to Redis in parallel (was sequential — added 2-3s)
  await Promise.all(
    AGENTS.map((agent, i) => {
      const result = agentResults[i];
      if (!result) return null;
      return writeExtraKeyWithMeta(
        agent.key,
        result,
        CACHE_TTL,
        result.findings?.length || 0,
        `seed-meta:council:${agent.id}`,
      );
    }).filter(Boolean),
  );

  // Phase 2: Chair synthesis
  console.log('\n  Phase 2: Chair synthesis...');
  const synthesis = await runChair(agentResults, digest);

  // Build agent reports for ALL agents (including failed ones)
  const allAgentReports = AGENTS.map((agent, i) => {
    const result = agentResults[i];
    if (result) {
      return {
        agentId: result.agentId,
        summary: result.summary || '',
        findingCount: result.findings?.length || 0,
        status: 'ok',
      };
    }
    return {
      agentId: agent.id,
      summary: 'Analysis unavailable — LLM call failed.',
      findingCount: 0,
      status: 'failed',
    };
  });

  if (!synthesis) {
    // Still publish agent results even if chair fails
    return {
      crossDomainFindings: [],
      conflicts: [],
      overallAssessment: 'Chair synthesis unavailable. Individual agent reports are available.',
      threatLevel: 'guarded',
      topPriority: 'Review individual agent reports for details.',
      watchItems: [],
      agentReports: allAgentReports,
      meta: {
        generatedAt: new Date().toISOString(),
        agentSuccessCount: successCount,
        agentTotalCount: AGENTS.length,
        chairStatus: 'failed',
      },
    };
  }

  // Build final synthesis payload
  return {
    ...synthesis,
    agentReports: allAgentReports,
    meta: {
      ...synthesis.meta,
      agentSuccessCount: successCount,
      agentTotalCount: AGENTS.length,
      chairStatus: 'ok',
      sourceCount,
    },
  };
}

function validate(data) {
  return data && typeof data.overallAssessment === 'string' && data.overallAssessment.length > 10;
}

runSeed('council', 'synthesis', CANONICAL_KEY, fetchCouncilAnalysis, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  lockTtlMs: 900_000, // 15 min lock — this seed takes 12-15 min
  sourceVersion: 'agent-council-v1',
  recordCount: (data) => data?.agentReports?.length || 0,
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
