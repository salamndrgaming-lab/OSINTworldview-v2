#!/usr/bin/env node

// seed-alerts.mjs — Anomaly detection pipeline that reads from multiple Redis
// intelligence keys, detects significant events (spikes, new critical items,
// radiation anomalies), and pushes alert objects to a Redis list.
// The client polls /api/alerts every 30s for near-real-time notifications.

import { loadEnvFile, CHROME_UA, getRedisCredentials } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const ALERTS_KEY = 'alerts:stream:v1';
const MAX_ALERTS = 50;       // Keep last 50 alerts in the list
const ALERT_TTL = 86400;     // 24h TTL on the alerts key
const DEDUP_KEY = 'alerts:seen:v1';
const DEDUP_TTL = 43200;     // 12h dedup window

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

async function redisCommand(url, token, args) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) throw new Error(`Redis command failed: ${resp.status}`);
  return resp.json();
}

async function pushAlerts(url, token, alerts) {
  if (alerts.length === 0) return;

  // LPUSH each alert as JSON string
  for (const alert of alerts) {
    await redisCommand(url, token, ['LPUSH', ALERTS_KEY, JSON.stringify(alert)]);
  }

  // Trim to MAX_ALERTS
  await redisCommand(url, token, ['LTRIM', ALERTS_KEY, '0', String(MAX_ALERTS - 1)]);

  // Set TTL
  await redisCommand(url, token, ['EXPIRE', ALERTS_KEY, String(ALERT_TTL)]);
}

async function getSeenIds(url, token) {
  const data = await redisGet(url, token, DEDUP_KEY);
  return new Set(Array.isArray(data) ? data : []);
}

async function saveSeenIds(url, token, ids) {
  const arr = [...ids].slice(-200); // Keep last 200 IDs
  await redisCommand(url, token, ['SET', DEDUP_KEY, JSON.stringify(arr), 'EX', String(DEDUP_TTL)]);
}

// ---------- Alert Generators ----------

function createAlert(type, severity, title, details, source) {
  return {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,       // 'missile' | 'conflict' | 'disease' | 'radiation' | 'unrest' | 'quake'
    severity,   // 'critical' | 'high' | 'medium'
    title,
    details,
    source,
    timestamp: Date.now(),
  };
}

// Check for new critical/high severity missile strikes in the last 6 hours
function checkMissileAlerts(data, seenIds) {
  const alerts = [];
  if (!data?.events) return alerts;

  const sixHoursAgo = Date.now() - 6 * 3600_000;
  const recent = data.events.filter(e => e.timestamp >= sixHoursAgo);
  const critical = recent.filter(e => e.severity === 'critical' || e.severity === 'high');

  for (const e of critical) {
    const dedupKey = `missile:${e.locationName}:${Math.floor(e.timestamp / 3600_000)}`;
    if (seenIds.has(dedupKey)) continue;
    seenIds.add(dedupKey);

    alerts.push(createAlert(
      'missile',
      e.severity,
      `${e.eventType === 'drone' ? '🛩️ Drone' : e.eventType === 'airstrike' ? '💣 Air' : '🚀 Missile'} strike — ${e.locationName}`,
      e.title?.slice(0, 150) || '',
      'GDELT',
    ));
  }

  // Also alert if there's a volume spike (>10 events in 6 hours)
  if (recent.length > 10) {
    const dedupKey = `missile:spike:${Math.floor(Date.now() / 3600_000)}`;
    if (!seenIds.has(dedupKey)) {
      seenIds.add(dedupKey);
      alerts.push(createAlert(
        'missile',
        'high',
        `🚀 Strike surge: ${recent.length} events in 6 hours`,
        `${critical.length} critical/high severity across multiple locations`,
        'GDELT',
      ));
    }
  }

  return alerts;
}

// Check for extreme conflict forecast jumps
function checkConflictAlerts(data, seenIds) {
  const alerts = [];
  if (!data?.forecasts) return alerts;

  // Alert on countries with very high predicted fatalities (log > 5 = ~150+ predicted deaths/month)
  const extreme = data.forecasts.filter(f => f.predictedLogFatalities > 5);
  for (const f of extreme) {
    const dedupKey = `conflict:${f.countryCode}:${f.monthId || 'latest'}`;
    if (seenIds.has(dedupKey)) continue;
    seenIds.add(dedupKey);

    alerts.push(createAlert(
      'conflict',
      'high',
      `📊 Extreme conflict forecast — ${f.countryName || f.countryCode}`,
      `Predicted ~${f.estimatedFatalities} fatalities/month (VIEWS model)`,
      'VIEWS',
    ));
  }

  return alerts;
}

// Check for critical disease outbreaks (hemorrhagic or high severity)
function checkDiseaseAlerts(data, seenIds) {
  const alerts = [];
  if (!data?.events) return alerts;

  const thirtyDaysAgo = Date.now() - 30 * 86400_000;
  const recent = data.events.filter(e => e.timestamp >= thirtyDaysAgo);
  const critical = recent.filter(e => e.severity === 'critical' || e.diseaseType === 'hemorrhagic');

  for (const e of critical) {
    const dedupKey = `disease:${e.country}:${e.diseaseType}`;
    if (seenIds.has(dedupKey)) continue;
    seenIds.add(dedupKey);

    const icon = e.diseaseType === 'hemorrhagic' ? '🩸' : '🦠';
    alerts.push(createAlert(
      'disease',
      'critical',
      `${icon} ${e.diseaseType.toUpperCase()} outbreak — ${e.country}`,
      e.title?.slice(0, 150) || '',
      'WHO-DON',
    ));
  }

  return alerts;
}

// Check for radiation anomalies
function checkRadiationAlerts(data, seenIds) {
  const alerts = [];
  if (!data?.readings) return alerts;

  const anomalies = data.readings.filter(r => r.isAnomaly);
  if (anomalies.length === 0) return alerts;

  // Group anomalies by rough region (1° grid)
  const regions = new Map();
  for (const a of anomalies) {
    const regionKey = `${Math.round(a.latitude)}:${Math.round(a.longitude)}`;
    if (!regions.has(regionKey)) regions.set(regionKey, []);
    regions.get(regionKey).push(a);
  }

  for (const [regionKey, readings] of regions) {
    const dedupKey = `radiation:${regionKey}`;
    if (seenIds.has(dedupKey)) continue;
    seenIds.add(dedupKey);

    const maxCpm = Math.max(...readings.map(r => r.cpm));
    alerts.push(createAlert(
      'radiation',
      maxCpm > 300 ? 'critical' : 'high',
      `☢️ Radiation anomaly — ${maxCpm.toFixed(0)} CPM (${readings.length} sensors)`,
      `${readings.length} elevated readings in region [${regionKey}]. Threshold: ${data.anomalyThreshold} CPM`,
      'Safecast',
    ));
  }

  return alerts;
}

// Check for significant earthquakes
function checkQuakeAlerts(data, seenIds) {
  const alerts = [];
  if (!data?.earthquakes) return alerts;

  const oneHourAgo = Date.now() - 3600_000;
  const significant = data.earthquakes.filter(q =>
    q.magnitude >= 5.5 && q.timestamp >= oneHourAgo
  );

  for (const q of significant) {
    const dedupKey = `quake:${q.id || Math.round(q.latitude)}:${Math.round(q.longitude)}`;
    if (seenIds.has(dedupKey)) continue;
    seenIds.add(dedupKey);

    alerts.push(createAlert(
      'quake',
      q.magnitude >= 7.0 ? 'critical' : q.magnitude >= 6.0 ? 'high' : 'medium',
      `🌍 M${q.magnitude.toFixed(1)} earthquake — ${q.place || 'Unknown location'}`,
      `Depth: ${q.depth || '?'}km`,
      'USGS',
    ));
  }

  return alerts;
}

// ---------- Main ----------

async function main() {
  const { url, token } = getRedisCredentials();
  console.log('=== Alert Stream Seed ===');

  // Read all data sources
  const [missiles, conflicts, diseases, radiation, quakes] = await Promise.all([
    redisGet(url, token, 'intelligence:missile-events:v1'),
    redisGet(url, token, 'forecast:conflict:v1'),
    redisGet(url, token, 'health:outbreaks:v1'),
    redisGet(url, token, 'environment:radiation:v1'),
    redisGet(url, token, 'natural:earthquakes:v1'),
  ]);

  console.log(`  Data sources loaded:`);
  console.log(`    Missiles: ${missiles?.events?.length ?? 0} events`);
  console.log(`    Conflicts: ${conflicts?.forecasts?.length ?? 0} forecasts`);
  console.log(`    Diseases: ${diseases?.events?.length ?? 0} outbreaks`);
  console.log(`    Radiation: ${radiation?.readings?.length ?? 0} readings`);
  console.log(`    Quakes: ${quakes?.earthquakes?.length ?? 0} earthquakes`);

  // Load dedup set
  const seenIds = await getSeenIds(url, token);
  console.log(`  Previously seen alert IDs: ${seenIds.size}`);

  // Generate alerts from each source
  const allAlerts = [
    ...checkMissileAlerts(missiles, seenIds),
    ...checkConflictAlerts(conflicts, seenIds),
    ...checkDiseaseAlerts(diseases, seenIds),
    ...checkRadiationAlerts(radiation, seenIds),
    ...checkQuakeAlerts(quakes, seenIds),
  ];

  // Sort by severity then recency
  const sevOrder = { critical: 0, high: 1, medium: 2 };
  allAlerts.sort((a, b) => {
    const sd = (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
    return sd !== 0 ? sd : b.timestamp - a.timestamp;
  });

  console.log(`  New alerts generated: ${allAlerts.length}`);

  if (allAlerts.length > 0) {
    await pushAlerts(url, token, allAlerts);
    console.log(`  Pushed ${allAlerts.length} alerts to ${ALERTS_KEY}`);
  }

  // Save dedup state
  await saveSeenIds(url, token, seenIds);

  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0); // Soft fail — don't block other seeds
});
