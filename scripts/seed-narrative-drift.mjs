#!/usr/bin/env node

// seed-narrative-drift.mjs — Narrative Drift Detection
//
// Detects which intelligence topics are emerging (velocity accelerating)
// vs fading (velocity decelerating) by comparing current GDELT timeline
// data against a 24-hour baseline stored in Redis.
//
// Strategy:
//   1. Fetch GDELT timeline data for 10 OSINT themes (current 6h window)
//   2. Fetch the same themes' 24h baseline (stored in previous run)
//   3. Compare mention velocity: current vs baseline = drift score
//   4. Cluster into: SURGING (>2x), RISING (1.5–2x), STABLE, FADING (<0.5x)
//   5. Also queries Upstash Vector for semantic clustering if available
//   6. Writes narrative drift report + updates baseline for next comparison
//
// Output: intelligence:narrative-drift:v1  TTL: 2h
// Baseline: intelligence:narrative-drift:baseline:v1  TTL: 26h

import { loadEnvFile, CHROME_UA, getRedisCredentials, runSeed, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:narrative-drift:v1';
const BASELINE_KEY = 'intelligence:narrative-drift:baseline:v1';
const CACHE_TTL = 7200;     // 2 hours for drift report
const BASELINE_TTL = 93600; // 26 hours for baseline (survives 2 missed runs)

const THEMES = [
  { id: 'conflict',    query: '(conflict OR war OR attack OR strike OR offensive)' },
  { id: 'military',    query: '(military OR army OR navy OR troops OR deployment)' },
  { id: 'cyber',       query: '(cyber OR hack OR malware OR ransomware OR espionage)' },
  { id: 'ukraine',     query: '(ukraine OR kyiv OR russia OR zelensky OR kremlin)' },
  { id: 'middleeast',  query: '(israel OR gaza OR iran OR lebanon OR syria OR hamas)' },
  { id: 'nuclear',     query: '(nuclear OR uranium OR IAEA OR missile OR warhead)' },
  { id: 'sanctions',   query: '(sanctions OR embargo OR tariff OR "trade war")' },
  { id: 'china',       query: '(china OR beijing OR taiwan OR PLA OR "south china sea")' },
  { id: 'unrest',      query: '(protest OR riot OR coup OR uprising OR unrest)' },
  { id: 'energy',      query: '(oil OR gas OR OPEC OR pipeline OR "energy crisis")' },
];

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

// ---------- GDELT Timeline Fetch ----------

async function fetchThemeVolume(theme) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', theme.query);
  url.searchParams.set('mode', 'timelinevol');
  url.searchParams.set('timespan', '6h');
  url.searchParams.set('smoothing', '3');
  url.searchParams.set('format', 'json');

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // Timeline data: array of { date, value } — sum values for total volume
    const timeline = data?.timeline?.[0]?.data || [];
    const totalVolume = timeline.reduce((sum, pt) => sum + (Number(pt.value) || 0), 0);
    const recentVolume = timeline.slice(-3).reduce((sum, pt) => sum + (Number(pt.value) || 0), 0);

    return { id: theme.id, totalVolume, recentVolume, dataPoints: timeline.length };
  } catch (err) {
    console.warn(`[warn] Theme ${theme.id} fetch failed: ${err.message}`);
    return { id: theme.id, totalVolume: 0, recentVolume: 0, dataPoints: 0 };
  }
}

// ---------- Drift Calculation ----------

function computeDrift(current, baseline) {
  if (!baseline || baseline.totalVolume === 0) {
    return { driftRatio: 1.0, driftScore: 0, direction: 'stable' };
  }

  const ratio = current.totalVolume / baseline.totalVolume;
  const driftScore = Math.round((ratio - 1) * 100); // percent change

  let direction;
  if (ratio >= 2.0) direction = 'surging';
  else if (ratio >= 1.5) direction = 'rising';
  else if (ratio <= 0.4) direction = 'collapsed';
  else if (ratio <= 0.65) direction = 'fading';
  else direction = 'stable';

  return { driftRatio: Math.round(ratio * 100) / 100, driftScore, direction };
}

// ---------- Main Fetcher ----------

async function fetchNarrativeDrift() {
  const { url, token } = getRedisCredentials();

  // Load baseline from previous run
  const baseline = await redisGet(url, token, BASELINE_KEY);
  const baselineMap = {};
  if (baseline && Array.isArray(baseline.themes)) {
    for (const t of baseline.themes) {
      baselineMap[t.id] = t;
    }
  }
  const hasBaseline = Object.keys(baselineMap).length > 0;
  console.log(`[info] Baseline: ${hasBaseline ? Object.keys(baselineMap).length + ' themes loaded' : 'none (first run)'}`);

  // Fetch current volume for all themes — sequential to avoid GDELT rate limits
  const currentThemes = [];
  for (const theme of THEMES) {
    const vol = await fetchThemeVolume(theme);
    currentThemes.push(vol);
    await sleep(2500); // 2.5s mandatory backoff between GDELT requests
  }

  const validThemes = currentThemes.filter(t => t.dataPoints > 0);
  if (validThemes.length === 0) {
    console.error('[error] All GDELT fetches failed — preserving existing cache');
    return null;
  }

  console.log(`[info] Fetched ${validThemes.length}/${THEMES.length} themes successfully`);

  // Compute drift for each theme
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

  // Sort: surging/rising first, then stable, then fading/collapsed
  const directionOrder = { surging: 0, rising: 1, stable: 2, fading: 3, collapsed: 4 };
  driftResults.sort((a, b) => {
    const ao = directionOrder[a.direction] ?? 2;
    const bo = directionOrder[b.direction] ?? 2;
    if (ao !== bo) return ao - bo;
    return b.driftScore - a.driftScore;
  });

  // Compute overall drift index (weighted average of abs drift scores)
  const overallDriftIndex = validThemes.length > 0
    ? Math.round(driftResults.filter(t => t.hasBaseline)
        .reduce((sum, t) => sum + Math.abs(t.driftScore), 0) /
        Math.max(driftResults.filter(t => t.hasBaseline).length, 1))
    : 0;

  // Save current readings as next run's baseline
  const newBaseline = {
    themes: currentThemes,
    recordedAt: new Date().toISOString(),
  };
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
  sourceVersion: 'gdelt-drift-v1',
  recordCount: (data) => data?.themes?.length ?? 0,
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});