// src/workers/flight-worker.ts
// Web Worker — fetches global ADS-B data via /api/adsb proxy,
// classifies aircraft with expanded military/gov detection,
// filters junk, and posts enriched results to the main thread.

// Expanded military/gov operator patterns — catches branches, agencies, and international forces
const MIL_OPERATOR_RE = /\b(AIR\s?FORCE|AIRFORCE|NAVY|ARMY|MARINES|USMC|USCG|COAST\s?GUARD|NATIONAL\s?GUARD|POLICE|BORDER|GOV|GOVERNMENT|MILITARY|ARMED\s?FORCES|ROYAL\s?AIR|RAF|LUFTWAFFE|AERONAUTICA|FUERZA\s?AEREA|ARMADA|PLAAF|PLAN|PLA|JASDF|JMSDF|ROKAF|ROKN|IAF|RAAF|RNZAF|RCAF|PAF|RSAF|USAF|USN|DOD|DEPT\s?OF\s?DEFENSE|MINISTRY\s?OF\s?DEF|NATO|NORAD|STRATCOM|FBI|SECRET\s?SERVICE|CUSTOMS|ICE|CBP|DEA|ATF|MARSHALS|DHS|STATE\s?DEPT|NATL?\s?GUARD)\b/i;

// Military callsign prefixes — ICAO 3-letter codes for military operators worldwide
const MIL_CALLSIGN_RE = /^(RCH|REACH|EVAC|SAM|EXEC|NAVY|ARMY|AIR|JAKE|DUKE|BOLT|TOPCAT|SKULL|VIPER|HAWK|EAGLE|COBRA|RAVEN|SHADOW|DARK|STORK|PAT|SPAR|GRZLY|TIGER|BEARS|CASA|PLF|CFC|IAM|GAF|BAF|RRR|ASY|CNV|MMF|RFR|CTM|HVK|SVF|RSD)\d/i;

// Cargo operator names and callsign prefixes
const CARGO_OPERATOR_RE = /\b(FEDEX|UPS|DHL|AMAZON|AMZ|ATLAS\s?AIR|CARGOLUX|KALITTA|NIPPON\s?CARGO|POLAR\s?AIR|SOUTHERN\s?AIR|WESTERN\s?GLOBAL|ABX\s?AIR|AIR\s?TRANSPORT|ASTAR|AMERIJET|MARTINAIR\s?CARGO)\b/i;
const CARGO_CALLSIGN_RE = /^(FDX|UPS|GTI|CLX|CKS|PAC|SOO|WGN|ABX|ATN|AJT|MPH)\d/i;

// General aviation aircraft type codes (single/twin piston, light sport)
const GA_TYPE_RE = /^(C1[2-9]\d|C20[0-6]|P28[A-T]|PA2[4-8]|PA3[0-9]|BE[23]\d|BE[9A]|DA[24]\d|SR2[0-2]|M20[A-V]|AA[15]|TB[0-9]|RV\d|GLID|BALL|ULM)/i;

async function fetchAndProcess(): Promise<void> {
  try {
    const res = await fetch('/api/adsb');
    if (!res.ok) throw new Error(`ADSB proxy HTTP ${res.status}`);
    const data = await res.json();

    const raw = Array.isArray(data?.ac) ? data.ac : [];
    if (raw.length === 0) {
      console.warn('[flight-worker] API returned 0 aircraft');
      self.postMessage([]);
      return;
    }

    // Filter out junk
    const valid = raw.filter((ac: any) =>
      ac.hex &&
      !ac.hex.startsWith('~') &&
      !/^SIM/i.test(ac.hex) &&
      typeof ac.lat === 'number' && !Number.isNaN(ac.lat) &&
      typeof ac.lon === 'number' && !Number.isNaN(ac.lon) &&
      ac.category !== 'C3'
    );

    console.log(`[flight-worker] ${raw.length} raw → ${valid.length} after filter (dropped ${raw.length - valid.length})`);

    const now = Date.now() / 1000;

    const processed = valid.map((ac: any) => {
      const operator = ac.ownOp || ac.r || 'Private/Unknown';
      const callsign = (ac.flight || '').trim();
      const registration = (ac.r || '').trim();
      const acType = (ac.t || '').trim();

      // Classification with expanded military detection
      let category = 'Commercial';
      let color = [0, 150, 255]; // Blue

      // dbFlags bit 1 = military (from aircraft database), or ac.mil flag, or operator/callsign regex match
      const isMilByFlag = ac.mil === 1 || ((ac.dbFlags || 0) & 1) === 1;
      const isMilByOperator = MIL_OPERATOR_RE.test(operator);
      const isMilByCallsign = callsign && MIL_CALLSIGN_RE.test(callsign);

      if (isMilByFlag || isMilByOperator || isMilByCallsign) {
        category = 'Military/Gov';
        color = [255, 50, 50]; // Red
      } else if (CARGO_OPERATOR_RE.test(operator) || (callsign && CARGO_CALLSIGN_RE.test(callsign))) {
        category = 'Cargo';
        color = [160, 100, 255]; // Purple
      } else if (!callsign && ((ac.alt_baro || 0) < 15000 || GA_TYPE_RE.test(acType))) {
        category = 'General Aviation';
        color = [180, 180, 180]; // Grey
      }

      return {
        id: ac.hex,
        coords: [ac.lon, ac.lat, (ac.alt_baro || 0) * 0.3048],
        heading: ac.track || 0,
        label: callsign || registration || ac.hex.toUpperCase(),
        desc: `${operator} (${acType || 'UNK'})`,
        color,
        category,
        timestamp: now,
        // Extra fields for enriched tooltip
        registration: registration || null,
        acType: acType || null,
        operator,
        squawk: ac.squawk || null,
        groundSpeed: typeof ac.gs === 'number' ? Math.round(ac.gs) : null,
        verticalRate: typeof ac.baro_rate === 'number' ? Math.round(ac.baro_rate) : null,
        onGround: ac.alt_baro === 'ground' || ac.ground === true,
        emergency: ac.emergency && ac.emergency !== 'none' ? ac.emergency : null,
        rssi: typeof ac.rssi === 'number' ? ac.rssi : null,
        seen: typeof ac.seen === 'number' ? ac.seen : null,
        dbFlags: ac.dbFlags || 0,
      };
    });

    self.postMessage(processed);
  } catch (e) {
    console.error('[flight-worker] fetch failed:', e);
  }
}

self.onmessage = () => {
  fetchAndProcess();
};

setTimeout(() => fetchAndProcess(), 2000);
