#!/usr/bin/env node

/**
 * seed-poi-discovery.mjs  (Phase 5)
 *
 * Organic POI Auto-Discovery — finds new persons of interest by:
 *   1. Querying GDELT for top headlines across multiple geopolitical topics
 *   2. Using Groq NER to extract person names from those headlines
 *   3. Counting mention frequency per person
 *   4. Filtering out anyone already in the tracked persons list
 *   5. Building provisional profiles for high-volume new names (15+ mentions)
 *   6. Merging discovered persons into the existing POI Redis key
 *
 * Usage: node scripts/seed-poi-discovery.mjs
 * Requires: GROQ_API_KEY
 */

import { loadEnvFile, CHROME_UA, getRedisCredentials, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:poi:v1';
const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GROQ_MODEL = 'llama-3.1-8b-instant';
const MIN_MENTIONS_THRESHOLD = 15;
const MAX_DISCOVERED = 10; // Cap auto-discovered persons per run

// These names are already tracked by seed-persons-of-interest.mjs — skip them
const TRACKED_NAMES = new Set([
  'vladimir putin', 'volodymyr zelenskyy', 'xi jinping', 'kim jong un',
  'ali khamenei', 'benjamin netanyahu', 'bashar al-assad', 'recep tayyip erdogan',
  'narendra modi', 'mohammed bin salman', 'abdel fattah el-sisi',
  'yevgeny prigozhin', 'abu mohammed al-julani', 'yahya sinwar',
  'hassan nasrallah', 'masoud pezeshkian', 'ismail haniyeh',
  'joe biden', 'donald trump', 'keir starmer', 'emmanuel macron',
]);

// ── GDELT: fetch top headlines by topic ──

const DISCOVERY_QUERIES = [
  '"president" OR "prime minister" OR "leader"',
  '"military" OR "armed forces" OR "defense minister"',
  '"summit" OR "negotiations" OR "ceasefire"',
  '"sanctions" OR "nuclear" OR "missile"',
  '"coup" OR "protest" OR "uprising" OR "revolution"',
];

async function fetchGdeltHeadlines(query, maxRecords = 100) {
  const url = new URL(GDELT_DOC_API);
  url.searchParams.set('query', `${query} sourcelang:eng`);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', String(maxRecords));
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'hybridrel');
  url.searchParams.set('timespan', '24h');

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.articles || []).map(a => a.title || '').filter(Boolean);
  } catch {
    return [];
  }
}
/**
 * Determines if a person should be tracked as a POI.
 * @param {Object} entity - The extracted person entity
 * @param {number} entity.articleCount - How many times they were mentioned
 * @param {string[]} entity.relatedHeadlines - Array of article titles they appear in
 * @returns {boolean} True if they meet threshold OR organic criteria
 */
function isHighValuePOI(entity) {
  // 1. The Volume Threshold (Your original logic, lowered slightly for safety)
  if (entity.articleCount >= 10) return true;

  // 2. The Organic "Trigger" Discovery (The new intelligence layer)
  const highValueRoles = ['commander', 'minister', 'general', 'ceo', 'envoy', 'leader'];
  const triggerEvents = [
    'sanctioned', 'detained', 'arrested', 'disappeared', 
    'assassinated', 'threatened', 'resigned', 'fled'
  ];

  // Flatten all related headlines into a single lowercase text block for analysis
  const contextBlock = (entity.relatedHeadlines || []).join(" ").toLowerCase();

  // Check if context contains a high-value role
  const hasRole = highValueRoles.some(role => contextBlock.includes(role));
  
  // Check if context contains a critical geopolitical trigger
  const isCritical = triggerEvents.some(event => contextBlock.includes(event));

  // If they are a high-value target involved in a critical event, 
  // bypass the article count requirement.
  if (hasRole && isCritical) {
    console.log(`[ORGANIC INTEL] Fast-tracking POI: ${entity.name} (Role/Event matched)`);
    return true;
  }

  return false;
}

// ── Groq NER: extract person names from headlines ──

async function extractPersonNames(headlines) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return [];

  // Batch headlines into chunks to stay within token limits
  const batchSize = 50;
  const allNames = [];

  for (let i = 0; i < headlines.length; i += batchSize) {
    const batch = headlines.slice(i, i + batchSize);
    const headlineBlock = batch.map((h, idx) => `${idx + 1}. ${h}`).join('\n');

    const prompt = `Extract ALL person names (full names only, no titles like "President" or "PM") from these news headlines. Return ONLY a JSON array of strings. No markdown, no backticks, no explanation.

Example output: ["John Smith", "Jane Doe", "Ahmed Hassan"]

Headlines:
${headlineBlock}`;

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
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
      const json = await resp.json();
      const text = json.choices?.[0]?.message?.content?.trim() || '';
      const cleaned = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();

      try {
        const names = JSON.parse(cleaned);
        if (Array.isArray(names)) {
          allNames.push(...names.filter(n => typeof n === 'string' && n.length > 2 && n.includes(' ')));
        }
      } catch { /* skip unparseable batch */ }

      // Rate limit: Groq free tier
      await sleep(2200);
    } catch { /* skip failed batch */ }
  }

  return allNames;
}

// ── Count name frequency and find new high-volume persons ──

function findNewPersons(extractedNames, allHeadlines) {
  const counts = new Map();
  
  // Combine all headlines into one block for the "Intel" logic to search
  const contextBlock = allHeadlines.join(" ").toLowerCase();

  for (const name of extractedNames) {
    const normalized = name.trim();
    const key = normalized.toLowerCase();
    
    if (TRACKED_NAMES.has(key)) continue;
    if (!normalized.includes(' ') || normalized.length < 5) continue;
    if (/^\d/.test(normalized)) continue;

    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { 
        name: normalized, 
        count: 1,
        // We pass the headlines here so isHighValuePOI can read them
        relatedHeadlines: allHeadlines 
      });
    }
  }

  return Array.from(counts.values())
    .filter(p => {
      // THE NEW LOGIC:
      // Keep them if they hit the 15-mention limit...
      const hitThreshold = p.count >= MIN_MENTIONS_THRESHOLD;
      
      // ...OR if your 'isHighValuePOI' function says they are important
      const isOrganicIntel = isHighValuePOI(p);

      return hitThreshold || isOrganicIntel;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_DISCOVERED);
}

// ── Groq: build provisional profile for a discovered person ──

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
      headers: {
        Authorization: `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
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
    const json = await resp.json();
    const text = json.choices?.[0]?.message?.content?.trim() || '';
    const cleaned = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      // Normalize
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

// ── Read existing POI data from Redis ──

async function readExistingPOI() {
  const { url, token } = getRedisCredentials();
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(CANONICAL_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.result) return null;
    const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
    return parsed;
  } catch {
    return null;
  }
}

// ── Write merged POI data back to Redis ──

async function writeMergedPOI(data) {
  const { url, token } = getRedisCredentials();
  const payload = JSON.stringify(data);
  const resp = await fetch(`${url}/set/${encodeURIComponent(CANONICAL_KEY)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ EX: 7200, value: payload }),
    signal: AbortSignal.timeout(5000),
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

  console.log('=== POI Auto-Discovery ===');
  console.log(`  Threshold: ${MIN_MENTIONS_THRESHOLD}+ mentions`);
  console.log(`  Max discover: ${MAX_DISCOVERED} persons per run`);

  // Step 1: Gather headlines from multiple GDELT queries
  console.log('  Step 1: Fetching GDELT headlines...');
  const allHeadlines = [];
  for (const query of DISCOVERY_QUERIES) {
    const headlines = await fetchGdeltHeadlines(query, 100);
    allHeadlines.push(...headlines);
    console.log(`    "${query.slice(0, 40)}..." → ${headlines.length} headlines`);
    await sleep(1500); // GDELT rate limit
  }
  console.log(`  Total headlines: ${allHeadlines.length}`);

  if (allHeadlines.length < 20) {
    console.log('  SKIP: Too few headlines for meaningful discovery');
    process.exit(0);
  }

  // STEP 2: Extract names (This creates the variable)
  console.log('  Step 2: Extracting person names via Groq NER...');
  const extractedNames = await extractPersonNames(allHeadlines); 

  // STEP 3: Find new persons (This uses the variable)
  console.log('  Step 3: Finding new high-volume persons...');
  // Ensure this line is BELOW the one above and INSIDE main()
  const newPersons = findNewPersons(extractedNames);

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
    if (!profile) {
      console.log(`    ✗ ${person.name} — profile generation failed`);
      continue;
    }

    discoveredProfiles.push({
      id: person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: person.name,
      role: profile.role || 'Unknown',
      region: profile.region || 'Unknown',
      tags: Array.isArray(profile.tags) ? profile.tags : [],
      source: 'auto-discovered',
      discoveredAt: new Date().toISOString(),

      lastKnownLocation: profile.lastKnownLocation || 'Unknown',
      locationConfidence: profile.locationConfidence || 0.2,
      locationSource: 'ai-likely',
      locationReasoning: 'Auto-discovered via GDELT headline analysis',

      summary: profile.summary || `Trending person with ${person.count} mentions in 24h.`,
      recentActivity: profile.recentActivity || [`${person.count} mentions in global media in the past 24 hours`],
      riskLevel: profile.riskLevel || 'medium',
      riskReason: profile.riskReason || `High media volume (${person.count} mentions/24h)`,
      associatedEntities: profile.associatedEntities || [],
      sentiment: profile.sentiment || 'neutral',

      mentionCount: person.count,
      activityScore: Math.min(100, Math.round(60 * Math.log10(Math.max(1, person.count)) / Math.log10(200)) + 30),
      averageTone: 0,

      recentArticles: [],
      profileGeneratedAt: new Date().toISOString(),
      dataFreshness: '24h',
    });

    console.log(`    ✓ ${person.name} — ${profile.role} (${profile.region})`);
    await sleep(2200); // Groq rate limit
  }

  if (discoveredProfiles.length === 0) {
    console.log('  No profiles generated');
    process.exit(0);
  }

  // Step 5: Read existing POI data and merge
  console.log('  Step 5: Merging with existing POI data...');
  const existing = await readExistingPOI();
  const existingPersons = existing?.persons || [];

  // Remove old auto-discovered entries (they'll be replaced with fresh ones)
  const tracked = existingPersons.filter(p => p.source !== 'auto-discovered');
  const merged = [...tracked, ...discoveredProfiles];

  // Sort by activity score
  merged.sort((a, b) => (b.activityScore || 0) - (a.activityScore || 0));

  const result = {
    persons: merged,
    generatedAt: new Date().toISOString(),
    trackedCount: tracked.length,
    discoveredCount: discoveredProfiles.length,
    withAiProfile: merged.filter(p => p.riskReason).length,
    version: 2,
  };

  await writeMergedPOI(result);

  console.log(`  Written ${merged.length} total POIs (${tracked.length} tracked + ${discoveredProfiles.length} discovered)`);
  console.log('=== POI Auto-Discovery Complete ===');
}

main().catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
