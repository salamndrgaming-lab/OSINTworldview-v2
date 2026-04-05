#!/usr/bin/env node

/**
 * seed-insights-from-cache.mjs
 * 
 * Alternative insights seeder that generates AI intelligence briefs
 * from GDELT data already cached in Redis, instead of requiring
 * a news digest. Drop this in the scripts/ folder.
 * 
 * Usage: node scripts/seed-insights-from-cache.mjs
 * Requires: GROQ_API_KEY (or OPENROUTER_API_KEY as fallback)
 */

import { loadEnvFile, CHROME_UA, getRedisCredentials, runSeed, maskToken } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'news:insights:v1';
const CACHE_TTL = 10800; // 3h — survives 1 missed cron cycle (was 1800s)
const GROQ_MODEL = 'llama-3.1-8b-instant';

// Keys to read from Redis for building context
const SOURCE_KEYS = {
  gdelt:       'intelligence:gdelt-intel:v1',
  earthquakes: 'seismology:earthquakes:v1',
  unrest:      'unrest:events:v1',
  cyber:       'cyber:threats-bootstrap:v2',
  natural:     'natural:events:v1',
  predictions: 'prediction:markets-bootstrap:v1',
  commodities: 'market:commodities-bootstrap:v1',
};

function unwrap(raw, ...keys) {
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

async function readMultipleKeys() {
  const { url, token } = getRedisCredentials();
  const keys = Object.values(SOURCE_KEYS);
  const pipeline = keys.map(k => ['GET', k]);

  const resp = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) throw new Error(`Redis pipeline failed: ${resp.status}`);
  const results = await resp.json();
  const data = {};
  const names = Object.keys(SOURCE_KEYS);

  for (let i = 0; i < names.length; i++) {
    const raw = results[i]?.result;
    if (raw) {
      try { data[names[i]] = JSON.parse(raw); } catch { /* skip */ }
    }
  }
  return data;
}

function buildHeadlinesFromCache(data) {
  const headlines = [];

  // GDELT intelligence topics
  const topics = unwrap(data.gdelt, 'topics');
  for (const topic of topics) {
    const articles = unwrap(topic, 'articles', 'events');
    for (const a of articles.slice(0, 3)) {
      const title = a.title || a.headline || '';
      if (title.length > 15) headlines.push(title.slice(0, 300));
    }
  }

  // Earthquake headlines
  const quakes = unwrap(data.earthquakes, 'earthquakes');
  for (const q of quakes.filter(q => (q.magnitude ?? q.mag ?? 0) >= 5.0).slice(0, 3)) {
    headlines.push(`M${(q.magnitude ?? q.mag).toFixed(1)} earthquake near ${q.place || 'unknown location'}`);
  }

  // Unrest events
  const unrest = unwrap(data.unrest, 'events');
  for (const e of unrest.slice(0, 5)) {
    const type = e.event_type || e.type || 'Unrest';
    const loc = e.location ? `${e.location}, ${e.country || ''}` : (e.country || '');
    if (loc) headlines.push(`${type} reported in ${loc.trim()}`);
  }

  // Cyber threats
  const cyber = unwrap(data.cyber, 'threats');
  for (const t of cyber.filter(t => ['critical', 'high'].includes(String(t.severity || '').toLowerCase())).slice(0, 2)) {
    headlines.push(`Cyber threat: ${t.name || 'unnamed'} (${t.severity})`);
  }

  // Natural events  
  const natural = unwrap(data.natural, 'events');
  for (const e of natural.slice(0, 2)) {
    const title = e.title || e.name || e.type || '';
    if (title) headlines.push(title);
  }

  return headlines.filter(h => h.length > 10).slice(0, 20);
}

function categorize(title) {
  const lower = (title || '').toLowerCase();
  const cats = [
    { kw: ['war', 'attack', 'missile', 'troops', 'airstrike', 'military'], cat: 'conflict', sev: 'critical' },
    { kw: ['killed', 'dead', 'casualties', 'shooting'], cat: 'violence', sev: 'high' },
    { kw: ['protest', 'uprising', 'riot', 'unrest', 'coup'], cat: 'unrest', sev: 'high' },
    { kw: ['sanctions', 'tensions', 'escalation'], cat: 'geopolitical', sev: 'elevated' },
    { kw: ['earthquake', 'flood', 'hurricane', 'wildfire', 'tsunami', 'volcano'], cat: 'natural_disaster', sev: 'elevated' },
    { kw: ['cyber', 'hack', 'breach', 'malware', 'ransomware'], cat: 'cyber', sev: 'high' },
    { kw: ['market', 'economy', 'trade', 'tariff', 'inflation', 'oil', 'crude'], cat: 'economic', sev: 'moderate' },
    { kw: ['election', 'vote', 'parliament'], cat: 'political', sev: 'moderate' },
  ];
  for (const { kw, cat, sev } of cats) {
    if (kw.some(k => lower.includes(k))) return { category: cat, severity: sev };
  }
  return { category: 'general', severity: 'moderate' };
}

async function callGroq(headlines) {
  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (!groqKey && !openrouterKey) {
    console.log('  No LLM key available (GROQ_API_KEY or OPENROUTER_API_KEY) — generating without AI brief');
    return null;
  }

  const headlineText = headlines.map((h, i) => `${i + 1}. ${h}`).join('\n');
  const dateStr = new Date().toISOString().split('T')[0];

  const systemPrompt = `Current date: ${dateStr}. You are a senior intelligence analyst writing a daily brief.
Summarize the 3 most significant developments from the headlines below in 3 concise sentences (under 100 words total).
Rules:
- Each headline is a SEPARATE story — never combine facts from different headlines
- Lead with WHAT happened and WHERE
- Focus on geopolitical significance and potential escalation risks
- Never start with "Breaking news" or TV-style openings
- Be direct and analytical`;

  const userPrompt = `Headlines:\n${headlineText}`;

  // Try Groq first
  if (groqKey) {
    try {
      console.log(`  Calling Groq (${GROQ_MODEL})...`);
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 300,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const json = await resp.json();
        const text = json.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 20) {
          console.log(`  Groq brief: ${text.length} chars`);
          return { text, provider: 'groq', model: json.model || GROQ_MODEL };
        }
      } else {
        console.warn(`  Groq error: ${resp.status}`);
      }
    } catch (err) {
      console.warn(`  Groq failed: ${err.message}`);
    }
  }

  // Fallback to OpenRouter
  if (openrouterKey) {
    try {
      console.log('  Falling back to OpenRouter...');
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://worldmonitor.app',
          'X-Title': 'World Monitor',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 300,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (resp.ok) {
        const json = await resp.json();
        const text = json.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 20) {
          console.log(`  OpenRouter brief: ${text.length} chars`);
          return { text, provider: 'openrouter', model: json.model || 'gemini-2.5-flash' };
        }
      }
    } catch (err) {
      console.warn(`  OpenRouter failed: ${err.message}`);
    }
  }

  return null;
}

async function fetchInsights() {
  console.log('  Reading cached data from Redis...');
  const cached = await readMultipleKeys();
  const sourceCount = Object.keys(cached).length;
  console.log(`  Found ${sourceCount} cached data sources`);

  const headlines = buildHeadlinesFromCache(cached);
  console.log(`  Built ${headlines.length} headlines from cached data`);

  if (headlines.length === 0) {
    throw new Error('No cached data available to generate insights from. Run other seed scripts first.');
  }

  // Generate AI brief
  const llmResult = await callGroq(headlines);

  // Build top stories from headlines
  const topStories = headlines.slice(0, 10).map((title, i) => {
    const { category, severity } = categorize(title);
    return {
      primaryTitle: title,
      primarySource: 'cache-aggregation',
      primaryLink: '',
      pubDate: new Date().toISOString(),
      sourceCount: 1,
      importanceScore: 10 - i,
      velocity: { level: 'normal', sourcesPerHour: 0 },
      isAlert: severity === 'critical',
      category,
      threatLevel: severity,
    };
  });

  return {
    worldBrief: llmResult?.text || '',
    briefProvider: llmResult?.provider || '',
    briefModel: llmResult?.model || '',
    status: llmResult ? 'ok' : 'degraded',
    topStories,
    generatedAt: new Date().toISOString(),
    clusterCount: headlines.length,
    multiSourceCount: 0,
    fastMovingCount: 0,
  };
}

function validate(data) {
  return Array.isArray(data?.topStories) && data.topStories.length >= 1;
}

runSeed('news', 'insights', CANONICAL_KEY, fetchInsights, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'cache-aggregation-v1',
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
