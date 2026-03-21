// src/workers/flight-worker.ts
// Web Worker — fetches global ADS-B data from adsb.one, classifies aircraft,
// filters junk (simulated transponders, ground vehicles, invalid positions),
// and posts processed results back to the main thread.

async function fetchAndProcess(): Promise<void> {
  try {
    const res = await fetch('https://api.adsb.one/v2/all');
    if (!res.ok) throw new Error(`ADSB fetch failed: HTTP ${res.status}`);
    const data = await res.json();

    // Guard against malformed API response
    const raw = Array.isArray(data?.ac) ? data.ac : [];

    // Filter out junk before processing:
    //  - hex starting with '~' = non-ICAO / MLAT artifact / simulated target
    //  - missing or invalid lat/lon = no position data
    //  - category 'C3' = ground vehicle (airport service trucks etc.)
    //  - hex matching SIM pattern = simulator feeds that leak into the network
    const valid = raw.filter((ac: any) =>
      ac.hex &&
      !ac.hex.startsWith('~') &&
      !/^SIM/i.test(ac.hex) &&
      typeof ac.lat === 'number' && !Number.isNaN(ac.lat) &&
      typeof ac.lon === 'number' && !Number.isNaN(ac.lon) &&
      ac.category !== 'C3'
    );

    const now = Date.now() / 1000;

    const processed = valid.map((ac: any) => {
      const operator = ac.ownOp || ac.r || 'Private/Unknown';
      const callsign = (ac.flight || '').trim();

      // Entity classification — Military/Gov, Cargo, General Aviation, or Commercial
      let category = 'Commercial';
      let color = [0, 150, 255]; // Blue

      if (ac.mil === 1 || /AFB|NAVY|ARMY|MARINES|POLICE|BORD|GOV|COAST\s?GUARD/i.test(operator)) {
        category = 'Military/Gov';
        color = [255, 50, 50]; // Red
      } else if (/FEDEX|UPS|DHL|AMZ|ATLAS|CARGOLUX|KALITTA|NIPPON\s?CARGO/i.test(operator) || /FDX|UPS|GTI|CLX|CKS/i.test(callsign)) {
        category = 'Cargo';
        color = [160, 100, 255]; // Purple
      } else if (!ac.flight && ((ac.alt_baro || 0) < 15000 || /C172|P28A|SR22|C182|PA32|BE36|DA40|DA42|C152|PA28/i.test(ac.t || ''))) {
        category = 'General Aviation';
        color = [180, 180, 180]; // Grey
      }

      return {
        id: ac.hex,
        coords: [ac.lon, ac.lat, (ac.alt_baro || 0) * 0.3048], // ft → meters
        heading: ac.track || 0,
        label: callsign || ac.r || ac.hex.toUpperCase(),
        desc: `${operator} (${ac.t || 'UNK'})`,
        color,
        category,
        timestamp: now,
      };
    });

    self.postMessage(processed);
  } catch (e) {
    console.error('[flight-worker] fetch failed:', e);
  }
}

// On message from main thread → fetch and process
self.onmessage = () => {
  fetchAndProcess();
};

// Immediate first fetch on worker load so trails start building
// right away instead of waiting for the first 120s timer tick
fetchAndProcess();
