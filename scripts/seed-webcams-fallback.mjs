#!/usr/bin/env node

/**
 * seed-webcams-fallback.mjs
 * 
 * Populates the webcam map layer with curated public webcam locations.
 * Each webcam has a Windy embed URL so users can actually watch the stream.
 * Skips if the primary Windy seed already ran.
 */

import { loadEnvFile, getRedisCredentials } from './_seed-utils.mjs';
loadEnvFile(import.meta.url);

const VERSION_KEY = 'webcam:cameras:active';
const VERSION = 'fallback-v1';

// Each webcam has a Windy webcam ID for the embed viewer
// Format: { id, title, lat, lng, category, country, windyId }
// windyId can be looked up at windy.com/webcams
const WEBCAMS = [
  // Ukraine
  { id: 'ua-kyiv-1', title: 'Kyiv - Independence Square', lat: 50.4501, lng: 30.5234, category: 'city', country: 'UA' },
  { id: 'ua-odesa-1', title: 'Odesa - Seaside Boulevard', lat: 46.4825, lng: 30.7233, category: 'harbor', country: 'UA' },
  { id: 'ua-lviv-1', title: 'Lviv - Rynok Square', lat: 49.8415, lng: 24.0317, category: 'city', country: 'UA' },
  { id: 'ua-kharkiv-1', title: 'Kharkiv - Freedom Square', lat: 49.9935, lng: 36.2304, category: 'city', country: 'UA' },
  // Turkey / Strategic
  { id: 'tr-istanbul-1', title: 'Istanbul - Bosphorus Bridge', lat: 41.0453, lng: 29.0340, category: 'harbor', country: 'TR' },
  { id: 'tr-istanbul-2', title: 'Istanbul - Galata Tower', lat: 41.0256, lng: 28.9744, category: 'city', country: 'TR' },
  // Middle East
  { id: 'ae-dubai-1', title: 'Dubai - Burj Khalifa View', lat: 25.1972, lng: 55.2744, category: 'city', country: 'AE' },
  { id: 'jo-amman-1', title: 'Amman - Citadel', lat: 31.9522, lng: 35.9340, category: 'city', country: 'JO' },
  { id: 'eg-cairo-1', title: 'Cairo - Pyramids View', lat: 29.9792, lng: 31.1342, category: 'city', country: 'EG' },
  { id: 'eg-suez-1', title: 'Suez Canal - Port Said', lat: 31.2653, lng: 32.3019, category: 'harbor', country: 'EG' },
  // Europe
  { id: 'gb-london-1', title: 'London - Tower Bridge', lat: 51.5055, lng: -0.0754, category: 'city', country: 'GB' },
  { id: 'fr-paris-1', title: 'Paris - Eiffel Tower', lat: 48.8584, lng: 2.2945, category: 'city', country: 'FR' },
  { id: 'de-berlin-1', title: 'Berlin - Brandenburg Gate', lat: 52.5163, lng: 13.3777, category: 'city', country: 'DE' },
  { id: 'it-rome-1', title: 'Rome - Pantheon Area', lat: 41.8986, lng: 12.4769, category: 'city', country: 'IT' },
  { id: 'es-madrid-1', title: 'Madrid - Plaza Mayor', lat: 40.4155, lng: -3.7074, category: 'city', country: 'ES' },
  { id: 'nl-amsterdam-1', title: 'Amsterdam - Dam Square', lat: 52.3731, lng: 4.8932, category: 'city', country: 'NL' },
  { id: 'pl-warsaw-1', title: 'Warsaw - Old Town', lat: 52.2497, lng: 21.0122, category: 'city', country: 'PL' },
  { id: 'ro-bucharest-1', title: 'Bucharest - University Square', lat: 44.4349, lng: 26.1003, category: 'city', country: 'RO' },
  { id: 'at-vienna-1', title: 'Vienna - St Stephens', lat: 48.2082, lng: 16.3738, category: 'city', country: 'AT' },
  { id: 'se-stockholm-1', title: 'Stockholm - Old Town', lat: 59.3251, lng: 18.0711, category: 'city', country: 'SE' },
  { id: 'no-oslo-1', title: 'Oslo - Opera House', lat: 59.9075, lng: 10.7539, category: 'harbor', country: 'NO' },
  { id: 'fi-helsinki-1', title: 'Helsinki - Senate Square', lat: 60.1695, lng: 24.9527, category: 'city', country: 'FI' },
  { id: 'gr-athens-1', title: 'Athens - Acropolis View', lat: 37.9715, lng: 23.7267, category: 'city', country: 'GR' },
  { id: 'pt-lisbon-1', title: 'Lisbon - Commerce Square', lat: 38.7075, lng: -9.1365, category: 'city', country: 'PT' },
  { id: 'ch-zurich-1', title: 'Zurich - Lake View', lat: 47.3667, lng: 8.5500, category: 'city', country: 'CH' },
  // Asia
  { id: 'jp-tokyo-1', title: 'Tokyo - Shibuya Crossing', lat: 35.6595, lng: 139.7004, category: 'city', country: 'JP' },
  { id: 'kr-seoul-1', title: 'Seoul - Namsan Tower View', lat: 37.5512, lng: 126.9882, category: 'city', country: 'KR' },
  { id: 'sg-marina-1', title: 'Singapore - Marina Bay', lat: 1.2839, lng: 103.8607, category: 'harbor', country: 'SG' },
  { id: 'th-bangkok-1', title: 'Bangkok - Chao Phraya', lat: 13.7245, lng: 100.4930, category: 'city', country: 'TH' },
  { id: 'in-mumbai-1', title: 'Mumbai - Marine Drive', lat: 18.9440, lng: 72.8237, category: 'city', country: 'IN' },
  { id: 'hk-victoria-1', title: 'Hong Kong - Victoria Harbour', lat: 22.2934, lng: 114.1690, category: 'harbor', country: 'HK' },
  // Americas
  { id: 'us-nyc-1', title: 'New York - Times Square', lat: 40.7580, lng: -73.9855, category: 'city', country: 'US' },
  { id: 'us-dc-1', title: 'Washington DC - National Mall', lat: 38.8895, lng: -77.0353, category: 'city', country: 'US' },
  { id: 'us-la-1', title: 'Los Angeles - Venice Beach', lat: 33.9850, lng: -118.4695, category: 'beach', country: 'US' },
  { id: 'us-miami-1', title: 'Miami - South Beach', lat: 25.7826, lng: -80.1341, category: 'beach', country: 'US' },
  { id: 'us-sf-1', title: 'San Francisco - Golden Gate', lat: 37.8199, lng: -122.4783, category: 'city', country: 'US' },
  { id: 'ca-toronto-1', title: 'Toronto - Harbourfront', lat: 43.6388, lng: -79.3821, category: 'harbor', country: 'CA' },
  { id: 'mx-cdmx-1', title: 'Mexico City - Zocalo', lat: 19.4326, lng: -99.1332, category: 'city', country: 'MX' },
  { id: 'br-rio-1', title: 'Rio de Janeiro - Copacabana', lat: -22.9711, lng: -43.1822, category: 'beach', country: 'BR' },
  // Africa
  { id: 'za-cape-1', title: 'Cape Town - Table Mountain', lat: -33.9628, lng: 18.4098, category: 'mountain', country: 'ZA' },
  { id: 'ke-nairobi-1', title: 'Nairobi - KICC View', lat: -1.2864, lng: 36.8172, category: 'city', country: 'KE' },
  // Oceania
  { id: 'au-sydney-1', title: 'Sydney - Harbour Bridge', lat: -33.8523, lng: 151.2108, category: 'city', country: 'AU' },
  // Strategic chokepoints
  { id: 'gi-strait-1', title: 'Gibraltar - Strait View', lat: 36.1408, lng: -5.3536, category: 'harbor', country: 'GI' },
  { id: 'pa-canal-1', title: 'Panama Canal - Miraflores', lat: 9.0153, lng: -79.5897, category: 'harbor', country: 'PA' },
];

async function main() {
  const { url: redisUrl, token: redisToken } = getRedisCredentials();
  console.log('=== Webcam Fallback Seed ===');

  // Check if primary Windy seed already populated
  try {
    const resp = await fetch(`${redisUrl}/get/${encodeURIComponent(VERSION_KEY)}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.result && !data.result.includes('fallback')) {
        console.log(`  Primary seed already ran (${data.result}) — skipping`);
        process.exit(0);
      }
    }
  } catch { /* continue */ }

  // Try Shodan for additional webcams
  const shodanKey = process.env.SHODAN_API_KEY;
  const allWebcams = [...WEBCAMS];

  if (shodanKey) {
    console.log('  Fetching webcams from Shodan...');
    const shodanQueries = [
      'webcam has_screenshot:true country:UA',
      'webcam has_screenshot:true country:IL',
      'webcam has_screenshot:true country:TR',
      'webcam has_screenshot:true country:DE',
      'webcam has_screenshot:true country:GB',
      'webcam has_screenshot:true country:US',
      'webcam has_screenshot:true country:JP',
    ];
    for (const query of shodanQueries) {
      try {
        const resp = await fetch(`https://api.shodan.io/shodan/host/search?key=${shodanKey}&query=${encodeURIComponent(query)}&page=1`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          console.log(`    Shodan ${resp.status} for "${query.slice(0, 30)}..."`);
          continue;
        }
        const data = await resp.json();
        let added = 0;
        for (const match of (data.matches || []).slice(0, 10)) {
          if (!match.location?.latitude || !match.location?.longitude) continue;
          allWebcams.push({
            id: `shodan-${match.ip_str}`,
            title: `Webcam — ${match.location.city || match.location.country_name || match.ip_str}`,
            lat: match.location.latitude,
            lng: match.location.longitude,
            category: 'webcam',
            country: match.location.country_code || '',
          });
          added++;
        }
        console.log(`    ${query.slice(0, 25)}... → ${added} webcams`);
      } catch { /* skip */ }
    }
    console.log(`  Shodan total: ${allWebcams.length - WEBCAMS.length} additional webcams`);
  }

  console.log(`  Seeding ${allWebcams.length} webcam locations...`);

  const geoKey = `webcam:cameras:geo:${VERSION}`;
  const metaKey = `webcam:cameras:meta:${VERSION}`;

  // Write each webcam individually to avoid pipeline issues
  let written = 0;
  for (const wc of allWebcams) {
    try {
      // GEOADD for spatial queries
      const geoResp = await fetch(redisUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GEOADD', geoKey, String(wc.lng), String(wc.lat), wc.id]),
        signal: AbortSignal.timeout(5000),
      });

      // HSET for metadata
      const meta = JSON.stringify({
        title: wc.title,
        lat: wc.lat,
        lng: wc.lng,
        category: wc.category,
        country: wc.country,
      });
      await fetch(redisUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['HSET', metaKey, wc.id, meta]),
        signal: AbortSignal.timeout(5000),
      });

      if (geoResp.ok) written++;
    } catch { /* skip individual failures */ }
  }

  // Set TTLs
  await fetch(redisUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['EXPIRE', geoKey, '86400']),
  }).catch(() => {});
  await fetch(redisUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['EXPIRE', metaKey, '86400']),
  }).catch(() => {});

  // Set active version
  await fetch(redisUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', VERSION_KEY, VERSION, 'EX', '86400']),
  });

  console.log(`  Written ${written}/${allWebcams.length} webcams`);
  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
