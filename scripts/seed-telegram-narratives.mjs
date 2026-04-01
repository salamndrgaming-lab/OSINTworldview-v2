#!/usr/bin/env node
/**
 * seed-telegram-narratives.mjs — Reads from gdelt:raw:v1 cache (no direct GDELT calls)
 * Requires seed-gdelt-raw.mjs to have run first in this seed cycle.
 */
import { loadEnvFile, getRedisCredentials, sleep } from './_seed-utils.mjs';
import { getGdeltNarrativeThemes } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const REDIS_KEY = 'telegram:narratives:v1';
const TTL = 7200; // 2 hours

// Convert GDELT timestamp (YYYYMMDDTHHMMSSZ) to ISO string
function parseGdeltDate(gdeltDateStr) {
  if (!gdeltDateStr || gdeltDateStr.length < 15) return new Date().toISOString();
  try {
    const y   = gdeltDateStr.substring(0, 4);
    const mo  = gdeltDateStr.substring(4, 6);
    const d   = gdeltDateStr.substring(6, 8);
    const h   = gdeltDateStr.substring(9, 11);
    const min = gdeltDateStr.substring(11, 13);
    const s   = gdeltDateStr.substring(13, 15);
    return `${y}-${mo}-${d}T${h}:${min}:${s}Z`;
  } catch {
    return new Date().toISOString();
  }
}

async function fetchAllNarratives() {
  const themes = await getGdeltNarrativeThemes();
  const allMessages = [];

  for (const theme of themes) {
    for (const art of (theme.artlist ?? [])) {
      if (!art.title || !art.url) continue;
      allMessages.push({
        channelName: art.domain || 'gdelt.source',
        text:        art.title,
        timestamp:   parseGdeltDate(art.seendate || art.date || ''),
        url:         art.url,
        theme:       theme.id,
      });
    }
  }

  if (allMessages.length === 0) {
    console.error('[error] No narrative articles in GDELT cache. Preserving existing Redis value.');
    return null;
  }

  allMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { telegramNarratives: allMessages };
}

async function main() {
  const { url, token } = getRedisCredentials();
  const data = await fetchAllNarratives();

  if (!data) {
    console.log('Nothing to write — keeping existing cache.');
    process.exit(0);
  }

  const payload = JSON.stringify(data);
  const mb = (Buffer.byteLength(payload, 'utf8') / 1_048_576).toFixed(2);
  console.log(`Writing ${REDIS_KEY} (${mb} MB, ${data.telegramNarratives.length} messages)`);

  const resp = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', REDIS_KEY, payload, 'EX', TTL]),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Redis write failed: HTTP ${resp.status}`);
  console.log(`✅ ${REDIS_KEY} written`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
