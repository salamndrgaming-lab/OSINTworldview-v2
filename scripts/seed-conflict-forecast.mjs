#!/usr/bin/env node

// seed-conflict-forecast.mjs — Fetches armed conflict probability forecasts from
// the Uppsala/PRIO VIEWS API (fatalities003 model). Country-month level predictions
// of the probability of ≥25 battle-related deaths, plus predicted fatality counts.
// Forecasts update monthly; we cache for 24h.

import { loadEnvFile, CHROME_UA, runSeed, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const VIEWS_API = 'https://api.viewsforecasting.org';
const CANONICAL_KEY = 'forecast:conflict:v1';
const CACHE_TTL = 86400; // 24h — VIEWS updates monthly

// Gleditsch-Ward country ID → ISO Alpha-2 mapping (covers all VIEWS countries)
// This is needed because VIEWS uses its own country IDs, not ISO codes.
const GW_TO_ISO = {
  2: 'US', 20: 'CA', 31: 'BH', 40: 'CU', 41: 'HT', 42: 'DO', 51: 'JM', 52: 'TT',
  70: 'MX', 80: 'BZ', 90: 'GT', 91: 'HN', 92: 'SV', 93: 'NI', 94: 'CR', 95: 'PA',
  100: 'CO', 101: 'VE', 110: 'GY', 115: 'SR', 130: 'EC', 135: 'PE', 140: 'BR',
  145: 'BO', 150: 'PY', 155: 'CL', 160: 'AR', 165: 'UY', 200: 'GB', 205: 'IE',
  210: 'NL', 211: 'BE', 212: 'LU', 220: 'FR', 225: 'CH', 230: 'ES', 235: 'PT',
  255: 'DE', 260: 'DE', 265: 'DE', 290: 'PL', 305: 'AT', 310: 'HU', 315: 'CZ',
  316: 'CZ', 317: 'SK', 325: 'IT', 338: 'MT', 339: 'AL', 341: 'ME', 343: 'MK',
  344: 'HR', 345: 'RS', 346: 'BA', 349: 'SI', 350: 'GR', 352: 'CY', 355: 'BG',
  359: 'MD', 360: 'RO', 365: 'RU', 366: 'EE', 367: 'LV', 368: 'LT', 369: 'UA',
  370: 'BY', 371: 'AM', 372: 'GE', 373: 'AZ', 375: 'FI', 380: 'SE', 385: 'NO',
  390: 'DK', 395: 'IS', 402: 'KM', 403: 'MU', 404: 'MG', 411: 'SZ', 420: 'GM',
  432: 'ML', 433: 'SN', 434: 'BJ', 435: 'MR', 436: 'NE', 437: 'CI', 438: 'GN',
  439: 'BF', 450: 'LR', 451: 'SL', 452: 'GH', 461: 'TG', 471: 'CM', 475: 'NG',
  481: 'GA', 482: 'CF', 483: 'TD', 484: 'CG', 490: 'CD', 500: 'UG', 501: 'KE',
  510: 'TZ', 516: 'BI', 517: 'RW', 520: 'SO', 522: 'DJ', 530: 'ET', 531: 'ER',
  540: 'AO', 541: 'MZ', 551: 'ZM', 552: 'ZW', 553: 'MW', 560: 'ZA', 565: 'NA',
  570: 'LS', 571: 'BW', 572: 'SZ', 580: 'MG', 581: 'KM', 590: 'MU', 591: 'SC',
  600: 'MA', 615: 'DZ', 616: 'TN', 620: 'LY', 625: 'SD', 626: 'SS', 630: 'IR',
  640: 'TR', 645: 'IQ', 651: 'EG', 652: 'SY', 660: 'LB', 663: 'JO', 666: 'IL',
  670: 'SA', 678: 'YE', 679: 'YE', 690: 'KW', 692: 'BH', 694: 'QA', 696: 'AE',
  698: 'OM', 700: 'AF', 701: 'TM', 702: 'TJ', 703: 'KG', 704: 'UZ', 705: 'KZ',
  710: 'CN', 712: 'MN', 713: 'TW', 731: 'KP', 732: 'KR', 740: 'JP', 750: 'IN',
  760: 'BT', 770: 'PK', 771: 'BD', 775: 'MM', 780: 'LK', 781: 'MV', 790: 'NP',
  800: 'TH', 811: 'KH', 812: 'LA', 816: 'VN', 820: 'MY', 830: 'SG', 835: 'BN',
  840: 'PH', 850: 'ID', 860: 'TL', 900: 'AU', 910: 'PG', 920: 'NZ', 940: 'SB',
  950: 'FJ',
};

// Country centroids for the choropleth (lat, lon per ISO code)
const COUNTRY_CENTROIDS = {
  AF: [33.93, 67.71], AL: [41.15, 20.17], DZ: [28.03, 1.66], AO: [-11.20, 17.87],
  AR: [-38.42, -63.62], AM: [40.07, 45.04], AU: [-25.27, 133.78], AT: [47.52, 14.55],
  AZ: [40.14, 47.58], BH: [26.03, 50.55], BD: [23.68, 90.36], BY: [53.71, 27.95],
  BE: [50.50, 4.47], BZ: [17.19, -88.50], BJ: [9.31, 2.32], BT: [27.51, 90.43],
  BO: [-16.29, -63.59], BA: [43.92, 17.68], BW: [-22.33, 24.68], BR: [-14.24, -51.93],
  BN: [4.54, 114.73], BG: [42.73, 25.49], BF: [12.24, -1.56], BI: [-3.37, 29.92],
  KH: [12.57, 104.99], CM: [7.37, 12.35], CA: [56.13, -106.35], CF: [6.61, 20.94],
  TD: [15.45, 18.73], CL: [-35.68, -71.54], CN: [35.86, 104.20], CO: [4.57, -74.30],
  KM: [-11.88, 43.87], CG: [-0.23, 15.83], CD: [-4.04, 21.76], CR: [9.75, -83.75],
  HR: [45.10, 15.20], CU: [21.52, -77.78], CY: [35.13, 33.43], CZ: [49.82, 15.47],
  DK: [56.26, 9.50], DJ: [11.83, 42.59], DO: [18.74, -70.16], EC: [-1.83, -78.18],
  EG: [26.82, 30.80], SV: [13.79, -88.90], ER: [15.18, 39.78], EE: [58.60, 25.01],
  ET: [9.15, 40.49], FJ: [-17.71, 178.07], FI: [61.92, 25.75], FR: [46.23, 2.21],
  GA: [-0.80, 11.61], GM: [13.44, -15.31], GE: [42.32, 43.36], DE: [51.17, 10.45],
  GH: [7.95, -1.02], GR: [39.07, 21.82], GT: [15.78, -90.23], GN: [9.95, -9.70],
  GY: [4.86, -58.93], HT: [18.97, -72.29], HN: [15.20, -86.24], HU: [47.16, 19.50],
  IS: [64.96, -19.02], IN: [20.59, 78.96], ID: [-0.79, 113.92], IR: [32.43, 53.69],
  IQ: [33.22, 43.68], IE: [53.14, -7.69], IL: [31.05, 34.85], IT: [41.87, 12.57],
  CI: [7.54, -5.55], JM: [18.11, -77.30], JP: [36.20, 138.25], JO: [30.59, 36.24],
  KZ: [48.02, 66.92], KE: [-0.02, 37.91], KP: [40.34, 127.51], KR: [35.91, 127.77],
  KW: [29.31, 47.48], KG: [41.20, 74.77], LA: [19.86, 102.50], LV: [56.88, 24.60],
  LB: [33.85, 35.86], LS: [-29.61, 28.23], LR: [6.43, -9.43], LY: [26.34, 17.23],
  LT: [55.17, 23.88], LU: [49.82, 6.13], MK: [41.51, 21.75], MG: [-18.77, 46.87],
  MW: [-13.25, 34.30], MY: [4.21, 101.98], MV: [3.20, 73.22], ML: [17.57, -4.00],
  MT: [35.94, 14.38], MR: [21.01, -10.94], MU: [-20.35, 57.55], MX: [23.63, -102.55],
  MD: [47.41, 28.37], MN: [46.86, 103.85], ME: [42.71, 19.37], MA: [31.79, -7.09],
  MZ: [-18.67, 35.53], MM: [21.91, 95.96], NA: [-22.96, 18.49], NP: [28.39, 84.12],
  NL: [52.13, 5.29], NZ: [-40.90, 174.89], NI: [12.87, -85.21], NE: [17.61, 8.08],
  NG: [9.08, 8.68], NO: [60.47, 8.47], OM: [21.51, 55.92], PK: [30.38, 69.35],
  PA: [8.54, -80.78], PG: [-6.31, 143.96], PY: [-23.44, -58.44], PE: [-9.19, -75.02],
  PH: [12.88, 121.77], PL: [51.92, 19.15], PT: [39.40, -8.22], QA: [25.35, 51.18],
  RO: [45.94, 24.97], RU: [61.52, 105.32], RW: [-1.94, 29.87], SA: [23.89, 45.08],
  SN: [14.50, -14.45], RS: [44.02, 21.01], SC: [-4.68, 55.49], SL: [8.46, -11.78],
  SG: [1.35, 103.82], SK: [48.67, 19.70], SI: [46.15, 14.99], SB: [-9.65, 160.16],
  SO: [5.15, 46.20], ZA: [-30.56, 22.94], SS: [6.88, 31.31], ES: [40.46, -3.75],
  LK: [7.87, 80.77], SD: [12.86, 30.22], SR: [3.92, -56.03], SZ: [-26.52, 31.47],
  SE: [60.13, 18.64], CH: [46.82, 8.23], SY: [34.80, 38.99], TW: [23.70, 120.96],
  TJ: [38.86, 71.28], TZ: [-6.37, 34.89], TH: [15.87, 100.99], TL: [-8.87, 125.73],
  TG: [8.62, 1.21], TT: [10.69, -61.22], TN: [33.89, 9.54], TR: [38.96, 35.24],
  TM: [38.97, 59.56], UG: [1.37, 32.29], UA: [48.38, 31.17], AE: [23.42, 53.85],
  GB: [55.38, -3.44], US: [37.09, -95.71], UY: [-32.52, -55.77], UZ: [41.38, 64.59],
  VE: [6.42, -66.59], VN: [14.06, 108.28], YE: [15.55, 48.52], ZM: [-13.13, 27.85],
  ZW: [-19.02, 29.15],
};

async function fetchConflictForecasts() {
  // The VIEWS API uses the format: /{run}/{loa}/{type_of_violence}
  // "current" aliases the latest production run. We fetch country-month state-based predictions.
  // The response includes paginated data with country_id, month_id, and prediction values.
  // Try multiple endpoint formats since the API structure may vary between versions.
  const endpoints = [
    `${VIEWS_API}/current/cm/sb?pagesize=500`,
    `${VIEWS_API}/fatalities003/cm/sb?pagesize=500`,
    `${VIEWS_API}/fatalities002/cm/sb?pagesize=500`,
  ];

  let records = [];

  for (const probUrl of endpoints) {
    console.log(`  Trying: ${probUrl}`);
    try {
      const resp = await fetch(probUrl, {
        headers: { 'User-Agent': CHROME_UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        console.warn(`    HTTP ${resp.status} — skipping`);
        continue;
      }

      const data = await resp.json();
      // VIEWS API wraps data in a "data" array with metadata
      records = Array.isArray(data) ? data : (data.data || data.results || []);
      if (records.length > 0) {
        console.log(`  Success: ${records.length} records from ${probUrl}`);
        break;
      }
    } catch (err) {
      console.warn(`    Failed: ${err.message}`);
    }
  }

  if (records.length === 0) throw new Error('All VIEWS API endpoints returned empty or failed');
  console.log(`  Raw records: ${records.length}`);

  // Transform into our format. Each record has country_id (Gleditsch-Ward), month_id, and prediction values.
  const forecasts = [];
  for (const r of records) {
    const gwId = r.country_id || r.gwcode;
    const iso = GW_TO_ISO[gwId];
    if (!iso) continue;

    const centroid = COUNTRY_CENTROIDS[iso];
    if (!centroid) continue;

    // The main_mean field is the predicted log fatalities; we also look for probability fields
    const predictedFatalities = r.main_mean ?? r.fatalities ?? r.prediction ?? 0;
    // Some responses include a probability field directly
    const probability = r.probability ?? r.prob ?? null;

    // Convert log fatalities to approximate actual fatalities for display
    const estFatalities = predictedFatalities > 0 ? Math.round(Math.exp(predictedFatalities) - 1) : 0;

    forecasts.push({
      countryCode: iso,
      countryId: gwId,
      countryName: r.country_name || r.name || iso,
      monthId: r.month_id || r.month,
      predictedLogFatalities: typeof predictedFatalities === 'number' ? Math.round(predictedFatalities * 1000) / 1000 : 0,
      estimatedFatalities: estFatalities,
      probability: probability != null ? Math.round(probability * 1000) / 1000 : null,
      lat: centroid[0],
      lon: centroid[1],
    });
  }

  // Sort by predicted fatalities descending (highest risk first)
  forecasts.sort((a, b) => b.predictedLogFatalities - a.predictedLogFatalities);
  console.log(`  Processed forecasts: ${forecasts.length}`);

  return { forecasts, model: 'fatalities003', fetchedAt: Date.now() };
}

function validate(data) {
  return Array.isArray(data?.forecasts) && data.forecasts.length >= 10;
}

runSeed('forecast', 'conflict', CANONICAL_KEY, fetchConflictForecasts, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'views-fatalities003-v1',
  recordCount: (data) => data?.forecasts?.length ?? 0,
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
