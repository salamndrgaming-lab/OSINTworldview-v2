// src/services/telegram-osint.ts
import { getPersistentCache } from './persistent-cache';
import { withRetry } from '../../scripts/_seed-utils.mjs'; // ← correct path + real exported function

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
];

export async function seedTelegramOSINT() {
  const cache = getPersistentCache();   // reuse your repo's cache (no direct Redis)
  // mock public relay fetch with your retry helper
  for (const chan of CURATED_CHANNELS) {
    const mockPost = await withRetry(async () => 
      fetch(`https://public-osint-relay.example.com/channel/${chan.handle}`)
        .then(r => r.json())
    );

    const payload: TelegramChannel = {
      ...chan,
      lastPost: mockPost?.text || 'No recent post',
      relevanceScore: Math.random() * 100,
    };

    await cache.set(`telegram:osint:${chan.id}`, JSON.stringify(payload), 3600);
  }
  console.log('✅ OSINT Telegram seeded');
}

export async function getTelegramOSINT(): Promise<TelegramChannel[]> {
  const cache = getPersistentCache();
  const keys = CURATED_CHANNELS.map(c => `telegram:osint:${c.id}`);
  const raw = await cache.mget(keys);
  return raw.map((r: any) => r ? JSON.parse(r) : null).filter(Boolean);
}