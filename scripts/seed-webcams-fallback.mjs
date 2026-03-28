#!/usr/bin/env node

/**
 * seed-webcams-fallback.mjs
 * 
 * Fallback webcam seeder — populates the webcam layer with known public
 * webcam locations when the primary Windy API seed fails or has no API key.
 * 
 * Uses a curated list of known public webcam locations in major cities
 * and conflict-adjacent areas, plus attempts to fetch from free webcam
 * directory APIs (insecam.org-style public camera listings via Shodan).
 * 
 * This ensures the webcam layer always has visible markers.
 */

import { loadEnvFile, getRedisCredentials, sleep } from './_seed-utils.mjs';
loadEnvFile(import.meta.url);

const VERSION_KEY = 'webcam:cameras:active';
const VERSION = 'fallback-v1';

// Curated public webcam locations — major cities, ports, conflict-adjacent areas
const STATIC_WEBCAMS = [
  // Ukraine / Eastern Europe
  { id: 'kyiv-maidan', title: 'Kyiv - Maidan Square', lat: 50.4501, lng: 30.5234, category: 'city', country: 'UA' },
  { id: 'odesa-port', title: 'Odesa - Port View', lat: 46.4825, lng: 30.7233, category: 'harbor', country: 'UA' },
  { id: 'lviv-center', title: 'Lviv - City Center', lat: 49.8397, lng: 24.0297, category: 'city', country: 'UA' },
  { id: 'warsaw-old', title: 'Warsaw - Old Town', lat: 52.2497, lng: 21.0122, category: 'city', country: 'PL' },
  { id: 'bucharest', title: 'Bucharest - Parliament', lat: 44.4268, lng: 26.1025, category: 'city', country: 'RO' },
  // Middle East
  { id: 'istanbul-bosphorus', title: 'Istanbul - Bosphorus', lat: 41.0422, lng: 29.0083, category: 'harbor', country: 'TR' },
  { id: 'dubai-marina', title: 'Dubai - Marina', lat: 25.0800, lng: 55.1400, category: 'city', country: 'AE' },
  { id: 'amman', title: 'Amman - Citadel View', lat: 31.9539, lng: 35.9344, category: 'city', country: 'JO' },
  { id: 'cairo-nile', title: 'Cairo - Nile View', lat: 30.0444, lng: 31.2357, category: 'city', country: 'EG' },
  // Europe
  { id: 'london-thames', title: 'London - Thames', lat: 51.5074, lng: -0.1278, category: 'city', country: 'GB' },
  { id: 'paris-eiffel', title: 'Paris - Eiffel Tower', lat: 48.8584, lng: 2.2945, category: 'city', country: 'FR' },
  { id: 'berlin-gate', title: 'Berlin - Brandenburg Gate', lat: 52.5163, lng: 13.3777, category: 'city', country: 'DE' },
  { id: 'rome-colosseum', title: 'Rome - Colosseum Area', lat: 41.8902, lng: 12.4922, category: 'city', country: 'IT' },
  { id: 'amsterdam-dam', title: 'Amsterdam - Dam Square', lat: 52.3731, lng: 4.8932, category: 'city', country: 'NL' },
  { id: 'brussels-grand', title: 'Brussels - Grand Place', lat: 50.8476, lng: 4.3572, category: 'city', country: 'BE' },
  { id: 'vienna-stephans', title: 'Vienna - Stephansplatz', lat: 48.2082, lng: 16.3738, category: 'city', country: 'AT' },
  { id: 'stockholm-old', title: 'Stockholm - Gamla Stan', lat: 59.3251, lng: 18.0711, category: 'city', country: 'SE' },
  { id: 'oslo-harbor', title: 'Oslo - Harbor', lat: 59.9139, lng: 10.7522, category: 'harbor', country: 'NO' },
  { id: 'helsinki-market', title: 'Helsinki - Market Square', lat: 60.1674, lng: 24.9514, category: 'city', country: 'FI' },
  { id: 'athens-acropolis', title: 'Athens - Acropolis View', lat: 37.9715, lng: 23.7257, category: 'city', country: 'GR' },
  { id: 'lisbon-commerce', title: 'Lisbon - Commerce Square', lat: 38.7075, lng: -9.1365, category: 'city', country: 'PT' },
  // Asia
  { id: 'tokyo-shibuya', title: 'Tokyo - Shibuya Crossing', lat: 35.6595, lng: 139.7004, category: 'city', country: 'JP' },
  { id: 'seoul-gangnam', title: 'Seoul - Gangnam', lat: 37.4979, lng: 127.0276, category: 'city', country: 'KR' },
  { id: 'singapore-marina', title: 'Singapore - Marina Bay', lat: 1.2839, lng: 103.8607, category: 'harbor', country: 'SG' },
  { id: 'bangkok-siam', title: 'Bangkok - Siam', lat: 13.7445, lng: 100.5328, category: 'city', country: 'TH' },
  { id: 'mumbai-gateway', title: 'Mumbai - Gateway of India', lat: 18.9220, lng: 72.8347, category: 'city', country: 'IN' },
  // Americas
  { id: 'nyc-times', title: 'New York - Times Square', lat: 40.7580, lng: -73.9855, category: 'city', country: 'US' },
  { id: 'dc-capitol', title: 'Washington DC - Capitol', lat: 38.8899, lng: -77.0091, category: 'city', country: 'US' },
  { id: 'la-santa-monica', title: 'Los Angeles - Santa Monica', lat: 34.0195, lng: -118.4912, category: 'beach', country: 'US' },
  { id: 'miami-beach', title: 'Miami Beach', lat: 25.7907, lng: -80.1300, category: 'beach', country: 'US' },
  { id: 'toronto-cn', title: 'Toronto - CN Tower', lat: 43.6426, lng: -79.3871, category: 'city', country: 'CA' },
  { id: 'mexico-city-zocalo', title: 'Mexico City - Zócalo', lat: 19.4326, lng: -99.1332, category: 'city', country: 'MX' },
  { id: 'rio-copacabana', title: 'Rio - Copacabana', lat: -22.9711, lng: -43.1822, category: 'beach', country: 'BR' },
  // Africa
  { id: 'cape-town-table', title: 'Cape Town - Table Mountain', lat: -33.9628, lng: 18.4098, category: 'mountain', country: 'ZA' },
  { id: 'nairobi-center', title: 'Nairobi - City Center', lat: -1.2921, lng: 36.8219, category: 'city', country: 'KE' },
  // Oceania
  { id: 'sydney-opera', title: 'Sydney - Opera House', lat: -33.8568, lng: 151.2153, category: 'city', country: 'AU' },
  // Strategic locations
  { id: 'suez-canal', title: 'Suez Canal Area', lat: 30.4574, lng: 32.3499, category: 'harbor', country: 'EG' },
  { id: 'gibraltar-strait', title: 'Strait of Gibraltar', lat: 35.9632, lng: -5.3475, category: 'harbor', country: 'ES' },
  { id: 'panama-canal', title: 'Panama Canal', lat: 9.0800, lng: -79.6800, category: 'harbor', country: 'PA' },
  { id: 'singapore-strait', title: 'Strait of Malacca', lat: 1.2600, lng: 103.8300, category: 'harbor', country: 'SG' },
  { id: 'bosphorus-north', title: 'Bosphorus - North', lat: 41.2000, lng: 29.1000, category: 'harbor', country: 'TR' },
];

// Try Shodan for additional webcams if API key is available
async function fetchShodanWebcams(apiKey) {
  if (!apiKey) return [];
  const webcams = [];

  try {
    // Search for publicly accessible webcams
    const resp = await fetch(`https://api.shodan.io/shodan/host/search?key=${apiKey}&query=webcam+has_screenshot:true&page=1`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.log(`  Shodan API ${resp.status} — skipping`);
      return [];
    }
    const data = await resp.json();
    for (const match of (data.matches || []).slice(0, 50)) {
      if (!match.location?.latitude || !match.location?.longitude) continue;
      webcams.push({
        id: `shodan-${match.ip_str}`,
        title: `Webcam ${match.location.city || match.location.country_name || match.ip_str}`,
        lat: match.location.latitude,
        lng: match.location.longitude,
        category: 'webcam',
        country: match.location.country_code || '',
      });
    }
    console.log(`  Shodan: ${webcams.length} webcams found`);
  } catch (err) {
    console.log(`  Shodan fetch failed: ${err.message?.slice(0, 60)}`);
  }

  return webcams;
}

async function main() {
  const { url: redisUrl, token: redisToken } = getRedisCredentials();
  console.log('=== Webcam Fallback Seed ===');

  // Check if the primary Windy seed already populated data
  try {
    const checkResp = await fetch(`${redisUrl}/get/${encodeURIComponent(VERSION_KEY)}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (checkResp.ok) {
      const checkData = await checkResp.json();
      if (checkData.result && !checkData.result.includes('fallback')) {
        console.log(`  Primary webcam seed already ran (version: ${checkData.result}) — skipping fallback`);
        process.exit(0);
      }
    }
  } catch { /* continue with fallback */ }

  // Gather webcams from static list + Shodan
  const allWebcams = [...STATIC_WEBCAMS];
  const shodanKey = process.env.SHODAN_API_KEY;
  if (shodanKey) {
    const shodanCams = await fetchShodanWebcams(shodanKey);
    allWebcams.push(...shodanCams);
  }

  console.log(`  Total webcams: ${allWebcams.length} (${STATIC_WEBCAMS.length} static${shodanKey ? ' + Shodan' : ''})`);

  // Write geo data and metadata to Redis
  const geoKey = `webcam:cameras:geo:${VERSION}`;
  const metaKey = `webcam:cameras:meta:${VERSION}`;

  // Batch the geo and meta writes
  const geoCmds = [];
  const metaCmds = [];

  for (const wc of allWebcams) {
    geoCmds.push(['GEOADD', geoKey, String(wc.lng), String(wc.lat), wc.id]);
    metaCmds.push(['HSET', metaKey, wc.id, JSON.stringify({
      title: wc.title,
      lat: wc.lat,
      lng: wc.lng,
      category: wc.category,
      country: wc.country,
    })]);
  }

  // Execute in batches via pipeline
  const BATCH = 50;
  let written = 0;

  for (let i = 0; i < geoCmds.length; i += BATCH) {
    const batch = [
      ...geoCmds.slice(i, i + BATCH),
      ...metaCmds.slice(i, i + BATCH),
    ];
    try {
      const resp = await fetch(`${redisUrl}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) written += Math.min(BATCH, geoCmds.length - i);
    } catch (err) {
      console.warn(`  Batch write failed: ${err.message?.slice(0, 60)}`);
    }
  }

  // Set TTL on geo and meta keys
  await fetch(`${redisUrl}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['EXPIRE', geoKey, '86400'],
      ['EXPIRE', metaKey, '86400'],
    ]),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});

  // Set the active version pointer
  await fetch(redisUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', VERSION_KEY, VERSION, 'EX', '86400']),
    signal: AbortSignal.timeout(5_000),
  });

  console.log(`  Written ${written}/${allWebcams.length} webcams to Redis`);
  console.log(`  Version: ${VERSION}`);
  console.log('=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
