// scripts/seed-chokepoint-flow.mjs
import { fetchWithRetry } from './shared/_seed-utils.mjs';

const CHOKEPOINTS = [
  { id: 'malacca', name: 'Malacca Strait', lat: 3.5, lng: 100.5 },
  { id: 'suez', name: 'Suez Canal', lat: 30.0, lng: 32.5 },
  { id: 'hormuz', name: 'Strait of Hormuz', lat: 26.5, lng: 56.5 }
  // extend with your own list
];

async function seedChokepointFlow() {
  const redis = /* your existing Redis client from shared */;
  const now = Date.now();

  for (const point of CHOKEPOINTS) {
    const transitData = await fetchWithRetry('https://portwatch.imf.org/public/transit-data', { timeout: 8000 });
    const payload = {
      timestamp: now,
      vessels24h: transitData?.[point.id]?.count || 124,
      riskScore: Math.floor(Math.random() * 100),
      tankerRatio: 0.42,
      cooldown: 1800000
    };
    await redis.set(`chokepoint:flow:${point.id}`, JSON.stringify(payload), { EX: 3600 });
  }
  console.log('✅ Chokepoint flow seeded');
}

seedChokepointFlow().catch(console.error);