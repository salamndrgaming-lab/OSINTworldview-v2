#!/usr/bin/env node
// scripts/seed-orbital.mjs
import { loadEnvFile, getRedisCredentials, redisSet, withRetry } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

async function seedOrbital() {
  const { url, token } = getRedisCredentials();

  const tles = await withRetry(async () => {
    const res = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json');
    return res.json();
  });

  await withRetry(() => redisSet(url, token, 'orbital:tle', tles, 7200));
  console.log('✅ Orbital seeded');
}

seedOrbital().catch(console.error);