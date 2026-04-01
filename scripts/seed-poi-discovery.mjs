#!/usr/bin/env node
/**
 * seed-poi-discovery.mjs (Phase 5 — cache-backed)
 * Reads headlines from gdelt:raw:v1 instead of calling GDELT directly.
 * Requires seed-gdelt-raw.mjs to have run first in this seed cycle.
 *
 * Organic POI Auto-Discovery — finds new persons of interest by:
 *   1. Reading pre-fetched GDELT headlines from Redis cache
 *   2. Using Groq NER to extract person names from those headlines
 *   3. Counting mention frequency per person
 *   4. Filtering out anyone already in the tracked persons list
 *   5. Building provisional profiles for high-volume new names (5+ mentions)
 *   6. Merging discovered persons into the existing POI Redis key
 */

import { loadEnvFile, getRedisCredentials, sleep } from './_seed-utils.mjs';
import { getGdeltPoiDiscoveryArticles } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY          = 'intelligence:poi:v1';
const GROQ_MODEL             = 'llama-3.1-8b-instant';
const MIN_MENTIONS_THRESHOLD = 5;
const MAX_DISCOVERED         = 10;

const TRACKED_NAMES = new Set([
  'vladimir putin', 'volodymyr zelenskyy', 'xi jinping', 'kim jong un',
  'ali khamenei', 'benjamin netanyahu', 'bashar al-assad', 'recep tayyip erdogan',
  'narendra modi', 'mohammed bin salman', 'abdel fattah el-sisi',
  'yevgeny prigozhin', 'abu mohammed al-julani', 'yahya sinwar',
  'hassan nasrallah', 'masoud pezeshkian', 'ismail haniyeh',
  'joe biden', 'donald trump', 'keir starmer', 'emmanuel macron',
]);

// ── Groq NER: extract person names from headlines ──

async function extractPersonNames(headlines) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return [];

  const batchSize = 50;
  const allNames  = [];

  for (let i = 0; i < headlines.length; i += batchSize) {
    const batch        = headlines.slice(i, i + batchSize);
    const headlineBlock = batch.map((h, idx) => `${idx + 1}. ${h}`).join('\n');

    const prompt = `Extract ALL person names (full names only, no titles like "President" or "PM") from these news headlines. Return ONLY a JSON array of strings. No markdown, no backticks, no explanation.

Example output: ["John Smith", "Jane Doe", "Ahmed Hassan"]

Headlines:
${headlineBlock}`;

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: 'You extract person names from text. Return ONLY a JSON array of full name strings. No other text.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1000,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) continue;
      const json    = await resp.json();
      const text    = json.choices?.[0]?.message?.content?.trim() || '';
      const cleaned = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();
      try {
        const names = JSON.parse(cleaned);
        if (Array.isArray(names)) {
          allNames.push(...names.filter(n => typeof n === 'string' && n.length > 2 && n.includes(' ')));
        }
      } catch { /* skip unparseable batch */ }

      await sleep(2200); // Groq free-tier rate limit
    } catch { /* skip failed batch */ }
  }

  return allNames;
}

// ── High-value POI check ──

function isHighValuePOI(entity, allHeadlines = []) {
  let effectiveCount = entity.count;
  const nameLower    = entity.name.toLowerCase();
  const related      = allHeadlines.filter(h => h.toLowerCase().includes(nameLower));
  const crisisTerms  = ['kill', 'dead', 'attack', 'bomb', 'crisis', 'war', 'strike', 'threat',
    'sanction', 'nuclear', 'missile', 'arrest', 'coup', 'resign', 'flee', 'invasion',
    'collapse', 'emergency', 'urgent', 'breaking'];
  const crisisCount  = related.filter(h => crisisTerms.some(t => h.toLowerCase().includes(t))).length;
  effectiveCount += Math.round(crisisCount * 1.5);
  if (effectiveCount >= MIN_MENTIONS_THRESHOLD) return true;

  const highValueRoles = ['commander', 'minister', 'general', 'ceo', 'envoy', 'leader',
    'president', 'prime minister', 'chief', 'director', 'secretary'];
  const triggerEvents  = ['sanctioned', 'detained', 'arrested', 'disappeared',
    'assassinated', 'threatened', 'resigned', 'fled', 'indicted', 'charged', 'expelled', 'deported'];
  const contextBlock   = related.join(' ').toLowerCase();
  const hasRole        = highValueRoles.some(r => contextBlock.includes(r));
  const isCritical     = triggerEvents.some(e => contextBlock.includes(e));
  if (hasRole && isCritical) {
    console.log(`[ORGANIC INTEL] Fast-tracking POI: ${entity.name}`);
    return true;
  }
  return false;
}

function findNewPersons(extractedNames, allHeadlines = []) {
  const counts = new Map();
  for (const name of extractedNames) {
    const normalized = name.trim();
    const key        = normalized.toLowerCase();
    if (TRACKED_NAMES.has(key)) continue;
    if (!normalized.includes(' ') || normalized.length < 5) continue;
    if (/^\d/.test(normalized)) continue;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { name: normalized, count: 1 });
  }
  return Array.from(counts.values())
    .filter(p => isHighValuePOI(p, allHeadlines))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_DISCOVERED);
}

// ── Groq: provisional profile ──

async function buildProvisionalProfile(personName, mentionCount) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  const prompt = `You are an OSINT analyst. A person named "${personName}" has appeared ${mentionCount} times in global news headlines in the past 24 hours. Based on your knowledge, provide a provisional intelligence profile.

CRITICAL: locationConfidence must be a number 0.0-1.0, recentActivity must be an array, riskLevel must be critical|high|medium|low.
Respond with ONLY valid JSON:

{
  "role": "Their current title/position",
  "region": "Country or region they are most associated with",
  "tags": ["relevant", "category", "tags"],
  "summary": "2-3 sentence assessment of why they are trending",
  "lastKnownLocation": "Best guess of current location (City, Country)",
  "locationConfidence": 0.3,
  "recentActivity": ["Brief description of what triggered the media attention"],
  "riskLevel": "medium",
  "riskReason": "Why this person is geopolitically relevant right now",
  "associatedEntities": ["Related organizations or people"],
  "sentiment": "negative"
}`;

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are an intelligence analyst. Respond with ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const json    = await resp.json();
    const text    = json.choices?.[0]?.message?.content?.trim() || '';
    const cleaned = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.locationConfidence !== 'number') parsed.locationConfidence = 0.2;
      parsed.locationConfidence = Math.max(0, Math.min(1, parsed.locationConfidence));
      if (typeof parsed.recentActivity === 'string') parsed.recentActivity = [parsed.recentActivity];
      if (!Array.isArray(parsed.recentActivity)) parsed.recentActivity = [];
      const riskMap = { elevated: 'high', moderate: 'medium' };
      if (riskMap[parsed.riskLevel]) parsed.riskLevel = riskMap[parsed.riskLevel];
      if (!['critical', 'high', 'medium', 'low'].includes(parsed.riskLevel)) parsed.riskLevel = 'medium';
      return parsed;
    } catch { return null; }
  } catch { return null; }
}

// ── Read / write existing POI from Redis ──

async function readExistingPOI() {
  const { url, token } = getRedisCredentials();
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(CANONICAL_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.result) return null;
    return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
  } catch { return null; }
}

async function writeMergedPOI(data) {
  const { url, token } = getRedisCredentials();
  const payload = JSON.stringify(data);
  const resp = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', CANONICAL_KEY, payload, 'EX', 7200]),
    signal:  AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`Redis write failed: ${resp.status}`);
}

// ── Main ──

async function main() {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    console.log('  SKIP: GROQ_API_KEY required for POI auto-discovery');
    process.exit(0);
  }

  console.log('=== POI Auto-Discovery (cache-backed) ===');
  console.log(`  Threshold: ${MIN_MENTIONS_THRESHOLD}+ mentions, Max: ${MAX_DISCOVERED} per run`);

  // Step 1: Pull headlines from gdelt:raw:v1 — zero GDELT API calls
  console.log('  Step 1: Reading headlines from GDELT cache...');
  const articles     = await getGdeltPoiDiscoveryArticles();
  const allHeadlines = articles.map(a => a.title).filter(Boolean);
  console.log(`  Cache headlines: ${allHeadlines.length}`);

  // Fallback: if cache was empty, pull titles from other seeded Redis keys
  if (allHeadlines.length < 20) {
    console.log('  Step 1b: Cache thin — pulling from Redis intel keys...');
    const { url, token } = getRedisCredentials();
    const fallbackKeys = ['intelligence:gdelt-intel:v1', 'intelligence:missile-events:v1', 'unrest:events:v1'];
    for (const key of fallbackKeys) {
      try {
        const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal:  AbortSignal.timeout(5000),
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (!data.result) continue;
        const parsed = JSON.parse(data.result);
        if (parsed.topics) {
          for (const topic of parsed.topics) {
            for (const article of (topic.articles || [])) {
              if (article.title) allHeadlines.push(article.title);
            }
          }
        }
        if (parsed.events) {
          for (const event of parsed.events) {
            if (event.title) allHeadlines.push(event.title);
          }
        }
      } catch { /* skip */ }
    }
    console.log(`  Total headlines after fallback: ${allHeadlines.length}`);
  }

  if (allHeadlines.length < 10) {
    console.log('  SKIP: Too few headlines for meaningful discovery');
    process.exit(0);
  }

  // Step 2: Extract person names via Groq NER
  console.log('  Step 2: Extracting person names via Groq NER...');
  const extractedNames = await extractPersonNames(allHeadlines);
  console.log(`  Extracted ${extractedNames.length} name mentions`);

  // Step 3: Find new high-volume persons
  console.log('  Step 3: Finding new high-volume persons...');
  const newPersons = findNewPersons(extractedNames, allHeadlines);
  console.log(`  Found ${newPersons.length} new persons above threshold`);

  if (newPersons.length === 0) {
    console.log('  No new persons discovered this run');
    process.exit(0);
  }

  for (const p of newPersons) {
    console.log(`    ★ ${p.name} (${p.count} mentions)`);
  }

  // Step 4: Build provisional profiles
  console.log('  Step 4: Building provisional profiles via Groq...');
  const discoveredProfiles = [];
  for (const person of newPersons) {
    const profile = await buildProvisionalProfile(person.name, person.count);
    if (!profile) { console.log(`    ✗ ${person.name} — profile generation failed`); continue; }

    discoveredProfiles.push({
      id:     person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name:   person.name,
      role:   profile.role   || 'Unknown',
      region: profile.region || 'Unknown',
      tags:   Array.isArray(profile.tags) ? profile.tags : [],
      source: 'auto-discovered',
      discoveredAt: new Date().toISOString(),
      lastKnownLocation:  profile.lastKnownLocation || 'Unknown',
      locationConfidence: profile.locationConfidence || 0.2,
      locationSource:     'ai-likely',
      locationReasoning:  'Auto-discovered via GDELT headline analysis',
      summary:        profile.summary || `Trending person with ${person.count} mentions in 24h.`,
      recentActivity: profile.recentActivity || [`${person.count} mentions in global media in the past 24 hours`],
      riskLevel:         profile.riskLevel  || 'medium',
      riskReason:        profile.riskReason || `High media volume (${person.count} mentions/24h)`,
      associatedEntities: profile.associatedEntities || [],
      sentiment:         profile.sentiment  || 'neutral',
      mentionCount:  person.count,
      activityScore: Math.min(100, Math.round(60 * Math.log10(Math.max(1, person.count)) / Math.log10(200)) + 30),
      averageTone:   0,
      recentArticles: [],
      profileGeneratedAt: new Date().toISOString(),
      dataFreshness: '24h',
    });

    console.log(`    ✓ ${person.name} — ${profile.role} (${profile.region})`);
    await sleep(2200);
  }

  if (discoveredProfiles.length === 0) {
    console.log('  No profiles generated');
    process.exit(0);
  }

  // Step 5: Merge with existing POI data
  console.log('  Step 5: Merging with existing POI data...');
  const existing        = await readExistingPOI();
  const existingPersons = existing?.persons || [];
  const tracked         = existingPersons.filter(p => p.source !== 'auto-discovered');
  const merged          = [...tracked, ...discoveredProfiles];
  merged.sort((a, b) => (b.activityScore || 0) - (a.activityScore || 0));

  const result = {
    persons:        merged,
    generatedAt:    new Date().toISOString(),
    trackedCount:   tracked.length,
    discoveredCount: discoveredProfiles.length,
    withAiProfile:  merged.filter(p => p.riskReason).length,
    version: 2,
  };

  await writeMergedPOI(result);
  console.log(`  Written ${merged.length} total POIs (${tracked.length} tracked + ${discoveredProfiles.length} discovered)`);
  console.log('=== POI Auto-Discovery Complete ===');
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
