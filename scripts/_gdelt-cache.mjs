/**
 * _gdelt-cache.mjs — Read the master GDELT raw cache from Redis
 *
 * All scripts that previously called gdeltproject.org directly now call
 * getGdeltRaw() or one of the convenience helpers below.
 *
 * STALENESS WARNINGS:
 *   If the cache is older than STALE_WARN_MIN minutes, helpers log a warning
 *   but still return the data — consumers must never block on stale cache.
 *
 * DEGRADED MODE:
 *   If gdelt:raw:ratelimit-at is set, the last crawl hit GDELT's rate limit
 *   and data may be partial. Consumers can surface a degraded-mode banner.
 */

import { getRedisCredentials } from './_seed-utils.mjs';

export const RAW_KEY       = 'gdelt:raw:v1';
const RATELIMIT_FLAG_KEY    = 'gdelt:raw:ratelimit-at';
const STALE_WARN_MIN        = 90; // warn if cache > 90 min old

// ── Core reader ───────────────────────────────────────────────────────────────

/**
 * Returns the full raw cache object: { topics, persons, gkg, crawledAt }
 *
 * Behaviour:
 *   - If the key is missing → throws (caller should soft-fail)
 *   - If the key is present but old → logs a warning, returns data
 *   - If circuitTripped flag is set → logs a degraded-mode warning
 */
export async function getGdeltRaw() {
  const { url, token } = getRedisCredentials();

  const resp = await fetch(`${url}/get/${encodeURIComponent(RAW_KEY)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) throw new Error(`Redis GET failed: HTTP ${resp.status}`);

  const data = await resp.json();
  if (!data.result) {
    throw new Error(
      'gdelt:raw:v1 is empty — seed-gdelt-raw.mjs has not run yet this cycle. ' +
      'Ensure it runs before all consumer seeds in seed.yml. ' +
      'Run: node scripts/seed-gdelt-raw.mjs --force'
    );
  }

  const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;

  // Staleness check
  if (parsed.crawledAt) {
    const ageMin = (Date.now() - new Date(parsed.crawledAt).getTime()) / 60_000;
    if (ageMin > STALE_WARN_MIN) {
      console.warn(`  ⚠ gdelt:raw:v1 is ${ageMin.toFixed(0)} min old — data may be stale. Re-run seed-gdelt-raw.mjs.`);
    }
  }

  // Degraded-mode flag
  if (parsed.circuitTripped) {
    console.warn('  ⚠ Last GDELT crawl hit rate-limit circuit breaker — data is partial. Some topics/persons may be empty.');
  }

  return parsed;
}

/**
 * Returns true if the last crawl was rate-limited (circuit tripped).
 * Use this to surface a degraded-mode banner in UI consumers.
 */
export async function isGdeltDegraded() {
  const { url, token } = getRedisCredentials();
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(RATELIMIT_FLAG_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!data.result;
  } catch {
    return false;
  }
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/**
 * seed-gdelt-intel: returns 6 intel topics with artlist arrays.
 */
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
  };
}

/**
 * seed-telegram-narratives: artlist + timelinevol for 10 narrative themes.
 */
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

/**
 * seed-narrative-drift: timelinevol data for 10 themes.
 */
export async function getGdeltTimelineVolumes() {
  const raw = await getGdeltRaw();
  const DRIFT_IDS = ['conflict', 'military', 'cyber', 'ukraine', 'middleeast', 'nuclear', 'sanctions', 'china', 'unrest', 'energy'];
  return DRIFT_IDS.map(id => ({
    id,
    timeline: raw.topics?.[id]?.timelinevol ?? null,
  }));
}

/**
 * seed-missile-events: artlist for missile/drone/airstrike topics.
 */
export async function getGdeltMissileArticles() {
  const raw = await getGdeltRaw();
  return {
    missile:   raw.topics?.missile?.artlist   ?? [],
    drone:     raw.topics?.drone?.artlist     ?? [],
    airstrike: raw.topics?.airstrike?.artlist ?? [],
  };
}

/**
 * seed-warcam: artlist for all conflict/kinetic topics.
 */
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

/**
 * seed-persons-of-interest: per-person article arrays.
 */
export async function getGdeltPersonData(personName) {
  const raw = await getGdeltRaw();
  const data = raw.persons?.[personName];
  if (!data) return { articles7d: [], headlines: [], mentionCount: 0 };
  return data;
}

/**
 * seed-poi-discovery: flattened + deduped article pool from POI discovery topics.
 */
export async function getGdeltPoiDiscoveryArticles() {
  const raw = await getGdeltRaw();
  const POI_IDS = ['poi-leaders', 'poi-military', 'poi-diplomacy', 'poi-wmd', 'poi-unrest'];
  const seen = new Set();
  const all  = [];
  for (const id of POI_IDS) {
    for (const art of raw.topics?.[id]?.artlist ?? []) {
      if (!seen.has(art.url)) {
        seen.add(art.url);
        all.push(art);
      }
    }
  }
  return all;
}

/**
 * seed-unrest-events: GKG GeoJSON for unrest.
 */
export async function getGdeltUnrestGkg() {
  const raw = await getGdeltRaw();
  return raw.gkg ?? null;
}
