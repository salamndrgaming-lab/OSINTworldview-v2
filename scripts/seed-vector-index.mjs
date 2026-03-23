#!/usr/bin/env node

// seed-vector-index.mjs — Indexes intelligence data from Redis into Upstash Vector
// for semantic search. Uses Upstash Vector's built-in embedding model, so we send
// raw text and it handles vectorization server-side. No external embedding API needed.
//
// Data sources indexed:
//   - GDELT intel headlines (6 topics × ~10 articles each)
//   - Missile/drone strike events (titles + locations)
//   - Disease outbreak alerts (WHO DON titles)
//   - Conflict forecasts (country risk summaries)
//   - POI summaries (person profiles)
//   - Agent SITREP sections (if available)
//   - Active alerts
//
// Each vector gets metadata (source, type, timestamp, severity, country/region)
// so queries can be filtered by category.

import { loadEnvFile, CHROME_UA, getRedisCredentials, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

// ---------- Config ----------

const VECTOR_URL = process.env.UPSTASH_VECTOR_REST_URL;
const VECTOR_TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN;
const BATCH_SIZE = 20; // Upstash Vector accepts batches; keep reasonable to avoid timeouts
const BATCH_DELAY_MS = 500; // Small delay between batches to be kind to the API

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

async function redisLRange(url, token, key, start, stop) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['LRANGE', key, String(start), String(stop)]),
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  if (!Array.isArray(data.result)) return [];
  return data.result.map(item => { try { return JSON.parse(item); } catch { return null; } }).filter(Boolean);
}

// ---------- Upstash Vector Helpers ----------

// Upsert raw text data — Upstash Vector embeds it server-side using the built-in model.
// Endpoint: POST {VECTOR_URL}/upsert-data
// Body: [{ id, data, metadata }] where "data" is the raw text to embed
async function vectorUpsertBatch(items) {
  const resp = await fetch(`${VECTOR_URL}/upsert-data`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VECTOR_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(items),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Vector upsert failed: ${resp.status} — ${errText.slice(0, 200)}`);
  }

  return resp.json();
}

// Get index info to verify connectivity
async function vectorInfo() {
  const resp = await fetch(`${VECTOR_URL}/info`, {
    headers: { Authorization: `Bearer ${VECTOR_TOKEN}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) return null;
  return resp.json();
}

// ---------- Data Extractors ----------
// Each extractor reads a Redis key and returns an array of { id, data, metadata }
// objects ready for Upstash Vector upsert.

function extractGdeltIntel(data) {
  if (!data?.topics) return [];
  const items = [];
  for (const topic of data.topics) {
    for (const article of (topic.articles || [])) {
      if (!article.title) continue;
      items.push({
        id: `gdelt:${topic.id}:${hashId(article.url || article.title)}`,
        data: `${article.title}. Source: ${article.source || 'unknown'}. Topic: ${topic.id}.`,
        metadata: {
          type: 'gdelt-intel',
          topic: topic.id,
          source: article.source || '',
          url: article.url || '',
          tone: article.tone || 0,
          timestamp: Date.now(),
        },
      });
    }
  }
  return items;
}

function extractMissileEvents(data) {
  if (!data?.events) return [];
  return data.events.slice(0, 50).map(e => ({
    id: `missile:${hashId(e.id || e.title)}`,
    data: `${e.eventType || 'strike'} event: ${e.title || ''}. Location: ${e.locationName || 'unknown'}. Severity: ${e.severity || 'unknown'}.`,
    metadata: {
      type: 'missile-strike',
      event_type: e.eventType || '',
      severity: e.severity || '',
      location: e.locationName || '',
      timestamp: e.timestamp || Date.now(),
    },
  }));
}

function extractDiseaseOutbreaks(data) {
  if (!data?.events) return [];
  return data.events.map(e => ({
    id: `disease:${hashId(e.id || e.title)}`,
    data: `Disease outbreak: ${e.title || ''}. Country: ${e.country || 'unknown'}. Disease type: ${e.diseaseType || 'unknown'}. Severity: ${e.severity || 'unknown'}.`,
    metadata: {
      type: 'disease-outbreak',
      disease_type: e.diseaseType || '',
      severity: e.severity || '',
      country: e.country || '',
      timestamp: e.timestamp || Date.now(),
    },
  }));
}

function extractConflictForecasts(data) {
  if (!data?.forecasts) return [];
  // Only index countries with meaningful risk (log fatalities > 0.5)
  return data.forecasts
    .filter(f => f.predictedLogFatalities > 0.5)
    .slice(0, 40)
    .map(f => {
      const risk = f.predictedLogFatalities > 5 ? 'extreme' : f.predictedLogFatalities > 3 ? 'high' : f.predictedLogFatalities > 1 ? 'elevated' : 'moderate';
      return {
        id: `forecast:${f.countryCode}:${f.monthId || 'latest'}`,
        data: `Conflict forecast for ${f.countryName || f.countryCode}: ${risk} risk. Estimated ${f.estimatedFatalities || 0} fatalities per month. VIEWS fatalities003 model prediction.`,
        metadata: {
          type: 'conflict-forecast',
          country: f.countryCode || '',
          country_name: f.countryName || '',
          risk_level: risk,
          estimated_fatalities: f.estimatedFatalities || 0,
          timestamp: data.fetchedAt || Date.now(),
        },
      };
    });
}

function extractPOI(data) {
  if (!data?.persons) return [];
  return data.persons.slice(0, 30).map(p => ({
    id: `poi:${hashId(p.name)}`,
    data: `Person of interest: ${p.name}. Role: ${p.role || 'unknown'}. Region: ${p.region || 'unknown'}. Risk level: ${p.riskLevel || 'unknown'}. ${p.summary || ''}`.slice(0, 500),
    metadata: {
      type: 'poi',
      name: p.name || '',
      role: p.role || '',
      region: p.region || '',
      risk_level: (p.riskLevel || '').toLowerCase(),
      activity_score: p.activityScore || 0,
      timestamp: Date.now(),
    },
  }));
}

function extractAgentSitrep(data) {
  if (!data?.sections) return [];
  const items = [];

  // Index the executive summary as one vector
  if (data.executive_summary) {
    items.push({
      id: `sitrep:summary:${data.generated_at || Date.now()}`,
      data: `Intelligence SITREP executive summary: ${data.executive_summary}`.slice(0, 800),
      metadata: {
        type: 'agent-sitrep',
        section: 'executive_summary',
        threat_level: data.overall_threat_level || 'unknown',
        timestamp: data.generated_at || Date.now(),
      },
    });
  }

  // Index each section
  for (const section of data.sections) {
    items.push({
      id: `sitrep:section:${hashId(section.title)}:${data.generated_at || Date.now()}`,
      data: `SITREP section — ${section.title}: ${section.content}`.slice(0, 800),
      metadata: {
        type: 'agent-sitrep',
        section: section.title || '',
        risk_level: section.risk_level || '',
        timestamp: data.generated_at || Date.now(),
      },
    });
  }

  return items;
}

function extractAlerts(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return [];
  return alerts.map(a => ({
    id: `alert:${a.id || hashId(a.title)}`,
    data: `Alert (${a.severity}): ${a.title}. ${a.details || ''}. Source: ${a.source || 'unknown'}.`,
    metadata: {
      type: 'alert',
      alert_type: a.type || '',
      severity: a.severity || '',
      source: a.source || '',
      timestamp: a.timestamp || Date.now(),
    },
  }));
}

function extractUnrest(data) {
  if (!data?.events && !data?.topics) return [];
  const events = data.events || (data.topics?.flatMap(t => t.events || []) || []);
  return events.slice(0, 30).map(e => {
    const loc = e.location?.name || e.country || 'unknown';
    const desc = e.description || e.title || '';
    return {
      id: `unrest:${hashId(desc + loc)}`,
      data: `Civil unrest: ${desc.slice(0, 200)}. Location: ${loc}. Severity: ${e.severityLevel || e.severity || 'unknown'}.`,
      metadata: {
        type: 'unrest',
        location: loc,
        severity: (e.severityLevel || e.severity || '').toLowerCase(),
        timestamp: Date.now(),
      },
    };
  });
}

// Simple hash for generating deterministic IDs
function hashId(str) {
  let hash = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// ---------- Main ----------

async function main() {
  if (!VECTOR_URL || !VECTOR_TOKEN) {
    console.log('UPSTASH_VECTOR_REST_URL or UPSTASH_VECTOR_REST_TOKEN not set — skipping vector index');
    process.exit(0);
  }

  const { url: redisUrl, token: redisToken } = getRedisCredentials();
  console.log('=== Vector Index Seed ===');

  // Verify vector index connectivity
  const info = await vectorInfo();
  if (info) {
    const result = info.result || info;
    console.log(`  Index: ${result.dimension || '?'}D, ${result.vectorCount ?? result.vector_count ?? '?'} vectors`);
  } else {
    console.warn('  Warning: Could not fetch vector index info — will attempt upserts anyway');
  }

  // Read all data sources from Redis in parallel
  const [gdelt, missiles, diseases, forecasts, poi, sitrep, unrest] = await Promise.all([
    redisGet(redisUrl, redisToken, 'intelligence:gdelt-intel:v1'),
    redisGet(redisUrl, redisToken, 'intelligence:missile-events:v1'),
    redisGet(redisUrl, redisToken, 'health:outbreaks:v1'),
    redisGet(redisUrl, redisToken, 'forecast:conflict:v1'),
    redisGet(redisUrl, redisToken, 'intelligence:poi:v1'),
    redisGet(redisUrl, redisToken, 'intelligence:agent-sitrep:v1'),
    redisGet(redisUrl, redisToken, 'unrest:events:v1'),
  ]);
  const alerts = await redisLRange(redisUrl, redisToken, 'alerts:stream:v1', 0, 49);

  // Extract vectors from each source
  const allItems = [
    ...extractGdeltIntel(gdelt),
    ...extractMissileEvents(missiles),
    ...extractDiseaseOutbreaks(diseases),
    ...extractConflictForecasts(forecasts),
    ...extractPOI(poi),
    ...extractAgentSitrep(sitrep),
    ...extractAlerts(alerts),
    ...extractUnrest(unrest),
  ];

  console.log(`  Total items to index: ${allItems.length}`);
  console.log(`    GDELT: ${extractGdeltIntel(gdelt).length}`);
  console.log(`    Missiles: ${extractMissileEvents(missiles).length}`);
  console.log(`    Diseases: ${extractDiseaseOutbreaks(diseases).length}`);
  console.log(`    Forecasts: ${extractConflictForecasts(forecasts).length}`);
  console.log(`    POI: ${extractPOI(poi).length}`);
  console.log(`    SITREP: ${extractAgentSitrep(sitrep).length}`);
  console.log(`    Alerts: ${extractAlerts(alerts).length}`);
  console.log(`    Unrest: ${extractUnrest(unrest).length}`);

  if (allItems.length === 0) {
    console.log('  No items to index — exiting');
    process.exit(0);
  }

  // Upsert in batches
  let upserted = 0;
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    try {
      await vectorUpsertBatch(batch);
      upserted += batch.length;
      console.log(`  Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} items (${upserted}/${allItems.length})`);
    } catch (err) {
      console.warn(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
      // Continue with remaining batches rather than failing entirely
    }

    if (i + BATCH_SIZE < allItems.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`  Total upserted: ${upserted}/${allItems.length}`);
  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0); // Soft fail
});
