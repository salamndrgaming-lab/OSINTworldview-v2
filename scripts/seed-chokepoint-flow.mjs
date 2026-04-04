#!/usr/bin/env node
/**
 * seed-chokepoint-flow.mjs — Chokepoint flow aggregator
 *
 * Reads raw chokepoint transit data from supply_chain:chokepoints:v4 (populated
 * by seed-supply-chain-trade or the upstream koala seed). If that key is empty,
 * synthesises sensible defaults so the ChokepointFlowPanel always has data.
 *
 * Writes: chokepoint:flow:v1 (consumed by /api/supply-chain/chokepoints proxy)
 *
 * NOTE: The ChokepointFlowPanel fetches /api/supply-chain/chokepoints which
 * reads supply_chain:chokepoints:v4. This seed enriches/copies that data so
 * both keys stay populated. If supply_chain:chokepoints:v4 is already fresh
 * from its own seed, this is a no-op enrichment pass.
 */
import { loadEnvFile, getRedisCredentials, writeExtraKey, withRetry, verifySeedKey } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'supply_chain:chokepoints:v4';
const FLOW_KEY      = 'chokepoint:flow:v1';
const TTL           = 3600; // 1h

const DEFAULT_CHOKEPOINTS = [
  { id: 'malacca',   name: 'Strait of Malacca',  lat: 2.5,   lng: 101.0, avgDailyTransits: 84,  tankerPct: 0.38 },
  { id: 'suez',      name: 'Suez Canal',          lat: 30.45, lng: 32.35, avgDailyTransits: 52,  tankerPct: 0.25 },
  { id: 'hormuz',    name: 'Strait of Hormuz',    lat: 26.57, lng: 56.25, avgDailyTransits: 68,  tankerPct: 0.55 },
  { id: 'bab',       name: 'Bab el-Mandeb',       lat: 12.58, lng: 43.33, avgDailyTransits: 36,  tankerPct: 0.30 },
  { id: 'gibraltar',  name: 'Strait of Gibraltar', lat: 35.97, lng: -5.50, avgDailyTransits: 44,  tankerPct: 0.20 },
  { id: 'panama',    name: 'Panama Canal',         lat: 9.08,  lng: -79.68, avgDailyTransits: 38, tankerPct: 0.15 },
  { id: 'dover',     name: 'Strait of Dover',      lat: 51.05, lng: 1.45, avgDailyTransits: 120, tankerPct: 0.10 },
  { id: 'tsugaru',   name: 'Tsugaru Strait',       lat: 41.55, lng: 140.58, avgDailyTransits: 28, tankerPct: 0.12 },
];

async function seedChokepointFlow() {
  const { url, token } = getRedisCredentials();

  // Try reading existing chokepoint data from the canonical key
  let existing = null;
  try {
    existing = await verifySeedKey(CANONICAL_KEY);
  } catch {
    // Key doesn't exist yet — use defaults
  }

  const now = new Date().toISOString();

  let chokepoints;

  if (existing && Array.isArray(existing.chokepoints) && existing.chokepoints.length > 0) {
    // Use real data from upstream seed
    chokepoints = existing.chokepoints.map(cp => ({
      id:             cp.id || cp.name?.toLowerCase().replace(/\s+/g, '-') || 'unknown',
      name:           cp.name || cp.id || 'Unknown',
      lat:            cp.lat ?? cp.latitude ?? 0,
      lng:            cp.lng ?? cp.longitude ?? 0,
      vessels24h:     cp.vessels24h ?? cp.transits ?? cp.avgDailyTransits ?? 0,
      tankerRatio:    cp.tankerRatio ?? cp.tankerPct ?? 0,
      riskScore:      cp.riskScore ?? cp.risk ?? 0,
      trend:          cp.trend ?? 'stable',
      lastUpdated:    cp.lastUpdated ?? now,
    }));
    console.log(`  Read ${chokepoints.length} chokepoints from ${CANONICAL_KEY}`);
  } else {
    // Use defaults when upstream seed hasn't run yet
    chokepoints = DEFAULT_CHOKEPOINTS.map(cp => ({
      id:          cp.id,
      name:        cp.name,
      lat:         cp.lat,
      lng:         cp.lng,
      vessels24h:  cp.avgDailyTransits,
      tankerRatio: cp.tankerPct,
      riskScore:   0,
      trend:       'stable',
      lastUpdated: now,
    }));
    console.log(`  No upstream data — using ${chokepoints.length} defaults`);
  }

  const payload = {
    chokepoints,
    count:     chokepoints.length,
    fetchedAt: now,
    source:    existing ? 'upstream-seed' : 'defaults',
  };

  // Write to the flow key (for any future consumers)
  await withRetry(() => writeExtraKey(FLOW_KEY, payload, TTL));

  // Also ensure the canonical key exists (if upstream seed hasn't run,
  // this gives the API something to return)
  if (!existing) {
    await withRetry(() => writeExtraKey(CANONICAL_KEY, payload, TTL));
    console.log(`  Also wrote defaults to ${CANONICAL_KEY}`);
  }

  console.log(`✅ Chokepoint flow seeded (${chokepoints.length} chokepoints)`);
}

seedChokepointFlow().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0); // Non-fatal — don't break the workflow
});
