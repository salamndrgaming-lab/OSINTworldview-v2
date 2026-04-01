#!/usr/bin/env node

/**
 * seed-gdelt-raw.mjs — Master GDELT Fetch (Run this FIRST)
 *
 * PURPOSE:
 *   All other scripts that previously called gdeltproject.org directly now
 *   read from the Redis key written here instead. This reduces total GDELT
 *   API calls from ~91 per seed run down to ~26 (one crawl, one writer).
 *
 * WHAT IT FETCHES (one sequential pass, adaptive cooldown):
 *   Mode: artlist   — full article lists for every topic (24h window)
 *   Mode: timelinevol — volume/velocity timelines for narrative-drift topics (6h window)
 *   Person queries  — mention counts for every tracked POI (7d + 72h windows)
 *   GKG GeoJSON     — unrest/protest geographic features
 *
 * OUTPUT KEY:  gdelt:raw:v1   TTL: 4h
 *
 * CACHE-FIRST BEHAVIOUR:
 *   Before fetching GDELT, checks if gdelt:raw:v1 is still fresh (< MIN_CACHE_AGE_MIN old).
 *   If fresh and --force flag is NOT set, skips the crawl and exits 0.
 *   This prevents redundant re-fetches within a single seed window.
 *
 * RATE-LIMIT HANDLING:
 *   - Sequential execution (topics → persons → gkg) — never concurrent
 *   - Exponential back-off on 429: doubles delay up to MAX_BACKOFF_MS
 *   - Circuit breaker: after CIRCUIT_TRIP_THRESHOLD consecutive 429s, aborts
 *     remaining calls and writes whatever was collected, preserving partial data
 *   - On circuit-break, writes gdelt:raw:ratelimit-at with ISO timestamp so
 *     consumers can log the degraded-mode reason
 *
 * CONSUMERS (read from Redis, never call GDELT themselves):
 *   seed-gdelt-intel.mjs         → reads topics.artlist
 *   seed-telegram-narratives.mjs → reads topics.artlist + topics.timelinevol
 *   seed-narrative-drift.mjs     → reads topics.timelinevol
 *   seed-missile-events.mjs      → reads topics.artlist (missile/drone/airstrike)
 *   seed-warcam.mjs              → reads topics.artlist (conflict labels)
 *   seed-persons-of-interest.mjs → reads persons.*
 *   seed-poi-discovery.mjs       → reads topics.artlist (discovery queries)
 *
 * Usage:
 *   node scripts/seed-gdelt-raw.mjs          # cache-first (skips if fresh)
 *   node scripts/seed-gdelt-raw.mjs --force  # always re-fetch from GDELT
 */

import { loadEnvFile, CHROME_UA, getRedisCredentials, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

export const RAW_KEY        = 'gdelt:raw:v1';
const RATELIMIT_FLAG_KEY     = 'gdelt:raw:ratelimit-at';
const TTL                    = 4 * 3600;       // 4 hours
const MIN_CACHE_AGE_MIN      = 30;             // skip re-fetch if cache < 30 min old
const GDELT_DOC              = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_GKG              = 'https://api.gdeltproject.org/api/v1/gkg_geojson';
const COOLDOWN_BASE_MS       = 6_000;          // base delay between calls
const MAX_BACKOFF_MS         = 90_000;         // max back-off on 429 (90 s)
const CIRCUIT_TRIP_THRESHOLD = 5;             // consecutive 429s before stopping
const FETCH_TIMEOUT_MS       = 22_000;        // per-request timeout

const FORCE = process.argv.includes('--force');

// ── Mutable rate-limit state ─────────────────────────────────────────────────

let consecutiveRateLimits = 0;
let currentCooldownMs     = COOLDOWN_BASE_MS;
let circuitOpen           = false;

function recordSuccess() {
  consecutiveRateLimits = 0;
  currentCooldownMs     = COOLDOWN_BASE_MS;
}

function recordRateLimit() {
  consecutiveRateLimits++;
  currentCooldownMs = Math.min(currentCooldownMs * 2, MAX_BACKOFF_MS);
  if (consecutiveRateLimits >= CIRCUIT_TRIP_THRESHOLD) {
    circuitOpen = true;
    console.warn(`  ⚡ CIRCUIT OPEN after ${consecutiveRateLimits} consecutive failures — aborting remaining GDELT calls`);
  } else {
    console.warn(`  ⏳ Back-off ${(currentCooldownMs / 1000).toFixed(0)}s (${consecutiveRateLimits}/${CIRCUIT_TRIP_THRESHOLD} trip threshold)`);
  }
}

// ── Topic definitions ─────────────────────────────────────────────────────────

const TOPICS = [
  // Geopolitical / intel
  { id: 'military',      query: '(military exercise OR troop deployment OR airstrike OR "naval exercise") sourcelang:eng', artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'cyber',         query: '(cyberattack OR ransomware OR hacking OR "data breach" OR APT) sourcelang:eng',           artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'nuclear',       query: '(nuclear OR uranium enrichment OR IAEA OR "nuclear weapon" OR plutonium) sourcelang:eng', artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'sanctions',     query: '(sanctions OR embargo OR "trade war" OR tariff OR "economic pressure") sourcelang:eng',   artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'intelligence',  query: '(espionage OR spy OR intelligence agency OR covert OR surveillance) sourcelang:eng',       artlist: true, timelinevol: false, timespan_art: '24h',                      maxrecords: 50 },
  { id: 'maritime',      query: '(naval blockade OR piracy OR "strait of hormuz" OR "south china sea" OR warship) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '24h', maxrecords: 50 },

  // Conflict / narrative
  { id: 'conflict',      query: '(conflict OR war OR attack OR strike OR offensive)',                              artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'ukraine',       query: '(ukraine OR kyiv OR russia OR zelensky OR kremlin)',                             artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'middleeast',    query: '(israel OR gaza OR iran OR lebanon OR syria OR hamas)',                          artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'china',         query: '(china OR beijing OR taiwan OR PLA OR "south china sea")',                       artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'unrest',        query: '(protest OR riot OR coup OR uprising OR unrest)',                                artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'energy',        query: '(oil OR gas OR OPEC OR pipeline OR "energy crisis")',                            artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'geopolitics',   query: '(geopolitics OR diplomacy OR summit OR negotiations OR ceasefire)',              artlist: true, timelinevol: false, timespan_art: '24h',                      maxrecords: 50 },
  { id: 'trade',         query: '(trade OR tariff OR export OR "supply chain")',                                  artlist: true, timelinevol: false, timespan_art: '24h',                      maxrecords: 50 },
  { id: 'osint',         query: '(osint OR "open source intelligence" OR satellite OR surveillance)',             artlist: true, timelinevol: false, timespan_art: '24h',                      maxrecords: 50 },

  // Strike / weapons
  { id: 'missile',       query: '(missile strike OR missile attack OR ballistic missile OR cruise missile) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'drone',         query: '(drone strike OR drone attack OR UAV strike OR kamikaze drone OR Shahed drone) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'airstrike',     query: '(airstrike OR air strike OR aerial bombardment OR bombing raid) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'ground-combat', query: '(combat OR fighting OR battle OR frontline) sourcelang:eng',                    artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },
  { id: 'casualties',    query: '(explosion OR destroyed OR casualties OR killed) sourcelang:eng',               artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },
  { id: 'military-ops',  query: '(invasion OR offensive OR advance OR retreat) sourcelang:eng',                  artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },

  // POI discovery
  { id: 'poi-leaders',   query: '"president" OR "prime minister" OR "leader" sourcelang:eng',         artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-military',  query: '"military" OR "armed forces" OR "defense minister" sourcelang:eng',  artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-diplomacy', query: '"summit" OR "negotiations" OR "ceasefire" sourcelang:eng',           artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-wmd',       query: '"sanctions" OR "nuclear" OR "missile" sourcelang:eng',               artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-unrest',    query: '"coup" OR "protest" OR "uprising" OR "revolution" sourcelang:eng',   artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
];

const TRACKED_PERSONS = [
  'Vladimir Putin', 'Volodymyr Zelenskyy', 'Xi Jinping', 'Kim Jong Un',
  'Ali Khamenei', 'Benjamin Netanyahu', 'Bashar al-Assad', 'Recep Tayyip Erdogan',
  'Narendra Modi', 'Mohammed bin Salman', 'Abdel Fattah el-Sisi',
  'Yevgeny Prigozhin', 'Abu Mohammed al-Julani', 'Yahya Sinwar',
  'Hassan Nasrallah', 'Masoud Pezeshkian', 'Ismail Haniyeh',
  'Joe Biden', 'Donald Trump', 'Keir Starmer', 'Emmanuel Macron',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

function normalizeArticle(raw) {
  const url = raw.url || '';
  if (!isValidUrl(url)) return null;
  return {
    title:    String(raw.title    || '').slice(0, 500),
    url,
    domain:   String(raw.domain   || raw.source?.domain || '').slice(0, 200),
    source:   String(raw.domain   || raw.source?.domain || '').slice(0, 200),
    date:     String(raw.seendate || ''),
    seendate: String(raw.seendate || ''),
    image:    isValidUrl(raw.socialimage || '') ? raw.socialimage : '',
    language: String(raw.language || ''),
    tone:     typeof raw.tone === 'number' ? raw.tone : 0,
  };
}

// ── Core fetcher ──────────────────────────────────────────────────────────────

/**
 * Low-level GDELT Doc API call. Returns raw JSON or null.
 * Mutates circuit-breaker state on 429 / network error.
 */
async function gdeltFetch(params, label) {
  if (circuitOpen) {
    console.warn(`  ⚡ [${label}] skipped — circuit open`);
    return null;
  }

  const url = new URL(GDELT_DOC);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('format', 'json');

  let resp;
  try {
    resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`  ⚠ GDELT network error [${label}]: ${err.message}`);
    recordRateLimit();
    return null;
  }

  if (resp.status === 429) {
    recordRateLimit();
    console.warn(`  ⚠ GDELT 429 [${label}] — back-off now ${(currentCooldownMs / 1000).toFixed(0)}s`);
    return null;
  }

  if (!resp.ok) {
    console.warn(`  ⚠ GDELT HTTP ${resp.status} [${label}]`);
    return null;
  }

  try {
    const json = await resp.json();
    recordSuccess();
    return json;
  } catch (err) {
    console.warn(`  ⚠ GDELT JSON parse [${label}]: ${err.message}`);
    return null;
  }
}

/**
 * Waits the current cooldown then calls gdeltFetch.
 * On 429 (null return + increased currentCooldownMs), waits back-off and retries once.
 */
async function fetchWithBackoff(params, label, isFirstCall = false) {
  if (!isFirstCall) await sleep(currentCooldownMs);
  if (circuitOpen) return null;

  const prevConsecutive = consecutiveRateLimits;
  const data = await gdeltFetch(params, label);

  // If we got rate-limited (detected by consecutiveRateLimits increasing) and
  // circuit not yet open, do one retry after the updated back-off delay.
  if (data === null && consecutiveRateLimits > prevConsecutive && !circuitOpen) {
    console.log(`  🔄 Retry [${label}] after ${(currentCooldownMs / 1000).toFixed(0)}s…`);
    await sleep(currentCooldownMs);
    if (circuitOpen) return null;
    return gdeltFetch(params, label);
  }

  return data;
}

// ── Crawl phases — strictly sequential ───────────────────────────────────────

async function crawlTopics() {
  const results = {};
  let isFirstCall = true;

  for (const topic of TOPICS) {
    if (circuitOpen) {
      console.warn(`  ⚡ Stopping topic crawl at "${topic.id}" — circuit open`);
      break;
    }

    // artlist
    if (topic.artlist) {
      console.log(`  [artlist] ${topic.id} (${topic.timespan_art ?? '24h'})`);
      const data = await fetchWithBackoff({
        query:      topic.query,
        mode:       'artlist',
        maxrecords: topic.maxrecords ?? 50,
        timespan:   topic.timespan_art ?? '24h',
        sort:       'date',
      }, `${topic.id}/artlist`, isFirstCall);
      isFirstCall = false;

      results[topic.id] = results[topic.id] ?? {};
      const articles = (data?.articles ?? []).map(normalizeArticle).filter(Boolean);
      results[topic.id].artlist   = articles;
      results[topic.id].fetchedAt = new Date().toISOString();
      console.log(`    → ${articles.length} articles`);
    }

    if (circuitOpen) break;

    // timelinevol
    if (topic.timelinevol) {
      console.log(`  [timelinevol] ${topic.id} (${topic.timespan_vol ?? '6h'})`);
      const data = await fetchWithBackoff({
        query:     topic.query,
        mode:      'timelinevol',
        timespan:  topic.timespan_vol ?? '6h',
        smoothing: '3',
      }, `${topic.id}/timelinevol`);

      results[topic.id] = results[topic.id] ?? {};
      // Normalise: GDELT returns { timeline: [...] } — guard for both shapes
      const tl = data?.timeline ?? data?.timelines ?? null;
      results[topic.id].timelinevol = Array.isArray(tl) && tl.length > 0 ? tl : null;
      console.log(`    → timeline ${results[topic.id].timelinevol ? 'ok' : 'empty'}`);
    }
  }

  return results;
}

async function crawlPersons() {
  const results = {};

  for (const name of TRACKED_PERSONS) {
    if (circuitOpen) {
      console.warn(`  ⚡ Stopping person crawl at "${name}" — circuit open`);
      break;
    }

    results[name] = {};

    console.log(`  [person 7d] ${name}`);
    const broad = await fetchWithBackoff({
      query:      `"${name}" sourcelang:eng`,
      mode:       'artlist',
      maxrecords: '250',
      timespan:   '7d',
    }, `person:${name}/7d`);
    const articles7d = (broad?.articles ?? []).map(normalizeArticle).filter(Boolean);
    results[name].articles7d   = articles7d;
    results[name].mentionCount = articles7d.length;

    if (circuitOpen) break;

    console.log(`  [person 72h] ${name}`);
    const narrow = await fetchWithBackoff({
      query:      `"${name}" sourcelang:eng`,
      mode:       'artlist',
      maxrecords: '10',
      timespan:   '72h',
    }, `person:${name}/72h`);
    results[name].headlines = (narrow?.articles ?? []).map(normalizeArticle).filter(Boolean);
  }

  return results;
}

async function crawlGkg() {
  if (circuitOpen) {
    console.warn('  ⚡ GKG skipped — circuit open');
    return null;
  }

  // GKG v1 accepts space-separated keywords (treats as OR); complex boolean
  // expressions with parentheses are not supported here.
  const GKG_TERMS = 'protest riot demonstration unrest coup';
  console.log('  [gkg] unrest geojson');
  await sleep(currentCooldownMs);

  let resp;
  try {
    const url = new URL(GDELT_GKG);
    url.searchParams.set('query',      GKG_TERMS);
    url.searchParams.set('timespan',   '24h');
    url.searchParams.set('format',     'geojson');
    url.searchParams.set('maxrecords', '500');

    resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`  ⚠ GKG network error: ${err.message}`);
    recordRateLimit();
    return null;
  }

  if (resp.status === 429) {
    recordRateLimit();
    console.warn('  ⚠ GKG 429 — skipping');
    return null;
  }

  if (!resp.ok) {
    console.warn(`  ⚠ GKG HTTP ${resp.status}`);
    return null;
  }

  try {
    const data = await resp.json();
    recordSuccess();
    console.log(`    → ${data?.features?.length ?? 0} GKG features`);
    return data;
  } catch (err) {
    console.warn(`  ⚠ GKG JSON parse: ${err.message}`);
    return null;
  }
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function redisGet(url, token, key) {
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.result
    ? (typeof data.result === 'string' ? JSON.parse(data.result) : data.result)
    : null;
}

async function redisSetRaw(url, token, key, payload, ttl) {
  const mb = (Buffer.byteLength(payload, 'utf8') / 1_048_576).toFixed(2);
  console.log(`\n  Writing ${key} (${mb} MB) TTL=${ttl}s`);
  const resp = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', key, payload, 'EX', ttl]),
    signal:  AbortSignal.timeout(25_000),
  });
  if (!resp.ok) throw new Error(`Redis write failed: HTTP ${resp.status}`);
}

async function checkCacheFreshness(redisUrl, redisToken) {
  try {
    const existing = await redisGet(redisUrl, redisToken, RAW_KEY);
    if (!existing?.crawledAt) return { fresh: false, ageMin: Infinity };
    const ageMin = (Date.now() - new Date(existing.crawledAt).getTime()) / 60_000;
    return { fresh: ageMin < MIN_CACHE_AGE_MIN, ageMin: ageMin.toFixed(1), existing };
  } catch {
    return { fresh: false, ageMin: Infinity };
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log('=== seed-gdelt-raw: Master GDELT Crawl ===');
  console.log(`  Topics:   ${TOPICS.length} × artlist/timelinevol`);
  console.log(`  Persons:  ${TRACKED_PERSONS.length} × 7d + 72h`);
  console.log(`  Cooldown: ${COOLDOWN_BASE_MS / 1000}s base (adaptive up to ${MAX_BACKOFF_MS / 1000}s)`);
  console.log(`  Circuit:  trips after ${CIRCUIT_TRIP_THRESHOLD} consecutive failures`);
  console.log(`  Force:    ${FORCE ? 'YES — bypassing cache check' : 'NO — cache-first'}`);

  const { url: redisUrl, token: redisToken } = getRedisCredentials();

  // ── Cache-freshness gate ─────────────────────────────────────────────────
  if (!FORCE) {
    const { fresh, ageMin, existing } = await checkCacheFreshness(redisUrl, redisToken);
    if (fresh) {
      const topicCount  = Object.keys(existing.topics  ?? {}).length;
      const personCount = Object.keys(existing.persons ?? {}).length;
      console.log(`\n  ✅ Cache fresh (${ageMin} min old — threshold: ${MIN_CACHE_AGE_MIN} min)`);
      console.log(`     ${topicCount} topics, ${personCount} persons already in Redis`);
      console.log(`     Use --force to bypass\n`);
      console.log('=== Done (cache hit — no GDELT calls made) ===');
      return;
    }
    console.log(ageMin === Infinity
      ? '  No existing cache — fetching from GDELT\n'
      : `  Cache is ${ageMin} min old — stale, re-fetching\n`);
  }

  // ── Sequential crawl ─────────────────────────────────────────────────────
  // MUST be sequential. Running topics + persons + GKG concurrently fires
  // dozens of requests at once and immediately saturates GDELT's rate limit.

  console.log('--- Phase 1: Topics ---');
  const topics = await crawlTopics();

  console.log('\n--- Phase 2: Persons ---');
  const persons = await crawlPersons();

  console.log('\n--- Phase 3: GKG ---');
  const gkg = await crawlGkg();

  // ── Write output ─────────────────────────────────────────────────────────
  const topicCount  = Object.keys(topics).length;
  const personCount = Object.keys(persons).length;

  const output = {
    topics,
    persons,
    gkg: gkg ?? null,
    crawledAt:     new Date().toISOString(),
    version:       'v1',
    circuitTripped: circuitOpen,
    ...(circuitOpen ? { rateLimitedAt: new Date().toISOString() } : {}),
  };

  // Always write partial data — empty arrays are handled by consumers.
  const payload = JSON.stringify(output);
  await redisSetRaw(redisUrl, redisToken, RAW_KEY, payload, TTL);
  console.log(`  ✅ ${RAW_KEY} written`);

  // Rate-limit flag for consumer degraded-mode banners
  if (circuitOpen) {
    const flagPayload = JSON.stringify({ at: new Date().toISOString(), topics: topicCount, persons: personCount });
    await fetch(redisUrl, {
      method:  'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(['SET', RATELIMIT_FLAG_KEY, flagPayload, 'EX', 3600]),
      signal:  AbortSignal.timeout(5_000),
    }).catch(() => {});
    console.warn('\n  ⚡ Crawl ended with circuit open — data is partial. Consumers will serve from existing Redis keys.');
  } else {
    // Clear stale flag from any previous degraded run
    await fetch(redisUrl, {
      method:  'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(['DEL', RATELIMIT_FLAG_KEY]),
      signal:  AbortSignal.timeout(5_000),
    }).catch(() => {});
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const partial = circuitOpen ? ' [PARTIAL — circuit tripped]' : '';
  console.log(`\n=== Done in ${elapsed}s — ${topicCount} topics, ${personCount} persons${partial} ===`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
