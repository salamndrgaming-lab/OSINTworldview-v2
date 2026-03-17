#!/usr/bin/env node

/**
 * seed-persons-of-interest.mjs
 * 
 * Searches GDELT for mentions of tracked persons, aggregates articles,
 * uses Groq AI to build intelligence profiles with last known location,
 * activity summary, and risk assessment.
 * 
 * Location: scripts/seed-persons-of-interest.mjs
 * Usage: node scripts/seed-persons-of-interest.mjs
 * 
 * Requires: GROQ_API_KEY (optional but recommended for AI profiles)
 */

import { loadEnvFile, CHROME_UA, getRedisCredentials, runSeed, maskToken } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:poi:v1';
const CACHE_TTL = 3600; // 1 hour
const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GROQ_MODEL = 'llama-3.1-8b-instant';

// ── Tracked Persons ──
// These are publicly known figures tracked via open source intelligence.
// Add or remove names as needed. Each entry can have optional metadata.
const TRACKED_PERSONS = [
  { name: 'Vladimir Putin', role: 'President of Russia', region: 'Russia', tags: ['head-of-state', 'nuclear-power'] },
  { name: 'Volodymyr Zelenskyy', role: 'President of Ukraine', region: 'Ukraine', tags: ['head-of-state', 'conflict-zone'] },
  { name: 'Xi Jinping', role: 'President of China', region: 'China', tags: ['head-of-state', 'nuclear-power'] },
  { name: 'Kim Jong Un', role: 'Supreme Leader of North Korea', region: 'North Korea', tags: ['head-of-state', 'nuclear-power'] },
  { name: 'Ali Khamenei', role: 'Supreme Leader of Iran', region: 'Iran', tags: ['head-of-state', 'nuclear-program'] },
  { name: 'Benjamin Netanyahu', role: 'Prime Minister of Israel', region: 'Israel', tags: ['head-of-state', 'conflict-zone'] },
  { name: 'Bashar al-Assad', role: 'Former President of Syria', region: 'Syria', tags: ['conflict-zone', 'displaced'] },
  { name: 'Recep Tayyip Erdogan', role: 'President of Turkey', region: 'Turkey', tags: ['head-of-state', 'NATO'] },
  { name: 'Narendra Modi', role: 'Prime Minister of India', region: 'India', tags: ['head-of-state', 'nuclear-power'] },
  { name: 'Mohammed bin Salman', role: 'Crown Prince of Saudi Arabia', region: 'Saudi Arabia', tags: ['head-of-state', 'energy'] },
  { name: 'Abdel Fattah el-Sisi', role: 'President of Egypt', region: 'Egypt', tags: ['head-of-state', 'middle-east'] },
  { name: 'Yevgeny Prigozhin', role: 'Wagner Group (deceased)', region: 'Russia', tags: ['PMC', 'africa-operations'] },
  { name: 'Abu Mohammed al-Julani', role: 'HTS Leader / Syria transition', region: 'Syria', tags: ['non-state-actor', 'conflict-zone'] },
  { name: 'Yahya Sinwar', role: 'Hamas Leader (deceased)', region: 'Gaza', tags: ['non-state-actor', 'conflict-zone'] },
  { name: 'Hassan Nasrallah', role: 'Hezbollah Secretary-General (deceased)', region: 'Lebanon', tags: ['non-state-actor', 'conflict-zone'] },
  { name: 'Masoud Pezeshkian', role: 'President of Iran', region: 'Iran', tags: ['head-of-state', 'nuclear-program'] },
  { name: 'Ismail Haniyeh', role: 'Hamas Political Chief (deceased)', region: 'Qatar', tags: ['non-state-actor'] },
  { name: 'Joe Biden', role: 'Former President of the United States', region: 'United States', tags: ['head-of-state', 'NATO', 'nuclear-power'] },
  { name: 'Donald Trump', role: 'President of the United States', region: 'United States', tags: ['head-of-state', 'NATO', 'nuclear-power'] },
  { name: 'Keir Starmer', role: 'Prime Minister of the United Kingdom', region: 'United Kingdom', tags: ['head-of-state', 'NATO', 'nuclear-power'] },
  { name: 'Emmanuel Macron', role: 'President of France', region: 'France', tags: ['head-of-state', 'NATO', 'nuclear-power'] },
];

// ── GDELT Search ──

async function searchGdelt(personName, maxRecords = 10) {
  const url = new URL(GDELT_DOC_API);
  url.searchParams.set('query', `"${personName}" sourcelang:eng`);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', String(maxRecords));
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'date');
  url.searchParams.set('timespan', '72h');

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.articles || []).map(a => ({
      title: a.title || '',
      url: a.url || '',
      source: a.domain || '',
      date: a.seendate || '',
      tone: typeof a.tone === 'number' ? a.tone : 0,
    }));
  } catch (err) {
    console.warn(`  GDELT search failed for "${personName}": ${err.message}`);
    return [];
  }
}

// ── Groq AI Profiling ──

async function generateProfile(person, articles) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || articles.length === 0) return null;

  const headlineText = articles.slice(0, 8).map((a, i) => 
    `${i + 1}. "${a.title}" (${a.source}, ${a.date})`
  ).join('\n');

  const prompt = `Based on these recent news headlines about ${person.name} (${person.role}), provide a brief intelligence profile in this exact JSON format. Respond with ONLY valid JSON, no markdown, no backticks:

{
  "summary": "2-3 sentence summary of their current activities and significance",
  "lastKnownLocation": "City, Country based on the most recent article mentioning a location",
  "locationConfidence": "confirmed|likely|estimated|unknown",
  "recentActivity": "1-2 sentence description of most notable recent action",
  "riskLevel": "critical|high|elevated|moderate|low",
  "riskReason": "1 sentence explaining the risk assessment",
  "associatedEntities": ["list", "of", "mentioned", "organizations", "or", "people"],
  "sentiment": "positive|negative|neutral|mixed"
}

Headlines:
${headlineText}`;

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${groqKey}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are an intelligence analyst. Respond with ONLY valid JSON, no extra text.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      console.warn(`  Groq error for ${person.name}: ${resp.status}`);
      return null;
    }

    const json = await resp.json();
    const text = json.choices?.[0]?.message?.content?.trim() || '';
    
    // Clean potential markdown fences
    const cleaned = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();
    
    try {
      return JSON.parse(cleaned);
    } catch {
      console.warn(`  Failed to parse Groq response for ${person.name}`);
      return null;
    }
  } catch (err) {
    console.warn(`  Groq failed for ${person.name}: ${err.message}`);
    return null;
  }
}

// ── Location Prediction ──

function predictLocation(person, profile) {
  // If AI profile has a confirmed location, use it
  if (profile?.lastKnownLocation && profile.locationConfidence !== 'unknown') {
    return {
      location: profile.lastKnownLocation,
      confidence: profile.locationConfidence,
      method: 'ai-extraction',
    };
  }

  // Fallback: use the person's default region as estimated location
  // This is a simple heuristic — heads of state are usually in their capital
  const capitalMap = {
    'Russia': 'Moscow, Russia',
    'Ukraine': 'Kyiv, Ukraine',
    'China': 'Beijing, China',
    'North Korea': 'Pyongyang, North Korea',
    'Iran': 'Tehran, Iran',
    'Israel': 'Jerusalem, Israel',
    'Syria': 'Damascus, Syria',
    'Turkey': 'Ankara, Turkey',
    'India': 'New Delhi, India',
    'Saudi Arabia': 'Riyadh, Saudi Arabia',
    'Egypt': 'Cairo, Egypt',
    'Gaza': 'Gaza City, Palestine',
    'Lebanon': 'Beirut, Lebanon',
    'Qatar': 'Doha, Qatar',
    'United States': 'Washington D.C., United States',
    'United Kingdom': 'London, United Kingdom',
    'France': 'Paris, France',
  };

  return {
    location: capitalMap[person.region] || `${person.region} (estimated)`,
    confidence: 'estimated',
    method: 'default-capital',
  };
}

// ── Main ──

async function fetchPersonsOfInterest() {
  const profiles = [];
  const hasGroq = !!process.env.GROQ_API_KEY;

  console.log(`  Tracking ${TRACKED_PERSONS.length} persons of interest`);
  console.log(`  Groq AI: ${hasGroq ? 'enabled' : 'disabled (no GROQ_API_KEY)'}`);

  for (const person of TRACKED_PERSONS) {
    console.log(`  → ${person.name}...`);

    // Search GDELT for recent mentions
    const articles = await searchGdelt(person.name, 8);
    console.log(`    ${articles.length} articles found`);

    // Generate AI profile if we have Groq + articles
    let aiProfile = null;
    if (hasGroq && articles.length > 0) {
      aiProfile = await generateProfile(person, articles);
      if (aiProfile) console.log(`    AI profile generated`);
      // Rate limit: Groq free tier is 30 req/min
      await new Promise(r => setTimeout(r, 2200));
    }

    // Predict/extract location
    const locationData = predictLocation(person, aiProfile);

    // Calculate activity score based on article count and recency
    const now = Date.now();
    const activityScore = articles.reduce((score, a) => {
      const age = a.date ? (now - new Date(a.date.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).getTime()) / 3600000 : 72;
      return score + Math.max(0, 1 - age / 72); // Decay over 72 hours
    }, 0);

    // Average sentiment from articles
    const avgTone = articles.length > 0 
      ? articles.reduce((sum, a) => sum + (a.tone || 0), 0) / articles.length 
      : 0;

    profiles.push({
      id: person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: person.name,
      role: person.role,
      region: person.region,
      tags: person.tags,
      
      // Location intelligence
      lastKnownLocation: locationData.location,
      locationConfidence: locationData.confidence,
      locationMethod: locationData.method,
      
      // AI profile (if available)
      summary: aiProfile?.summary || `${person.role}. ${articles.length} recent mentions in global media.`,
      recentActivity: aiProfile?.recentActivity || (articles[0]?.title || 'No recent activity detected'),
      riskLevel: aiProfile?.riskLevel || 'moderate',
      riskReason: aiProfile?.riskReason || '',
      associatedEntities: aiProfile?.associatedEntities || [],
      sentiment: aiProfile?.sentiment || (avgTone > 2 ? 'positive' : avgTone < -2 ? 'negative' : 'neutral'),
      
      // Metrics
      mentionCount: articles.length,
      activityScore: Math.round(activityScore * 100) / 100,
      averageTone: Math.round(avgTone * 100) / 100,
      
      // Source articles
      recentArticles: articles.slice(0, 5).map(a => ({
        title: a.title,
        source: a.source,
        url: a.url,
        date: a.date,
      })),
      
      // Timestamps
      profileGeneratedAt: new Date().toISOString(),
      dataFreshness: articles.length > 0 ? '72h' : 'stale',
    });

    // Small delay between GDELT requests to be polite
    await new Promise(r => setTimeout(r, 1500));
  }

  // Sort by activity score (most active first)
  profiles.sort((a, b) => b.activityScore - a.activityScore);

  console.log(`  Generated ${profiles.length} POI profiles`);

  return {
    persons: profiles,
    generatedAt: new Date().toISOString(),
    trackedCount: TRACKED_PERSONS.length,
    withAiProfile: profiles.filter(p => p.riskReason).length,
  };
}

function validate(data) {
  return Array.isArray(data?.persons) && data.persons.length >= 1;
}

runSeed('intelligence', 'poi', CANONICAL_KEY, fetchPersonsOfInterest, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'gdelt-groq-v1',
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
