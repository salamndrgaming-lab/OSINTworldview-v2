#!/usr/bin/env node

// seed-warcam.mjs — Conflict Zone Media Feed
//
// Pulls geolocated conflict/war coverage from GDELT GEO 2.0 API.
// Each entry has: coordinates, timestamp, title, social image URL,
// source, and conflict context. Stored in Redis for the warcam
// map layer and panel display.
//
// GDELT GEO API returns articles with geographic coordinates extracted
// from the article text. We filter for conflict-related content and
// store entries with images for visual display on the map.

import { loadEnvFile, CHROME_UA, getRedisCredentials, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const REDIS_KEY = 'intelligence:warcam:v1';
const GDELT_GEO_API = 'https://api.gdeltproject.org/api/v2/geo/geo';

// Conflict-focused queries for the GEO API
const WARCAM_QUERIES = [
  { query: '(strike OR bombing OR shelling OR airstrike)', label: 'airstrikes' },
  { query: '(combat OR fighting OR battle OR frontline)', label: 'ground-combat' },
  { query: '(drone attack OR missile launch OR rocket)', label: 'drone-missile' },
  { query: '(explosion OR destroyed OR casualties OR killed)', label: 'casualties' },
  { query: '(invasion OR offensive OR advance OR retreat)', label: 'military-ops' },
];

// Parse GDELT GEO API JSON response
// The GEO API returns { type: "FeatureCollection", features: [...] }
async function fetchGeoArticles(query, timespan = '24h', maxRecords = 75) {
  const url = new URL(GDELT_GEO_API);
  url.searchParams.set('query', `${query} sourcelang:eng`);
  url.searchParams.set('mode', 'pointdata');
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('timespan', timespan);
  url.searchParams.set('maxpoints', String(maxRecords));

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.warn(`    GEO API ${resp.status} for "${query.slice(0, 30)}..."`);
      return [];
    }
    const data = await resp.json();
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      // Might be CSV or HTML format — try parsing differently
      return [];
    }
    return data.features;
  } catch (err) {
    console.warn(`    GEO fetch error: ${err.message?.slice(0, 80)}`);
    return [];
  }
}

// Fallback: use DOC API for articles with social images
async function fetchDocArticlesWithImages(query, timespan = '24h', maxRecords = 50) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', `${query} sourcelang:eng`);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'datedesc');
  url.searchParams.set('timespan', timespan);
  url.searchParams.set('maxrecords', String(maxRecords));

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.articles || []).filter(a => a.socialimage && a.title);
  } catch {
    return [];
  }
}

// Known conflict zone centroids for geocoding articles without coordinates
const CONFLICT_ZONE_COORDS = {
  ukraine: [48.38, 35.0], kyiv: [50.45, 30.52], kharkiv: [49.99, 36.23],
  kherson: [46.64, 32.62], zaporizhzhia: [47.84, 35.14], donetsk: [48.0, 37.8],
  gaza: [31.35, 34.31], israel: [31.77, 35.22], rafah: [31.28, 34.24],
  syria: [34.80, 38.99], aleppo: [36.2, 37.17], damascus: [33.51, 36.29],
  yemen: [15.55, 48.52], sanaa: [15.37, 44.21],
  sudan: [15.5, 32.56], khartoum: [15.59, 32.53],
  myanmar: [19.76, 96.07], ethiopia: [9.02, 38.75],
  iraq: [33.31, 44.37], baghdad: [33.31, 44.37],
  lebanon: [33.89, 35.50], beirut: [33.89, 35.50],
  somalia: [2.05, 45.32], mogadishu: [2.05, 45.32],
  libya: [32.90, 13.18], tripoli: [32.90, 13.18],
  afghanistan: [34.53, 69.17], kabul: [34.53, 69.17],
  pakistan: [33.69, 73.04], niger: [13.51, 2.11],
  mali: [12.64, -8.0], congo: [-4.32, 15.31],
  nigeria: [9.06, 7.49],
};

function geocodeFromTitle(title) {
  const lower = title.toLowerCase();
  for (const [name, coords] of Object.entries(CONFLICT_ZONE_COORDS)) {
    if (lower.includes(name)) return coords;
  }
  return null;
}

// Classify severity from title
function classifySeverity(title) {
  const lower = title.toLowerCase();
  if (/mass casualt|dozens killed|massacre|genocide/.test(lower)) return 'critical';
  if (/killed|dead|casualties|destroy|bomb/.test(lower)) return 'high';
  if (/strike|attack|shell|missile|drone|fight/.test(lower)) return 'medium';
  return 'low';
}

// ── Main ──

async function main() {
  const { url: redisUrl, token: redisToken } = getRedisCredentials();
  console.log('=== Warcam Seed ===');

  const allEntries = [];
  const seenUrls = new Set();

  // Step 1: Try GEO API for geolocated articles
  console.log('  Step 1: Fetching geolocated conflict media...');
  for (const { query, label } of WARCAM_QUERIES) {
    const features = await fetchGeoArticles(query, '24h', 50);
    for (const f of features) {
      const coords = f.geometry?.coordinates; // [lng, lat]
      const props = f.properties || {};
      const articleUrl = props.url || props.urlmobile || '';
      if (seenUrls.has(articleUrl)) continue;
      seenUrls.add(articleUrl);

      allEntries.push({
        id: articleUrl || `geo:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        title: props.name || props.title || '',
        url: articleUrl,
        image: props.socialimage || props.shareimage || '',
        source: props.domain || props.source || '',
        lat: coords ? coords[1] : 0,
        lng: coords ? coords[0] : 0,
        timestamp: props.seendate ? new Date(props.seendate).getTime() : Date.now(),
        category: label,
        severity: classifySeverity(props.name || props.title || ''),
        hasGeo: true,
      });
    }
    console.log(`    ${label}: ${features.length} geolocated articles`);
    await sleep(1500);
  }

  // Step 2: Fallback — DOC API for articles with images (geocode from title)
  if (allEntries.length < 20) {
    console.log('  Step 2: Supplementing with DOC API articles...');
    for (const { query, label } of WARCAM_QUERIES.slice(0, 3)) {
      const articles = await fetchDocArticlesWithImages(query, '48h', 30);
      for (const a of articles) {
        if (seenUrls.has(a.url)) continue;
        seenUrls.add(a.url);

        const coords = geocodeFromTitle(a.title || '');
        if (!coords) continue; // Skip articles we can't geolocate

        allEntries.push({
          id: a.url || `doc:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          title: a.title || '',
          url: a.url || '',
          image: a.socialimage || '',
          source: a.domain || '',
          lat: coords[0],
          lng: coords[1],
          timestamp: a.seendate ? new Date(a.seendate).getTime() : Date.now(),
          category: label,
          severity: classifySeverity(a.title || ''),
          hasGeo: false, // Geocoded from title, not from GDELT
        });
      }
      console.log(`    ${label} (DOC fallback): ${articles.length} articles`);
      await sleep(1500);
    }
  }

  console.log(`  Total warcam entries: ${allEntries.length}`);

  if (allEntries.length === 0) {
    console.log('  No conflict media found — skipping');
    process.exit(0);
  }

  // Sort by timestamp (newest first) and limit
  allEntries.sort((a, b) => b.timestamp - a.timestamp);
  const entries = allEntries.slice(0, 100);

  // Store in Redis
  const payload = {
    entries,
    entryCount: entries.length,
    fetchedAt: Date.now(),
    sources: [...new Set(entries.map(e => e.source))].slice(0, 20),
  };

  const resp = await fetch(`${redisUrl}/set/${encodeURIComponent(REDIS_KEY)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ EX: 7200, value: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(5_000),
  });

  if (!resp.ok) {
    console.error(`  Redis write failed: ${resp.status}`);
    process.exit(0);
  }

  console.log(`  Written ${entries.length} entries to ${REDIS_KEY}`);
  console.log(`  Severity breakdown: ${entries.filter(e => e.severity === 'critical').length} critical, ${entries.filter(e => e.severity === 'high').length} high, ${entries.filter(e => e.severity === 'medium').length} medium`);
  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
