import type {
  ServerContext,
  SearchGdeltDocumentsRequest,
  SearchGdeltDocumentsResponse,
  GdeltArticle,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { UPSTREAM_TIMEOUT_MS } from './_shared';
import { CHROME_UA } from '../../../_shared/constants';
import { cachedFetchJson, getCachedJson } from '../../../_shared/redis';
import { sha256Hex } from '../../../_shared/hash';

const REDIS_CACHE_KEY = 'intel:gdelt-docs:v1';
// Bumped from 600s (10min) to 1800s (30min) — GDELT data doesn't change fast enough
// to justify hammering it every 10 minutes per unique query, and 429s were the result.
const REDIS_CACHE_TTL = 1800;

// Seed data lives at this key (written every 3h by seed-gdelt-intel.mjs).
// Structure: { topics: [{ id: 'military', articles: [...], fetchedAt: '...' }, ...] }
const SEED_REDIS_KEY = 'intelligence:gdelt-intel:v1';

// ========================================================================
// Constants
// ========================================================================

const GDELT_MAX_RECORDS = 20;
const GDELT_DEFAULT_RECORDS = 10;
const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';

// Simple in-memory 429 backoff tracker — avoids pounding GDELT when it's rate-limiting.
// Shared across all requests hitting this edge function instance.
let rateLimitedUntil = 0;

// ========================================================================
// Seed fallback helper
// ========================================================================

// The seed script stores pre-fetched articles for well-known topic IDs.
// If the request query matches one of them, we can serve seed data instead of nothing.
const SEED_TOPIC_QUERIES: Record<string, string> = {
  'military exercise OR troop deployment OR airstrike': 'military',
  'cyberattack OR ransomware OR hacking': 'cyber',
  'nuclear OR uranium enrichment OR IAEA': 'nuclear',
  'sanctions OR embargo OR "trade war"': 'sanctions',
  'espionage OR spy OR intelligence agency': 'intelligence',
  'naval blockade OR piracy OR "strait of hormuz"': 'maritime',
};

function matchSeedTopicId(query: string): string | null {
  const lower = query.toLowerCase();
  for (const [fragment, topicId] of Object.entries(SEED_TOPIC_QUERIES)) {
    if (lower.includes(fragment.toLowerCase())) return topicId;
  }
  return null;
}

async function fetchSeedFallback(query: string): Promise<SearchGdeltDocumentsResponse | null> {
  const topicId = matchSeedTopicId(query);
  if (!topicId) return null;

  try {
    const raw = await getCachedJson(SEED_REDIS_KEY) as {
      topics?: Array<{ id: string; articles?: GdeltArticle[]; fetchedAt?: string }>;
    } | null;
    if (!raw?.topics) return null;

    const topic = raw.topics.find(t => t.id === topicId);
    if (!topic?.articles?.length) return null;

    return {
      articles: topic.articles,
      query,
      error: '',
    } as SearchGdeltDocumentsResponse;
  } catch {
    return null;
  }
}

// ========================================================================
// RPC handler
// ========================================================================

export async function searchGdeltDocuments(
  _ctx: ServerContext,
  req: SearchGdeltDocumentsRequest,
): Promise<SearchGdeltDocumentsResponse> {
  const MAX_QUERY_LEN = 500;
  let query = req.query;
  if (!query || query.length < 2) {
    return { articles: [], query: query || '', error: 'Query parameter required (min 2 characters)' };
  }
  if (query.length > MAX_QUERY_LEN) {
    return { articles: [], query, error: 'Query too long' };
  }

  // Append tone filter to query if provided (e.g., "tone>5" for positive articles)
  if (req.toneFilter) {
    query = `${query} ${req.toneFilter}`;
  }

  const maxRecords = Math.min(
    req.maxRecords > 0 ? req.maxRecords : GDELT_DEFAULT_RECORDS,
    GDELT_MAX_RECORDS,
  );
  const timespan = req.timespan || '72h';

  try {
    const keyHash = await sha256Hex(`${query}|${timespan}|${maxRecords}`);
    const cacheKey = `${REDIS_CACHE_KEY}:${keyHash}`;
    const result = await cachedFetchJson<SearchGdeltDocumentsResponse>(
      cacheKey,
      REDIS_CACHE_TTL,
      async () => {
        // If we're in a 429 cooldown period, skip GDELT entirely and try seed data
        if (Date.now() < rateLimitedUntil) {
          console.warn(`[GDELT] Rate-limit cooldown active, skipping direct fetch for "${query.slice(0, 40)}..."`);
          const seedResult = await fetchSeedFallback(query);
          if (seedResult) return seedResult;
          return null;
        }

        const gdeltUrl = new URL(GDELT_DOC_API);
        gdeltUrl.searchParams.set('query', query);
        gdeltUrl.searchParams.set('mode', 'artlist');
        gdeltUrl.searchParams.set('maxrecords', maxRecords.toString());
        gdeltUrl.searchParams.set('format', 'json');
        gdeltUrl.searchParams.set('sort', req.sort || 'date');
        gdeltUrl.searchParams.set('timespan', timespan);

        const response = await fetch(gdeltUrl.toString(), {
          headers: { 'User-Agent': CHROME_UA },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });

        if (response.status === 429) {
          // Exponential-ish backoff: 5 minutes on first 429, prevents all
          // subsequent requests from hitting GDELT during the cooldown.
          rateLimitedUntil = Date.now() + 5 * 60_000;
          console.warn('[GDELT] 429 rate-limited — backing off 5 min for all queries');

          // Try seed data as fallback instead of returning empty
          const seedResult = await fetchSeedFallback(query);
          if (seedResult) return seedResult;

          throw new Error('GDELT returned 429');
        }

        if (!response.ok) {
          throw new Error(`GDELT returned ${response.status}`);
        }

        const data = (await response.json()) as {
          articles?: Array<{
            title?: string;
            url?: string;
            domain?: string;
            source?: { domain?: string };
            seendate?: string;
            socialimage?: string;
            language?: string;
            tone?: number;
          }>;
        };

        const articles: GdeltArticle[] = (data.articles || []).map((article) => ({
          title: article.title || '',
          url: article.url || '',
          source: article.domain || article.source?.domain || '',
          date: article.seendate || '',
          image: article.socialimage || '',
          language: article.language || '',
          tone: typeof article.tone === 'number' ? article.tone : 0,
        }));

        if (articles.length === 0) return null;
        return { articles, query, error: '' } as SearchGdeltDocumentsResponse;
      },
    );
    return result || { articles: [], query, error: '' };
  } catch (error) {
    // Last-resort: try seed data even on unexpected errors
    const seedResult = await fetchSeedFallback(query);
    if (seedResult) return seedResult;

    return {
      articles: [],
      query,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
