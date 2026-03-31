// src/services/telegram-osint.ts
// Original OSINT-focused Telegram aggregator using public MTProto relay + Redis
// Integrates with your existing seed pattern and analyst tab

import { getRedis } from '../utils/redis';
import { fetchWithRetry } from '../../scripts/shared/_seed-utils.mjs'; // reuse your util

export interface TelegramChannel {
  id: string;
  name: string;
  handle: string;
  lastPost: string;
  keywords: string[];
  relevanceScore: number;
}

const CURATED_CHANNELS = [
  { id: 'osint_1', name: 'OSINT Technical', handle: '@osinttech', keywords: ['drone', 'cyber', 'supply'] },
  { id: 'osint_2', name: 'Geopolitics Watch', handle: '@geowatch', keywords: ['chokepoint', 'conflict'] },
  // Add your own 10-15 public OSINT channels here
];

export async function seedTelegramOSINT() {
  const redis = getRedis();
  const now = Date.now();

  for (const chan of CURATED_CHANNELS) {
    // Simulate public relay fetch (replace with real MTProto if you have the client)
    const mockPost = await fetchWithRetry(`https://public-osint-relay.example.com/channel/${chan.handle}`, { timeout: 5000 });
    const payload: TelegramChannel = {
      ...chan,
      lastPost: mockPost?.text || 'No recent post',
      relevanceScore: Math.random() * 100,
    };

    await redis.set(`telegram:osint:${chan.id}`, JSON.stringify(payload), { EX: 3600 });
  }
  console.log('✅ OSINT Telegram seeded');
}

export async function getTelegramOSINT(): Promise<TelegramChannel[]> {
  const redis = getRedis();
  const keys = CURATED_CHANNELS.map(c => `telegram:osint:${c.id}`);
  const raw = await redis.mget(keys);
  return raw.map(r => r ? JSON.parse(r) : null).filter(Boolean);
}