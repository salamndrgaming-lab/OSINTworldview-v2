/**
 * _gdelt-cache.mjs — Read the master GDELT raw cache from Redis
 *
 * All scripts that previously called gdeltproject.org directly now
 * call getGdeltRaw() or the specific helper for their use-case.
 *
 * If the cache key is missing (seed-gdelt-raw hasn't run yet, or expired)
 * every function throws clearly so the caller can decide to skip or soft-fail.
 */

import { getRedisCredentials } from './_seed-utils.mjs';

export const RAW_KEY = 'gdelt:raw:v1';

// ── Core reader ───────────────────────────────────────────────────────────────

/**
 * Returns the full raw cache object:
 *   { topics, persons, gkg, crawledAt }
 * Throws if the key is missing so callers can soft-fail gracefully.
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
      'Ensure it runs before all consumer seeds in seed.yml.'
    );
  }

  const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
  return parsed;
}

// ── Convenience helpers for each consumer ────────────────────────────────────

/**
 * seed-gdelt-intel: returns the 6 intel topics with artlist arrays
 * structured exactly as fetchAllTopics() used to return.
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
 * seed-telegram-narratives: returns artlist + timelinevol for 10 narrative themes.
 * Returns same shape as the old fetchAllNarratives() expected.
 */
export async function getGdeltNarrativeThemes() {
  const raw = await getGdeltRaw();
  const THEME_IDS = ['conflict', 'military', 'cyber', 'ukraine', 'middleeast', 'osint', 'geopolitics', 'unrest', 'nuclear', 'trade'];
  return THEME_IDS.map(id => ({
    id,
    artlist:    raw.topics?.[id]?.artlist ?? [],
    timelinevol: raw.topics?.[id]?.timelinevol ?? null,
    fetchedAt:  raw.topics?.[id]?.fetchedAt ?? raw.crawledAt,
  }));
}

/**
 * seed-narrative-drift: returns timelinevol data for 10 themes.
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
 * seed-missile-events: returns artlist for missile/drone/airstrike topics.
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
 * seed-warcam: returns artlist for all conflict/kinetic topics.
 * Mapped to { query, label } shape to match the original WARCAM_QUERIES loop.
 */
export async function getGdeltWarcamArticles() {
  const raw = await getGdeltRaw();
  return [
    { label: 'airstrikes',   articles: raw.topics?.airstrike?.artlist    ?? [] },
    { label: 'ground-combat',articles: raw.topics?.['ground-combat']?.artlist ?? [] },
    { label: 'drone-missile',articles: raw.topics?.drone?.artlist        ?? [] },
    { label: 'casualties',   articles: raw.topics?.casualties?.artlist   ?? [] },
    { label: 'military-ops', articles: raw.topics?.['military-ops']?.artlist ?? [] },
  ];
}

/**
 * seed-persons-of-interest: returns per-person article arrays.
 * { articles7d, headlines, mentionCount } for each tracked person name.
 */
export async function getGdeltPersonData(personName) {
  const raw = await getGdeltRaw();
  const data = raw.persons?.[personName];
  if (!data) return { articles7d: [], headlines: [], mentionCount: 0 };
  return data;
}

/**
 * seed-poi-discovery: returns artlist arrays for POI discovery queries.
 */
export async function getGdeltPoiDiscoveryArticles() {
  const raw = await getGdeltRaw();
  const POI_IDS = ['poi-leaders', 'poi-military', 'poi-diplomacy', 'poi-wmd', 'poi-unrest'];
  // Flatten all discovery topics into one article pool (deduped by URL)
  const seen = new Set();
  const all = [];
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
 * seed-unrest-events: returns the GKG GeoJSON fetched for unrest.
 */
export async function getGdeltUnrestGkg() {
  const raw = await getGdeltRaw();
  return raw.gkg ?? null;
}
