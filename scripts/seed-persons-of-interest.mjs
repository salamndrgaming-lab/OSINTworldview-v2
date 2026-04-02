#!/usr/bin/env node
/**
 * seed-persons-of-interest.mjs (v2 — cache-backed)
 * Reads from gdelt:raw:v1 instead of calling GDELT directly.
 * Requires seed-gdelt-raw.mjs to have run first in this seed cycle.
 */

import { loadEnvFile, runSeed, verifySeedKey } from './_seed-utils.mjs';
import { getGdeltPersonData } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:poi:v1';
const CACHE_TTL     = 21_600; // 6h — survives 2 missed cron cycles (was 1h, expired between runs)
const GROQ_MODEL    = 'llama-3.1-8b-instant';

// ── Tracked Persons ──

const TRACKED_PERSONS = [
  { name: 'Vladimir Putin',          role: 'President of Russia',                         region: 'Russia',         tags: ['head-of-state', 'nuclear-power'] },
  { name: 'Volodymyr Zelenskyy',     role: 'President of Ukraine',                        region: 'Ukraine',        tags: ['head-of-state', 'conflict-zone'] },
  { name: 'Xi Jinping',              role: 'President of China',                          region: 'China',          tags: ['head-of-state', 'nuclear-power'] },
  { name: 'Kim Jong Un',             role: 'Supreme Leader of North Korea',               region: 'North Korea',    tags: ['head-of-state', 'nuclear-power'] },
  { name: 'Ali Khamenei',            role: 'Supreme Leader of Iran',                      region: 'Iran',           tags: ['head-of-state', 'nuclear-program'] },
  { name: 'Benjamin Netanyahu',      role: 'Prime Minister of Israel',                    region: 'Israel',         tags: ['head-of-state', 'conflict-zone'] },
  { name: 'Bashar al-Assad',         role: 'Former President of Syria',                   region: 'Syria',          tags: ['conflict-zone', 'displaced'] },
  { name: 'Recep Tayyip Erdogan',    role: 'President of Turkey',                         region: 'Turkey',         tags: ['head-of-state', 'NATO'] },
  { name: 'Narendra Modi',           role: 'Prime Minister of India',                     region: 'India',          tags: ['head-of-state', 'nuclear-power'] },
  { name: 'Mohammed bin Salman',     role: 'Crown Prince of Saudi Arabia',                region: 'Saudi Arabia',   tags: ['head-of-state', 'energy'] },
  { name: 'Abdel Fattah el-Sisi',    role: 'President of Egypt',                          region: 'Egypt',          tags: ['head-of-state', 'middle-east'] },
  { name: 'Yevgeny Prigozhin',       role: 'Wagner Group (deceased)',                     region: 'Russia',         tags: ['PMC', 'africa-operations'] },
  { name: 'Abu Mohammed al-Julani',  role: 'HTS Leader / Syria transition',               region: 'Syria',          tags: ['non-state-actor', 'conflict-zone'] },
  { name: 'Yahya Sinwar',            role: 'Hamas Leader (deceased)',                     region: 'Gaza',           tags: ['non-state-actor', 'conflict-zone'] },
  { name: 'Hassan Nasrallah',        role: 'Hezbollah Secretary-General (deceased)',      region: 'Lebanon',        tags: ['non-state-actor', 'conflict-zone'] },
  { name: 'Masoud Pezeshkian',       role: 'President of Iran',                           region: 'Iran',           tags: ['head-of-state', 'nuclear-program'] },
  { name: 'Ismail Haniyeh',          role: 'Hamas Political Chief (deceased)',            region: 'Qatar',          tags: ['non-state-actor'] },
  { name: 'Joe Biden',               role: 'Former President of the United States',       region: 'United States',  tags: ['head-of-state', 'NATO', 'nuclear-power'] },
  { name: 'Donald Trump',            role: 'President of the United States',              region: 'United States',  tags: ['head-of-state', 'NATO', 'nuclear-power'] },
  { name: 'Keir Starmer',            role: 'Prime Minister of the United Kingdom',        region: 'United Kingdom', tags: ['head-of-state', 'NATO', 'nuclear-power'] },
  { name: 'Emmanuel Macron',         role: 'President of France',                         region: 'France',         tags: ['head-of-state', 'NATO', 'nuclear-power'] },
];

const CAPITAL_MAP = {
  'Russia': 'Moscow, Russia', 'Ukraine': 'Kyiv, Ukraine', 'China': 'Beijing, China',
  'North Korea': 'Pyongyang, North Korea', 'Iran': 'Tehran, Iran', 'Israel': 'Jerusalem, Israel',
  'Syria': 'Damascus, Syria', 'Turkey': 'Ankara, Turkey', 'India': 'New Delhi, India',
  'Saudi Arabia': 'Riyadh, Saudi Arabia', 'Egypt': 'Cairo, Egypt', 'Gaza': 'Gaza City, Palestine',
  'Lebanon': 'Beirut, Lebanon', 'Qatar': 'Doha, Qatar', 'United States': 'Washington D.C., United States',
  'United Kingdom': 'London, United Kingdom', 'France': 'Paris, France',
};

// ── Groq AI Profiling ──

async function generateProfile(person, articles) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || articles.length === 0) return null;

  const headlineText = articles.slice(0, 10).map((a, i) =>
    `${i + 1}. "${a.title}" (${a.source}, ${a.date})`
  ).join('\n');

  const prompt = `You are an OSINT intelligence analyst. Based on these recent headlines about ${person.name} (${person.role}), produce a JSON intelligence profile.

CRITICAL RULES:
- locationConfidence MUST be a number between 0.0 and 1.0 (not a string)
- recentActivity MUST be an array of strings (not a single string)
- riskLevel MUST be one of: "critical", "high", "medium", "low"
- Respond with ONLY valid JSON, no markdown, no backticks

{
  "summary": "2-3 sentence summary of current activities and geopolitical significance",
  "lastKnownLocation": "City, Country",
  "locationConfidence": 0.8,
  "locationReasoning": "Brief explanation",
  "recentActivity": ["First notable action", "Second action"],
  "riskLevel": "high",
  "riskReason": "1 sentence risk assessment",
  "associatedEntities": ["org1", "person2"],
  "sentiment": "negative"
}

Headlines:
${headlineText}`;

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are an intelligence analyst. Respond with ONLY valid JSON. locationConfidence must be a number 0-1, recentActivity must be an array, riskLevel must be critical|high|medium|low.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 600,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) { console.warn(`  Groq error for ${person.name}: ${resp.status}`); return null; }
    const json = await resp.json();
    const text = json.choices?.[0]?.message?.content?.trim() || '';
    const cleaned = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.locationConfidence === 'string') {
        const m = { confirmed: 0.95, likely: 0.7, estimated: 0.4, unknown: 0.1 };
        parsed.locationConfidence = m[parsed.locationConfidence] ?? 0.5;
      }
      if (typeof parsed.locationConfidence !== 'number') parsed.locationConfidence = 0.5;
      parsed.locationConfidence = Math.max(0, Math.min(1, parsed.locationConfidence));
      if (typeof parsed.recentActivity === 'string') parsed.recentActivity = [parsed.recentActivity];
      if (!Array.isArray(parsed.recentActivity)) parsed.recentActivity = [];
      const riskMap = { elevated: 'high', moderate: 'medium' };
      if (riskMap[parsed.riskLevel]) parsed.riskLevel = riskMap[parsed.riskLevel];
      if (!['critical', 'high', 'medium', 'low'].includes(parsed.riskLevel)) parsed.riskLevel = 'medium';
      return parsed;
    } catch { console.warn(`  Failed to parse Groq response for ${person.name}`); return null; }
  } catch (err) { console.warn(`  Groq failed for ${person.name}: ${err.message}`); return null; }
}

function resolveLocation(person, aiProfile) {
  if (aiProfile?.lastKnownLocation && aiProfile.locationConfidence > 0.2) {
    const conf = aiProfile.locationConfidence;
    return { location: aiProfile.lastKnownLocation, confidence: conf, source: conf >= 0.7 ? 'ai-confirmed' : 'ai-likely', reasoning: aiProfile.locationReasoning || '' };
  }
  const capital = CAPITAL_MAP[person.region];
  if (capital) return { location: capital, confidence: 0.4, source: 'capital-fallback', reasoning: `Default capital for ${person.region}` };
  return { location: `${person.region} (estimated)`, confidence: 0.15, source: 'region-estimate', reasoning: 'No specific location data available' };
}

function calculateActivityScore(mentionCount, articles) {
  const volumeScore  = Math.min(60, Math.round(60 * Math.log10(Math.max(1, mentionCount)) / Math.log10(200)));
  const now = Date.now();
  let recencyScore = 0;
  for (const a of articles.slice(0, 5)) {
    if (!a.date) continue;
    try {
      const ts = new Date(a.date.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).getTime();
      const hoursAgo = (now - ts) / 3600000;
      recencyScore += Math.max(0, 8 * (1 - hoursAgo / 72));
    } catch { /* skip */ }
  }
  return volumeScore + Math.min(40, Math.round(recencyScore));
}

// ── Main ──

async function fetchPersonsOfInterest() {
  const profiles = [];
  const hasGroq = !!process.env.GROQ_API_KEY;

  console.log(`  Tracking ${TRACKED_PERSONS.length} persons (cache-backed, no direct GDELT calls)`);
  console.log(`  Groq AI: ${hasGroq ? 'enabled' : 'disabled'}`);

  for (const person of TRACKED_PERSONS) {
    console.log(`  → ${person.name}...`);

    // Read pre-fetched data from gdelt:raw:v1 — zero GDELT API calls
    const personData = await getGdeltPersonData(person.name);
    const mentionCount = personData.mentionCount ?? 0;
    const articles     = personData.headlines     ?? [];
    console.log(`    ${mentionCount} mentions (7d), ${articles.length} headlines (72h) [from cache]`);

    let aiProfile = null;
    if (hasGroq && articles.length > 0) {
      aiProfile = await generateProfile(person, articles);
      if (aiProfile) console.log(`    AI profile ✓ (loc: ${aiProfile.lastKnownLocation}, conf: ${aiProfile.locationConfidence})`);
      // Rate-limit Groq free tier: 30 req/min
      await new Promise(r => setTimeout(r, 2200));
    }

    const loc          = resolveLocation(person, aiProfile);
    const activityScore = calculateActivityScore(mentionCount, articles);
    const avgTone      = articles.length > 0
      ? articles.reduce((sum, a) => sum + (a.tone || 0), 0) / articles.length
      : 0;

    profiles.push({
      id:     person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name:   person.name,
      role:   person.role,
      region: person.region,
      tags:   person.tags,
      source: 'tracked',
      lastKnownLocation:  loc.location,
      locationConfidence: loc.confidence,
      locationSource:     loc.source,
      locationReasoning:  loc.reasoning,
      summary:        aiProfile?.summary || `${person.role}. ${mentionCount} mentions in global media over the past week.`,
      recentActivity: Array.isArray(aiProfile?.recentActivity) ? aiProfile.recentActivity
                      : aiProfile?.recentActivity ? [String(aiProfile.recentActivity)]
                      : [articles[0]?.title || 'No recent activity detected'],
      riskLevel:         aiProfile?.riskLevel || 'medium',
      riskReason:        aiProfile?.riskReason || '',
      associatedEntities: aiProfile?.associatedEntities || [],
      sentiment:         aiProfile?.sentiment || (avgTone > 2 ? 'positive' : avgTone < -2 ? 'negative' : 'neutral'),
      mentionCount,
      activityScore,
      averageTone: Math.round(avgTone * 100) / 100,
      recentArticles: articles.slice(0, 5).map(a => ({ title: a.title, source: a.source, url: a.url, date: a.date })),
      profileGeneratedAt: new Date().toISOString(),
      dataFreshness: articles.length > 0 ? '72h' : 'stale',
    });
  }


  // LKG (Last Known Good) preservation: if every single person has 0 mentions
  // and 0 headlines, the GDELT cache is empty (circuit tripped on first run or
  // gdelt:raw:v1 key is missing). Rather than publishing 21 zero-data profiles
  // that will overwrite valid cached profiles, return the previous snapshot.
  const allEmpty = profiles.every(p => p.mentionCount === 0 && p.recentArticles.length === 0);
  if (allEmpty && profiles.length > 0) {
    const previous = await verifySeedKey(CANONICAL_KEY).catch(() => null);
    if (previous && Array.isArray(previous.persons) && previous.persons.length > 0) {
      const prevWithData = previous.persons.filter(p => p.mentionCount > 0 || p.recentArticles?.length > 0);
      if (prevWithData.length > 0) {
        console.warn(`  ⚠ All ${profiles.length} persons returned 0 data from cache — GDELT raw key is empty or stale.`);
        console.warn(`  ↩ LKG preservation: returning previous snapshot (${previous.persons.length} profiles, ${prevWithData.length} with data).`);
        return previous;
      }
    }
  }

  profiles.sort((a, b) => b.activityScore - a.activityScore);
  console.log(`  Generated ${profiles.length} POI profiles`);
  console.log(`  With AI profiles: ${profiles.filter(p => p.riskReason).length}`);
  console.log(`  High-confidence locations: ${profiles.filter(p => p.locationConfidence >= 0.7).length}`);

  return {
    persons: profiles,
    generatedAt: new Date().toISOString(),
    trackedCount: TRACKED_PERSONS.length,
    withAiProfile: profiles.filter(p => p.riskReason).length,
    version: 2,
  };
}

function validate(data) {
  return Array.isArray(data?.persons) && data.persons.length >= 1;
}

runSeed('intelligence', 'poi', CANONICAL_KEY, fetchPersonsOfInterest, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'gdelt-raw-cache-v2',
}).catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
