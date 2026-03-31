// src/services/chokepoint-monitor.ts
// Uses your repo's persistent-cache pattern (no direct Redis in client services)
import { getPersistentCache } from './persistent-cache'; // ← your existing service

export async function getChokepointFlow() {
  // Data is seeded to Redis by the .mjs script; persistent-cache reads it safely
  const cache = getPersistentCache();
  const keys = ['malacca', 'suez', 'hormuz'].map(id => `chokepoint:flow:${id}`);
  const raw = await cache.mget(keys);           // matches your repo style
  return raw.map((r: any) => r ? JSON.parse(r) : null).filter(Boolean);
}