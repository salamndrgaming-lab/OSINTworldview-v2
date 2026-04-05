#!/usr/bin/env node
/**
 * seed-ais-vessels.mjs — Snapshot AIS vessel positions from aisstream.io
 *
 * Connects to the free aisstream.io WebSocket API, collects vessel position
 * reports for ~90 seconds across major global shipping lanes, deduplicates
 * by MMSI, and writes a snapshot to Redis.
 *
 * The frontend reads this via /api/ais-snapshot which the maritime service
 * polls. This gives baseline vessel positions even without the relay running.
 *
 * Requires: AISSTREAM_API_KEY in environment (free at aisstream.io)
 * Writes:   ais:vessel-snapshot:v1 (3h TTL, matches cron interval)
 *
 * Usage:
 *   node scripts/seed-ais-vessels.mjs
 */

import { loadEnvFile, getRedisCredentials, writeExtraKey, withRetry } from './_seed-utils.mjs';
import { WebSocket } from 'ws';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'ais:vessel-snapshot:v1';
const TTL           = 10800; // 3h — matches cron interval
const COLLECT_MS    = 90_000; // 90 seconds of collection
const MAX_VESSELS   = 2000;  // cap to keep Redis payload reasonable

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';

// Major shipping lane bounding boxes [SW corner, NE corner]
// Coverage: Malacca, Suez approaches, Hormuz, English Channel, 
// Mediterranean, South China Sea, East China Sea, Gulf of Aden,
// US East Coast, US West Coast, North Sea
const BOUNDING_BOXES = [
  [[-10, 95], [10, 115]],     // Malacca Strait + Singapore
  [[25, 30], [35, 45]],       // Suez + Red Sea north
  [[10, 40], [16, 50]],       // Gulf of Aden / Bab el-Mandeb
  [[24, 48], [28, 58]],       // Persian Gulf / Hormuz
  [[30, -10], [55, 15]],      // Western Europe / English Channel / North Sea
  [[30, 0], [45, 35]],        // Mediterranean
  [[0, 100], [25, 125]],      // South China Sea
  [[25, 120], [40, 145]],     // East China Sea / Japan
  [[25, -85], [45, -65]],     // US East Coast
  [[30, -125], [50, -115]],   // US West Coast
  [[-40, -10], [-25, 25]],    // South Africa / Cape route
];

// Ship type codes → human-readable categories
const SHIP_TYPES = {
  // Cargo
  70: 'Cargo', 71: 'Cargo (DG)', 72: 'Cargo (DG)', 73: 'Cargo (DG)', 74: 'Cargo (DG)',
  75: 'Cargo', 76: 'Cargo', 77: 'Cargo', 78: 'Cargo', 79: 'Cargo',
  // Tanker
  80: 'Tanker', 81: 'Tanker (DG)', 82: 'Tanker (DG)', 83: 'Tanker (DG)', 84: 'Tanker (DG)',
  85: 'Tanker', 86: 'Tanker', 87: 'Tanker', 88: 'Tanker', 89: 'Tanker',
  // Passenger
  60: 'Passenger', 61: 'Passenger', 62: 'Passenger', 63: 'Passenger', 64: 'Passenger',
  65: 'Passenger', 66: 'Passenger', 67: 'Passenger', 68: 'Passenger', 69: 'Passenger',
  // Other
  30: 'Fishing', 31: 'Towing', 32: 'Towing (Large)', 33: 'Dredger',
  34: 'Diving', 35: 'Military', 36: 'Sailing', 37: 'Pleasure',
  50: 'Pilot', 51: 'SAR', 52: 'Tug', 53: 'Port Tender', 54: 'Anti-Pollution',
  55: 'Law Enforcement',
};

function getShipCategory(typeCode) {
  if (!typeCode) return 'Unknown';
  return SHIP_TYPES[typeCode] || (typeCode >= 70 && typeCode <= 79 ? 'Cargo' : typeCode >= 80 && typeCode <= 89 ? 'Tanker' : 'Other');
}

function getNavStatus(code) {
  const statuses = {
    0: 'Under Way', 1: 'At Anchor', 2: 'Not Under Command', 3: 'Restricted Maneuverability',
    4: 'Constrained by Draught', 5: 'Moored', 6: 'Aground', 7: 'Engaged in Fishing',
    8: 'Under Way Sailing', 11: 'Power-driven Towing Astern', 12: 'Power-driven Pushing',
    14: 'AIS-SART Active',
  };
  return statuses[code] || 'Unknown';
}

async function collectVesselPositions() {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    console.error('  AISSTREAM_API_KEY not set — get a free key at https://aisstream.io/authenticate');
    console.error('  Add it to GitHub repo secrets as AISSTREAM_API_KEY');
    return null;
  }

  console.log('  Connecting to aisstream.io...');
  console.log('  Bounding boxes: ' + BOUNDING_BOXES.length + ' regions');
  console.log('  Collection window: ' + (COLLECT_MS / 1000) + 's');

  const vessels = new Map(); // MMSI → vessel data
  let messageCount = 0;
  let connected = false;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('  Collection complete: ' + messageCount + ' messages, ' + vessels.size + ' unique vessels');
      if (ws.readyState === WebSocket.OPEN) ws.close();
      resolve(vessels.size > 0 ? Array.from(vessels.values()) : null);
    }, COLLECT_MS);

    const ws = new WebSocket(AISSTREAM_URL);

    ws.on('open', () => {
      connected = true;
      console.log('  Connected to aisstream.io');

      const subscription = {
        APIKey: apiKey,
        BoundingBoxes: BOUNDING_BOXES,
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      };
      ws.send(JSON.stringify(subscription));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        messageCount++;

        if (messageCount % 500 === 0) {
          console.log('    ... ' + messageCount + ' messages, ' + vessels.size + ' vessels');
        }

        const meta = msg.MetaData;
        if (!meta) return;

        const mmsi = String(meta.MMSI || '');
        if (!mmsi || mmsi.length < 5) return;

        const lat = meta.latitude;
        const lon = meta.longitude;
        if (lat == null || lon == null || lat === 0 && lon === 0) return;

        // Build/update vessel record
        const existing = vessels.get(mmsi) || {};
        const vessel = {
          mmsi,
          name: meta.ShipName?.trim() || existing.name || '',
          lat,
          lon,
          speed: null,
          course: null,
          heading: null,
          navStatus: existing.navStatus || '',
          shipType: existing.shipType || 0,
          shipCategory: existing.shipCategory || 'Unknown',
          destination: existing.destination || '',
          flag: meta.country_code || existing.flag || '',
          lastUpdate: meta.time_utc || new Date().toISOString(),
          ...existing, // preserve previous fields
          // Always update position from latest message
          lat: lat,
          lon: lon,
          lastUpdate: meta.time_utc || new Date().toISOString(),
        };

        // Extract position-specific fields
        if (msg.MessageType === 'PositionReport') {
          const pr = msg.Message?.PositionReport;
          if (pr) {
            vessel.speed = pr.Sog ?? vessel.speed;
            vessel.course = pr.Cog ?? vessel.course;
            vessel.heading = pr.TrueHeading !== 511 ? pr.TrueHeading : vessel.heading;
            vessel.navStatus = getNavStatus(pr.NavigationalStatus);
          }
        }

        // Extract static data
        if (msg.MessageType === 'ShipStaticData') {
          const sd = msg.Message?.ShipStaticData;
          if (sd) {
            vessel.name = sd.Name?.trim() || vessel.name;
            vessel.shipType = sd.Type ?? vessel.shipType;
            vessel.shipCategory = getShipCategory(sd.Type);
            vessel.destination = sd.Destination?.trim() || vessel.destination;
            vessel.imo = sd.ImoNumber || vessel.imo;
            vessel.callsign = sd.CallSign?.trim() || vessel.callsign;
            vessel.length = sd.Dimension?.A + sd.Dimension?.B || vessel.length;
            vessel.width = sd.Dimension?.C + sd.Dimension?.D || vessel.width;
          }
        }

        // Update name from metadata if still empty
        if (!vessel.name && meta.ShipName) vessel.name = meta.ShipName.trim();

        vessels.set(mmsi, vessel);

        // Cap collection
        if (vessels.size >= MAX_VESSELS) {
          console.log('  Hit vessel cap (' + MAX_VESSELS + '), stopping early');
          clearTimeout(timeout);
          ws.close();
          resolve(Array.from(vessels.values()));
        }
      } catch {
        // Skip malformed messages
      }
    });

    ws.on('error', (err) => {
      console.error('  WebSocket error:', err.message);
      if (!connected) {
        clearTimeout(timeout);
        resolve(null);
      }
    });

    ws.on('close', (code) => {
      if (code !== 1000 && vessels.size === 0) {
        console.warn('  WebSocket closed with code ' + code + ' before collecting data');
        clearTimeout(timeout);
        resolve(null);
      }
    });
  });
}

async function main() {
  console.log('=== seed-ais-vessels: AIS Vessel Position Snapshot ===');

  const vessels = await collectVesselPositions();

  if (!vessels || vessels.length === 0) {
    console.warn('  No vessel data collected — check AISSTREAM_API_KEY');
    console.log('=== Done (no data) ===');
    return;
  }

  // Categorize for stats
  const categories = {};
  for (const v of vessels) {
    const cat = v.shipCategory || 'Unknown';
    categories[cat] = (categories[cat] || 0) + 1;
  }

  console.log('  Categories:', JSON.stringify(categories));

  const payload = {
    vessels,
    count: vessels.length,
    categories,
    collectedAt: new Date().toISOString(),
    source: 'aisstream.io',
    boundingBoxes: BOUNDING_BOXES.length,
  };

  await withRetry(() => writeExtraKey(CANONICAL_KEY, payload, TTL));

  // Also write to the key that /api/ais-snapshot reads for backward compat
  // The ais-snapshot API falls back to this when the relay isn't running
  const snapshotPayload = {
    vessels: vessels.map(v => ({
      mmsi: v.mmsi,
      name: v.name,
      lat: v.lat,
      lon: v.lon,
      speed: v.speed,
      course: v.course,
      heading: v.heading,
      shipType: v.shipType,
      flag: v.flag,
      destination: v.destination,
      navStatus: v.navStatus,
      lastAisUpdate: v.lastUpdate,
    })),
    timestamp: new Date().toISOString(),
    source: 'seed-ais-vessels',
    configured: true,
  };

  await withRetry(() => writeExtraKey('ais:snapshot:latest', snapshotPayload, TTL));

  console.log('  ✅ Wrote ' + vessels.length + ' vessels to Redis');
  console.log('=== Done ===');
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
