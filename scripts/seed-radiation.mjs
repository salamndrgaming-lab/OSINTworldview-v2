#!/usr/bin/env node

// seed-radiation.mjs — Fetches real-time radiation measurements from the Safecast
// citizen sensor network. Returns CPM/µSv/h readings from sensors worldwide.
// Highlights anomalies (readings >3x local average baseline).

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const SAFECAST_API = 'https://api.safecast.org/measurements.json';
const CANONICAL_KEY = 'environment:radiation:v1';
const CACHE_TTL = 7200; // 2h

// Approximate global average background radiation in CPM (counts per minute).
// Most areas read 20-60 CPM. We flag anything >3x the global average as anomalous.
const GLOBAL_AVG_CPM = 35;
const ANOMALY_THRESHOLD_MULTIPLIER = 3;

// ---------- Main Fetch ----------

async function fetchRadiationData() {
  // Safecast API returns recent measurements. We fetch the latest 2000 readings
  // (API supports pagination via page parameter).
  const allReadings = [];

  for (let page = 1; page <= 4; page++) {
    const url = `${SAFECAST_API}?order=captured_at+desc&per_page=500&page=${page}`;
    console.log(`  Fetching page ${page}...`);

    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': CHROME_UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!resp.ok) {
        console.warn(`  Page ${page}: HTTP ${resp.status}`);
        break;
      }

      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) break;

      allReadings.push(...data);
      console.log(`    Page ${page}: ${data.length} readings`);
    } catch (err) {
      console.warn(`  Page ${page} failed: ${err.message}`);
      break;
    }
  }

  console.log(`  Total raw readings: ${allReadings.length}`);

  // Filter: must have lat, lon, and a value
  const valid = allReadings.filter(r =>
    r.latitude != null && r.longitude != null &&
    r.value != null && r.value >= 0 &&
    Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180
  );

  console.log(`  Valid readings: ${valid.length}`);

  // Convert to our format, flagging anomalies
  const readings = valid.map(r => {
    const cpm = typeof r.value === 'number' ? r.value : 0;
    // CPM to µSv/h approximate conversion (depends on tube type, ~0.0057 for SBM-20)
    const usvh = Math.round(cpm * 0.0057 * 1000) / 1000;
    const isAnomaly = cpm > GLOBAL_AVG_CPM * ANOMALY_THRESHOLD_MULTIPLIER;

    return {
      id: r.id || `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      latitude: r.latitude,
      longitude: r.longitude,
      cpm: Math.round(cpm * 10) / 10,
      usvh,
      isAnomaly,
      capturedAt: r.captured_at || null,
      deviceId: r.device_id || null,
      unit: r.unit || 'cpm',
    };
  });

  // Sort anomalies first, then by CPM descending
  readings.sort((a, b) => {
    if (a.isAnomaly && !b.isAnomaly) return -1;
    if (!a.isAnomaly && b.isAnomaly) return 1;
    return b.cpm - a.cpm;
  });

  // Count anomalies
  const anomalyCount = readings.filter(r => r.isAnomaly).length;
  console.log(`  Anomalies (>${GLOBAL_AVG_CPM * ANOMALY_THRESHOLD_MULTIPLIER} CPM): ${anomalyCount}`);

  return {
    readings: readings.slice(0, 1500), // Cap at 1500 for Redis payload size
    anomalyCount,
    globalAvgCpm: GLOBAL_AVG_CPM,
    anomalyThreshold: GLOBAL_AVG_CPM * ANOMALY_THRESHOLD_MULTIPLIER,
    fetchedAt: Date.now(),
  };
}

function validate(data) {
  return Array.isArray(data?.readings) && data.readings.length >= 10;
}

runSeed('environment', 'radiation', CANONICAL_KEY, fetchRadiationData, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'safecast-v1',
  recordCount: (data) => data?.readings?.length ?? 0,
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
