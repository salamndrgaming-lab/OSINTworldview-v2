// src/services/chokepoint-monitor.ts
import { getRedis } from '../utils/redis';

export async function getChokepointFlow() {
  const redis = getRedis();
  // fetch keys matching your pattern
  const keys = ['malacca', 'suez', 'hormuz'].map(id => `chokepoint:flow:${id}`);
  const raw = await redis.mget(keys);
  return raw.map(r => r ? JSON.parse(r) : null).filter(Boolean);
}