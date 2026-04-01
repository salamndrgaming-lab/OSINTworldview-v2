#!/usr/bin/env node
// seed-missile-events.mjs — Reads from gdelt:raw:v1 cache (no direct GDELT calls)
// Requires seed-gdelt-raw.mjs to have run first in this seed cycle.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { getGdeltMissileArticles } from './_gdelt-cache.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:missile-events:v1';
const CACHE_TTL = 7200;

// ---------- Geocoding Dictionary ----------

const LOCATION_COORDS = {
  // Ukraine
  'kyiv': { lat: 50.4501, lon: 30.5234 }, 'kharkiv': { lat: 49.9935, lon: 36.2304 },
  'odesa': { lat: 46.4825, lon: 30.7233 }, 'odessa': { lat: 46.4825, lon: 30.7233 },
  'dnipro': { lat: 48.4647, lon: 35.0462 }, 'zaporizhzhia': { lat: 47.8388, lon: 35.1396 },
  'kherson': { lat: 46.6354, lon: 32.6169 }, 'lviv': { lat: 49.8397, lon: 24.0297 },
  'mykolaiv': { lat: 46.9750, lon: 31.9946 }, 'sumy': { lat: 50.9077, lon: 34.7981 },
  'chernihiv': { lat: 51.4982, lon: 31.2893 }, 'poltava': { lat: 49.5883, lon: 34.5514 },
  'vinnytsia': { lat: 49.2331, lon: 28.4682 }, 'kramatorsk': { lat: 48.7305, lon: 37.5567 },
  'pokrovsk': { lat: 48.2834, lon: 37.1822 }, 'ukraine': { lat: 48.3794, lon: 31.1656 },
  'crimea': { lat: 44.9521, lon: 34.1024 }, 'donbas': { lat: 48.0159, lon: 37.8028 },
  'donetsk': { lat: 48.0159, lon: 37.8028 }, 'luhansk': { lat: 48.5740, lon: 39.3078 },
  // Russia
  'moscow': { lat: 55.7558, lon: 37.6173 }, 'belgorod': { lat: 50.5997, lon: 36.5882 },
  'kursk': { lat: 51.7373, lon: 36.1874 }, 'bryansk': { lat: 53.2521, lon: 34.3717 },
  'rostov': { lat: 47.2357, lon: 39.7015 }, 'sevastopol': { lat: 44.6167, lon: 33.5254 },
  'russia': { lat: 55.7558, lon: 37.6173 },
  // Middle East
  'gaza': { lat: 31.3547, lon: 34.3088 }, 'rafah': { lat: 31.2969, lon: 34.2455 },
  'khan younis': { lat: 31.3462, lon: 34.3064 }, 'jabalia': { lat: 31.5280, lon: 34.4834 },
  'tel aviv': { lat: 32.0853, lon: 34.7818 }, 'jerusalem': { lat: 31.7683, lon: 35.2137 },
  'haifa': { lat: 32.7940, lon: 34.9896 }, 'israel': { lat: 31.7683, lon: 35.2137 },
  'beirut': { lat: 33.8938, lon: 35.5018 }, 'lebanon': { lat: 33.8547, lon: 35.8623 },
  'damascus': { lat: 33.5138, lon: 36.2765 }, 'syria': { lat: 34.8021, lon: 38.9968 },
  'aleppo': { lat: 36.2021, lon: 37.1343 }, 'homs': { lat: 34.7324, lon: 36.7137 },
  'idlib': { lat: 35.9306, lon: 36.6339 }, 'tehran': { lat: 35.6892, lon: 51.3890 },
  'isfahan': { lat: 32.6546, lon: 51.6680 }, 'iran': { lat: 32.4279, lon: 53.6880 },
  'iraq': { lat: 33.2232, lon: 43.6793 }, 'baghdad': { lat: 33.3152, lon: 44.3661 },
  'erbil': { lat: 36.1912, lon: 44.0119 }, 'yemen': { lat: 15.5527, lon: 44.0170 },
  'sanaa': { lat: 15.3694, lon: 44.1910 }, 'hodeidah': { lat: 14.7979, lon: 42.9541 },
  'houthi': { lat: 15.3694, lon: 44.1910 }, 'aden': { lat: 12.7855, lon: 45.0187 },
  'riyadh': { lat: 24.7136, lon: 46.6753 }, 'saudi': { lat: 24.7136, lon: 46.6753 },
  'jeddah': { lat: 21.4858, lon: 39.1925 },
  // Asia
  'taiwan': { lat: 23.6978, lon: 120.9605 }, 'north korea': { lat: 39.0392, lon: 125.7625 },
  'pyongyang': { lat: 39.0392, lon: 125.7625 }, 'south korea': { lat: 37.5665, lon: 126.9780 },
  'seoul': { lat: 37.5665, lon: 126.9780 }, 'pakistan': { lat: 33.6844, lon: 73.0479 },
  'afghanistan': { lat: 34.5553, lon: 69.2075 }, 'kabul': { lat: 34.5553, lon: 69.2075 },
  'india': { lat: 28.6139, lon: 77.2090 }, 'kashmir': { lat: 34.0837, lon: 74.7973 },
  'myanmar': { lat: 19.7633, lon: 96.0785 },
  // Africa
  'sudan': { lat: 15.5007, lon: 32.5599 }, 'khartoum': { lat: 15.5007, lon: 32.5599 },
  'libya': { lat: 32.8872, lon: 13.1913 }, 'tripoli': { lat: 32.8872, lon: 13.1913 },
  'benghazi': { lat: 32.1194, lon: 20.0868 }, 'mogadishu': { lat: 2.0469, lon: 45.3182 },
  'somalia': { lat: 2.0469, lon: 45.3182 }, 'ethiopia': { lat: 9.0192, lon: 38.7525 },
  'mali': { lat: 12.6392, lon: -8.0029 }, 'niger': { lat: 13.5116, lon: 2.1254 },
  'nigeria': { lat: 9.0765, lon: 7.3986 }, 'congo': { lat: -4.4419, lon: 15.2663 },
  // Red Sea / shipping
  'red sea': { lat: 20.0, lon: 38.5 }, 'bab al-mandab': { lat: 12.6, lon: 43.3 },
  'gulf of aden': { lat: 12.5, lon: 47.0 }, 'strait of hormuz': { lat: 26.5, lon: 56.3 },
};

function geocodeFromTitle(title) {
  const lower = title.toLowerCase();
  for (const [name, coords] of Object.entries(LOCATION_COORDS)) {
    if (lower.includes(name)) return { lat: coords.lat, lon: coords.lon, locationName: name };
  }
  return null;
}

function classifySeverity(title) {
  const l = title.toLowerCase();
  if (l.includes('ballistic') || l.includes('cruise missile') || l.includes('mass') || l.includes('dozens') || l.includes('killed') || l.includes('dead') || l.includes('devastat')) return 'critical';
  if (l.includes('missile') || l.includes('strike') || l.includes('barrage') || l.includes('intercept') || l.includes('wound') || l.includes('injur')) return 'high';
  if (l.includes('drone') || l.includes('uav') || l.includes('bomb') || l.includes('shell') || l.includes('attack')) return 'medium';
  return 'low';
}

function classifyEventType(title, queryId) {
  const l = title.toLowerCase();
  if (l.includes('drone') || l.includes('uav') || l.includes('shahed')) return 'drone';
  if (l.includes('ballistic') || l.includes('cruise') || l.includes('missile')) return 'missile';
  if (l.includes('airstrike') || l.includes('air strike') || l.includes('aerial') || l.includes('bombardment') || l.includes('bombing')) return 'airstrike';
  return queryId;
}

function deduplicateEvents(events) {
  const unique = new Map();
  for (const event of events) {
    const latKey  = Math.round(event.latitude  * 10) / 10;
    const lonKey  = Math.round(event.longitude * 10) / 10;
    const dateKey = new Date(event.timestamp).toISOString().split('T')[0];
    const key     = `${latKey}:${lonKey}:${dateKey}:${event.eventType}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, event);
    } else {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      if ((order[event.severity] ?? 3) < (order[existing.severity] ?? 3)) {
        event.sources = [...new Set([...event.sources, ...existing.sources])];
        unique.set(key, event);
      } else {
        existing.sources = [...new Set([...existing.sources, ...event.sources])];
      }
    }
  }
  return Array.from(unique.values());
}

async function fetchMissileEvents() {
  const cached = await getGdeltMissileArticles();
  const allEvents = [];

  const queries = [
    { id: 'missile',   articles: cached.missile   },
    { id: 'drone',     articles: cached.drone     },
    { id: 'airstrike', articles: cached.airstrike },
  ];

  for (const q of queries) {
    console.log(`  ${q.id}: ${q.articles.length} articles from cache`);
    for (const art of q.articles) {
      const geo = geocodeFromTitle(art.title || '');
      if (!geo) continue;

      const raw = art.seendate || art.date || '';
      const seenMs = raw
        ? new Date(raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')).getTime()
        : Date.now();

      allEvents.push({
        id:           `missile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title:        art.title,
        eventType:    classifyEventType(art.title, q.id),
        severity:     classifySeverity(art.title),
        latitude:     geo.lat,
        longitude:    geo.lon,
        locationName: geo.locationName,
        timestamp:    Number.isFinite(seenMs) ? seenMs : Date.now(),
        sources:      [art.source],
        sourceUrl:    art.url,
        tone:         art.tone,
        dataSource:   'GDELT',
      });
    }
  }

  console.log(`  Total geolocated: ${allEvents.length}`);
  const deduped = deduplicateEvents(allEvents);
  console.log(`  After dedup: ${deduped.length}`);

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  deduped.sort((a, b) => {
    const diff = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
    return diff !== 0 ? diff : b.timestamp - a.timestamp;
  });

  return { events: deduped.slice(0, 200), fetchedAt: Date.now() };
}

function validate(data) {
  return Array.isArray(data?.events) && data.events.length >= 1;
}

runSeed('intelligence', 'missile-events', CANONICAL_KEY, fetchMissileEvents, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'gdelt-raw-cache-v1',
  recordCount: (data) => data?.events?.length ?? 0,
}).catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
