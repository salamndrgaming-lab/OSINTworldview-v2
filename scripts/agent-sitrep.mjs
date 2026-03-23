#!/usr/bin/env node

// agent-sitrep.mjs — Groq function-calling agent for autonomous intelligence
// brief generation. Uses Llama 3.1's native tool_use capability to:
//   1. Decide which Redis intelligence keys to query
//   2. Analyze the retrieved data for patterns and risks
//   3. Generate a structured narrative SITREP
//
// Unlike the static /api/sitrep.js endpoint (which hardcodes which keys to read),
// this agent dynamically decides what data to pull based on what it finds, can
// follow up on anomalies, and produces richer narrative synthesis.
//
// Output: Writes the final SITREP to Redis at 'intelligence:agent-sitrep:v1'
// and optionally sends a Telegram summary.

import { loadEnvFile, CHROME_UA, getRedisCredentials, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:agent-sitrep:v1';
const SITREP_TTL = 14400; // 4h

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

async function redisSet(url, token, key, value, ttl) {
  const args = ['SET', key, JSON.stringify(value)];
  if (ttl) args.push('EX', String(ttl));
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) throw new Error(`Redis SET failed: ${resp.status}`);
}

async function redisLRange(url, token, key, start, stop) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['LRANGE', key, String(start), String(stop)]),
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  if (!Array.isArray(data.result)) return [];
  return data.result.map(item => { try { return JSON.parse(item); } catch { return null; } }).filter(Boolean);
}

// ---------- Tool Definitions (Groq function-calling schema) ----------

// These are the tools the agent can call. Each tool maps to a real function
// that we execute locally when Groq requests it.

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'redis_query',
      description: 'Read the latest data from a Redis intelligence key. Returns the parsed JSON data stored at that key. Use this to gather intelligence from different data sources before writing the sitrep.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The Redis key to query',
            enum: [
              'intelligence:missile-events:v1',
              'intelligence:gdelt-intel:v1',
              'intelligence:poi:v1',
              'forecast:conflict:v1',
              'health:outbreaks:v1',
              'environment:radiation:v1',
              'unrest:events:v1',
              'seismology:earthquakes:v1',
              'natural:events:v1',
              'cyber:threats:v2',
              'weather:alerts:v1',
              'market:commodities-bootstrap:v1',
              'market:stocks-bootstrap:v1',
              'conflict:iran-events:v1',
              'infra:outages:v1',
            ],
          },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_alerts',
      description: 'Retrieve the current active alerts from the alert stream. Returns an array of recent anomaly alerts detected across all data sources.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assess_region_risk',
      description: 'Compute a risk score (0-100) for a specific region/country based on aggregated event data you have already retrieved. Provide the region name and a summary of events affecting it. Returns a structured risk assessment.',
      parameters: {
        type: 'object',
        properties: {
          region: {
            type: 'string',
            description: 'The country or region name to assess (e.g., "Ukraine", "Middle East", "Sub-Saharan Africa")',
          },
          event_summary: {
            type: 'string',
            description: 'A brief summary of the events/data affecting this region (from your prior redis_query results)',
          },
        },
        required: ['region', 'event_summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'format_sitrep',
      description: 'Format and save the final SITREP. Call this ONCE at the end after gathering all intelligence. Provide the complete narrative brief as structured sections.',
      parameters: {
        type: 'object',
        properties: {
          executive_summary: {
            type: 'string',
            description: '2-3 paragraph executive summary synthesizing the most critical intelligence across all sources',
          },
          sections: {
            type: 'array',
            description: 'Ordered list of SITREP sections',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Section heading (e.g., "Active Conflicts", "Threat Assessment")' },
                content: { type: 'string', description: 'Section narrative content — analysis, not just data listing' },
                risk_level: { type: 'string', enum: ['critical', 'high', 'elevated', 'moderate', 'low'], description: 'Overall risk level for this section' },
              },
              required: ['title', 'content'],
            },
          },
          overall_threat_level: {
            type: 'string',
            enum: ['critical', 'high', 'elevated', 'moderate', 'low'],
            description: 'Overall global threat level assessment',
          },
          watch_list: {
            type: 'array',
            description: 'Top 3-5 situations requiring continued monitoring',
            items: { type: 'string' },
          },
        },
        required: ['executive_summary', 'sections', 'overall_threat_level'],
      },
    },
  },
];

// ---------- Tool Execution ----------

// This is where we actually execute the tools that Groq requests.
// Each function receives the parsed arguments and returns a result.

async function executeTool(name, args, context) {
  const { redisUrl, redisToken } = context;

  switch (name) {
    case 'redis_query': {
      const key = args.key;
      console.log(`    [tool] redis_query: ${key}`);
      const data = await redisGet(redisUrl, redisToken, key);
      if (!data) return { error: `No data found at key: ${key}` };

      // Summarize large datasets to fit within context window limits
      // (Groq has limited context; sending 1500 radiation readings would blow it up)
      return summarizeForAgent(key, data);
    }

    case 'get_active_alerts': {
      console.log('    [tool] get_active_alerts');
      const alerts = await redisLRange(redisUrl, redisToken, 'alerts:stream:v1', 0, 19);
      return { alerts, count: alerts.length };
    }

    case 'assess_region_risk': {
      console.log(`    [tool] assess_region_risk: ${args.region}`);
      // This is a structured assessment that the agent builds from its own analysis.
      // We return a template that Groq fills in during its next turn.
      return {
        region: args.region,
        event_summary: args.event_summary,
        assessment_framework: {
          dimensions: ['conflict_intensity', 'civilian_impact', 'escalation_potential', 'humanitarian_access', 'economic_disruption'],
          instruction: 'Score each dimension 0-20 based on the event summary, then sum for total 0-100 risk score.',
        },
      };
    }

    case 'format_sitrep': {
      console.log('    [tool] format_sitrep — saving final SITREP');
      const sitrep = {
        executive_summary: args.executive_summary,
        sections: args.sections || [],
        overall_threat_level: args.overall_threat_level || 'moderate',
        watch_list: args.watch_list || [],
        generated_at: Date.now(),
        generated_by: 'agent-sitrep-v1',
        model: 'llama-3.1-8b-instant',
      };

      // Save to Redis
      await redisSet(redisUrl, redisToken, CANONICAL_KEY, sitrep, SITREP_TTL);
      console.log(`    Saved to ${CANONICAL_KEY}`);
      return { success: true, key: CANONICAL_KEY };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Summarize large Redis payloads so they fit in Groq's context window
function summarizeForAgent(key, data) {
  // Missile events: return top 10 + stats
  if (key.includes('missile-events') && data.events) {
    const events = data.events;
    const sixH = Date.now() - 6 * 3600_000;
    const recent = events.filter(e => e.timestamp >= sixH);
    return {
      total_events: events.length,
      recent_6h: recent.length,
      severity_breakdown: countBy(events, 'severity'),
      type_breakdown: countBy(events, 'eventType'),
      top_events: events.slice(0, 8).map(e => ({
        title: e.title?.slice(0, 120),
        location: e.locationName,
        severity: e.severity,
        type: e.eventType,
        hours_ago: Math.round((Date.now() - e.timestamp) / 3600_000),
      })),
      fetched_at: data.fetchedAt,
    };
  }

  // Conflict forecast: return top 15 by risk
  if (key.includes('conflict') && data.forecasts) {
    return {
      total_countries: data.forecasts.length,
      model: data.model,
      top_risk_countries: data.forecasts.slice(0, 15).map(f => ({
        country: f.countryName || f.countryCode,
        predicted_log_fatalities: f.predictedLogFatalities,
        estimated_fatalities_per_month: f.estimatedFatalities,
      })),
      fetched_at: data.fetchedAt,
    };
  }

  // Disease outbreaks: return all (usually <30)
  if (key.includes('outbreaks') && data.events) {
    return {
      total_outbreaks: data.events.length,
      events: data.events.slice(0, 15).map(e => ({
        title: e.title?.slice(0, 120),
        country: e.country,
        disease_type: e.diseaseType,
        severity: e.severity,
        days_ago: Math.round((Date.now() - e.timestamp) / 86400_000),
      })),
    };
  }

  // Radiation: return only anomalies + stats
  if (key.includes('radiation') && data.readings) {
    const anomalies = data.readings.filter(r => r.isAnomaly);
    return {
      total_readings: data.readings.length,
      anomaly_count: anomalies.length,
      anomaly_threshold_cpm: data.anomalyThreshold,
      anomalies: anomalies.slice(0, 10).map(r => ({
        cpm: r.cpm,
        usvh: r.usvh,
        lat: r.latitude,
        lon: r.longitude,
      })),
    };
  }

  // POI: return high-risk persons
  if (key.includes('poi') && data.persons) {
    const highRisk = data.persons.filter(p => ['critical', 'high'].includes((p.riskLevel || '').toLowerCase()));
    return {
      total_persons: data.persons.length,
      high_risk_count: highRisk.length,
      high_risk_persons: highRisk.slice(0, 10).map(p => ({
        name: p.name,
        role: p.role,
        risk_level: p.riskLevel,
        region: p.region,
        activity_score: p.activityScore,
      })),
    };
  }

  // GDELT intel: return topic summaries
  if (key.includes('gdelt-intel') && data.topics) {
    return {
      topics: data.topics.map(t => ({
        id: t.id,
        article_count: t.articles?.length || 0,
        top_headlines: (t.articles || []).slice(0, 3).map(a => a.title?.slice(0, 100)),
      })),
    };
  }

  // Unrest events: return top events by severity
  if (key.includes('unrest') && (data.events || data.topics)) {
    const events = data.events || (data.topics?.flatMap(t => t.events || []) || []);
    return {
      total_events: events.length,
      top_events: events.slice(0, 10).map(e => ({
        location: e.location?.name || e.country || '?',
        type: e.eventType || e.type || '?',
        severity: e.severityLevel || e.severity || '?',
        description: (e.description || e.title || '').slice(0, 100),
      })),
    };
  }

  // Iran events
  if (key.includes('iran') && data.events) {
    return {
      total_events: data.events.length,
      top_events: data.events.slice(0, 8).map(e => ({
        title: e.title?.slice(0, 120),
        category: e.category,
        location: e.locationName,
        severity: e.severity,
      })),
    };
  }

  // Default: truncate to reasonable size
  const str = JSON.stringify(data);
  if (str.length > 8000) {
    return { _truncated: true, _original_size: str.length, sample: JSON.parse(str.slice(0, 8000) + '..."}') };
  }
  return data;
}

function countBy(arr, field) {
  const counts = {};
  for (const item of arr) {
    const val = item[field] || 'unknown';
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

// ---------- Groq API ----------

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';  // 8B has 131K TPM vs 12K on the 70B — essential for multi-step agent loops
const MAX_AGENT_STEPS = 6; // Reduced from 8 — 8B model needs fewer steps with targeted prompting
const STEP_DELAY_MS = 3_000; // 3s delay between steps to avoid rate limits

const SYSTEM_PROMPT = `You are an expert intelligence analyst working for World Monitor, an open-source OSINT platform. Your task is to generate a comprehensive Situation Report (SITREP) by querying available intelligence data sources and synthesizing findings.

WORKFLOW:
1. Start by querying the alert stream (get_active_alerts) to see what anomalies have been detected
2. Query 4-6 of the most relevant Redis intelligence keys based on what alerts suggest
3. For the 2-3 most concerning regions, use assess_region_risk to structure your analysis
4. Call format_sitrep ONCE at the end with your complete analysis

ANALYSIS GUIDELINES:
- Lead with what matters most — active threats and escalating situations
- Look for GEOGRAPHIC CLUSTERS where multiple data sources converge (e.g., missile strikes + conflict forecast + displacement in the same region)
- Note patterns and correlations between different intelligence streams
- Distinguish between confirmed events and forecasted/predicted risks
- Include specific data points (numbers, dates, locations) — don't be vague
- The executive summary should be 2-3 paragraphs, max 200 words
- Each section should contain ANALYSIS, not just data regurgitation

Current date: ${new Date().toISOString().split('T')[0]}. All timestamps are in UTC.`;

async function callGroq(messages, tools) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const body = {
    model: GROQ_MODEL,
    messages,
    max_tokens: 4096,
    temperature: 0.3,
  };

  // Only include tools if we want the model to call them
  if (tools) body.tools = tools;

  // Retry up to 3 times on 429 rate limit errors
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (resp.status === 429) {
      const waitSec = (attempt + 1) * 15;
      console.warn(`    Rate limited (429) — waiting ${waitSec}s before retry ${attempt + 1}/3...`);
      await sleep(waitSec * 1000);
      continue;
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Groq API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    return resp.json();
  }

  throw new Error('Groq API rate limited after 3 retries');
}

// ---------- Agent Loop ----------

async function runAgent(context) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: 'Generate a comprehensive global intelligence SITREP based on the latest available data. Query the relevant data sources, analyze patterns, and produce a structured brief.' },
  ];

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    // Delay between steps to stay within rate limits
    if (step > 0) {
      console.log(`    (waiting ${STEP_DELAY_MS / 1000}s between steps...)`);
      await sleep(STEP_DELAY_MS);
    }

    console.log(`  Step ${step + 1}/${MAX_AGENT_STEPS}...`);

    // On the last step, don't pass tools to force the model to finish
    const toolsForStep = step < MAX_AGENT_STEPS - 1 ? TOOLS : undefined;
    const response = await callGroq(messages, toolsForStep);

    const choice = response.choices?.[0];
    if (!choice) throw new Error('No response from Groq');

    const msg = choice.message;
    messages.push(msg);

    // If the model wants to call tools, execute them
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      console.log(`    Model requested ${msg.tool_calls.length} tool call(s)`);

      for (const toolCall of msg.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs;
        try {
          fnArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          fnArgs = {};
        }

        const result = await executeTool(fnName, fnArgs, context);

        // If this was format_sitrep, we're done — the SITREP has been saved
        if (fnName === 'format_sitrep' && result.success) {
          console.log('  Agent completed — SITREP saved');
          return result;
        }

        // Feed the tool result back to the model
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    // If the model produced a final text response without calling format_sitrep,
    // we try to extract a sitrep from the text and save it anyway
    if (choice.finish_reason === 'stop' && msg.content) {
      console.log('  Agent finished with text response (no format_sitrep call)');
      const fallbackSitrep = {
        executive_summary: msg.content.slice(0, 1000),
        sections: [],
        overall_threat_level: 'moderate',
        watch_list: [],
        generated_at: Date.now(),
        generated_by: 'agent-sitrep-v1-fallback',
        model: GROQ_MODEL,
      };
      await redisSet(context.redisUrl, context.redisToken, CANONICAL_KEY, fallbackSitrep, SITREP_TTL);
      return { success: true, key: CANONICAL_KEY, fallback: true };
    }
  }

  console.warn('  Agent hit max steps without completing');
  return { success: false, reason: 'max_steps_exceeded' };
}

// ---------- Main ----------

async function main() {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    console.error('GROQ_API_KEY not set — skipping agent sitrep');
    process.exit(0);
  }

  const { url, token } = getRedisCredentials();
  console.log('=== Agent SITREP Generation ===');
  console.log(`  Model: ${GROQ_MODEL}`);
  console.log(`  Max steps: ${MAX_AGENT_STEPS}`);
  console.log(`  Output key: ${CANONICAL_KEY}`);

  const context = { redisUrl: url, redisToken: token };

  const startMs = Date.now();
  const result = await runAgent(context);
  const durationMs = Date.now() - startMs;

  console.log(`  Result: ${result.success ? 'SUCCESS' : 'FAILED'} (${Math.round(durationMs / 1000)}s)`);
  if (result.fallback) console.log('  Note: Used fallback (model did not call format_sitrep)');

  // Optionally send Telegram notification
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (telegramToken && chatId && result.success) {
    try {
      const sitrep = await redisGet(url, token, CANONICAL_KEY);
      const summary = sitrep?.executive_summary?.slice(0, 500) || 'SITREP generated.';
      const threat = sitrep?.overall_threat_level?.toUpperCase() || 'UNKNOWN';
      const msg = `📋 <b>Agent SITREP</b> (${threat})\n\n${summary}\n\n<i>Full report: /api/agent-sitrep</i>`;
      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(5_000),
      });
      console.log('  Telegram notification sent');
    } catch (err) {
      console.warn(`  Telegram notification failed: ${err.message}`);
    }
  }

  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
