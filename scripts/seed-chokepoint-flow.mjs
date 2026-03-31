#!/usr/bin/env node
// scripts/seed-chokepoint-flow.mjs
import { loadEnvFile, getRedisCredentials, redisSet, withRetry } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CHOKEPOINTS = [
  { id: 'malacca', name: 'Malacca Strait', lat: 3.5, lng: 100.5 },
  { id: 'suez', name: 'Suez Canal', lat: 30.0, lng: 32.5 },
  { id: 'hormuz', name: 'Strait of Hormuz', lat: 26.5, lng: 56.5 }
];

async function seedChokepointFlow() {
  const { url, token } = getRedisCredentials();
  const now = Date.now();

  for (const point of CHOKEPOINTS) {
    const payload = {
      timestamp: now,
      vessels24h: 124,                    // real data comes from your future API calls
      riskScore: Math.floor(Math.random() * 100),
      tankerRatio: 0.42,
      cooldown: 1800000
    };

    await withRetry(() => redisSet(url, token, `chokepoint:flow:${point.id}`, payload, 3600));
  }
  console.log('✅ Chokepoint flow seeded');
}

seedChokepointFlow().catch(console.error);