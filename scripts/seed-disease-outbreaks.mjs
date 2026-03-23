#!/usr/bin/env node

// seed-disease-outbreaks.mjs — Fetches WHO Disease Outbreak News (DON) from the
// WHO RSS feed. Each entry represents a disease outbreak alert with country,
// disease name, and date. Geocoded via a country dictionary.

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const WHO_DON_URLS = [
  // Current WHO DON API endpoint (OData-style)
  'https://www.who.int/api/hubs/diseaseoutbreaknews?$orderby=PublicationDate%20desc&$top=50',
  // Legacy RSS feed (may still work in some regions)
  'https://www.who.int/feeds/entity/don/en/rss.xml',
  // Alternative WHO news feed endpoint
  'https://www.who.int/api/news/diseaseoutbreaknews?sf_culture=en&$orderby=PublicationDateAndTime%20desc&$top=50',
];
const CANONICAL_KEY = 'health:outbreaks:v1';
const CACHE_TTL = 14400; // 4h

// ---------- Country Geocoding ----------

const COUNTRY_COORDS = {
  'afghanistan': { lat: 33.93, lon: 67.71 }, 'albania': { lat: 41.15, lon: 20.17 },
  'algeria': { lat: 28.03, lon: 1.66 }, 'angola': { lat: -11.20, lon: 17.87 },
  'argentina': { lat: -38.42, lon: -63.62 }, 'australia': { lat: -25.27, lon: 133.78 },
  'bangladesh': { lat: 23.68, lon: 90.36 }, 'belgium': { lat: 50.50, lon: 4.47 },
  'benin': { lat: 9.31, lon: 2.32 }, 'bolivia': { lat: -16.29, lon: -63.59 },
  'botswana': { lat: -22.33, lon: 24.68 }, 'brazil': { lat: -14.24, lon: -51.93 },
  'burkina faso': { lat: 12.24, lon: -1.56 }, 'burundi': { lat: -3.37, lon: 29.92 },
  'cambodia': { lat: 12.57, lon: 104.99 }, 'cameroon': { lat: 7.37, lon: 12.35 },
  'canada': { lat: 56.13, lon: -106.35 }, 'central african republic': { lat: 6.61, lon: 20.94 },
  'chad': { lat: 15.45, lon: 18.73 }, 'chile': { lat: -35.68, lon: -71.54 },
  'china': { lat: 35.86, lon: 104.20 }, 'colombia': { lat: 4.57, lon: -74.30 },
  'congo': { lat: -4.04, lon: 21.76 }, 'democratic republic of the congo': { lat: -4.04, lon: 21.76 },
  'drc': { lat: -4.04, lon: 21.76 }, 'côte d\'ivoire': { lat: 7.54, lon: -5.55 },
  'cote d\'ivoire': { lat: 7.54, lon: -5.55 }, 'croatia': { lat: 45.10, lon: 15.20 },
  'cuba': { lat: 21.52, lon: -77.78 }, 'denmark': { lat: 56.26, lon: 9.50 },
  'djibouti': { lat: 11.83, lon: 42.59 }, 'ecuador': { lat: -1.83, lon: -78.18 },
  'egypt': { lat: 26.82, lon: 30.80 }, 'eritrea': { lat: 15.18, lon: 39.78 },
  'ethiopia': { lat: 9.15, lon: 40.49 }, 'france': { lat: 46.23, lon: 2.21 },
  'gabon': { lat: -0.80, lon: 11.61 }, 'gambia': { lat: 13.44, lon: -15.31 },
  'germany': { lat: 51.17, lon: 10.45 }, 'ghana': { lat: 7.95, lon: -1.02 },
  'greece': { lat: 39.07, lon: 21.82 }, 'guatemala': { lat: 15.78, lon: -90.23 },
  'guinea': { lat: 9.95, lon: -9.70 }, 'guinea-bissau': { lat: 11.80, lon: -15.18 },
  'haiti': { lat: 18.97, lon: -72.29 }, 'honduras': { lat: 15.20, lon: -86.24 },
  'india': { lat: 20.59, lon: 78.96 }, 'indonesia': { lat: -0.79, lon: 113.92 },
  'iran': { lat: 32.43, lon: 53.69 }, 'iraq': { lat: 33.22, lon: 43.68 },
  'israel': { lat: 31.05, lon: 34.85 }, 'italy': { lat: 41.87, lon: 12.57 },
  'japan': { lat: 36.20, lon: 138.25 }, 'jordan': { lat: 30.59, lon: 36.24 },
  'kenya': { lat: -0.02, lon: 37.91 }, 'laos': { lat: 19.86, lon: 102.50 },
  'lao': { lat: 19.86, lon: 102.50 }, 'lebanon': { lat: 33.85, lon: 35.86 },
  'liberia': { lat: 6.43, lon: -9.43 }, 'libya': { lat: 26.34, lon: 17.23 },
  'madagascar': { lat: -18.77, lon: 46.87 }, 'malawi': { lat: -13.25, lon: 34.30 },
  'malaysia': { lat: 4.21, lon: 101.98 }, 'mali': { lat: 17.57, lon: -4.00 },
  'mauritania': { lat: 21.01, lon: -10.94 }, 'mexico': { lat: 23.63, lon: -102.55 },
  'morocco': { lat: 31.79, lon: -7.09 }, 'mozambique': { lat: -18.67, lon: 35.53 },
  'myanmar': { lat: 21.91, lon: 95.96 }, 'namibia': { lat: -22.96, lon: 18.49 },
  'nepal': { lat: 28.39, lon: 84.12 }, 'netherlands': { lat: 52.13, lon: 5.29 },
  'new zealand': { lat: -40.90, lon: 174.89 }, 'nicaragua': { lat: 12.87, lon: -85.21 },
  'niger': { lat: 17.61, lon: 8.08 }, 'nigeria': { lat: 9.08, lon: 8.68 },
  'pakistan': { lat: 30.38, lon: 69.35 }, 'panama': { lat: 8.54, lon: -80.78 },
  'papua new guinea': { lat: -6.31, lon: 143.96 }, 'paraguay': { lat: -23.44, lon: -58.44 },
  'peru': { lat: -9.19, lon: -75.02 }, 'philippines': { lat: 12.88, lon: 121.77 },
  'poland': { lat: 51.92, lon: 19.15 }, 'portugal': { lat: 39.40, lon: -8.22 },
  'romania': { lat: 45.94, lon: 24.97 }, 'russia': { lat: 61.52, lon: 105.32 },
  'russian federation': { lat: 61.52, lon: 105.32 }, 'rwanda': { lat: -1.94, lon: 29.87 },
  'saudi arabia': { lat: 23.89, lon: 45.08 }, 'senegal': { lat: 14.50, lon: -14.45 },
  'sierra leone': { lat: 8.46, lon: -11.78 }, 'singapore': { lat: 1.35, lon: 103.82 },
  'somalia': { lat: 5.15, lon: 46.20 }, 'south africa': { lat: -30.56, lon: 22.94 },
  'south sudan': { lat: 6.88, lon: 31.31 }, 'spain': { lat: 40.46, lon: -3.75 },
  'sri lanka': { lat: 7.87, lon: 80.77 }, 'sudan': { lat: 12.86, lon: 30.22 },
  'sweden': { lat: 60.13, lon: 18.64 }, 'switzerland': { lat: 46.82, lon: 8.23 },
  'syria': { lat: 34.80, lon: 38.99 }, 'syrian arab republic': { lat: 34.80, lon: 38.99 },
  'tanzania': { lat: -6.37, lon: 34.89 }, 'united republic of tanzania': { lat: -6.37, lon: 34.89 },
  'thailand': { lat: 15.87, lon: 100.99 }, 'togo': { lat: 8.62, lon: 1.21 },
  'tunisia': { lat: 33.89, lon: 9.54 }, 'turkey': { lat: 38.96, lon: 35.24 },
  'türkiye': { lat: 38.96, lon: 35.24 }, 'uganda': { lat: 1.37, lon: 32.29 },
  'ukraine': { lat: 48.38, lon: 31.17 }, 'united arab emirates': { lat: 23.42, lon: 53.85 },
  'united kingdom': { lat: 55.38, lon: -3.44 }, 'united states': { lat: 37.09, lon: -95.71 },
  'united states of america': { lat: 37.09, lon: -95.71 }, 'uruguay': { lat: -32.52, lon: -55.77 },
  'uzbekistan': { lat: 41.38, lon: 64.59 }, 'venezuela': { lat: 6.42, lon: -66.59 },
  'viet nam': { lat: 14.06, lon: 108.28 }, 'vietnam': { lat: 14.06, lon: 108.28 },
  'yemen': { lat: 15.55, lon: 48.52 }, 'zambia': { lat: -13.13, lon: 27.85 },
  'zimbabwe': { lat: -19.02, lon: 29.15 },
};

function geocodeCountry(text) {
  const lower = text.toLowerCase();
  for (const [name, coords] of Object.entries(COUNTRY_COORDS)) {
    if (lower.includes(name)) return { ...coords, country: name };
  }
  return null;
}

// ---------- Disease Classification ----------

function classifyDisease(title) {
  const lower = title.toLowerCase();
  // Hemorrhagic / high-risk
  if (lower.includes('ebola') || lower.includes('marburg') || lower.includes('lassa') ||
      lower.includes('crimean-congo') || lower.includes('hemorrhagic')) return 'hemorrhagic';
  // Respiratory
  if (lower.includes('influenza') || lower.includes('mers') || lower.includes('sars') ||
      lower.includes('covid') || lower.includes('respiratory') || lower.includes('pneumonia') ||
      lower.includes('tuberculosis') || lower.includes('mpox') || lower.includes('monkeypox')) return 'respiratory';
  // Waterborne / enteric
  if (lower.includes('cholera') || lower.includes('typhoid') || lower.includes('hepatitis') ||
      lower.includes('dysentery') || lower.includes('polio')) return 'waterborne';
  // Vector-borne
  if (lower.includes('dengue') || lower.includes('malaria') || lower.includes('zika') ||
      lower.includes('chikungunya') || lower.includes('yellow fever') || lower.includes('rift valley')) return 'vector';
  // Plague & other
  if (lower.includes('plague') || lower.includes('anthrax') || lower.includes('meningitis') ||
      lower.includes('measles') || lower.includes('diphtheria')) return 'bacterial';
  return 'other';
}

function classifySeverity(title, diseaseType) {
  if (diseaseType === 'hemorrhagic') return 'critical';
  const lower = title.toLowerCase();
  if (lower.includes('death') || lower.includes('fatal') || lower.includes('outbreak') ||
      lower.includes('epidemic') || lower.includes('emergency')) return 'high';
  if (lower.includes('case') || lower.includes('cluster') || lower.includes('surge')) return 'medium';
  return 'low';
}

// ---------- Simple XML Parser ----------

function extractItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
    const description = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || block.match(/<description>(.*?)<\/description>/) || [])[1] || '';
    if (title) items.push({ title: title.trim(), link: link.trim(), pubDate: pubDate.trim(), description: description.trim() });
  }
  return items;
}

// ---------- Main Fetch ----------

async function fetchDiseaseOutbreaks() {
  let items = [];

  // Try each URL until one works
  for (const url of WHO_DON_URLS) {
    console.log(`  Trying: ${url}`);
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': CHROME_UA, 'Accept': 'application/json, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!resp.ok) {
        console.warn(`    HTTP ${resp.status} — skipping`);
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';
      const body = await resp.text();

      if (contentType.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
        // JSON API response — WHO OData format: { value: [...] } or direct array
        try {
          const json = JSON.parse(body);
          const entries = json.value || json.Value || (Array.isArray(json) ? json : []);
          for (const entry of entries) {
            const title = entry.Title || entry.title || entry.Name || '';
            const link = entry.UrlName
              ? `https://www.who.int/emergencies/disease-outbreak-news/item/${entry.UrlName}`
              : (entry.ItemDefaultUrl || entry.url || '');
            const pubDate = entry.PublicationDate || entry.PublicationDateAndTime || entry.pubDate || '';
            const description = entry.Summary || entry.Description || entry.description || '';
            if (title) items.push({ title: title.trim(), link, pubDate, description: description.replace(/<[^>]+>/g, '').trim() });
          }
        } catch { /* not valid JSON, try next */ }
      } else if (body.includes('<rss') || body.includes('<item>')) {
        // RSS XML response
        items = extractItems(body);
      }

      if (items.length > 0) {
        console.log(`  Success: ${items.length} items from ${url}`);
        break;
      }
    } catch (err) {
      console.warn(`    Failed: ${err.message}`);
    }
  }

  if (items.length === 0) throw new Error('All WHO DON endpoints returned empty or failed');
  console.log(`  Total DON items: ${items.length}`);

  const events = [];
  for (const item of items) {
    const geo = geocodeCountry(item.title) || geocodeCountry(item.description);
    if (!geo) continue;

    const diseaseType = classifyDisease(item.title);
    const severity = classifySeverity(item.title, diseaseType);
    const timestamp = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();

    events.push({
      id: `don-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: item.title.slice(0, 300),
      diseaseType,
      severity,
      country: geo.country,
      latitude: geo.lat,
      longitude: geo.lon,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      sourceUrl: item.link,
      description: item.description.slice(0, 500),
      dataSource: 'WHO-DON',
    });
  }

  // Sort: critical first, then recent
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  events.sort((a, b) => {
    const sd = (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
    return sd !== 0 ? sd : b.timestamp - a.timestamp;
  });

  console.log(`  Geolocated outbreaks: ${events.length}`);
  return { events, fetchedAt: Date.now() };
}

function validate(data) {
  return Array.isArray(data?.events) && data.events.length >= 1;
}

runSeed('health', 'outbreaks', CANONICAL_KEY, fetchDiseaseOutbreaks, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'who-don-rss-v1',
  recordCount: (data) => data?.events?.length ?? 0,
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
