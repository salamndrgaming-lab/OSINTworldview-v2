#!/usr/bin/env node

// seed-narrative-drift.mjs — Reads from gdelt:raw:v1 cache (no direct GDELT calls)
// Requires seed-gdelt-raw.mjs to have run first in this seed cycle.

import { loadEnvFile, CHROME_UA, getRedisCredentials, runSeed, sleep } from './_seed-utils.mjs';
import { getGdeltTimelineVolumes } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:narrative-drift:v1';
const BASELINE_KEY  = 'intelligence:narrative-drift:baseline:v1';
const CACHE_TTL     = 7200;
const BASELINE_TTL  = 93600;

// ---------- Redis Helpers ----------

async function redisGet(url, token, key) {
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return null; }
}

async function redisSet(url, token, key, value, ttl) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', String(ttl)]),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Redis SET failed: ${resp.status}`);
}

// ---------- Volume extraction from cached timelinevol data ----------

function extractVolume(timelineData) {
  // timelinevol response shape: { timeline: [{ data: [{ date, value }] }] }
  const timeline = timelineData?.timeline?.[0]?.data || timelineData?.timeline || [];
  if (!Array.isArray(timeline) || timeline.length === 0) return { totalVolume: 0, recentVolume: 0, dataPoints: 0 };

  const totalVolume  = timeline.reduce((sum, pt) => sum + (Number(pt.value) || 0), 0);
  const recentVolume = timeline.slice(-3).reduce((sum, pt) => sum + (Number(pt.value) || 0), 0);
  return { totalVolume, recentVolume, dataPoints: timeline.length };
}

// ---------- Drift Calculation ----------

function computeDrift(current, baseline) {
  if (!baseline || baseline.totalVolume === 0) {
    return { driftRatio: 1.0, driftScore: 0, direction: 'stable' };
  }
  const ratio = current.totalVolume / baseline.totalVolume;
  const driftScore = Math.round((ratio - 1) * 100);
  let direction;
  if (ratio >= 2.0)      direction = 'surging';
  else if (ratio >= 1.5) direction = 'rising';
  else if (ratio <= 0.4) direction = 'collapsed';
  else if (ratio <= 0.65) direction = 'fading';
  else                   direction = 'stable';
  return { driftRatio: Math.round(ratio * 100) / 100, driftScore, direction };
}

// ---------- Main ----------

async function fetchNarrativeDrift() {
  const { url, token } = getRedisCredentials();

  // Load baseline from previous run
  const baseline = await redisGet(url, token, BASELINE_KEY);
  const baselineMap = {};
  if (baseline && Array.isArray(baseline.themes)) {
    for (const t of baseline.themes) baselineMap[t.id] = t;
  }
  const hasBaseline = Object.keys(baselineMap).length > 0;
  console.log(`[info] Baseline: ${hasBaseline ? Object.keys(baselineMap).length + ' themes' : 'none (first run)'}`);

  // Read volumes from GDELT raw cache — zero network calls to GDELT
  const cachedVolumes = await getGdeltTimelineVolumes();
  console.log(`[info] Loaded ${cachedVolumes.length} theme volumes from gdelt:raw:v1`);

  const currentThemes = cachedVolumes.map(({ id, timeline }) => {
    const vol = extractVolume(timeline);
    return { id, ...vol };
  });

  const validThemes = currentThemes.filter(t => t.dataPoints > 0);
  if (validThemes.length === 0) {
    console.error('[error] No timeline data in GDELT cache — preserving existing Redis value');
    return null;
  }
  console.log(`[info] ${validThemes.length}/${currentThemes.length} themes have data`);

  // Compute drift
  const driftResults = currentThemes.map(current => {
    const base = baselineMap[current.id];
    const drift = computeDrift(current, base);
    return {
      id: current.id,
      totalVolume: current.totalVolume,
      recentVolume: current.recentVolume,
      baselineVolume: base?.totalVolume ?? null,
      ...drift,
      hasBaseline: !!base,
    };
  });

  const directionOrder = { surging: 0, rising: 1, stable: 2, fading: 3, collapsed: 4 };
  driftResults.sort((a, b) => {
    const ao = directionOrder[a.direction] ?? 2;
    const bo = directionOrder[b.direction] ?? 2;
    if (ao !== bo) return ao - bo;
    return b.driftScore - a.driftScore;
  });

  const overallDriftIndex = validThemes.length > 0
    ? Math.round(
        driftResults.filter(t => t.hasBaseline)
          .reduce((sum, t) => sum + Math.abs(t.driftScore), 0) /
        Math.max(driftResults.filter(t => t.hasBaseline).length, 1)
      )
    : 0;

  // Save current readings as next run's baseline
  const newBaseline = { themes: currentThemes, recordedAt: new Date().toISOString() };
  try {
    await redisSet(url, token, BASELINE_KEY, newBaseline, BASELINE_TTL);
    console.log('[info] Baseline updated for next run');
  } catch (err) {
    console.warn(`[warn] Failed to update baseline: ${err.message}`);
  }

  return {
    themes: driftResults,
    overallDriftIndex,
    hasBaseline,
    themeCount: validThemes.length,
    generatedAt: new Date().toISOString(),
    version: 1,
  };
}

function validate(data) {
  return Array.isArray(data?.themes) && data.themes.length >= 1;
}

runSeed('intelligence', 'narrative-drift', CANONICAL_KEY, fetchNarrativeDrift, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'gdelt-raw-cache-v1',
  recordCount: (data) => data?.themes?.length ?? 0,
}).catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
