#!/usr/bin/env node
/**
 * _gdelt-cache.mjs — Master GDELT cache reader AND live fetcher.
 *
 * DUAL ROLE:
 *   1. Consumer helper: getGdeltRaw() + convenience wrappers used by all
 *      downstream seeds (gdelt-intel, persons-of-interest, telegram-narratives…).
 *      These read from gdelt:raw:v1 in Redis — zero direct GDELT calls.
 *
 *   2. Live fetcher: fetchArtlist(), fetchTimelineVol(), fetchPersonArticles(),
 *      fetchGkg() — used by seed-gdelt-raw.mjs to populate the raw cache.
 *      Each function checks Redis cache first, then calls GDELT with per-endpoint
 *      circuit breakers, exponential backoff, and response validation.
 *
 * CIRCUIT BREAKERS: artlist / timelinevol / gkg / person — all independent.
 *   GKG failures NEVER trip the artlist or person breakers.
 *
 * MISSING KEY BEHAVIOUR (Patch 5 hotfix):
 *   getGdeltRaw() no longer throws when gdelt:raw:v1 is missing.
 *   Returns EMPTY_RAW = { topics:{}, persons:{}, gkg:null, crawledAt:null,
 *   circuitTripped:false, _missing:true } so consumer seeds can detect and
 *   apply their LKG fallback without triggering runSeed's withRetry loop.
 *   Only genuine Redis errors (network failure, HTTP 5xx) still throw.
 *
 * EXPORT NOTE:
 *   ESM does not allow `export { importAlias as newName }` when the name is a
 *   local import alias. breakerSummary() and resetAllBreakers() are exported as
 *   named wrapper functions instead.
 *
 * CACHE TTLs:
 *   artlist     1800s (30 min)
 *   timelinevol  900s (15 min)
 *   gkg         3600s (1 hr)
 *   person      3600s (1 hr)
 *
 * USER-AGENT: OSINTworldview/2.0
 * TIMEOUT:    30s per request via AbortSignal.timeout
 */

import { getRedisCredentials } from './_seed-utils.mjs';
import {
  getBreaker,
  recordSuccess  as breakerRecordSuccess,
  recordFailure  as breakerRecordFailure,
  canRequest,
  breakerSummary as circuitBreakerSummary,
  resetAllBreakers as circuitBreakerResetAll,
} from './shared/circuit-breaker.mjs';
import {
  retryWithBackoff,
  sleep,
} from './shared/exponential-backoff.mjs';
import {
  validateArtlistResponse,
  validateTimelineResponse,
  validateGkgResponse,
} from './shared/zod-schemas.mjs';
import {
  recordError,
  recordSuccess    as telRecordSuccess,
  recordCacheHit,
  recordCacheMiss,
  recordValidationReject,
  recordCircuitTrip,
} from './shared/error-telemetry.mjs';

// ── Constants ─────────────────────────────────────────────────────────────────

export const RAW_KEY          = 'gdelt:raw:v1';
const RATELIMIT_FLAG_KEY       = 'gdelt:raw:ratelimit-at';
const STALE_WARN_MIN           = 90;

const GDELT_DOC                = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_GKG                = 'https://api.gdeltproject.org/api/v1/gkg_geojson';
const USER_AGENT               = 'OSINTworldview/2.0';
const FETCH_TIMEOUT_MS         = 15_000; // reduced from 30s — network failures fail faster, matches koala73

const CACHE_TTL = {
  artlist:     1800,
  timelinevol:  900,
  gkg:         3600,
  person:      3600,
};

// Sentinel returned when gdelt:raw:v1 is missing — never throws in this case.
const EMPTY_RAW = Object.freeze({
  topics:        {},
  persons:       {},
  gkg:           null,
  crawledAt:     null,
  circuitTripped: false,
  _missing:      true,
});

// ── Exported wrappers for circuit-breaker functions ───────────────────────────
// ESM does not allow `export { localAlias as newName }` when the alias comes
// from an import statement. Export named wrapper functions instead.

/** Returns a concise breaker-state summary string for end-of-run logging. */
export function breakerSummary() {
  return circuitBreakerSummary();
}

/** Force-close all circuit breakers (called when --force flag is set). */
export function resetAllBreakers() {
  return circuitBreakerResetAll();
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

let _creds = null;
function creds() {
  if (!_creds) _creds = getRedisCredentials();
  return _creds;
}

async function redisGet(key) {
  const { url, token } = creds();
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const body = await resp.json();
    if (!body.result) return null;
    return typeof body.result === 'string' ? JSON.parse(body.result) : body.result;
  } catch {
    return null;
  }
}

async function redisSet(key, value, ttl) {
  const { url, token } = creds();
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  const resp = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', key, payload, 'EX', ttl]),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Redis SET failed: HTTP ${resp.status}`);
}

// ── Live GDELT fetcher (used by seed-gdelt-raw.mjs) ──────────────────────────

async function gdeltDocFetch(endpoint, params, label) {
  if (!canRequest(endpoint)) {
    console.warn(`  ⚡ [${label}] blocked — ${endpoint} circuit open`);
    return null;
  }

  const url = new URL(GDELT_DOC);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('format', 'json');

  const fetchFn = async () => {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (resp.status === 429) {
      const err = new Error(`HTTP 429 [${label}]`);
      err.status = 429;
      throw err;
    }
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status} [${label}]`);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  };

  try {
    const json = await retryWithBackoff(fetchFn, {
      maxRetries:  3,
      baseMs:      60_000,
      capMs:       300_000,
      shouldRetry: (err) => err.status === 429 || (err.status != null && err.status >= 500), // retry on 429 (rate-limit) and 5xx; skip 4xx (except 429) and bare network errors
      onRetry: (err, attempt, delayMs) => {
        console.warn(`  🔄 Retry ${attempt + 1} [${label}] after ${(delayMs / 1000).toFixed(1)}s — ${err.message}`);
        recordError({ level: 'warn', endpoint, label, message: err.message, attempt });
      },
    });
    breakerRecordSuccess(endpoint);
    telRecordSuccess();
    return json;
  } catch (err) {
    console.warn(`  ⚠ GDELT fetch failed [${label}]: ${err.message}`);
    breakerRecordFailure(endpoint);
    recordError({ level: 'error', endpoint, label, message: err.message, status: err.status });
    const b = getBreaker(endpoint);
    if (b.state === 'open' && b.trips > 0 && b.failures === 0) {
      recordCircuitTrip();
    }
    return null;
  }
}

export async function fetchArtlist(query, { timespan = '24h', maxrecords = 50, force = false } = {}) {
  const cacheKey = `gdelt:artlist:${Buffer.from(query + timespan).toString('base64').slice(0, 40)}`;
  if (!force) {
    const cached = await redisGet(cacheKey);
    if (cached?.articles) { recordCacheHit(); return { articles: cached.articles, fromCache: true }; }
  }
  recordCacheMiss();
  const raw = await gdeltDocFetch('artlist', {
    query, mode: 'artlist', maxrecords: String(maxrecords), timespan, sort: 'date',
  }, `artlist:${query.slice(0, 40)}`);
  const { valid, data: articles, rejected, warning } = validateArtlistResponse(raw);
  if (!valid || !articles) { if (warning) console.warn(`  ⚠ artlist validation: ${warning}`); return { articles: [], fromCache: false }; }
  if (rejected > 0) recordValidationReject();
  if (warning) console.warn(`  ⚠ ${warning}`);
  await redisSet(cacheKey, { articles, cachedAt: new Date().toISOString() }, CACHE_TTL.artlist)
    .catch(e => console.warn(`  Redis cache write failed: ${e.message}`));
  return { articles, fromCache: false };
}

export async function fetchTimelineVol(query, { timespan = '6h', force = false } = {}) {
  const cacheKey = `gdelt:timelinevol:${Buffer.from(query + timespan).toString('base64').slice(0, 40)}`;
  if (!force) {
    const cached = await redisGet(cacheKey);
    if (cached?.timeline) { recordCacheHit(); return { timeline: cached.timeline, fromCache: true }; }
  }
  recordCacheMiss();
  const raw = await gdeltDocFetch('timelinevol', {
    query, mode: 'timelinevol', timespan, smoothing: '3',
  }, `timelinevol:${query.slice(0, 40)}`);
  const { valid, data: series, warning } = validateTimelineResponse(raw);
  if (!valid || !series || series.length === 0) { if (warning) console.warn(`  ⚠ timelinevol validation: ${warning}`); return { timeline: null, fromCache: false }; }
  await redisSet(cacheKey, { timeline: series, cachedAt: new Date().toISOString() }, CACHE_TTL.timelinevol)
    .catch(e => console.warn(`  Redis cache write failed: ${e.message}`));
  return { timeline: series, fromCache: false };
}

export async function fetchPersonArticles(name, { timespan = '7d', maxrecords = 100, force = false } = {}) {
  const cacheKey = `gdelt:person:${name.toLowerCase().replace(/\s+/g, '-')}:${timespan}`;
  if (!force) {
    const cached = await redisGet(cacheKey);
    if (cached?.articles) { recordCacheHit(); return { articles: cached.articles, fromCache: true }; }
  }
  recordCacheMiss();
  const query = `"${name}" sourcelang:eng`;
  const raw = await gdeltDocFetch('person', {
    query, mode: 'artlist', maxrecords: String(maxrecords), timespan, sort: 'date',
  }, `person:${name}/${timespan}`);
  const { valid, data: articles, rejected, warning } = validateArtlistResponse(raw);
  if (!valid || !articles) { if (warning) console.warn(`  ⚠ person artlist validation [${name}]: ${warning}`); return { articles: [], fromCache: false }; }
  if (rejected > 0) recordValidationReject();
  await redisSet(cacheKey, { articles, cachedAt: new Date().toISOString() }, CACHE_TTL.person)
    .catch(e => console.warn(`  Redis cache write failed: ${e.message}`));
  return { articles, fromCache: false };
}

export async function fetchGkg(query, { timespan = '24h', maxrecords = 500, force = false } = {}) {
  const cacheKey = `gdelt:gkg:${Buffer.from(query + timespan).toString('base64').slice(0, 40)}`;
  if (!force) {
    const cached = await redisGet(cacheKey);
    if (cached?.geojson) { recordCacheHit(); return { geojson: cached.geojson, fromCache: true }; }
  }
  recordCacheMiss();
  if (!canRequest('gkg')) { console.warn('  ⚡ GKG skipped — gkg circuit open'); return { geojson: null, fromCache: false }; }

  const gkgUrl = new URL(GDELT_GKG);
  gkgUrl.searchParams.set('query',      query);
  gkgUrl.searchParams.set('timespan',   timespan);
  gkgUrl.searchParams.set('format',     'geojson');
  gkgUrl.searchParams.set('maxrecords', String(maxrecords));

  try {
    const resp = await fetch(gkgUrl.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (resp.status === 429) {
      breakerRecordFailure('gkg');
      console.warn('  ⚠ GKG 429 — circuit failure recorded');
      recordError({ level: 'warn', endpoint: 'gkg', message: 'HTTP 429' });
      return { geojson: null, fromCache: false };
    }
    if (!resp.ok) {
      breakerRecordFailure('gkg');
      console.warn(`  ⚠ GKG HTTP ${resp.status}`);
      recordError({ level: 'error', endpoint: 'gkg', message: `HTTP ${resp.status}`, status: resp.status });
      return { geojson: null, fromCache: false };
    }
    const raw = await resp.json();
    const { valid, data: geojson, warning } = validateGkgResponse(raw);
    if (!valid || !geojson) {
      console.warn(`  ⚠ GKG validation failed: ${warning}`);
      recordValidationReject();
      breakerRecordFailure('gkg');
      return { geojson: null, fromCache: false };
    }
    breakerRecordSuccess('gkg');
    telRecordSuccess();
    if (warning) console.warn(`  ⚠ GKG: ${warning}`);
    console.log(`    → ${geojson.features.length} GKG features`);
    await redisSet(cacheKey, { geojson, cachedAt: new Date().toISOString() }, CACHE_TTL.gkg)
      .catch(e => console.warn(`  Redis cache write failed: ${e.message}`));
    return { geojson, fromCache: false };
  } catch (err) {
    breakerRecordFailure('gkg');
    recordError({ level: 'error', endpoint: 'gkg', message: err.message });
    console.warn(`  ⚠ GKG network error: ${err.message}`);
    return { geojson: null, fromCache: false };
  }
}

// ── Consumer helpers (read from gdelt:raw:v1) ─────────────────────────────────

/**
 * Returns the full raw cache object: { topics, persons, gkg, crawledAt }
 *
 * PATCH 5 HOTFIX: returns EMPTY_RAW (with _missing:true) when key is absent.
 * Does NOT throw on missing key — only throws on genuine Redis errors.
 */
export async function getGdeltRaw() {
  const { url, token } = getRedisCredentials();

  let resp;
  try {
    resp = await fetch(`${url}/get/${encodeURIComponent(RAW_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new Error(`Redis network error reading gdelt:raw:v1: ${err.message}`);
  }

  if (!resp.ok) {
    throw new Error(`Redis GET failed: HTTP ${resp.status}`);
  }

  const data = await resp.json();

  if (!data.result) {
    console.warn(
      '  ⚠ gdelt:raw:v1 is missing — GDELT raw seed has not written data yet.\n' +
      '    Consumer will use LKG fallback if available.\n' +
      '    To prime: node scripts/seed-gdelt-raw.mjs --force'
    );
    return EMPTY_RAW;
  }

  const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;

  if (parsed.crawledAt) {
    const ageMin = (Date.now() - new Date(parsed.crawledAt).getTime()) / 60_000;
    if (ageMin > STALE_WARN_MIN) {
      console.warn(`  ⚠ gdelt:raw:v1 is ${ageMin.toFixed(0)} min old — data may be stale.`);
    }
  }
  if (parsed.circuitTripped) {
    console.warn('  ⚠ Last GDELT crawl hit rate-limit circuit breaker — data is partial.');
  }

  return parsed;
}

/**
 * Returns true if the raw key is missing OR if the last crawl was rate-limited.
 */
export async function isGdeltDegraded() {
  const { url, token } = getRedisCredentials();
  try {
    const rawResp = await fetch(`${url}/get/${encodeURIComponent(RAW_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(5_000),
    });
    if (rawResp.ok) {
      const rawBody = await rawResp.json();
      if (!rawBody.result) return true;
    }
    const flagResp = await fetch(`${url}/get/${encodeURIComponent(RATELIMIT_FLAG_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(5_000),
    });
    if (!flagResp.ok) return false;
    const flagBody = await flagResp.json();
    return !!flagBody.result;
  } catch {
    return false;
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export async function getGdeltIntelTopics() {
  const raw = await getGdeltRaw();
  const INTEL_IDS = ['military', 'cyber', 'nuclear', 'sanctions', 'intelligence', 'maritime'];
  return {
    topics: INTEL_IDS.map(id => ({
      id,
      articles:  raw.topics?.[id]?.artlist ?? [],
      fetchedAt: raw.topics?.[id]?.fetchedAt ?? raw.crawledAt,
    })),
    fetchedAt: raw.crawledAt,
    _missing:  raw._missing ?? false,
  };
}

export async function getGdeltIntelTopicsWithTimelines() {
  const raw = await getGdeltRaw();
  const INTEL_IDS = ['military', 'cyber', 'nuclear', 'sanctions', 'intelligence', 'maritime'];
  return {
    topics: INTEL_IDS.map(id => {
      const topicRaw = raw.topics?.[id] ?? {};
      return {
        id,
        articles:  topicRaw.artlist   ?? [],
        fetchedAt: topicRaw.fetchedAt ?? raw.crawledAt,
        _vol:      topicRaw.timelinevol ?? [],
        _tone:     [],
      };
    }),
    fetchedAt: raw.crawledAt,
    _missing:  raw._missing ?? false,
  };
}

export async function getGdeltNarrativeThemes() {
  const raw = await getGdeltRaw();
  const THEME_IDS = ['conflict', 'military', 'cyber', 'ukraine', 'middleeast', 'osint', 'geopolitics', 'unrest', 'nuclear', 'trade'];
  return THEME_IDS.map(id => ({
    id,
    artlist:     raw.topics?.[id]?.artlist ?? [],
    timelinevol: raw.topics?.[id]?.timelinevol ?? null,
    fetchedAt:   raw.topics?.[id]?.fetchedAt ?? raw.crawledAt,
  }));
}

export async function getGdeltTimelineVolumes() {
  const raw = await getGdeltRaw();
  const DRIFT_IDS = ['conflict', 'military', 'cyber', 'ukraine', 'middleeast', 'nuclear', 'sanctions', 'china', 'unrest', 'energy'];
  return DRIFT_IDS.map(id => ({
    id,
    timeline: raw.topics?.[id]?.timelinevol ?? null,
  }));
}

export async function getGdeltMissileArticles() {
  const raw = await getGdeltRaw();
  return {
    missile:   raw.topics?.missile?.artlist   ?? [],
    drone:     raw.topics?.drone?.artlist     ?? [],
    airstrike: raw.topics?.airstrike?.artlist ?? [],
  };
}

export async function getGdeltWarcamArticles() {
  const raw = await getGdeltRaw();
  return [
    { label: 'airstrikes',    articles: raw.topics?.airstrike?.artlist             ?? [] },
    { label: 'ground-combat', articles: raw.topics?.['ground-combat']?.artlist     ?? [] },
    { label: 'drone-missile', articles: raw.topics?.drone?.artlist                 ?? [] },
    { label: 'casualties',    articles: raw.topics?.casualties?.artlist            ?? [] },
    { label: 'military-ops',  articles: raw.topics?.['military-ops']?.artlist      ?? [] },
  ];
}

export async function getGdeltPersonData(personName) {
  const raw = await getGdeltRaw();
  if (raw._missing) return { articles7d: [], headlines: [], mentionCount: 0, _missing: true };
  const data = raw.persons?.[personName];
  if (!data) return { articles7d: [], headlines: [], mentionCount: 0 };
  return data;
}

/**
 * Returns [] when raw key is missing — seed-poi-discovery Step 1b fallback fires naturally.
 */
export async function getGdeltPoiDiscoveryArticles() {
  const raw = await getGdeltRaw();
  if (raw._missing) return [];
  const POI_IDS = ['poi-leaders', 'poi-military', 'poi-diplomacy', 'poi-wmd', 'poi-unrest'];
  const seen = new Set();
  const all  = [];
  for (const id of POI_IDS) {
    for (const art of raw.topics?.[id]?.artlist ?? []) {
      if (!seen.has(art.url)) { seen.add(art.url); all.push(art); }
    }
  }
  return all;
}

export async function getGdeltUnrestGkg() {
  const raw = await getGdeltRaw();
  return raw.gkg ?? null;
}
