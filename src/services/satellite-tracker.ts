// src/services/satellite-tracker.ts
import { getPersistentCache } from './persistent-cache';

export async function getOrbitalLayer() {
  const envelope = await getPersistentCache<any>('orbital:tle');
  return envelope?.data ?? [];
}