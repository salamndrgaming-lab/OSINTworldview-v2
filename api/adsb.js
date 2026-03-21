import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://api.airplanes.live/v2';

// Regional query points covering major global flight corridors (250nm radius each).
// Together these cover North America, Europe, Middle East, East Asia, South Asia, and oceans.
const REGIONS = [
  { lat: 40, lon: -90, dist: 250 },   // Central US
  { lat: 35, lon: -100, dist: 250 },  // Southern US
  { lat: 50, lon: -5, dist: 250 },    // Western Europe
  { lat: 48, lon: 10, dist: 250 },    // Central Europe
  { lat: 55, lon: 40, dist: 250 },    // Russia/Eastern Europe
  { lat: 25, lon: 50, dist: 250 },    // Middle East / Gulf
  { lat: 35, lon: 105, dist: 250 },   // China
  { lat: 35, lon: 140, dist: 250 },   // Japan / East Asia
  { lat: 20, lon: 80, dist: 250 },    // India / South Asia
  { lat: -25, lon: 135, dist: 250 },  // Australia
  { lat: 5, lon: 100, dist: 250 },    // Southeast Asia
  { lat: -10, lon: -50, dist: 250 },  // South America
];

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Fan out: military endpoint + regional point queries in parallel
    const fetches = [
      fetchJson(`${BASE}/mil`).catch(() => ({ ac: [] })),
      ...REGIONS.map(r =>
        fetchJson(`${BASE}/point/${r.lat}/${r.lon}/${r.dist}`).catch(() => ({ ac: [] }))
      ),
    ];

    const results = await Promise.all(fetches);

    // Merge all aircraft arrays, deduplicate by hex ID
    const seen = new Set();
    const merged = [];
    for (const result of results) {
      const aircraft = Array.isArray(result?.ac) ? result.ac : [];
      for (const ac of aircraft) {
        if (ac.hex && !seen.has(ac.hex)) {
          seen.add(ac.hex);
          merged.push(ac);
        }
      }
    }

    const payload = JSON.stringify({ ac: merged, total: merged.length, now: Date.now() / 1000 });

    return new Response(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=12, stale-while-revalidate=25',
        'X-ADSB-Source': 'airplanes.live',
        'X-ADSB-Regions': String(REGIONS.length),
        'X-ADSB-Count': String(merged.length),
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `ADSB proxy error: ${err.message}` }), {
      status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
