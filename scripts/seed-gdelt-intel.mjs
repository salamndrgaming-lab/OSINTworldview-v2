#!/usr/bin/env node
/**
 * seed-gdelt-intel.mjs — Reads from gdelt:raw:v1 cache (no direct GDELT calls)
 * Requires seed-gdelt-raw.mjs to have run first in this seed cycle.
 */
import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { getGdeltIntelTopics } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:gdelt-intel:v1';
const CACHE_TTL = 3600;
const INTEL_TOPIC_IDS = ['military', 'cyber', 'nuclear', 'sanctions', 'intelligence', 'maritime'];

async function buildIntelData() {
  const cached = await getGdeltIntelTopics();

  // Preserve exact output shape consumers expect: { topics: [...], fetchedAt }
  return {
    topics: cached.topics,
    fetchedAt: cached.fetchedAt,
  };
}

function validate(data) {
  if (!Array.isArray(data?.topics) || data.topics.length !== INTEL_TOPIC_IDS.length) return false;
  const populated = data.topics.filter(t => Array.isArray(t.articles) && t.articles.length > 0);
  return populated.length >= 2;
}

runSeed('intelligence', 'gdelt-intel', CANONICAL_KEY, buildIntelData, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'gdelt-raw-cache-v1',
}).catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
