#!/usr/bin/env node
/**
 * seed-telegram-narratives.mjs — GDELT-based narrative tracker
 *
 * Fetches trending narrative topics from GDELT DOC API across key
 * OSINT-relevant themes, transforms them into a format compatible
 * with the TelegramOSINT panel, and stores in Redis under
 * `telegram:narratives:v1`. This serves as a fallback data source
 * when the Telegram WS relay is unavailable.
 *
 * Runs as part of the seed.yml GitHub Actions workflow.
 */

import { loadEnvFile, runSeed, CHROME_UA } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const GDELT_DOC_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

// Themes aligned with curated Telegram OSINT channels
const NARRATIVE_QUERIES = [
  { query: 'military conflict attack', theme: 'conflict' },
  { query: 'drone strike missile', theme: 'military' },
  { query: 'cyber attack hacking', theme: 'cyber' },
  { query: 'Ukraine Russia frontline', theme: 'ukraine' },
  { query: 'Iran Israel tensions', theme: 'middleeast' },
  { query: 'intelligence espionage OSINT', theme: 'osint' },
  { query: 'geopolitical sanctions diplomacy', theme: 'geopolitics' },
  { query: 'protest unrest uprising', theme: 'unrest' },
  { query: 'nuclear weapons proliferation', theme: 'nuclear' },
  { query: 'supply chain disruption trade', theme: 'trade' },
];

async function fetchGdeltTimeline(queryStr) {
  const params = new URLSearchParams({
    query: queryStr,
    mode: 'TimelineVolInfo',
    format: 'json',
    timespan: '24h',
    maxrecords: '20',
  });

  const resp = await fetch(`${GDELT_DOC_BASE}?${params}`, {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  return data;
}

async function fetchGdeltArticles(queryStr) {
  const params = new URLSearchParams({
    query: queryStr,
    mode: 'ArtList',
    format: 'json',
    timespan: '12h',
    maxrecords: '15',
    sort: 'DateDesc',
  });

  const resp = await fetch(`${GDELT_DOC_BASE}?${params}`, {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  return data.articles || [];
}

async function fetchNarratives() {
  const messages = [];
  const topicVelocities = [];

  for (const nq of NARRATIVE_QUERIES) {
    try {
      // Fetch both timeline (for velocity) and articles (for content)
      const [timeline, articles] = await Promise.all([
        fetchGdeltTimeline(nq.query),
        fetchGdeltArticles(nq.query),
      ]);

      // Calculate velocity from timeline data
      let velocity = 0;
      if (timeline && timeline.timeline) {
        const series = timeline.timeline[0];
        if (series && series.data) {
          const recent = series.data.slice(-6); // last 6 time intervals
          velocity = recent.reduce((sum, d) => sum + (d.value || 0), 0);
        }
      }

      topicVelocities.push({
        topic: nq.query.split(' ').slice(0, 2).join(' '),
        theme: nq.theme,
        velocity,
        articleCount: articles.length,
        trending: velocity > 100,
      });

      // Transform articles into telegram-like messages
      for (const art of articles) {
        messages.push({
          channelName: art.domain || art.source || 'GDELT',
          channelHandle: '@gdelt_' + nq.theme,
          text: (art.title || '') + (art.seendate ? '' : ''),
          date: art.seendate || new Date().toISOString(),
          timestamp: art.seendate ? new Date(art.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')).getTime() : Date.now(),
          url: art.url || '',
          source: 'gdelt',
          theme: nq.theme,
          tone: art.tone || 0,
        });
      }

      // Small delay between GDELT calls to be polite
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.warn(`  [warn] Failed to fetch ${nq.theme}: ${err.message}`);
    }
  }

  // Sort by timestamp descending
  messages.sort((a, b) => b.timestamp - a.timestamp);

  return {
    messages: messages.slice(0, 200),
    velocities: topicVelocities,
    cachedAt: new Date().toISOString(),
    source: 'gdelt-doc-api',
    count: messages.length,
  };
}

await runSeed('telegram', 'narratives', 'telegram:narratives:v1', fetchNarratives, {
  ttlSeconds: 7200, // 2 hours
  validateFn: (data) => data && data.messages && data.messages.length > 0,
  recordCount: (data) => data?.messages?.length || 0,
});
