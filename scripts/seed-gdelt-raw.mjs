#!/usr/bin/env node

/**
 * seed-gdelt-raw.mjs — Master GDELT Fetch (Run this FIRST)
 *
 * PURPOSE:
 *   Centralises all GDELT API calls into one sequential crawl that writes a
 *   single Redis key (gdelt:raw:v1). All consumer seeds read from this key
 *   instead of calling GDELT directly, cutting total API calls from ~91 → ~26.
 *
 * ARCHITECTURE (Patch 5):
 *   - Loads tracked persons from shared/tracked-persons.json (single source of truth)
 *   - All GDELT fetches go through _gdelt-cache.mjs (fetchArtlist, fetchTimelineVol,
 *     fetchPersonArticles, fetchGkg) which handle per-endpoint circuit breakers,
 *     exponential backoff, validation, and per-call Redis caching.
 *   - Telemetry flushed at end of run via error-telemetry.mjs
 *   - Breaker summary logged at the end
 *   - --force flag resets all breakers and bypasses cache
 *
 * RATE-LIMIT STRATEGY:
 *   - Strictly sequential (topics → persons → GKG)
 *   - cooldownDelay() provides adaptive inter-request pacing (starts 20s, decays to 5s)
 *   - Per-endpoint circuit breakers (artlist, timelinevol, gkg, person)
 *   - Snapshot merge when circuit trips — never overwrites good data with empty
 *   - First-run guard: skip write if 0 populated and no prior snapshot
 *
 * Usage:
 *   node scripts/seed-gdelt-raw.mjs          # cache-first (recommended)
 *   node scripts/seed-gdelt-raw.mjs --force  # bypass cache, reset all breakers
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile, getRedisCredentials } from './_seed-utils.mjs';
import {
  fetchArtlist,
  fetchTimelineVol,
  fetchPersonArticles,
  fetchGkg,
  breakerSummary,
  resetAllBreakers,
} from './_gdelt-cache.mjs';
import {
  anyBreakerOpen,
  canRequest,
} from './shared/circuit-breaker.mjs';
import {
  cooldownDelay,
  sleep,
} from './shared/exponential-backoff.mjs';
import {
  flushTelemetry,
  sessionMetricsSummary,
} from './shared/error-telemetry.mjs';

loadEnvFile(import.meta.url);

// ── Config ────────────────────────────────────────────────────────────────────

export const RAW_KEY           = 'gdelt:raw:v1';
const RATELIMIT_FLAG_KEY        = 'gdelt:raw:ratelimit-at';
const TTL                       = 24 * 3600;       // 24h — survives missed cron cycles
const MIN_CACHE_AGE_MIN         = 150;             // 2.5h — skip crawl if cache younger than this (cron runs every 3h)
const MIN_TOPICS_TO_OVERWRITE   = 3;
const MIN_PERSONS_TO_OVERWRITE  = 3;

// Cooldown parameters (adaptive via cooldownDelay())
const COOLDOWN_INITIAL_MS       = 6_000;   // 6s between calls on first request (was 20s)
const COOLDOWN_FLOOR_MS         = 3_000;   // 3s minimum once GDELT is responding well (was 5s)
const COOLDOWN_DECAY_MS         = 1_000;   // reduce by 1s per consecutive success (was 2s)
const COOLDOWN_POST_EXHAUST_MS  = 20_000;  // 20s after a topic exhausts retries (was 120s)

const FORCE = process.argv.includes('--force');

// ── Load tracked persons from JSON ────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {Array<{ name: string, aliases: string[], role: string, status: string, region: string, tags: string[] }>} */
let TRACKED_PERSONS;
try {
  TRACKED_PERSONS = JSON.parse(
    readFileSync(join(__dirname, 'shared', 'tracked-persons.json'), 'utf8')
  );
  console.log(`  Loaded ${TRACKED_PERSONS.length} persons from shared/tracked-persons.json`);
} catch (err) {
  console.error(`FATAL: Cannot load shared/tracked-persons.json — ${err.message}`);
  process.exit(1);
}

// ── Topic definitions ─────────────────────────────────────────────────────────

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

function mergeWithSnapshot(newTopics, newPersons, existing) {
  if (!existing) return { topics: newTopics, persons: newPersons };

  const mergedTopics  = { ...newTopics };
  const mergedPersons = { ...newPersons };

  for (const [id, cachedTopic] of Object.entries(existing.topics ?? {})) {
    const newTopic = newTopics[id];
    if (!newTopic || (newTopic.artlist?.length === 0 && cachedTopic.artlist?.length > 0)) {
      mergedTopics[id] = { ...cachedTopic, preservedFromCache: true };
      console.log(`  ↩ Preserved cached topic "${id}" (${cachedTopic.artlist?.length ?? 0} articles)`);
    }
  }

  const newPersonCount = Object.keys(newPersons).length;
  if (newPersonCount === 0 && Object.keys(existing.persons ?? {}).length > 0) {
    Object.assign(mergedPersons, existing.persons);
    console.log(`  ↩ Preserved all ${Object.keys(existing.persons).length} cached persons (Phase 2 skipped)`);
  } else {
    for (const [name, cachedPerson] of Object.entries(existing.persons ?? {})) {
      const newPerson = newPersons[name];
      if (!newPerson || (newPerson.mentionCount === 0 && cachedPerson.mentionCount > 0)) {
        mergedPersons[name] = { ...cachedPerson, preservedFromCache: true };
      }
    }
  }

  // Inactive persons: always preserve from snapshot
  const inactiveNames = TRACKED_PERSONS.filter(p => p.status === 'inactive').map(p => p.name);
  for (const name of inactiveNames) {
    if (!mergedPersons[name] && existing.persons?.[name]) {
      mergedPersons[name] = { ...existing.persons[name], preservedFromCache: true };
    }
  }

  return { topics: mergedTopics, persons: mergedPersons };
}

// ── Crawl phases ──────────────────────────────────────────────────────────────

async function crawlTopics() {
  const results = {};
  let consecutiveSuccesses = 0;
  let isFirstCall = true;
  const crawlStart = Date.now();
  const MAX_CRAWL_MS = 18 * 60_000; // 18 min hard cap — leaves margin for persons (~5 min) + GKG + write within 28-min step timeout

  for (const topic of TOPICS) {
    // Time guard — stop before GitHub Actions kills us
    if (Date.now() - crawlStart > MAX_CRAWL_MS) {
      console.warn(`  ⏱ Topic crawl stopped at "${topic.id}" — 40 min time limit reached (${Object.keys(results).length}/${TOPICS.length} done)`);
      break;
    }

    if (!canRequest('artlist')) {
      console.warn(`  ⚡ Topic crawl stopped at "${topic.id}" — artlist circuit open`);
      break;
    }

    const cooldownMs = isFirstCall ? 0 : cooldownDelay(consecutiveSuccesses, {
      initialMs: COOLDOWN_INITIAL_MS,
      floorMs:   COOLDOWN_FLOOR_MS,
      decayPerSuccess: COOLDOWN_DECAY_MS,
    });

    if (!isFirstCall && cooldownMs > 0) {
      await sleep(cooldownMs, `before ${topic.id}`);
    }
    isFirstCall = false;

    const topicResult = {};
    let topicFailed = false;

    if (topic.artlist) {
      console.log(`  [artlist] ${topic.id} (${topic.timespan_art ?? '24h'})`);
      const { articles, fromCache } = await fetchArtlist(topic.query, {
        timespan:   topic.timespan_art ?? '24h',
        maxrecords: topic.maxrecords ?? 50,
        force:      FORCE,
      });

      topicResult.artlist   = articles;
      topicResult.fetchedAt = new Date().toISOString();
      console.log(`    → ${articles.length} articles${fromCache ? ' [cache]' : ''}`);

      if (articles.length === 0 && !fromCache) {
        topicFailed = true;
        consecutiveSuccesses = 0;
        if (canRequest('artlist')) {
          console.log(`    Rate-limit cooldown: waiting ${COOLDOWN_POST_EXHAUST_MS / 1000}s…`);
          await sleep(COOLDOWN_POST_EXHAUST_MS, `post-exhaust ${topic.id}`);
        }
      } else {
        consecutiveSuccesses++;
      }
    }

    if (!canRequest('artlist')) break;

    if (topic.timelinevol && !topicFailed) {
      console.log(`  [timelinevol] ${topic.id} (${topic.timespan_vol ?? '6h'})`);
      await sleep(cooldownDelay(consecutiveSuccesses, {
        initialMs: COOLDOWN_INITIAL_MS, floorMs: COOLDOWN_FLOOR_MS, decayPerSuccess: COOLDOWN_DECAY_MS,
      }), `before timelinevol:${topic.id}`);

      const { timeline, fromCache } = await fetchTimelineVol(topic.query, {
        timespan: topic.timespan_vol ?? '6h',
        force:    FORCE,
      });

      topicResult.timelinevol = timeline;
      console.log(`    → timeline ${timeline ? 'ok' : 'empty'}${fromCache ? ' [cache]' : ''}`);
      if (timeline) consecutiveSuccesses++;
      else consecutiveSuccesses = Math.max(0, consecutiveSuccesses - 1);
    }

    results[topic.id] = topicResult;
  }

  return results;
}

async function crawlPersons() {
  const results = {};
  const activePersons = TRACKED_PERSONS.filter(p => p.status === 'active');
  let consecutiveSuccesses = 0;
  const phaseStart = Date.now();
  const MAX_PHASE_MS = 6 * 60_000; // 6 min hard cap on persons phase

  for (const person of activePersons) {
    if (Date.now() - phaseStart > MAX_PHASE_MS) {
      console.warn(`  ⏱ Persons phase stopped at "${person.name}" — 6 min cap reached (${Object.keys(results).length}/${activePersons.length} done)`);
      break;
    }

    if (!canRequest('person')) {
      console.warn(`  ⚡ Stopping person crawl at "${person.name}" — person circuit open`);
      break;
    }

    results[person.name] = {};

    // 7d artlist
    const cooldown7d = cooldownDelay(consecutiveSuccesses, {
      initialMs: COOLDOWN_INITIAL_MS, floorMs: COOLDOWN_FLOOR_MS, decayPerSuccess: COOLDOWN_DECAY_MS,
    });
    await sleep(cooldown7d, `before person:${person.name}/7d`);

    console.log(`  [person 7d] ${person.name}`);
    const { articles: articles7d, fromCache: fc7d } = await fetchPersonArticles(person.name, {
      timespan: '7d', maxrecords: 100, force: FORCE,
    });
    results[person.name].articles7d   = articles7d;
    results[person.name].mentionCount = articles7d.length;
    console.log(`    → ${articles7d.length} articles${fc7d ? ' [cache]' : ''}`);
    if (articles7d.length > 0) consecutiveSuccesses++;
    else consecutiveSuccesses = 0;

    if (!canRequest('person')) break;

    // 72h headlines
    const cooldown72h = cooldownDelay(consecutiveSuccesses, {
      initialMs: COOLDOWN_INITIAL_MS, floorMs: COOLDOWN_FLOOR_MS, decayPerSuccess: COOLDOWN_DECAY_MS,
    });
    await sleep(cooldown72h, `before person:${person.name}/72h`);

    console.log(`  [person 72h] ${person.name}`);
    const { articles: headlines, fromCache: fcH } = await fetchPersonArticles(person.name, {
      timespan: '72h', maxrecords: 10, force: FORCE,
    });
    results[person.name].headlines = headlines;
    console.log(`    → ${headlines.length} headlines${fcH ? ' [cache]' : ''}`);
  }

  return results;
}

async function crawlGkg() {
  if (!canRequest('gkg')) {
    console.warn('  ⚡ GKG skipped — gkg circuit open');
    return null;
  }

  const cooldownMs = cooldownDelay(0, {
    initialMs: COOLDOWN_INITIAL_MS, floorMs: COOLDOWN_FLOOR_MS, decayPerSuccess: COOLDOWN_DECAY_MS,
  });
  await sleep(cooldownMs, 'before gkg');

  console.log('  [gkg] unrest geojson');
  const { geojson } = await fetchGkg('protest riot demonstration unrest coup', {
    timespan:   '24h',
    maxrecords: 500,
    force:      FORCE,
  });

  return geojson;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  const activePersons = TRACKED_PERSONS.filter(p => p.status === 'active');

  if (FORCE) {
    resetAllBreakers();
  }

  console.log('=== seed-gdelt-raw: Master GDELT Crawl (Patch 5) ===');
  console.log(`  Topics:   ${TOPICS.length} × artlist/timelinevol`);
  console.log(`  Persons:  ${activePersons.length} active × 7d + 72h (${TRACKED_PERSONS.length - activePersons.length} inactive — snapshot-preserved only)`);
  console.log(`  Cooldown: ${COOLDOWN_INITIAL_MS / 1000}s initial → ${COOLDOWN_FLOOR_MS / 1000}s floor (adaptive)`);
  console.log(`  Post-exhaust pause: ${COOLDOWN_POST_EXHAUST_MS / 1000}s`);
  console.log(`  Source:   shared/tracked-persons.json`);
  console.log(`  Force:    ${FORCE ? 'YES — bypassing cache + resetting breakers' : 'NO — cache-first'}`);

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

  const isFirstRun = existing === null;
  console.log(isFirstRun
    ? '  No existing cache — fetching from GDELT (first run)\n'
    : `  Cache is ${ageMin} min old — stale, re-fetching\n`);

  // ── Sequential crawl ─────────────────────────────────────────────────────
  console.log('--- Phase 1: Topics ---');
  const rawTopics = await crawlTopics();

  console.log('\n--- Phase 2: Persons ---');
  const rawPersons = await crawlPersons();

  console.log('\n--- Phase 3: GKG ---');
  const gkg = await crawlGkg();

  // ── Telemetry flush ──────────────────────────────────────────────────────
  const { url: rUrl, token: rTok } = getRedisCredentials();
  await flushTelemetry({ url: rUrl, token: rTok });
  console.log('\n' + breakerSummary());

  // ── Snapshot merge ───────────────────────────────────────────────────────
  const circuitOpen = anyBreakerOpen();
  let topics  = rawTopics;
  let persons = rawPersons;

  if (circuitOpen && existing) {
    console.log('\n  Merging partial results with previous snapshot…');
    ({ topics, persons } = mergeWithSnapshot(rawTopics, rawPersons, existing));
  }

  // Preserve inactive persons from prior snapshot
  if (existing) {
    const inactiveNames = TRACKED_PERSONS.filter(p => p.status === 'inactive').map(p => p.name);
    for (const name of inactiveNames) {
      if (!persons[name] && existing.persons?.[name]) {
        persons[name] = { ...existing.persons[name], preservedFromCache: true };
      }
    }
  }

  const populatedTopicCount  = Object.values(topics).filter(t => t.artlist?.length > 0).length;
  const populatedPersonCount = Object.values(persons).filter(p => p.mentionCount > 0).length;
  const topicCount           = Object.keys(topics).length;
  const personCount          = Object.keys(persons).length;

  // ── FIRST-RUN GUARD ──────────────────────────────────────────────────────
  if (circuitOpen && isFirstRun && populatedTopicCount === 0) {
    const flagPayload = JSON.stringify({ at: new Date().toISOString(), reason: 'first_run_circuit_trip' });
    await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', RATELIMIT_FLAG_KEY, flagPayload, 'EX', 3600]),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.warn('\n  ⚡ First run + circuit tripped + no prior snapshot — skipping write.');
    console.warn('     Wait 15–30 minutes, then: node scripts/seed-gdelt-raw.mjs --force');
    console.log(`\n=== Done in ${elapsed}s — NO WRITE (first-run circuit trip) ===`);
    return;
  }

  // ── Prefer TTL extension over thin overwrite ─────────────────────────────
  if (circuitOpen && populatedTopicCount < MIN_TOPICS_TO_OVERWRITE && populatedPersonCount < MIN_PERSONS_TO_OVERWRITE && existing) {
    const existingPopTopics   = Object.values(existing.topics ?? {}).filter(t => t.artlist?.length > 0).length;
    const existingPopPersons  = Object.values(existing.persons ?? {}).filter(p => p.mentionCount > 0).length;
    if (existingPopTopics >= MIN_TOPICS_TO_OVERWRITE || existingPopPersons >= MIN_PERSONS_TO_OVERWRITE) {
      console.log(`\n  ↩ Existing key has ${existingPopTopics} pop. topics / ${existingPopPersons} pop. persons — extending TTL`);
      await redisPipelineRaw(redisUrl, redisToken, [['EXPIRE', RAW_KEY, TTL]])
        .catch(e => console.warn(`  TTL extend failed: ${e.message}`));
      console.log(`  ✅ ${RAW_KEY} TTL extended (${TTL}s)`);
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
    patch:          5,
    ...(circuitOpen ? { rateLimitedAt: new Date().toISOString() } : {}),
  };

  const payload = JSON.stringify(output);
  await redisSetRaw(redisUrl, redisToken, RAW_KEY, payload, TTL);
  console.log(`  ✅ ${RAW_KEY} written (${topicCount} topics, ${personCount} persons, ${populatedTopicCount} pop. topics, ${populatedPersonCount} pop. persons)`);

  // Rate-limit flag management
  if (circuitOpen) {
    const flagPayload = JSON.stringify({ at: new Date().toISOString(), topics: topicCount, persons: personCount, populatedTopics: populatedTopicCount });
    await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', RATELIMIT_FLAG_KEY, flagPayload, 'EX', 3600]),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
    console.warn('\n  ⚡ Crawl ended with circuit open — snapshot merge applied.');
  } else {
    await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['DEL', RATELIMIT_FLAG_KEY]),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const partial = circuitOpen ? ' [PARTIAL — snapshot merge applied]' : '';
  const { gdelt_calls, successes, failures, cache_hits } = sessionMetricsSummary();
  console.log(`\n  Session: gdelt_calls=${gdelt_calls} successes=${successes} failures=${failures} cache_hits=${cache_hits}`);
  console.log(`\n=== Done in ${elapsed}s — ${topicCount} topics, ${personCount} persons${partial} ===`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
