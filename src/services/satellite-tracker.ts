// src/services/satellite-tracker.ts
import { getPersistentCache } from './persistent-cache';

export async function getOrbitalLayer() {
  const cache = getPersistentCache();
  const tles = await cache.get('orbital:tle') || '[]';
  return JSON.parse(tles);
}