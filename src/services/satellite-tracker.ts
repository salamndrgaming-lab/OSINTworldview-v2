// src/services/satellite-tracker.ts
import { getRedis } from '../utils/redis';

export async function getOrbitalLayer() {
  const redis = getRedis();
  const tles = await redis.get('orbital:tle') || '[]'; // seeded below
  return JSON.parse(tles);
}