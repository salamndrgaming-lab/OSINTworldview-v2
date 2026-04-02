#!/usr/bin/env node
/**
 * seed-persons-of-interest.mjs (Patch 5 — shared tracked-persons.json)
 *
 * CHANGES FROM PATCH 4:
 *   - Import persons from shared/tracked-persons.json (no more inline array)
 *   - LKG fallback: if all 21 persons have mentionCount === 0, preserve
 *     previous intelligence:poi:v1 snapshot
 *   - topDomains: top 5 domains by headline count per person
 *   - Headline scoring: recency×0.6 + |tone|×0.4
 *   - _meta.patch: 5
 *
 * Reads from gdelt:raw:v1 — zero direct GDELT calls. Requires seed-gdelt-raw.mjs
 * to have run first in this seed cycle.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile, runSeed, getRedisCredentials } from './_seed-utils.mjs';
import { getGdeltPersonData } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:poi:v1';
const CACHE_TTL     = 6 * 3600; // 6h TTL as spec'd in Patch 5
const GROQ_MODEL    = 'llama-3.1-8b-instant';

// ── Load tracked persons from shared JSON ─────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {Array<{ name: string, aliases: string[], role: string, status: string, region: string, tags: string[] }>} */
let TRACKED_PERSONS;
try {
  TRACKED_PERSONS = JSON.parse(
    readFileSync(join(__dirname, 'shared', 'tracked-persons.json'), 'utf8')
  );
} catch (err) {
  console.error(`FATAL: Cannot load shared/tracked-persons.json — ${err.message}`);
  process.exit(1);
}

// ── Capital map (for location fallback) ──────────────────────────────────────

const CAPITAL_MAP = {
  'Russia':         'Moscow, Russia',
  'Ukraine':        'Kyiv, Ukraine',
  'China':          'Beijing, China',
  'North Korea':    'Pyongyang, North Korea',
  'Iran':           'Tehran, Iran',
  'Israel':         'Jerusalem, Israel',
  'Syria':          'Damascus, Syria',
  'Turkey':         'Ankara, Turkey',
  'India':          'New Delhi, India',
  'Saudi Arabia':   'Riyadh, Saudi Arabia',
  'Egypt':          'Cairo, Egypt',
  'Gaza':           'Gaza City, Palestine',
  'Lebanon':        'Beirut, Lebanon',
  'Qatar':          'Doha, Qatar',
  'United States':  'Washington D.C., United States',
  'United Kingdom': 'London, United Kingdom',
  'France':         'Paris, France',
};

// ── Groq AI Profiling ─────────────────────────────────────────────────────────

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
      // Coerce locationConfidence
      if (typeof parsed.locationConfidence === 'string') {
        const m = { confirmed: 0.95, likely: 0.7, estimated: 0.4, unknown: 0.1 };
        parsed.locationConfidence = m[parsed.locationConfidence] ?? 0.5;
      }
      if (typeof parsed.locationConfidence !== 'number') parsed.locationConfidence = 0.5;
      parsed.locationConfidence = Math.max(0, Math.min(1, parsed.locationConfidence));
      // Coerce recentActivity
      if (typeof parsed.recentActivity === 'string') parsed.recentActivity = [parsed.recentActivity];
      if (!Array.isArray(parsed.recentActivity)) parsed.recentActivity = [];
      // Normalise riskLevel synonyms
      const riskMap = { elevated: 'high', moderate: 'medium' };
      if (riskMap[parsed.riskLevel]) parsed.riskLevel = riskMap[parsed.riskLevel];
      if (!['critical', 'high', 'medium', 'low'].includes(parsed.riskLevel)) parsed.riskLevel = 'medium';
      return parsed;
    } catch { console.warn(`  Failed to parse Groq response for ${person.name}`); return null; }
  } catch (err) { console.warn(`  Groq failed for ${person.name}: ${err.message}`); return null; }
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

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
  const volumeScore = Math.min(60, Math.round(60 * Math.log10(Math.max(1, mentionCount)) / Math.log10(200)));
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

/**
 * Score a headline by recency (0.6 weight) and absolute tone magnitude (0.4 weight).
 * Returns a float in [0, 1].
 */
function scoreHeadline(article) {
  const now = Date.now();
  let recencyScore = 0;
  if (article.date) {
    try {
      const ts = new Date(article.date.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).getTime();
      const hoursAgo = Math.max(0, (now - ts) / 3600000);
      recencyScore = Math.max(0, 1 - hoursAgo / 72); // decay over 72h
    } catch { /* skip */ }
  }
  const toneScore = Math.min(1, Math.abs(article.tone || 0) / 10); // tone range ~-10 to +10
  return recencyScore * 0.6 + toneScore * 0.4;
}

/**
 * Extract top 5 domains by headline count for a person.
 * @param {object[]} articles
 * @returns {Array<{ domain: string, count: number }>}
 */
function extractTopDomains(articles) {
  const counts = {};
  for (const a of articles) {
    const d = a.domain || a.source || '';
    if (d) counts[d] = (counts[d] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function fetchPersonsOfInterest() {
  const profiles = [];
  const hasGroq = !!process.env.GROQ_API_KEY;

  console.log(`  Tracking ${TRACKED_PERSONS.length} persons (cache-backed, no direct GDELT calls)`);
  console.log(`  Source: shared/tracked-persons.json`);
  console.log(`  Groq AI: ${hasGroq ? 'enabled' : 'disabled'}`);

  for (const person of TRACKED_PERSONS) {
    console.log(`  → ${person.name}...`);

    const personData  = await getGdeltPersonData(person.name);
    const mentionCount = personData.mentionCount ?? 0;
    const articles     = personData.headlines    ?? [];
    console.log(`    ${mentionCount} mentions (7d), ${articles.length} headlines (72h) [from cache]`);

    let aiProfile = null;
    if (hasGroq && articles.length > 0) {
      aiProfile = await generateProfile(person, articles);
      if (aiProfile) console.log(`    AI profile ✓ (loc: ${aiProfile.lastKnownLocation}, conf: ${aiProfile.locationConfidence})`);
      // Rate-limit Groq free tier: 30 req/min
      await new Promise(r => setTimeout(r, 2200));
    }

    const loc           = resolveLocation(person, aiProfile);
    const activityScore = calculateActivityScore(mentionCount, articles);
    const avgTone       = articles.length > 0
      ? articles.reduce((sum, a) => sum + (a.tone || 0), 0) / articles.length
      : 0;

    // Score and sort headlines by recency×0.6 + |tone|×0.4
    const scoredHeadlines = articles
      .map(a => ({ ...a, _score: scoreHeadline(a) }))
      .sort((a, b) => b._score - a._score);

    // Top 5 domains
    const topDomains = extractTopDomains(articles);

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
      riskLevel:          aiProfile?.riskLevel || 'medium',
      riskReason:         aiProfile?.riskReason || '',
      associatedEntities: aiProfile?.associatedEntities || [],
      sentiment:          aiProfile?.sentiment || (avgTone > 2 ? 'positive' : avgTone < -2 ? 'negative' : 'neutral'),
      mentionCount,
      activityScore,
      averageTone:    Math.round(avgTone * 100) / 100,
      topDomains,
      recentArticles: scoredHeadlines.slice(0, 5).map(a => ({
        title:  a.title,
        source: a.source,
        url:    a.url,
        date:   a.date,
        score:  Math.round((a._score ?? 0) * 1000) / 1000,
      })),
      profileGeneratedAt: new Date().toISOString(),
      dataFreshness: articles.length > 0 ? '72h' : 'stale',
    });
  }

  profiles.sort((a, b) => b.activityScore - a.activityScore);
  console.log(`  Generated ${profiles.length} POI profiles`);
  console.log(`  With AI profiles: ${profiles.filter(p => p.riskReason).length}`);
  console.log(`  High-confidence locations: ${profiles.filter(p => p.locationConfidence >= 0.7).length}`);

  // ── LKG fallback guard ────────────────────────────────────────────────────
  // If all persons returned mentionCount === 0, the gdelt:raw:v1 cache is likely
  // empty or the circuit tripped in phase 2. Restore the previous snapshot.
  const allZero = profiles.every(p => p.mentionCount === 0);
  if (allZero && profiles.length > 0) {
    console.warn('  ⚠ All persons have mentionCount=0 — checking for LKG snapshot…');
    try {
      const { url, token } = getRedisCredentials();
      const resp = await fetch(`${url}/get/${encodeURIComponent(CANONICAL_KEY)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal:  AbortSignal.timeout(8_000),
      });
      if (resp.ok) {
        const body = await resp.json();
        if (body.result) {
          const lkg = typeof body.result === 'string' ? JSON.parse(body.result) : body.result;
          if (Array.isArray(lkg?.persons) && lkg.persons.some(p => p.mentionCount > 0)) {
            console.warn('  ↩ LKG fallback: preserving previous intelligence:poi:v1 snapshot (all current persons at zero)');
            // Return LKG data so validate() passes and runSeed writes it back, refreshing TTL
            return {
              ...lkg,
              generatedAt:    new Date().toISOString(),
              lkgFallback:    true,
              lkgPreservedAt: new Date().toISOString(),
            };
          }
        }
      }
    } catch (lkgErr) {
      console.warn(`  LKG read failed: ${lkgErr.message}`);
    }
  }

  return {
    persons: profiles,
    generatedAt: new Date().toISOString(),
    trackedCount: TRACKED_PERSONS.length,
    withAiProfile: profiles.filter(p => p.riskReason).length,
    version: 2,
    _meta: { patch: 5 },
  };
}

function validate(data) {
  return Array.isArray(data?.persons) && data.persons.length >= 1;
}

runSeed('intelligence', 'poi', CANONICAL_KEY, fetchPersonsOfInterest, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'gdelt-raw-cache-patch5',
}).catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
