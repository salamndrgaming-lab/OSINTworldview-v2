/**
 * scripts/seed-telegram-narratives.mjs
 * 
 * Fetches narrative data from GDELT DOC API across 10 OSINT-relevant themes.
 * Uses sequential fetching with 3-second backoff delays to prevent GDELT rate 
 * limiting and HTTP 429 / connection drop errors.
 */
import { runSeed } from './_seed-runner.mjs';

const THEMES =[
  { id: 'conflict',   query: '(conflict OR war OR attack OR strike)' },
  { id: 'military',   query: '(military OR army OR navy OR troops)' },
  { id: 'cyber',      query: '(cyber OR hack OR malware OR ransomware)' },
  { id: 'ukraine',    query: '(ukraine OR kyiv OR russia)' },
  { id: 'middleeast', query: '(israel OR gaza OR iran OR lebanon OR syria)' },
  { id: 'osint',      query: '(osint OR "open source intelligence" OR satellite)' },
  { id: 'geopolitics',query: '(geopolitics OR sanctions OR diplomacy)' },
  { id: 'unrest',     query: '(protest OR riot OR coup OR unrest)' },
  { id: 'nuclear',    query: '(nuclear OR uranium OR missile)' },
  { id: 'trade',      query: '(trade OR tariff OR export OR supply chain)' }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchGdelt(query, mode) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=${mode}&format=json&maxrecords=15`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout prevents CI hanging

  try {
    const res = await fetch(url, {
      headers: {
        // GDELT often blocks default generic node-fetch agents
        'User-Agent': 'OSINTWorldview/2.0 (Analysis Seed Engine - https://github.com/salamndrgaming-lab)'
      },
      signal: controller.signal
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Convert GDELT timestamp (YYYYMMDDTHHMMSSZ) to standard ISO string
function parseGdeltDate(gdeltDateStr) {
  if (!gdeltDateStr || gdeltDateStr.length < 15) return new Date().toISOString();
  try {
    const y = gdeltDateStr.substring(0, 4);
    const m = gdeltDateStr.substring(4, 6);
    const d = gdeltDateStr.substring(6, 8);
    const h = gdeltDateStr.substring(9, 11);
    const min = gdeltDateStr.substring(11, 13);
    const s = gdeltDateStr.substring(13, 15);
    return `${y}-${m}-${d}T${h}:${min}:${s}Z`;
  } catch {
    return new Date().toISOString();
  }
}

async function fetchAllNarratives() {
  const allMessages =[];
  
  // SEQUENTIAL EXECUTION REQUIRED.
  // GDELT DOC API instantly rate limits/drops connections if multiple queries fire simultaneously.
  for (const theme of THEMES) {
    console.log(`[info] Fetching narratives for theme: ${theme.id}`);
    
    try {
      // 1. Fetch recent articles (Message Content)
      const artData = await fetchGdelt(theme.query, 'artlist');
      await sleep(3000); // 3-second mandatory backoff
      
      // 2. Fetch timeline (Velocity/Trend Metrics)
      const timeData = await fetchGdelt(theme.query, 'timelinevol');
      await sleep(3000); // 3-second mandatory backoff before next theme
      
      const articles = artData?.articles ||[];
      
      for (const art of articles) {
        if (!art.title || !art.url) continue;
        
        allMessages.push({
          channelName: art.domain || 'gdelt.source',
          text: art.title,
          timestamp: parseGdeltDate(art.seendate),
          url: art.url,
          theme: theme.id
        });
      }
    } catch (err) {
      console.warn(`[warn] Failed to fetch ${theme.id}: ${err.message}`);
    }
  }

  // If all failed, return null to gracefully trigger "preserving existing cache"
  if (allMessages.length === 0) {
    console.error('[error] All GDELT fetches failed. Aborting write to preserve existing Redis cache.');
    return null; 
  }

  // Sort by newest timestamp first
  allMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return { telegramNarratives: allMessages };
}

runSeed({
  name: 'telegram:narratives Seed',
  redisKey: 'telegram:narratives:v1',
  fetcher: fetchAllNarratives,
  ttl: 7200
});