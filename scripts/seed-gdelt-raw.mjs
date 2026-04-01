#!/usr/bin/env node

/**
 * seed-gdelt-raw.mjs — Master GDELT Fetch (Run this FIRST)
 *
 * PURPOSE:
 *   All other scripts that previously called gdeltproject.org directly now
 *   read from the Redis key written here instead. This reduces total GDELT
 *   API calls from ~91 per seed run down to ~26 (one crawl, one writer).
 *
 * WHAT IT FETCHES (one sequential pass, 5s cooldown between calls):
 *   Mode: artlist   — full article lists for every topic (24h window)
 *   Mode: timelinevol — volume/velocity timelines for narrative-drift topics (6h window)
 *   Person queries  — mention counts for every tracked POI (7d + 72h windows)
 *
 * OUTPUT KEY:  gdelt:raw:v1   TTL: 4h
 *
 * CONSUMERS (read from Redis, never call GDELT themselves):
 *   seed-gdelt-intel.mjs        → reads topics.artlist
 *   seed-telegram-narratives.mjs → reads topics.artlist + topics.timelinevol
 *   seed-narrative-drift.mjs    → reads topics.timelinevol
 *   seed-missile-events.mjs     → reads topics.artlist (missile/drone/airstrike)
 *   seed-warcam.mjs             → reads topics.artlist (conflict labels)
 *   seed-persons-of-interest.mjs → reads persons.*
 *   seed-poi-discovery.mjs      → reads topics.artlist (discovery queries)
 *
 * Usage: node scripts/seed-gdelt-raw.mjs
 */

import { loadEnvFile, CHROME_UA, getRedisCredentials, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

export const RAW_KEY = 'gdelt:raw:v1';
const TTL = 4 * 3600; // 4 hours — survives the full seed run with headroom
const GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_GKG = 'https://api.gdeltproject.org/api/v1/gkg_geojson';
const COOLDOWN_MS = 5_000; // 5 s between every GDELT call — conservative but safe

// ── Topic definitions ────────────────────────────────────────────────────────
// Union of all topics previously scattered across individual scripts.
// Each entry can request artlist, timelinevol, or both.

const TOPICS = [
  // ── Geopolitical / intel (seed-gdelt-intel, seed-narrative-drift, seed-telegram-narratives)
  { id: 'military',     query: '(military exercise OR troop deployment OR airstrike OR "naval exercise") sourcelang:eng', artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'cyber',        query: '(cyberattack OR ransomware OR hacking OR "data breach" OR APT) sourcelang:eng',           artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'nuclear',      query: '(nuclear OR uranium enrichment OR IAEA OR "nuclear weapon" OR plutonium) sourcelang:eng', artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'sanctions',    query: '(sanctions OR embargo OR "trade war" OR tariff OR "economic pressure") sourcelang:eng',   artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'intelligence', query: '(espionage OR spy OR intelligence agency OR covert OR surveillance) sourcelang:eng',       artlist: true, timelinevol: false, timespan_art: '24h' },
  { id: 'maritime',     query: '(naval blockade OR piracy OR "strait of hormuz" OR "south china sea" OR warship) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '24h' },

  // ── Conflict / narrative (seed-narrative-drift, seed-telegram-narratives)
  { id: 'conflict',     query: '(conflict OR war OR attack OR strike OR offensive)',                              artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'ukraine',      query: '(ukraine OR kyiv OR russia OR zelensky OR kremlin)',                             artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'middleeast',   query: '(israel OR gaza OR iran OR lebanon OR syria OR hamas)',                          artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'china',        query: '(china OR beijing OR taiwan OR PLA OR "south china sea")',                       artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'unrest',       query: '(protest OR riot OR coup OR uprising OR unrest)',                                artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'energy',       query: '(oil OR gas OR OPEC OR pipeline OR "energy crisis")',                            artlist: true, timelinevol: true, timespan_art: '24h', timespan_vol: '6h' },
  { id: 'geopolitics',  query: '(geopolitics OR diplomacy OR summit OR negotiations OR ceasefire)',              artlist: true, timelinevol: false, timespan_art: '24h' },
  { id: 'trade',        query: '(trade OR tariff OR export OR "supply chain")',                                  artlist: true, timelinevol: false, timespan_art: '24h' },
  { id: 'osint',        query: '(osint OR "open source intelligence" OR satellite OR surveillance)',             artlist: true, timelinevol: false, timespan_art: '24h' },

  // ── Strike / weapons (seed-missile-events, seed-warcam)
  { id: 'missile',      query: '(missile strike OR missile attack OR ballistic missile OR cruise missile) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'drone',        query: '(drone strike OR drone attack OR UAV strike OR kamikaze drone OR Shahed drone) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'airstrike',    query: '(airstrike OR air strike OR aerial bombardment OR bombing raid) sourcelang:eng', artlist: true, timelinevol: false, timespan_art: '12h', maxrecords: 75 },
  { id: 'ground-combat',query: '(combat OR fighting OR battle OR frontline) sourcelang:eng',                    artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },
  { id: 'casualties',   query: '(explosion OR destroyed OR casualties OR killed) sourcelang:eng',               artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },
  { id: 'military-ops', query: '(invasion OR offensive OR advance OR retreat) sourcelang:eng',                  artlist: true, timelinevol: false, timespan_art: '48h', maxrecords: 50 },

  // ── POI discovery queries (seed-poi-discovery)
  { id: 'poi-leaders',  query: '"president" OR "prime minister" OR "leader" sourcelang:eng',                    artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-military', query: '"military" OR "armed forces" OR "defense minister" sourcelang:eng',             artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-diplomacy',query: '"summit" OR "negotiations" OR "ceasefire" sourcelang:eng',                      artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-wmd',      query: '"sanctions" OR "nuclear" OR "missile" sourcelang:eng',                          artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
  { id: 'poi-unrest',   query: '"coup" OR "protest" OR "uprising" OR "revolution" sourcelang:eng',              artlist: true, timelinevol: false, timespan_art: '72h', maxrecords: 100 },
];

// Tracked persons for seed-persons-of-interest (name → query object)
const TRACKED_PERSONS = [
  'Vladimir Putin', 'Volodymyr Zelenskyy', 'Xi Jinping', 'Kim Jong Un',
  'Ali Khamenei', 'Benjamin Netanyahu', 'Bashar al-Assad', 'Recep Tayyip Erdogan',
  'Narendra Modi', 'Mohammed bin Salman', 'Abdel Fattah el-Sisi',
  'Yevgeny Prigozhin', 'Abu Mohammed al-Julani', 'Yahya Sinwar',
  'Hassan Nasrallah', 'Masoud Pezeshkian', 'Ismail Haniyeh',
  'Joe Biden', 'Donald Trump', 'Keir Starmer', 'Emmanuel Macron',
];

// ── GDELT fetch helpers ──────────────────────────────────────────────────────

function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

function normalizeArticle(raw) {
  const url = raw.url || '';
  if (!isValidUrl(url)) return null;
  return {
    title:    String(raw.title   || '').slice(0, 500),
    url,
    domain:   String(raw.domain  || raw.source?.domain || '').slice(0, 200),
    source:   String(raw.domain  || raw.source?.domain || '').slice(0, 200),
    date:     String(raw.seendate || ''),
    seendate: String(raw.seendate || ''),
    image:    isValidUrl(raw.socialimage || '') ? raw.socialimage : '',
    language: String(raw.language || ''),
    tone:     typeof raw.tone === 'number' ? raw.tone : 0,
  };
}

async function gdeltFetch(params, label) {
  const url = new URL(GDELT_DOC);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('format', 'json');

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(18_000),
  });

  if (!resp.ok) throw new Error(`GDELT HTTP ${resp.status} for ${label}`);
  return resp.json();
}

async function safeGdeltFetch(params, label) {
  try {
    const data = await gdeltFetch(params, label);
    return data;
  } catch (err) {
    console.warn(`  ⚠ GDELT skip [${label}]: ${err.message}`);
    return null;
  }
}

// ── Main crawl ───────────────────────────────────────────────────────────────

async function crawlTopics() {
  const results = {};
  let callCount = 0;

  for (const topic of TOPICS) {
    // ── artlist fetch
    if (topic.artlist) {
      if (callCount > 0) await sleep(COOLDOWN_MS);
      console.log(`  [artlist] ${topic.id} (${topic.timespan_art ?? '24h'})`);
      const data = await safeGdeltFetch({
        query:      topic.query,
        mode:       'artlist',
        maxrecords: topic.maxrecords ?? 10,
        timespan:   topic.timespan_art ?? '24h',
        sort:       'date',
      }, `${topic.id}/artlist`);
      callCount++;

      results[topic.id] = results[topic.id] ?? {};
      results[topic.id].artlist = (data?.articles ?? []).map(normalizeArticle).filter(Boolean);
      results[topic.id].fetchedAt = new Date().toISOString();
      console.log(`    → ${results[topic.id].artlist.length} articles`);
    }

    // ── timelinevol fetch
    if (topic.timelinevol) {
      await sleep(COOLDOWN_MS);
      console.log(`  [timelinevol] ${topic.id} (${topic.timespan_vol ?? '6h'})`);
      const data = await safeGdeltFetch({
        query:    topic.query,
        mode:     'timelinevol',
        timespan: topic.timespan_vol ?? '6h',
        smoothing: '3',
      }, `${topic.id}/timelinevol`);
      callCount++;

      results[topic.id] = results[topic.id] ?? {};
      results[topic.id].timelinevol = data?.timeline ?? data ?? null;
      console.log(`    → timeline ${data ? 'ok' : 'empty'}`);
    }
  }

  return results;
}

async function crawlPersons() {
  const results = {};

  for (const name of TRACKED_PERSONS) {
    results[name] = {};

    // 7-day broad count
    await sleep(COOLDOWN_MS);
    console.log(`  [person 7d] ${name}`);
    const broad = await safeGdeltFetch({
      query:      `"${name}" sourcelang:eng`,
      mode:       'artlist',
      maxrecords: '250',
      timespan:   '7d',
    }, `person:${name}/7d`);
    results[name].articles7d = (broad?.articles ?? []).map(normalizeArticle).filter(Boolean);
    results[name].mentionCount = results[name].articles7d.length;

    // 72h headlines
    await sleep(COOLDOWN_MS);
    console.log(`  [person 72h] ${name}`);
    const narrow = await safeGdeltFetch({
      query:      `"${name}" sourcelang:eng`,
      mode:       'artlist',
      maxrecords: '10',
      timespan:   '72h',
    }, `person:${name}/72h`);
    results[name].headlines = (narrow?.articles ?? []).map(normalizeArticle).filter(Boolean);
  }

  return results;
}

// ── GKG fetch for unrest (seed-unrest-events uses v1 GKG endpoint) ───────────

async function crawlGkg() {
  try {
    await sleep(COOLDOWN_MS);
    console.log('  [gkg] unrest geojson');
    const url = new URL(GDELT_GKG);
    url.searchParams.set('query', 'protest OR riot OR demonstration OR strike');
    url.searchParams.set('timespan', '24h');
    url.searchParams.set('format', 'geojson');
    url.searchParams.set('maxrecords', '250');

    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(18_000),
    });
    if (!resp.ok) throw new Error(`GKG HTTP ${resp.status}`);
    const data = await resp.json();
    console.log(`    → ${data?.features?.length ?? 0} GKG features`);
    return data;
  } catch (err) {
    console.warn(`  ⚠ GKG skip: ${err.message}`);
    return null;
  }
}

// ── Redis write helpers ──────────────────────────────────────────────────────

async function writeToRedis(key, data, ttl) {
  const { url, token } = getRedisCredentials();
  const payload = JSON.stringify(data);
  const mb = (Buffer.byteLength(payload, 'utf8') / 1_048_576).toFixed(2);
  console.log(`\n  Writing ${key} (${mb} MB) TTL=${ttl}s`);

  const resp = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', key, payload, 'EX', ttl]),
    signal:  AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`Redis write failed: HTTP ${resp.status}`);
  console.log(`  ✅ ${key} written`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log('=== seed-gdelt-raw: Master GDELT Crawl ===');
  console.log(`  Topics: ${TOPICS.length} × artlist/timelinevol`);
  console.log(`  Persons: ${TRACKED_PERSONS.length} × 7d + 72h`);
  console.log(`  Cooldown: ${COOLDOWN_MS / 1000}s between calls`);

  const [topics, persons, gkg] = await Promise.allSettled([
    crawlTopics(),
    crawlPersons(),
    crawlGkg(),
  ]).then(r => r.map(s => s.status === 'fulfilled' ? s.value : {}));

  const output = {
    topics,
    persons,
    gkg: gkg ?? null,
    crawledAt: new Date().toISOString(),
    version: 'v1',
  };

  await writeToRedis(RAW_KEY, output, TTL);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const topicCount = Object.keys(topics).length;
  const personCount = Object.keys(persons).length;
  console.log(`\n=== Done in ${elapsed}s — ${topicCount} topics, ${personCount} persons ===`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
