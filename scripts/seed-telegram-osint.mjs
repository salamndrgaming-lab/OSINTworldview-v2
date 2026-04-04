#!/usr/bin/env node
/**
 * seed-telegram-osint.mjs — Telegram OSINT channel aggregator
 *
 * Reads existing Telegram narrative data from intelligence:telegram-narratives:v1
 * (populated by seed-telegram-narratives.mjs) and repackages it for the
 * TelegramOSINTPanel. Falls back to curated channel list with metadata.
 *
 * Writes: telegram:osint:v1 (consumed by TelegramOSINTPanel)
 * TTL: 3600s (1h)
 */
import { loadEnvFile, getRedisCredentials, writeExtraKey, withRetry, verifySeedKey } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY  = 'telegram:osint:v1';
const NARRATIVE_KEY  = 'intelligence:telegram-narratives:v1';
const TTL            = 3600; // 1h

// Curated OSINT Telegram channels (metadata fallback)
const CURATED_CHANNELS = [
  { id: 'osintdefender',  name: 'OSINT Defender',         handle: '@OSINTdefender',      category: 'conflict' },
  { id: 'intelslava',     name: 'Intel Slava Z',          handle: '@inaboron_channel',   category: 'conflict' },
  { id: 'rybar',          name: 'Rybar',                   handle: '@rybar',              category: 'conflict' },
  { id: 'deepstate',      name: 'DeepState',               handle: '@DeepStateUA',        category: 'conflict' },
  { id: 'militaryosint',  name: 'Military OSINT',          handle: '@milosinnt',          category: 'military' },
  { id: 'nukemap',        name: 'NukeMap',                 handle: '@nukemap_updates',    category: 'nuclear' },
  { id: 'cyberknow',      name: 'CyberKnow',              handle: '@cyberknow',          category: 'cyber' },
  { id: 'geointupdate',   name: 'GeoINT Update',          handle: '@geoint_update',      category: 'geoint' },
];

async function seedTelegramOSINT() {
  const now = new Date().toISOString();

  // Try reading narrative data from the upstream seed
  let narratives = null;
  try {
    narratives = await verifySeedKey(NARRATIVE_KEY);
  } catch {
    // Key doesn't exist
  }

  let channels;

  if (narratives && Array.isArray(narratives.themes) && narratives.themes.length > 0) {
    // Build channel-like entries from narrative themes
    const themeChannels = narratives.themes.slice(0, 10).map((theme, i) => ({
      id:             `narrative-${i}`,
      name:           theme.label || theme.id || `Theme ${i + 1}`,
      handle:         theme.source || '',
      category:       theme.category || 'intel',
      topHeadline:    theme.headlines?.[0] || theme.title || '',
      articleCount:   theme.articleCount ?? theme.articles?.length ?? 0,
      sentiment:      theme.avgTone ?? 0,
      lastUpdated:    theme.fetchedAt || narratives.fetchedAt || now,
    }));

    // Merge with curated channels (curated first, then narrative themes)
    channels = [
      ...CURATED_CHANNELS.map(ch => ({
        ...ch,
        topHeadline: '',
        articleCount: 0,
        sentiment: 0,
        lastUpdated: now,
      })),
      ...themeChannels,
    ];
    console.log(`  Merged ${CURATED_CHANNELS.length} curated + ${themeChannels.length} narrative themes`);
  } else {
    // Fallback to curated list only
    channels = CURATED_CHANNELS.map(ch => ({
      ...ch,
      topHeadline: '',
      articleCount: 0,
      sentiment: 0,
      lastUpdated: now,
    }));
    console.log(`  No narrative data — using ${channels.length} curated channels`);
  }

  const payload = {
    channels,
    count:     channels.length,
    fetchedAt: now,
    source:    narratives ? 'narrative-seed' : 'curated-fallback',
  };

  await withRetry(() => writeExtraKey(CANONICAL_KEY, payload, TTL));
  console.log(`✅ Telegram OSINT seeded (${channels.length} channels)`);
}

seedTelegramOSINT().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
