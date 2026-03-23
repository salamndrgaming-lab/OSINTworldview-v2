#!/usr/bin/env node

// seed-snapshot.mjs — Daily data archival for the time-machine feature.
// Takes a compressed snapshot of key Redis intelligence data and stores it
// at snapshots:{YYYY-MM-DD} with a 30-day TTL. The /api/snapshot endpoint
// can retrieve any stored date's snapshot for historical browsing.
//
// This script is designed to run once per day (add to a daily cron or run
// manually). It reads from the same Redis keys the sitrep uses and archives
// the data in a single key for efficient retrieval.

import { loadEnvFile, getRedisCredentials } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const SNAPSHOT_TTL = 30 * 86400; // 30 days
const SNAPSHOT_PREFIX = 'snapshots:';

// The keys we archive — these represent the core intelligence state
const ARCHIVE_KEYS = {
  missiles:        'intelligence:missile-events:v1',
  gdeltIntel:      'intelligence:gdelt-intel:v1',
  poi:             'intelligence:poi:v1',
  conflictForecast:'forecast:conflict:v1',
  diseaseOutbreaks:'health:outbreaks:v1',
  radiation:       'environment:radiation:v1',
  unrest:          'unrest:events:v1',
  earthquakes:     'seismology:earthquakes:v1',
  cyberThreats:    'cyber:threats:v2',
  marketQuotes:    'market:stocks-bootstrap:v1',
  commodityQuotes: 'market:commodities-bootstrap:v1',
  predictions:     'prediction:markets-bootstrap:v1',
  iranEvents:      'conflict:iran-events:v1',
  naturalEvents:   'natural:events:v1',
  weatherAlerts:   'weather:alerts:v1',
  outages:         'infra:outages:v1',
  agentSitrep:     'intelligence:agent-sitrep:v1',
  insights:        'news:insights:v1',
};

// ---------- Redis Helpers ----------

async function redisPipeline(url, token, commands) {
  const resp = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Redis pipeline failed: ${resp.status}`);
  return resp.json();
}

async function redisSet(url, token, key, value, ttl) {
  const args = ['SET', key, JSON.stringify(value), 'EX', String(ttl)];
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Redis SET failed: ${resp.status}`);
}

// ---------- Data Summarization ----------
// We don't store raw data verbatim — we summarize to keep snapshot size manageable.
// Target: <500KB per snapshot.

function summarizeData(key, data) {
  if (!data) return null;

  // Missile events: keep top 20 by severity + stats
  if (key === 'missiles' && data.events) {
    return {
      eventCount: data.events.length,
      events: data.events.slice(0, 20).map(e => ({
        title: e.title?.slice(0, 150), locationName: e.locationName,
        eventType: e.eventType, severity: e.severity, timestamp: e.timestamp,
      })),
      fetchedAt: data.fetchedAt,
    };
  }

  // GDELT intel: keep topic IDs + article count + top 2 headlines per topic
  if (key === 'gdeltIntel' && data.topics) {
    return {
      topics: data.topics.map(t => ({
        id: t.id,
        articleCount: t.articles?.length || 0,
        topHeadlines: (t.articles || []).slice(0, 2).map(a => a.title?.slice(0, 100)),
        fetchedAt: t.fetchedAt,
      })),
    };
  }

  // POI: keep name, role, risk, region only
  if (key === 'poi' && data.persons) {
    return {
      personCount: data.persons.length,
      persons: data.persons.slice(0, 25).map(p => ({
        name: p.name, role: p.role, riskLevel: p.riskLevel,
        region: p.region, activityScore: p.activityScore,
      })),
    };
  }

  // Conflict forecast: keep top 20 by risk
  if (key === 'conflictForecast' && data.forecasts) {
    return {
      model: data.model,
      forecastCount: data.forecasts.length,
      forecasts: data.forecasts.slice(0, 20).map(f => ({
        countryCode: f.countryCode, countryName: f.countryName,
        predictedLogFatalities: f.predictedLogFatalities,
        estimatedFatalities: f.estimatedFatalities,
      })),
      fetchedAt: data.fetchedAt,
    };
  }

  // Disease outbreaks: keep all (usually <30)
  if (key === 'diseaseOutbreaks' && data.events) {
    return {
      eventCount: data.events.length,
      events: data.events.slice(0, 20).map(e => ({
        title: e.title?.slice(0, 150), country: e.country,
        diseaseType: e.diseaseType, severity: e.severity, timestamp: e.timestamp,
      })),
    };
  }

  // Radiation: stats only (no individual readings — too large)
  if (key === 'radiation' && data.readings) {
    const anomalies = data.readings.filter(r => r.isAnomaly);
    return {
      readingCount: data.readings.length,
      anomalyCount: anomalies.length,
      anomalyThreshold: data.anomalyThreshold,
      maxCpm: anomalies.length > 0 ? Math.max(...anomalies.map(r => r.cpm)) : null,
      fetchedAt: data.fetchedAt,
    };
  }

  // Market quotes: keep top 10 movers
  if (key === 'marketQuotes' || key === 'commodityQuotes') {
    const items = Array.isArray(data) ? data : (data.quotes || data.results || []);
    const movers = items.filter(q => q.changePercent != null)
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 10);
    return { count: items.length, topMovers: movers.map(q => ({ symbol: q.symbol, price: q.price, changePercent: q.changePercent })) };
  }

  // Agent sitrep: keep as-is (already structured and reasonably sized)
  if (key === 'agentSitrep') {
    return {
      executive_summary: data.executive_summary?.slice(0, 500),
      overall_threat_level: data.overall_threat_level,
      sectionCount: data.sections?.length || 0,
      sectionTitles: (data.sections || []).map(s => s.title),
      watch_list: data.watch_list,
      generated_at: data.generated_at,
    };
  }

  // Earthquakes: significant ones only
  if (key === 'earthquakes') {
    const quakes = Array.isArray(data) ? data : (data.earthquakes || []);
    return {
      total: quakes.length,
      significant: quakes.filter(q => (q.magnitude || q.mag || 0) >= 4.5).slice(0, 10).map(q => ({
        magnitude: q.magnitude || q.mag, place: q.place, timestamp: q.occurredAt || q.timestamp,
      })),
    };
  }

  // Default: truncate to prevent oversized snapshots
  const str = JSON.stringify(data);
  if (str.length > 50000) {
    return { _truncated: true, _originalSize: str.length };
  }
  return data;
}

// ---------- Main ----------

async function main() {
  const { url, token } = getRedisCredentials();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const snapshotKey = `${SNAPSHOT_PREFIX}${today}`;

  console.log('=== Daily Snapshot Seed ===');
  console.log(`  Date: ${today}`);
  console.log(`  Key: ${snapshotKey}`);
  console.log(`  TTL: ${SNAPSHOT_TTL / 86400} days`);

  // Read all archive keys via pipeline
  const names = Object.keys(ARCHIVE_KEYS);
  const keys = Object.values(ARCHIVE_KEYS);
  const pipeline = keys.map(k => ['GET', k]);

  let results;
  try {
    results = await redisPipeline(url, token, pipeline);
  } catch (err) {
    console.error(`  Pipeline failed: ${err.message}`);
    process.exit(0);
  }

  // Parse and summarize each data source
  const snapshot = {
    date: today,
    createdAt: Date.now(),
    sources: {},
  };

  let sourceCount = 0;
  for (let i = 0; i < names.length; i++) {
    const raw = results[i]?.result || null;
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const summarized = summarizeData(names[i], parsed);
      if (summarized) {
        snapshot.sources[names[i]] = summarized;
        sourceCount++;
      }
    } catch { /* skip unparseable */ }
  }

  console.log(`  Sources archived: ${sourceCount}/${names.length}`);

  // Check snapshot size
  const snapshotJson = JSON.stringify(snapshot);
  const sizeKb = Math.round(snapshotJson.length / 1024);
  console.log(`  Snapshot size: ${sizeKb}KB`);

  if (sizeKb > 4000) {
    console.warn(`  WARNING: Snapshot exceeds 4MB — Redis may reject it`);
  }

  // Write snapshot to Redis
  try {
    await redisSet(url, token, snapshotKey, snapshot, SNAPSHOT_TTL);
    console.log(`  Written to ${snapshotKey}`);
  } catch (err) {
    console.error(`  Write failed: ${err.message}`);
    process.exit(0);
  }

  // Also maintain a list of available snapshot dates
  try {
    const indexKey = `${SNAPSHOT_PREFIX}index`;
    // Read current index
    const idxResp = await fetch(`${url}/get/${encodeURIComponent(indexKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    let dates = [];
    if (idxResp.ok) {
      const idxData = await idxResp.json();
      if (idxData.result) {
        try { dates = JSON.parse(idxData.result); } catch { dates = []; }
      }
    }

    // Add today if not present, keep last 30
    if (!dates.includes(today)) dates.push(today);
    dates.sort().reverse();
    dates = dates.slice(0, 30);

    await redisSet(url, token, indexKey, dates, SNAPSHOT_TTL);
    console.log(`  Index updated: ${dates.length} dates available`);
  } catch (err) {
    console.warn(`  Index update failed: ${err.message}`);
  }

  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
