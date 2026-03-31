#!/usr/bin/env node
// scripts/seed-telegram-osint.mjs
import { loadEnvFile, getRedisCredentials, redisSet, withRetry } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CURATED_CHANNELS = [
  { id: 'osint_1', name: 'OSINT Technical', handle: '@osinttech' },
  { id: 'osint_2', name: 'Geopolitics Watch', handle: '@geowatch' }
];

async function seedTelegramOSINT() {
  const { url, token } = getRedisCredentials();

  for (const chan of CURATED_CHANNELS) {
    const payload = {
      ...chan,
      lastPost: 'No recent post (demo)',
      relevanceScore: Math.random() * 100,
      keywords: ['drone', 'cyber', 'supply']
    };

    await withRetry(() => redisSet(url, token, `telegram:osint:${chan.id}`, payload, 3600));
  }
  console.log('✅ OSINT Telegram seeded');
}

seedTelegramOSINT().catch(console.error);