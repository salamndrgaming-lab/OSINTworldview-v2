# Changelog

---

## Patch 8 — April 4, 2026

### Summary
Combined fix + feature patch. Fixes GitHub Actions NODE_OPTIONS error, 45m timeout, GDELT retry inversion, 3 crashing seeds, SignalConfidencePanel wiring bug. Ports koala's 846-line cross-source signal correlation engine — the backbone of multi-domain intelligence fusion. Wires it into bootstrap, health, and Signal Confidence panel.

### GitHub Actions Fixes

**`.github/workflows/seed.yml`**
- `NODE_OPTIONS` moved from `echo >> $GITHUB_ENV` (blocked by GitHub security) to job-level `env:` block
- Job 1 timeout: 45m → 60m. Job 2: 25m → 30m
- Added 4 seeds to Job 2: chokepoint-flow, telegram-osint, orbital, cross-source-signals

### GDELT Pipeline Fixes

**`scripts/_gdelt-cache.mjs`**
- `shouldRetry`: now retries 429 + 5xx (was inverted — skipped 429s)
- Backoff: 30s base / 2 retries / 120s cap (was 60s/3/300s — too slow for 26 topics)

**`scripts/seed-gdelt-raw.mjs`**
- 40-minute hard time guard in topic loop
- `canRequest('artlist')` instead of `anyBreakerOpen()` — timelinevol trip no longer kills artlist crawl

### Seed Fixes

**`scripts/_seed-utils.mjs`** — exported `redisSet`
**`scripts/seed-chokepoint-flow.mjs`** — rewrite: reads real data from correct key
**`scripts/seed-telegram-osint.mjs`** — rewrite: reads narrative seed data
**`scripts/seed-orbital.mjs`** — fixed broken import

### New Feature: Cross-Source Signal Correlation

**`scripts/seed-cross-source-signals.mjs`** (NEW — ported from koala73)
- 846-line intelligence correlation engine
- Reads 22 Redis source keys in parallel via Upstash pipeline
- 20 signal extractors: thermal spikes, GPS jamming, military flight surges, unrest surges, VIX spikes, commodity shocks, cyber escalation, shipping disruption, sanctions surges, significant earthquakes, radiation anomalies, infrastructure outages, wildfire escalation, displacement surges, forecast deterioration, market stress, weather extremes, media tone deterioration, risk score spikes
- Composite escalation detector: fires when ≥3 signals from different categories co-fire in the same theater
- Severity scoring: base weights × domain-specific factors → CRITICAL/HIGH/MEDIUM/LOW
- Output: ranked signal list (max 30) with composites first
- Writes: `intelligence:cross-source-signals:v1` (30m TTL)

**`api/bootstrap.js`** — added `crossSourceSignals` to cache registry + SLOW_KEYS
**`api/health.js`** — added to standalone keys + SEED_META (maxStaleMin: 60)

### Frontend Fix

**`src/components/SignalConfidencePanel.ts`**
- Fixed: read `data.checks[key].seedAgeMin` instead of nonexistent `data.seedMeta`
- All domains remapped to actual health.js camelCase key names
- Expanded to 25 domains (added X-Source for cross-source-signals)

---

## Patch 5 — April 2, 2026
Circuit breakers, exponential backoff, tracked-persons.json, POI headline scoring.

## Patch 4 — March 31, 2026
D3 Link Graph, Entity Graph API, Globe FPS throttle.

## Patch 3 — March 31, 2026
Panel wiring, POI search, mobile UI, Telegram fallback.

## Patch 2 — March 31, 2026
Visual identity, Analyst tab, Counterfactual engine.

## Patch 1 — Earlier Sessions
Initial platform build.
