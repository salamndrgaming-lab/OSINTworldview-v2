#!/usr/bin/env node
/**
 * seed-gdelt-intel.mjs — Reads from gdelt:raw:v1 cache (no direct GDELT calls)
 * Requires seed-gdelt-raw.mjs to have run first in this seed cycle.
 *
 * Improvements over previous version (informed by upstream's implementation):
 *  - 24h TTL (was 1h) — outlasts multiple cron cycles so consumers always have data
 *  - publishTransform strips internal fields before writing to canonical key
 *  - afterPublish writes per-topic tone/vol timeline keys (gdelt:intel:tone:*, gdelt:intel:vol:*)
 *  - Snapshot merge: if cache returns 0 articles for a topic, restores from previous snapshot
 *  - validate threshold raised to 3/6 topics (was 2/6) — matches upstream
 */
import { loadEnvFile, runSeed, verifySeedKey, writeExtraKey } from './_seed-utils.mjs';
import { getGdeltIntelTopics, getGdeltIntelTopicsWithTimelines } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:gdelt-intel:v1';
// 24h — intentionally much longer than the cron interval so verifySeedKey
// always has a prior snapshot to merge from when GDELT rate-limits topics.
// Matches upstream's CACHE_TTL for this key.
const CACHE_TTL    = 86_400;
const TIMELINE_TTL = 43_200; // 12h — 2× cron interval; tone/vol survive until next run

const INTEL_TOPIC_IDS = ['military', 'cyber', 'nuclear', 'sanctions', 'intelligence', 'maritime'];

async function buildIntelData() {
  const cached = await getGdeltIntelTopics();

  // For topics that returned 0 articles (circuit tripped in the raw crawl),
  // restore the previous snapshot's articles rather than publishing empty
  // results over good cached data — same pattern as upstream's fetchAllTopics().
  const emptyTopics = cached.topics.filter(t => t.articles.length === 0);
  if (emptyTopics.length > 0) {
    const previous = await verifySeedKey(CANONICAL_KEY).catch(() => null);
    if (previous && Array.isArray(previous.topics)) {
      const prevMap = new Map(previous.topics.map(t => [t.id, t]));
      for (const topic of cached.topics) {
        if (topic.articles.length === 0 && prevMap.has(topic.id)) {
          const prev = prevMap.get(topic.id);
          if (prev.articles?.length > 0) {
            console.log(`    ${topic.id}: 0 articles from cache — restoring ${prev.articles.length} from previous snapshot`);
            topic.articles  = prev.articles;
            topic.fetchedAt = prev.fetchedAt;
          }
        }
      }
    }
  }

  // Attach tone/vol timeline data for the afterPublish hook using the
  // dedicated helper (avoids dynamic import, uses the same cache read).
  // _tone/_vol are private fields — stripped by publishTransform before the
  // canonical Redis write, and written to separate timeline keys by afterPublish.
  let topicsWithTimelines;
  try {
    topicsWithTimelines = await getGdeltIntelTopicsWithTimelines();
    const tlMap = new Map(topicsWithTimelines.topics.map(t => [t.id, t]));
    for (const topic of cached.topics) {
      const tl = tlMap.get(topic.id);
      topic._vol  = tl?._vol  ?? [];
      topic._tone = tl?._tone ?? [];
    }
  } catch {
    // Timeline data is best-effort — don't let it block the main publish
    for (const topic of cached.topics) {
      topic._vol  = [];
      topic._tone = [];
    }
  }

  return {
    topics:    cached.topics,
    fetchedAt: cached.fetchedAt,
  };
}

function validate(data) {
  if (!Array.isArray(data?.topics) || data.topics.length === 0) return false;
  const populated = data.topics.filter(t => Array.isArray(t.articles) && t.articles.length > 0);
  // At least 3 of 6 topics must have articles; per-topic snapshot merge above
  // handles individual missing topics so the bar is achievable.
  return populated.length >= 3;
}

// Strip private/internal fields before writing to canonical Redis key.
// Matches upstream's publishTransform pattern.
function publishTransform(data) {
  return {
    ...data,
    topics: (data.topics ?? []).map(({ _tone, _vol, exhausted, preservedFromCache, ...rest }) => rest),
  };
}

// Write per-topic tone/vol timeline keys (12h TTL) — separate from the 24h
// canonical key. Consumers that want sparkline data read these directly.
// Matches upstream's afterPublish hook.
async function afterPublish(data) {
  for (const topic of data.topics ?? []) {
    const fetchedAt = topic.fetchedAt ?? data.fetchedAt;

    if (Array.isArray(topic._tone) && topic._tone.length > 0) {
      await writeExtraKey(
        `gdelt:intel:tone:${topic.id}`,
        { data: topic._tone, fetchedAt },
        TIMELINE_TTL,
      ).catch(e => console.warn(`  tone key ${topic.id}: ${e.message}`));
    }

    if (Array.isArray(topic._vol) && topic._vol.length > 0) {
      await writeExtraKey(
        `gdelt:intel:vol:${topic.id}`,
        { data: topic._vol, fetchedAt },
        TIMELINE_TTL,
      ).catch(e => console.warn(`  vol key ${topic.id}: ${e.message}`));
    }
  }
}

runSeed('intelligence', 'gdelt-intel', CANONICAL_KEY, buildIntelData, {
  validateFn:       validate,
  ttlSeconds:       CACHE_TTL,
  sourceVersion:    'gdelt-raw-cache-v2',
  publishTransform,
  afterPublish,
}).catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
