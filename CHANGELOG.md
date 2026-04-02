# Changelog

---

## Patch 5 — April 2, 2026

### Summary
Architectural hardening of the GDELT seed pipeline. Introduces per-endpoint circuit breakers, decorrelated-jitter exponential backoff, dependency-free response validation, and a telemetry accumulator. Eliminates all inline person arrays in favour of a single `shared/tracked-persons.json` source of truth. Updates `seed-persons-of-interest.mjs` with LKG fallback, headline scoring, and topDomains extraction.

### New Files

**`scripts/shared/tracked-persons.json`**
Single source of truth for all 21 tracked persons. Each entry: `name`, `aliases` (string[]), `role`, `status` (`active`|`inactive`), `region`, `tags`. 17 active, 4 inactive (Assad, Raisi/Prigozhin, Sinwar, Nasrallah, Haniyeh). Both `seed-gdelt-raw.mjs` and `seed-persons-of-interest.mjs` now import from here. No more inline arrays.

**`scripts/shared/circuit-breaker.mjs`**
Per-endpoint circuit breakers (artlist, timelinevol, gkg, person — each independent). States: closed → open → half-open. Half-open probes use exponential reset timeout (base 120s × 1.5^trips, capped 10 min). GKG failures never trip artlist or person breakers. Exports: `getBreaker`, `recordSuccess`, `recordFailure`, `canRequest`, `anyBreakerOpen`, `breakerSummary`, `resetAllBreakers`.

**`scripts/shared/exponential-backoff.mjs`**
Replaces linear backoff throughout the GDELT pipeline. `exponentialDelay(attempt, opts)` uses decorrelated jitter (avoids thundering herd). `cooldownDelay(consecutiveSuccesses, opts)` provides adaptive inter-request pacing that decays from 20s → 5s as GDELT responds successfully. `retryWithBackoff(fn, opts)` wrapper with configurable `shouldRetry` and `onRetry` hooks. `sleep(ms, label)` helper with optional stdout logging.

**`scripts/shared/zod-schemas.mjs`**
Dependency-free runtime validation (no Zod library). `validateArtlistResponse(raw)` — validates articles array, requires `url` (>=10 chars, valid URL), `title` (>=3 chars), `seendate` (non-empty string); coerces optional fields (`tone`, `domain`, `language`, `socialimage`). Returns `{valid, data, rejected, warning}`. `validateTimelineResponse(raw)` — validates timeline series with date+value points. `validateGkgResponse(raw)` — checks FeatureCollection structure. `validateErrorEntry(entry)` — sanitises telemetry entries.

**`scripts/shared/error-telemetry.mjs`**
In-memory accumulator flushed to Redis at end of each seed run. Errors → `errors:seed` LIST (LPUSH + LTRIM to 200, 7-day TTL). Metrics → `metrics:seed` STRING (merged JSON, 30-day TTL). Counters: `gdelt_calls`, `successes`, `failures`, `cache_hits`, `cache_misses`, `validation_rejects`, `circuit_trips`, `runs`. Exports: `recordError`, `recordSuccess`, `recordCacheHit`, `recordCacheMiss`, `recordValidationReject`, `recordCircuitTrip`, `flushTelemetry(redis)`.

### Modified Files

**`scripts/_gdelt-cache.mjs`** (REWRITE)
Now serves dual role: (1) consumer helpers (`getGdeltRaw()` + all convenience wrappers — unchanged API, zero breaking changes for downstream seeds) and (2) live fetcher functions (`fetchArtlist`, `fetchTimelineVol`, `fetchPersonArticles`, `fetchGkg`) used by `seed-gdelt-raw.mjs`. Each live fetch function: checks per-call Redis cache first (TTLs: artlist 1800s, timelinevol 900s, gkg/person 3600s), checks per-endpoint breaker via `circuit-breaker.mjs`, fetches with `retryWithBackoff` (maxRetries: 2, exponential delays), validates response with `zod-schemas.mjs`, records telemetry, caches validated data. User-Agent: `OSINTworldview/2.0`. AbortSignal.timeout: 30s. Person queries use exact-match quoted syntax.

**`scripts/seed-gdelt-raw.mjs`** (REWRITE)
- Loads `TRACKED_PERSONS` from `shared/tracked-persons.json` (no more inline array)
- All GDELT fetches delegated to `_gdelt-cache.mjs` live fetcher functions
- Inter-request pacing via `cooldownDelay()` (adaptive 20s → 5s based on consecutive successes)
- Post-exhaust pause (120s) on topic exhaustion unchanged
- Snapshot merge logic unchanged — still merges partial results with previous snapshot on circuit trip
- First-run guard unchanged — skips write if 0 populated + no prior snapshot
- Flushes telemetry at end of run via `flushTelemetry()`
- Logs `breakerSummary()` at completion
- `--force` flag now calls `resetAllBreakers()` before proceeding
- Output payload includes `patch: 5` field

**`scripts/seed-persons-of-interest.mjs`** (UPDATE)
- Imports persons from `shared/tracked-persons.json` (no more inline TRACKED_PERSONS array)
- LKG fallback: if all 21 persons return `mentionCount === 0`, reads previous `intelligence:poi:v1` from Redis and returns it if any person there has `mentionCount > 0`
- `topDomains`: top 5 domains by headline count added to each profile
- Headline scoring: `scoreHeadline(article)` = recency×0.6 + |tone|×0.4; headlines sorted by score before slicing to 5
- TTL changed to 6h (per spec)
- `_meta.patch: 5` added to output

**`.github/workflows/seed.yml`** (UPDATE)
- Cron changed to `5 */3 * * *` (offset 5 min from top of hour to avoid contention)
- Both jobs now set `NODE_OPTIONS: '--dns-result-order=ipv4first'` in env block
- Node version pinned to `'20'` (was `22`)
- Job 2 renamed `seed-downstream` (was `seed-fast`) for clarity
- Post-seed health check step added to Job 1: verifies `gdelt:raw:v1` exists and logs populated topic count
- Telegram failure notification added to Job 1 (on: failure)
- Telegram completion notification moved into Job 2 steps (with `if: always()`)
- `workflow_dispatch` gains optional `force` boolean input → passes `--force` to seed-gdelt-raw
- All env vars consolidated into job-level `env:` blocks

---

## Patch 4 — March 31, 2026 (Session 8)

### D3 Link Graph, Entity Graph Edge API, Globe FPS Throttling

- `api/intelligence/entity-graph.js` (NEW) — Edge proxy for Neo4j/Redis graph data
- `src/utils/D3LinkGraph.ts` (NEW) — Vanilla TS D3 force-directed visualizer
- `src/components/AnalystWorkspacePanel.ts` (MODIFIED) — Wired tabs, embedded D3 graph
- `src/services/globe-render-settings.ts` (MODIFIED) — FPS throttler, preserved original exports
- `api/bootstrap.js` (MODIFIED) — Added entityGraph to cache registry
- `api/health.js` (MODIFIED) — Added entityGraph to standalone keys and seed meta

---

## Patch 3 — March 31, 2026 (Session 7)

### Panel Wiring, POI Search, Mobile UI, Telegram Fallback, Missing Endpoints

- `src/config/variants/full.ts` — +7 panels to DEFAULT_PANELS
- `src/config/variants/godmode.ts` — +6 panels, PANEL_LAYOUT_CONFIG updated
- `src/config/panels.ts` — +7 panels across PANEL_CATEGORY_MAP
- `src/styles/mobile-enhancements.css` (NEW) — Touch-optimized responsive CSS
- `src/components/POIMapLayer.ts` — +90 locations, country fallback geocoding
- `api/supply-chain/chokepoints.js` (NEW) — Redis proxy
- `api/market/commodity-quotes.js` (NEW) — Redis proxy
- `scripts/seed-telegram-narratives.mjs` (NEW) — GDELT narrative tracker
- `.github/workflows/seed.yml` — +seed-telegram-narratives.mjs

---

## Patch 2 — March 31, 2026 (Session 6)

### Visual Identity, Analyst Tab, Counterfactual Engine

- `src/styles/visual-identity.css` (NEW) — Amber/gold intel accent system
- `src/services/analyst-tab.ts` (NEW) — 5-tab analyst workspace
- `src/components/CounterfactualSimPanel.ts` (NEW)
- `src/components/ChokepointFlowPanel.ts` (NEW)
- `src/components/TelegramOSINTPanel.ts` (NEW)
- `src/components/SupplyChainPricesPanel.ts` (NEW)
- `src/components/OsintReportPanel.ts` (NEW)
- `src/config/map-layer-definitions.ts` — Added 10 layer categories
- `src/components/DeckGLMap.ts` — Category-grouped layer toggles

---

## Patch 1 — Earlier Sessions

Initial platform build: map engine, panel system, preset system, Redis seed pipeline, Telegram/Discord bots, Neo4j entity graph, flight tracking, POI tracking.
