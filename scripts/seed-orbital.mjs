#!/usr/bin/env node
/**
 * seed-orbital.mjs — Fetch active satellite TLE data from CelesTrak
 *
 * Writes: orbital:tle (consumed by satellite layer)
 * TTL: 7200s (2h)
 */
import { loadEnvFile, CHROME_UA, writeExtraKey, withRetry } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'orbital:tle';
const TTL           = 7200; // 2h

async function seedOrbital() {
  const tles = await withRetry(async () => {
    const res = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json', {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
    return res.json();
  });

  if (!Array.isArray(tles) || tles.length === 0) {
    console.warn('  No TLE data returned from CelesTrak — skipping');
    return;
  }

  console.log(`  Fetched ${tles.length} active satellite TLEs`);
  await withRetry(() => writeExtraKey(CANONICAL_KEY, tles, TTL));
  console.log(`✅ Orbital TLE seeded (${tles.length} satellites)`);
}

seedOrbital().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
