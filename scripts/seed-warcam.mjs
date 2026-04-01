#!/usr/bin/env node
// seed-warcam.mjs — Reads from gdelt:raw:v1 cache (no direct GDELT calls)
// Requires seed-gdelt-raw.mjs to have run first in this seed cycle.

import { loadEnvFile, getRedisCredentials } from './_seed-utils.mjs';
import { getGdeltWarcamArticles } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const REDIS_KEY = 'intelligence:warcam:v1';

const CONFLICT_ZONE_COORDS = {
  ukraine: [48.38, 35.0], kyiv: [50.45, 30.52], kharkiv: [49.99, 36.23],
  kherson: [46.64, 32.62], zaporizhzhia: [47.84, 35.14], donetsk: [48.0, 37.8],
  odesa: [46.48, 30.73], odessa: [46.48, 30.73], crimea: [44.95, 34.1],
  luhansk: [48.57, 39.31], mariupol: [47.1, 37.55], dnipro: [48.47, 35.04],
  russia: [55.75, 37.62], moscow: [55.75, 37.62], belgorod: [50.6, 36.59],
  kursk: [51.73, 36.19], rostov: [47.24, 39.71], russian: [55.75, 37.62],
  kremlin: [55.75, 37.62], putin: [55.75, 37.62],
  gaza: [31.35, 34.31], israel: [31.77, 35.22], rafah: [31.28, 34.24],
  jerusalem: [31.77, 35.23], 'tel aviv': [32.09, 34.78], 'west bank': [31.95, 35.25],
  hamas: [31.35, 34.31], hezbollah: [33.89, 35.50], idf: [31.77, 35.22],
  syria: [34.80, 38.99], aleppo: [36.2, 37.17], damascus: [33.51, 36.29],
  iran: [35.69, 51.39], tehran: [35.69, 51.39], iranian: [35.69, 51.39],
  iraq: [33.31, 44.37], baghdad: [33.31, 44.37], mosul: [36.34, 43.12],
  yemen: [15.55, 48.52], sanaa: [15.37, 44.21], houthi: [15.37, 44.21],
  lebanon: [33.89, 35.50], beirut: [33.89, 35.50],
  saudi: [24.71, 46.68], riyadh: [24.71, 46.68],
  jordan: [31.95, 35.93], amman: [31.95, 35.93],
  sudan: [15.5, 32.56], khartoum: [15.59, 32.53], darfur: [13.5, 25.0],
  'south sudan': [4.85, 31.58], juba: [4.85, 31.58],
  ethiopia: [9.02, 38.75], 'addis ababa': [9.02, 38.75], tigray: [13.5, 39.5],
  somalia: [2.05, 45.32], mogadishu: [2.05, 45.32],
  libya: [32.90, 13.18], tripoli: [32.90, 13.18], benghazi: [32.12, 20.09],
  nigeria: [9.06, 7.49], lagos: [6.52, 3.38], abuja: [9.06, 7.49],
  mali: [12.64, -8.0], bamako: [12.64, -8.0],
  niger: [13.51, 2.11], niamey: [13.51, 2.11],
  burkina: [12.37, -1.52], ouagadougou: [12.37, -1.52],
  cameroon: [3.87, 11.52], chad: [12.13, 15.05],
  congo: [-4.32, 15.31], kinshasa: [-4.32, 15.31], drc: [-4.32, 15.31],
  mozambique: [-25.97, 32.57], kenya: [-1.29, 36.82], nairobi: [-1.29, 36.82],
  afghanistan: [34.53, 69.17], kabul: [34.53, 69.17], taliban: [34.53, 69.17],
  pakistan: [33.69, 73.04], islamabad: [33.69, 73.04], karachi: [24.86, 67.01],
  india: [28.61, 77.21], kashmir: [34.08, 74.80], delhi: [28.61, 77.21],
  myanmar: [19.76, 96.07], china: [39.9, 116.4], beijing: [39.9, 116.4],
  taiwan: [25.03, 121.57], taipei: [25.03, 121.57],
  'north korea': [39.02, 125.75], pyongyang: [39.02, 125.75],
  'south korea': [37.57, 126.98], seoul: [37.57, 126.98],
  philippines: [14.6, 120.98], manila: [14.6, 120.98],
  mexico: [19.43, -99.13], colombia: [4.71, -74.07], bogota: [4.71, -74.07],
  venezuela: [10.49, -66.88], haiti: [18.54, -72.34],
  nato: [50.85, 4.35], europe: [50.85, 4.35], brussels: [50.85, 4.35],
  poland: [52.23, 21.01], romania: [44.43, 26.1],
  pentagon: [38.87, -77.06], washington: [38.91, -77.04],
  'united states': [38.91, -77.04], 'u.s.': [38.91, -77.04],
  uk: [51.51, -0.13], london: [51.51, -0.13], britain: [51.51, -0.13],
  france: [48.86, 2.35], paris: [48.86, 2.35],
  germany: [52.52, 13.41], berlin: [52.52, 13.41],
  japan: [35.68, 139.69], tokyo: [35.68, 139.69],
  australia: [-33.87, 151.21],
};

function geocodeFromTitle(title) {
  const lower = title.toLowerCase();
  for (const [name, coords] of Object.entries(CONFLICT_ZONE_COORDS)) {
    if (lower.includes(name)) return coords;
  }
  return null;
}

function classifySeverity(title) {
  const l = title.toLowerCase();
  if (l.includes('killed') || l.includes('dead') || l.includes('massacre') || l.includes('dozens') || l.includes('mass')) return 'critical';
  if (l.includes('wound') || l.includes('injur') || l.includes('blast') || l.includes('destroy') || l.includes('strike') || l.includes('bomb')) return 'high';
  if (l.includes('attack') || l.includes('clash') || l.includes('fire') || l.includes('drone') || l.includes('advance') || l.includes('retreat')) return 'medium';
  return 'low';
}

async function main() {
  const { url: redisUrl, token: redisToken } = getRedisCredentials();
  console.log('=== Warcam Seed (cache-backed) ===');

  const allEntries = [];
  const seenUrls   = new Set();

  // Read from cache — zero GDELT calls
  const warcamGroups = await getGdeltWarcamArticles();

  for (const { label, articles } of warcamGroups) {
    let geocoded = 0;
    for (const a of articles) {
      if (seenUrls.has(a.url)) continue;
      seenUrls.add(a.url);
      const coords = geocodeFromTitle(a.title || '');
      if (!coords) continue;
      geocoded++;
      allEntries.push({
        id:        a.url || `wc:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        title:     a.title || '',
        url:       a.url  || '',
        image:     a.image || a.socialimage || '',
        source:    a.domain || a.source || '',
        lat:       coords[0],
        lng:       coords[1],
        timestamp: a.seendate ? new Date(a.seendate).getTime() : Date.now(),
        category:  label,
        severity:  classifySeverity(a.title || ''),
        hasGeo:    false,
      });
    }
    console.log(`  ${label}: ${articles.length} articles → ${geocoded} geocoded`);
  }

  console.log(`  Total warcam entries: ${allEntries.length}`);

  // Fallback: if cache was empty, pull from other seeded Redis keys
  if (allEntries.length < 5) {
    console.log('  Cache empty — building warcam from missile/unrest Redis keys...');
    const fallbackKeys = ['intelligence:missile-events:v1', 'unrest:events:v1'];
    for (const key of fallbackKeys) {
      try {
        const resp = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${redisToken}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) continue;
        const raw = await resp.json();
        if (!raw.result) continue;
        const parsed = JSON.parse(raw.result);
        const events = parsed.events || [];
        for (const e of events.slice(0, 30)) {
          const title = e.title || e.description || '';
          const coords = geocodeFromTitle(title);
          if (!coords) continue;
          const eUrl = e.url || e.sourceUrl || '';
          if (seenUrls.has(eUrl) && eUrl) continue;
          if (eUrl) seenUrls.add(eUrl);
          allEntries.push({
            id:        eUrl || `redis:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            title:     title.slice(0, 200),
            url:       eUrl,
            image:     e.socialimage || '',
            source:    e.dataSource || e.source || 'Redis',
            lat:       coords[0],
            lng:       coords[1],
            timestamp: e.timestamp || Date.now(),
            category:  key.includes('missile') ? 'airstrikes' : 'ground-combat',
            severity:  classifySeverity(title),
            hasGeo:    false,
          });
        }
      } catch { /* skip */ }
    }
    console.log(`  Redis fallback total: ${allEntries.length}`);
  }

  if (allEntries.length === 0) {
    console.log('  No conflict media found — skipping');
    process.exit(0);
  }

  allEntries.sort((a, b) => b.timestamp - a.timestamp);
  const entries = allEntries.slice(0, 100);

  const payload = {
    entries,
    entryCount: entries.length,
    fetchedAt:  Date.now(),
    sources:    [...new Set(entries.map(e => e.source))].slice(0, 20),
  };

  const resp = await fetch(redisUrl, {
    method:  'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', REDIS_KEY, JSON.stringify(payload), 'EX', '7200']),
    signal:  AbortSignal.timeout(5_000),
  });

  if (!resp.ok) {
    console.error(`  Redis write failed: ${resp.status}`);
    process.exit(0);
  }

  console.log(`  Written ${entries.length} entries to ${REDIS_KEY}`);
  console.log(`  Severity: ${entries.filter(e => e.severity === 'critical').length} critical, ${entries.filter(e => e.severity === 'high').length} high, ${entries.filter(e => e.severity === 'medium').length} medium`);
  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
