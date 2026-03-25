#!/usr/bin/env node

/**
 * seed-poi-discovery.mjs  (Phase 5)
 *
 * Organic POI Auto-Discovery — finds new persons of interest by:
 * 1. Querying GDELT for top headlines across multiple geopolitical topics
 * 2. Using Groq NER to extract person names from those headlines
 * 3. Counting mention frequency per person
 * 4. Filtering out anyone already in the tracked persons list
 * 5. Building provisional profiles for high-volume new names (15+ mentions)
 * 6. Merging discovered persons into the existing POI Redis key
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

// FIX: Wrapped queries in parentheses for GDELT Boolean evaluation
const DISCOVERY_QUERIES = [
  '("president" OR "prime minister" OR "leader")',
  '("military" OR "armed forces" OR "defense minister")',
  '("summit" OR "negotiations" OR "ceasefire")',
  '("sanctions" OR "nuclear" OR "missile")',
  '("coup" OR "protest" OR "uprising" OR "revolution")',
];

async function fetchGdeltHeadlines(query, maxRecords = 100) {
  const url = new URL(GDELT_DOC_API);
  // FIX: Use full word 'english' and PascalCase for 'ArtList'
  url.searchParams.set('query', `${query} sourcelang:english`);
  url.searchParams.set('mode', 'ArtList');
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
  // 1. The Volume Threshold
  if (entity.count >= MIN_MENTIONS_THRESHOLD) return true;

  // 2. The Organic "Trigger" Discovery
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

  // If they are a high-value target involved in a critical event
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
        relatedHeadlines: allHeadlines 
      });
    }
  }

  return Array.from(counts.values())
    .filter(p => isHighValuePOI(p))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_DISCOVERED);
}

// ── Groq: build provisional profile for a discovered person ──

async function buildProvisionalProfile(personName, mentionCount) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  const prompt = `You are an OSINT analyst. A person named "${personName}" has appeared ${mentionCount} times in global news headlines in the past 24 hours. Based on your knowledge, provide a provisional intelligence profile.

CRITICAL: locationConfidence must be a number 0.0-1.0, recentActivity must be an array, riskLevel must be
