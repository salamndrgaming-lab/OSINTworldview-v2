// src/services/chokepoint-monitor.ts
import { getPersistentCache } from './persistent-cache';

export interface ChokepointFlow {
  timestamp: number;
  vessels24h: number;
  riskScore: number;
  tankerRatio: number;
  cooldown: number;
}

export async function getChokepointFlow(): Promise<ChokepointFlow[]> {
  const keys = ['malacca', 'suez', 'hormuz'].map(id => `chokepoint:flow:${id}`);

  const envelopes = await Promise.all(
    keys.map(key => getPersistentCache<ChokepointFlow>(key))
  );

  return envelopes
    .filter((env): env is NonNullable<typeof env> => env !== null)
    .map(env => env.data);
}