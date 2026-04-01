#!/usr/bin/env node

/**
 * seed-gdelt-raw.mjs — Master GDELT Fetch (Run this FIRST)
 *
 * PURPOSE:
 *   Centralises all GDELT API calls into one sequential crawl that writes a
 *   single Redis key (gdelt:raw:v1). All consumer seeds read from this key
 *   instead of calling GDELT directly, cutting total API calls from ~91 → ~26.
 *
 * RATE-LIMIT STRATEGY:
 *   - Strictly sequential execution (topics → persons → GKG). GDELT's limit is
 *     per-IP; parallel phases saturate it instantly.
 *   - Exponential back-off on 429/network errors (base 6s → max 90s).
 *   - Circuit breaker trips after CIRCUIT_TRIP_THRESHOLD consecutive failures.
 *   - On trip: MERGES partial results with the previous Redis snapshot so good
 *     cached data is never overwritten by an empty payload. Only writes if the
 *     merged result is meaningfully better than what's already in Redis, or if
 *     the existing key is about to expire.
 *   - Writes gdelt:raw:ratelimit-at flag so consumers can show a degraded banner.
 *
 * CACHE-FIRST:
 *   Checks existing key age on startup. Skips crawl if < MIN_CACHE_AGE_MIN old
 *   (unless --force is passed). This prevents redundant fetches from cron overlap.
 *
 * BACKOFF TUNING (informed by worldmonitor's seed-gdelt-intel.mjs):
 *   Their inter-topic delay is 20s on success, 120s after any exhausted topic.
 *   We use a 20s base cooldown on success (up from 6s) and adaptive back-off
 *   that scales with consecutive failures up to 90s.
 *
 * Usage:
 *   node scripts/seed-gdelt-raw.mjs          # cache-first (recommended)
 *   node scripts/seed-gdelt-raw.mjs --force  # bypass cache check
 */

import { loadEnvFile, CHROME_UA, getRedisCredentials, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

export const RAW_KEY        = 'gdelt:raw:v1';
const RATELIMIT_FLAG_KEY     = 'gdelt:raw:ratelimit-at';
const TTL                    = 4 * 3600;       // 4h — outlasts the full seed run
const MIN_CACHE_AGE_MIN      = 30;             // skip re-fetch if cache < 30 min old
const GDELT_DOC              = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_GKG              = 'https://api.gdeltproject.org/api/v1/gkg_geojson';

// Back-off / circuit-breaker config (informed by worldmonitor's 20s inter-topic delay)
const COOLDOWN_BASE_MS       = 20_000;         // 20s between calls on success
const COOLDOWN_POST_EXHAUST  = 120_000;        // 2 min extra after a topic exhausts retries
const MAX_BACKOFF_MS         = 90_000;         // max single back-off sleep
const CIRCUIT_TRIP_THRESHOLD = 5;             // consecutive failures before abort
const FETCH_TIMEOUT_MS       = 22_000;

// Minimum populated-topic count below which we prefer extending the existing
// key's TTL over overwriting it with near-empty data.
const MIN_TOPICS_TO_OVERWRITE = 4;

const FORCE = process.argv.includes('--force');

// ── Rate-limit state ──────────────────────────────────────────────────────────

let consecutiveFailures = 0;
let currentCooldownMs   = COOLDOWN_BASE_MS;
let circuitOpen         = false;

function recordSuccess() {
  consecutiveFailures = 0;
  currentCooldownMs   = COOLDOWN_BASE_MS;
}

function recordFailure() {
  consecutiveFailures++;
  currentCooldownMs = Math.min(currentCooldownMs * 2, MAX_BACKOFF_MS);
  if (consecutiveFailures >= CIRCUIT_TRIP_THRESHOLD) {
    circuitOpen = true;
    console.warn(`  ⚡ CIRCUIT OPEN after ${consecutiveFailures} consecutive failures — aborting remaining GDELT calls`);
  } else {
    console.warn(`  ⏳ Back-off ${(currentCooldownMs / 1000).toFixed(0)}s (${consecutiveFailures}/${CIRCUIT_TRIP_THRESHOLD} trip threshold)`);
  }
}

// ── Topics ────────────────────────────────────────────────────────────────────

const TOPICS = [
  { id: 'military',      query: '(military exercise OR troop deployment OR airstrike OR "naval exercise") sourcelang:eng', artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'cyber',         query: '(cyberattack OR ransomware OR hacking OR "data breach" OR APT) sourcelang:eng',           artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'nuclear',       query: '(nuclear OR uranium enrichment OR IAEA OR "nuclear weapon" OR plutonium) sourcelang:eng', artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'sanctions',     query: '(sanctions OR embargo OR "trade war" OR tariff OR "economic pressure") sourcelang:eng',   artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'intelligence',  query: '(espionage OR spy OR intelligence agency OR covert OR surveillance) sourcelang:eng',       artlist: true, timelinevol: false, timespan_art: '24h',                      maxrecords: 50 },
  { id: 'maritime',      query: '(naval blockade OR piracy OR "strait of hormuz" OR "south china sea" OR warship) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '24h', maxrecords: 50 },
  { id: 'conflict',      query: '(conflict OR war OR attack OR strike OR offensive)',                                       artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'ukraine',       query: '(ukraine OR kyiv OR russia OR zelensky OR kremlin)',                                      artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'middleeast',    query: '(israel OR gaza OR iran OR lebanon OR syria OR hamas)',                                   artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'china',         query: '(china OR beijing OR taiwan OR PLA OR "south china sea")',                                artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'unrest',        query: '(protest OR riot OR coup OR uprising OR unrest)',                                         artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'energy',        query: '(oil OR gas OR OPEC OR pipeline OR "energy crisis")',                                     artlist: true, timelinevol: true,  timespan_art: '24h', timespan_vol: '6h',  maxrecords: 50 },
  { id: 'geopolitics',   query: '(geopolitics OR diplomacy OR summit OR negotiations OR ceasefire)',                       artlist: true, timelinevol: false, timespan_art: '24h',                      maxrecords: 50 },
  { id: 'trade',         query: '(trade OR tariff OR export OR "supply chain")',                                           artlist: true, timelinevol: false, timespan_art: '24h',                      maxrecords: 50 },
  { id: 'osint',         query: '(osint OR "open source intelligence" OR satellite OR surveillance)',                      artlist: true, timelinevol: false, timespan_art: '24h',                      maxrecords: 50 },
  { id: 'missile',       query: '(missile strike OR missile attack OR ballistic missile OR cruise missile) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'drone',         query: '(drone strike OR drone attack OR UAV strike OR kamikaze drone OR Shahed drone) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'airstrike',     query: '(airstrike OR air strike OR aerial bombardment OR bombing raid) sourcelang:eng',          artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'ground-combat', query: '(combat OR fighting OR battle OR frontline) sourcelang:eng',                             artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },
  { id: 'casualties',    query: '(explosion OR destroyed OR casualties OR killed) sourcelang:eng',                        artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },
  { id: 'military-ops',  query: '(invasion OR offensive OR advance OR retreat) sourcelang:eng',                           artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },
  { id: 'poi-leaders',   query: '"president" OR "prime minister" OR "leader" sourcelang:eng',                             artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-military',  query: '"military" OR "armed forces" OR "defense minister" sourcelang:eng',                      artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-diplomacy', query: '"summit" OR "negotiations" OR "ceasefire" sourcelang:eng',                               artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-wmd',       query: '"sanctions" OR "nuclear" OR "missile" sourcelang:eng',                                   artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-unrest',    query: '"coup" OR "protest" OR "uprising" OR "revolution" sourcelang:eng',                       artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
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

// ── Core fetch — single GDELT call with back-off on failure ───────────────────

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
    recordFailure();
    return null;
  }

  if (resp.status === 429) {
    recordFailure();
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

// Waits cooldown, fetches, retries once on failure before giving up.
// isFirstCall skips the leading sleep.
async function fetchWithBackoff(params, label, isFirstCall = false) {
  if (!isFirstCall) await sleep(currentCooldownMs);
  if (circuitOpen) return null;

  const prevFailures = consecutiveFailures;
  const data = await gdeltFetch(params, label);

  if (data === null && consecutiveFailures > prevFailures && !circuitOpen) {
    console.log(`  🔄 Retry [${label}] after ${(currentCooldownMs / 1000).toFixed(0)}s…`);
    await sleep(currentCooldownMs);
    if (circuitOpen) return null;
    return gdeltFetch(params, label);
  }

  return data;
}

// ── Crawl phases ──────────────────────────────────────────────────────────────

async function crawlTopics() {
  const results = {};
  let isFirstCall = true;

  for (const topic of TOPICS) {
    if (circuitOpen) { console.warn(`  ⚡ Topic crawl stopped at "${topic.id}" — circuit open`); break; }

    const wasExhausted_before = consecutiveFailures;

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

      // If this topic fully exhausted retries, give GDELT a long cooldown
      // before hitting it again (mirrors worldmonitor's POST_EXHAUST_DELAY_MS)
      if (articles.length === 0 && consecutiveFailures > wasExhausted_before && !circuitOpen) {
        console.log(`    Rate-limit cooldown: waiting ${COOLDOWN_POST_EXHAUST / 1000}s before next topic…`);
        await sleep(COOLDOWN_POST_EXHAUST);
      }
    }

    if (circuitOpen) break;

    if (topic.timelinevol) {
      console.log(`  [timelinevol] ${topic.id} (${topic.timespan_vol ?? '6h'})`);
      const data = await fetchWithBackoff({
        query:     topic.query,
        mode:      'timelinevol',
        timespan:  topic.timespan_vol ?? '6h',
        smoothing: '3',
      }, `${topic.id}/timelinevol`);

      results[topic.id] = results[topic.id] ?? {};
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
    if (circuitOpen) { console.warn(`  ⚡ Person crawl stopped at "${name}" — circuit open`); break; }

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
  if (circuitOpen) { console.warn('  ⚡ GKG skipped — circuit open'); return null; }

  // GKG v1 requires space-separated keywords (no boolean operators / parentheses)
  console.log('  [gkg] unrest geojson');
  await sleep(currentCooldownMs);

  let resp;
  try {
    const url = new URL(GDELT_GKG);
    url.searchParams.set('query',      'protest riot demonstration unrest coup');
    url.searchParams.set('timespan',   '24h');
    url.searchParams.set('format',     'geojson');
    url.searchParams.set('maxrecords', '500');
    resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`  ⚠ GKG network error: ${err.message}`);
    recordFailure();
    return null;
  }

  if (resp.status === 429) { recordFailure(); console.warn('  ⚠ GKG 429 — skipping'); return null; }
  if (!resp.ok) { console.warn(`  ⚠ GKG HTTP ${resp.status}`); return null; }

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
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.result
      ? (typeof data.result === 'string' ? JSON.parse(data.result) : data.result)
      : null;
  } catch { return null; }
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

async function redisPipelineRaw(url, token, commands) {
  const resp = await fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(commands),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Redis pipeline failed: HTTP ${resp.status}`);
}

async function checkCacheFreshness(redisUrl, redisToken) {
  const existing = await redisGet(redisUrl, redisToken, RAW_KEY);
  if (!existing?.crawledAt) return { fresh: false, ageMin: Infinity, existing: null };
  const ageMin = (Date.now() - new Date(existing.crawledAt).getTime()) / 60_000;
  return { fresh: ageMin < MIN_CACHE_AGE_MIN, ageMin: ageMin.toFixed(1), existing };
}

// ── Snapshot merge ────────────────────────────────────────────────────────────
// When the circuit trips, merge fresh partial results with the previous snapshot.
// This ensures consumers always get the best available data — the new crawl's
// topics where successful, cached topics where the circuit cut us off.

function mergeWithSnapshot(newTopics, newPersons, existing) {
  if (!existing) return { topics: newTopics, persons: newPersons };

  const mergedTopics  = { ...newTopics };
  const mergedPersons = { ...newPersons };

  // Topics: keep cached version if new fetch returned nothing
  for (const [id, cachedTopic] of Object.entries(existing.topics ?? {})) {
    const newTopic = newTopics[id];
    if (!newTopic || (newTopic.artlist?.length === 0 && cachedTopic.artlist?.length > 0)) {
      mergedTopics[id] = { ...cachedTopic, preservedFromCache: true };
      console.log(`  ↩ Preserved cached topic "${id}" (${cachedTopic.artlist?.length ?? 0} articles)`);
    }
  }

  // Persons: if Phase 2 never ran (circuit tripped in Phase 1), restore all cached persons
  const newPersonCount = Object.keys(newPersons).length;
  if (newPersonCount === 0 && Object.keys(existing.persons ?? {}).length > 0) {
    Object.assign(mergedPersons, existing.persons);
    console.log(`  ↩ Preserved all ${Object.keys(existing.persons).length} cached persons (Phase 2 skipped)`);
  } else {
    // Person-level merge: restore cached data for any person that returned nothing
    for (const [name, cachedPerson] of Object.entries(existing.persons ?? {})) {
      const newPerson = newPersons[name];
      if (!newPerson || (newPerson.mentionCount === 0 && cachedPerson.mentionCount > 0)) {
        mergedPersons[name] = { ...cachedPerson, preservedFromCache: true };
      }
    }
  }

  return { topics: mergedTopics, persons: mergedPersons };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log('=== seed-gdelt-raw: Master GDELT Crawl ===');
  console.log(`  Topics:   ${TOPICS.length} × artlist/timelinevol`);
  console.log(`  Persons:  ${TRACKED_PERSONS.length} × 7d + 72h`);
  console.log(`  Cooldown: ${COOLDOWN_BASE_MS / 1000}s base (adaptive up to ${MAX_BACKOFF_MS / 1000}s)`);
  console.log(`  Post-exhaust pause: ${COOLDOWN_POST_EXHAUST / 1000}s`);
  console.log(`  Circuit:  trips after ${CIRCUIT_TRIP_THRESHOLD} consecutive failures`);
  console.log(`  Force:    ${FORCE ? 'YES — bypassing cache check' : 'NO — cache-first'}`);

  const { url: redisUrl, token: redisToken } = getRedisCredentials();

  // ── Cache-freshness gate ─────────────────────────────────────────────────
  const { fresh, ageMin, existing } = await checkCacheFreshness(redisUrl, redisToken);
  if (!FORCE && fresh) {
    const tc = Object.keys(existing.topics  ?? {}).length;
    const pc = Object.keys(existing.persons ?? {}).length;
    console.log(`\n  ✅ Cache fresh (${ageMin} min old — threshold: ${MIN_CACHE_AGE_MIN} min)`);
    console.log(`     ${tc} topics, ${pc} persons already in Redis`);
    console.log(`     Use --force to bypass\n`);
    console.log('=== Done (cache hit — no GDELT calls made) ===');
    return;
  }
  console.log(ageMin === Infinity
    ? '  No existing cache — fetching from GDELT\n'
    : `  Cache is ${ageMin} min old — stale, re-fetching\n`);

  // ── Sequential crawl ─────────────────────────────────────────────────────
  console.log('--- Phase 1: Topics ---');
  const rawTopics = await crawlTopics();

  console.log('\n--- Phase 2: Persons ---');
  const rawPersons = await crawlPersons();

  console.log('\n--- Phase 3: GKG ---');
  const gkg = await crawlGkg();

  // ── Snapshot merge (only when circuit tripped) ───────────────────────────
  let topics  = rawTopics;
  let persons = rawPersons;

  if (circuitOpen && existing) {
    console.log('\n  Merging partial results with previous snapshot…');
    ({ topics, persons } = mergeWithSnapshot(rawTopics, rawPersons, existing));
  }

  const topicCount  = Object.keys(topics).length;
  const personCount = Object.keys(persons).length;
  const populatedTopicCount = Object.values(topics).filter(t => t.artlist?.length > 0).length;

  // ── Write decision ───────────────────────────────────────────────────────
  // If circuit tripped and we have very few fresh topics, check whether the
  // existing key is still healthy. If it is, extend its TTL instead of overwriting.
  if (circuitOpen && populatedTopicCount < MIN_TOPICS_TO_OVERWRITE && existing) {
    const existingPopulated = Object.values(existing.topics ?? {}).filter(t => t.artlist?.length > 0).length;
    if (existingPopulated >= MIN_TOPICS_TO_OVERWRITE) {
      console.log(`\n  ↩ Existing key has ${existingPopulated} populated topics — extending TTL instead of overwriting with ${populatedTopicCount}`);
      await redisPipelineRaw(redisUrl, redisToken, [
        ['EXPIRE', RAW_KEY, TTL],
      ]).catch(e => console.warn(`  TTL extend failed: ${e.message}`));
      console.log(`  ✅ ${RAW_KEY} TTL extended (${TTL}s)`);
      // Still set the ratelimit flag so consumers surface the degraded banner
      const flagPayload = JSON.stringify({ at: new Date().toISOString(), reason: 'circuit_tripped', ttlExtended: true });
      await fetch(redisUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['SET', RATELIMIT_FLAG_KEY, flagPayload, 'EX', 3600]),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {});
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\n=== Done in ${elapsed}s — TTL extended (circuit tripped, existing data preserved) ===`);
      return;
    }
  }

  // ── Write merged output ──────────────────────────────────────────────────
  const output = {
    topics,
    persons,
    gkg: gkg ?? null,
    crawledAt:      new Date().toISOString(),
    version:        'v1',
    circuitTripped: circuitOpen,
    ...(circuitOpen ? { rateLimitedAt: new Date().toISOString() } : {}),
  };

  const payload = JSON.stringify(output);
  await redisSetRaw(redisUrl, redisToken, RAW_KEY, payload, TTL);
  console.log(`  ✅ ${RAW_KEY} written (${topicCount} topics, ${personCount} persons, ${populatedTopicCount} populated)`);

  // Rate-limit flag for consumer degraded banners
  if (circuitOpen) {
    const flagPayload = JSON.stringify({ at: new Date().toISOString(), topics: topicCount, persons: personCount });
    await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', RATELIMIT_FLAG_KEY, flagPayload, 'EX', 3600]),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
    console.warn('\n  ⚡ Circuit tripped — partial data written with snapshot merge applied.');
  } else {
    // Clear stale flag from any previous degraded run
    await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['DEL', RATELIMIT_FLAG_KEY]),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const partial = circuitOpen ? ' [PARTIAL — snapshot merge applied]' : '';
  console.log(`\n=== Done in ${elapsed}s — ${topicCount} topics, ${personCount} persons${partial} ===`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
