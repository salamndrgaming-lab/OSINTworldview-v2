// src/services/telegram-osint.ts
import { getPersistentCache } from './persistent-cache';

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

export async function getTelegramOSINT(): Promise<TelegramChannel[]> {
  const keys = CURATED_CHANNELS.map(c => `telegram:osint:${c.id}`);

  const envelopes = await Promise.all(
    keys.map(key => getPersistentCache<TelegramChannel>(key))
  );

  return envelopes
    .filter((env): env is NonNullable<typeof env> => env !== null)
    .map(env => env.data);
}

// Seed function removed from here (moved to its own .mjs file — already provided)