# CLAUDE CODE SESSION PROMPT — OSINTworldview-v2

> Paste this into CLAUDE.md at repo root, or use as the initial prompt for a Claude Code session.
> Last updated: April 5, 2026 (Patch 10)

---

## IDENTITY

You are continuing development on **World Monitor** (OSINTworldview-v2), a full-stack OSINT intelligence platform. This is a **commercial product** targeting enterprise users. Every feature must use real data, deterministic logic, and production-quality UX. Zero simulated values. Zero placeholder data. Zero external link launches for in-app tools.

**Owner:** Chip (GitHub: salamndrgaming-lab)
**Repo:** `salamndrgaming-lab/OSINTworldview-v2` (forked from `koala73/worldmonitor`)
**Live:** `osintworldview.vercel.app`

---

## FIRST TASK — MANDATORY DIAGNOSTIC

Before building ANY new features, run a full codebase diagnostic:

```bash
# 1. TypeScript errors (the real error finder)
npx tsc --noEmit 2>&1 | grep -v "vite/client" | grep "error"

# 2. Find simulated/random/placeholder/dummy values (ZERO allowed in commercial product)
grep -rn "Math.random\|dummy\|demo data\|placeholder\|hardcode\|simulate" src/components/*.ts scripts/seed-*.mjs | grep -v "node_modules\|\.d\.ts\|// .*placeholder\|input.*placeholder"

# 3. Find dead imports and unused code
npx tsc --noEmit 2>&1 | grep "TS6133\|TS6196"

# 4. Check for Redis key mismatches (seed writes key X, API reads key Y)
# Compare CANONICAL_KEY in each seed vs the Redis key in its corresponding API endpoint

# 5. Check panel registration completeness (ALL 4 places required)
# For each panel component, verify it exists in:
#   - src/app/panel-layout.ts (lazyPanel registration)
#   - src/components/index.ts (export)
#   - src/config/panels.ts FULL_PANELS (THE ACTUAL CONFIG — NOT full.ts!)
#   - src/config/panels.ts PANEL_CATEGORY_MAP

# 6. Check API endpoint existence for every panel fetch URL
grep -rh "fetch(" src/components/*.ts | grep -oP "'/api/[^']*'" | sort -u

# 7. Check seed TTLs vs cron interval (cron runs every 3h, TTL must be >= 10800s)
grep -rn "CACHE_TTL\|TTL\s*=" scripts/seed-*.mjs | grep -v "86400\|43200\|21600\|14400\|10800"

# 8. Verify all seeds are in .github/workflows/seed.yml
```

Fix ALL diagnostic issues before proceeding with new features.

---

## TECH STACK — CRITICAL RULES

### Architecture
- **Vanilla TypeScript + Vite** — NO React, NO Redux, NO axios, NO `.tsx` files
- **deck.gl** for flat map, **MapLibre** underneath, **GlobeMap** for 3D globe
- **Upstash Redis** REST API for all data caching
- **Upstash Vector** for semantic search
- **Neo4j AuraDB Free** for entity graph (auto-pauses, Query API v2 only)
- **Groq AI** (`llama-3.3-70b-versatile`) for inference
- **Vercel** edge functions for API, static hosting for frontend
- **GitHub Actions** for seed pipeline (cron every 3 hours)

### TypeScript Rules
- `noUnusedLocals` is enforced — unused imports/variables CRASH THE BUILD (TS6133)
- Never use underscore-prefixed variables to "fix" unused warnings — remove entirely
- `DeckGLMap.ts` is 5,600+ lines — edit surgically with exact string matches, never rewrite

### Panel Architecture
- Every panel extends the `Panel` base class (`src/components/Panel.ts`)
- `buildUI()` must call `this.content.innerHTML = ''` at start to clear loading spinner
- New panels require **4 registrations** (miss any one = panel won't appear):
  1. `src/app/panel-layout.ts` — `this.lazyPanel('panel-id', () => import(...).then(m => new m.PanelClass()))`
  2. `src/components/index.ts` — `export { PanelClass } from './PanelClass'`
  3. `src/config/panels.ts` — add to `FULL_PANELS` object (line ~13) — **THIS IS THE ONE THAT MATTERS, NOT full.ts**
  4. `src/config/panels.ts` — add to `PANEL_CATEGORY_MAP` intelligence/market/env/etc array

### Redis Rules
- POST body format: `["SET", key, value, "EX", ttl]` — NOT `{EX: ttl, value: "..."}`
- Minimum TTL: **10800s (3h)** for any seed — cron runs every 3h, shorter TTLs cause data to disappear between runs
- Use `writeExtraKey()` or `redisSet()` from `_seed-utils.mjs` — both are exported

### Seed Pipeline Rules
- `_seed-utils.mjs` exports: `runSeed`, `loadEnvFile`, `getRedisCredentials`, `withRetry`, `writeExtraKey`, `writeExtraKeyWithMeta`, `verifySeedKey`, `atomicPublish`, `sleep`, `CHROME_UA`, `loadSharedConfig`, `maskToken`, `redisSet`, `readSeedSnapshot`, `parseYahooChart`, `isTransientRedisError`
- `_gdelt-cache.mjs` is the GDELT cache layer — all GDELT consumers read via its wrappers, never call GDELT directly
- `seed-gdelt-raw.mjs` is the ONLY script that calls GDELT API directly (Job 1 in workflow)
- `shouldRetry` must retry on HTTP 429 (rate-limit) with 30s+ backoff — GDELT rate windows exceed 50s
- `tracked-persons.json` in `scripts/shared/` is the single source of truth for all 21 POI

### Git/Deploy Rules
- File delivery: complete file replacements for GitHub Desktop, exact line instructions for web editor
- Large files (DeckGLMap.ts, panel-layout.ts): GitHub Desktop only — web editor truncates/corrupts
- Template literals get corrupted by GitHub web editor — use string concatenation for web editor changes
- After Discord bot changes: re-register slash commands via `GET /api/discord-webhook?register=true`

---

## CURRENT STATE (Patch 10)

### What Works
- 51 seed scripts running on 3h cron via GitHub Actions
- 79 API edge functions on Vercel
- 113 TypeScript panel components
- 119 Redis keys monitored by health endpoint
- Cross-source signal correlation engine (20 extractors + composite escalation detector)
- Thermal escalation detection from wildfire data
- Security advisory scraping (US State Dept, UK FCDO, CDC)
- AIS vessel position seeding from aisstream.io (requires `AISSTREAM_API_KEY` secret)
- Signal Confidence panel showing real-time data freshness across 26 domains
- OSINT Toolkit with 22 inline tools (zero external links)
- Full panel registration in correct FULL_PANELS location

### Known Issues Resolved (Do NOT Reintroduce)
| Issue | Root Cause | Fix |
|-------|-----------|-----|
| `NODE_OPTIONS` error in GitHub Actions | GitHub blocks writing it via `$GITHUB_ENV` | Put in job-level `env:` block |
| 45m workflow timeout | 26 topics × 60s backoff = 78 min | 30s/2 retries + 40-min crawl guard |
| `redisSet` import crash | Was private function | Exported it |
| GDELT 429s not retried | `shouldRetry` predicate was inverted | `(err) => err.status === 429 \|\| err.status >= 500` |
| Panels not appearing | Added to `full.ts` instead of `panels.ts` `FULL_PANELS` | Always edit `panels.ts` line ~13 |
| Data disappearing after 1h | Seed TTLs of 10-60min with 3h cron | All TTLs ≥ 10800s |
| Entity graph Link Graph empty | Seed wrote Neo4j only, not Redis | Added Redis snapshot write |
| Satellite layer empty | Seed key `orbital:tle` ≠ API key `intelligence:satellites:tle:v1` | Fixed seed key |
| SignalConfidencePanel grey | Read `data.seedMeta` (doesn't exist) | Changed to `data.checks[key].seedAgeMin` |
| OSINT Toolkit launched external sites | Tools had `url:` fields opening new tabs | All tools are builtins now |
| Simulated blockage risk | `Math.random()` noise in ChokepointFlowPanel | Deterministic `computeBlockageRisk()` |

### External Dependencies / API Keys (GitHub Secrets)
| Secret | Service | Required For |
|--------|---------|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis | All data storage |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis | All data storage |
| `GROQ_API_KEY` | Groq AI | Insights, hypotheses, POI profiles, agent SITREP |
| `AISSTREAM_API_KEY` | aisstream.io (free) | AIS vessel positions on map |
| `FINNHUB_API_KEY` | Finnhub | Market/stock quotes |
| `ACLED_EMAIL` / `ACLED_PASSWORD` | ACLED | Conflict/unrest events |
| `NASA_FIRMS_API_KEY` | NASA FIRMS | Wildfire fire detections |
| `COINGECKO_API_KEY` | CoinGecko | Crypto quotes |
| `OTX_API_KEY` / `ABUSEIPDB_API_KEY` | AlienVault/AbuseIPDB | Cyber threats |
| `UPSTASH_VECTOR_REST_URL/TOKEN` | Upstash Vector | Semantic search |
| `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` / `NEO4J_DATABASE` | Neo4j AuraDB Free | Entity graph (instance `3d7d5491`, auto-pauses) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram | Bot + notifications |
| `OPENROUTER_API_KEY` | OpenRouter | Fallback LLM |
| `WINDY_API_KEY` | Windy | Webcams |
| `SHODAN_API_KEY` | Shodan | Cyber scanning (future) |

---

## SEED PIPELINE ARCHITECTURE

```
Job 1 (60m timeout): seed-gdelt-raw.mjs
  → 26 topics + 16 persons + GKG → gdelt:raw:v1
  → 30s/2-retry backoff on 429, 40-min crawl time guard
  → Per-endpoint circuit breakers (artlist/timelinevol/gkg/person)

Job 2 (30m timeout): seed-downstream (depends on Job 1)
  → Free sources: earthquakes, natural, weather, commodities, unrest, predictions, climate, gulf, etf, correlation
  → API-key: market-quotes, cyber, crypto, fires, ucdp, internet-outages, military-flights
  → Webcams + GPS jamming
  → AIS vessels (aisstream.io, ~90s collection, 4-min timeout)
  → GDELT consumers: gdelt-intel, missile-events, warcam, telegram-narratives, narrative-drift
  → Panel aggregators: chokepoint-flow, telegram-osint, orbital
  → AI-powered: insights, persons-of-interest, poi-discovery
  → Non-GDELT: conflict-forecast, disease-outbreaks, radiation, thermal-escalation, security-advisories
  → Derivatives: alerts, agent-sitrep, hypothesis-generator, cross-source-signals
  → Archival: vector-index, snapshot, entity-graph
```

---

## TODO LIST STATUS

### Tier 1 — COMPLETE ✅
1. ~~TGStat fallback for TelegramOSINT~~ → reads telegram narrative seed data instead
2. ~~seed-persons-of-interest in seed.yml~~ ✅
3. ~~New panels in DEFAULT_PANELS~~ ✅ (fixed: was in wrong file)
4. ~~Deploy mobile UI~~ ✅

### Tier 2 — COMPLETE ✅
5. ~~Time-Travel Map Slider~~ ✅ wired to /api/snapshot
6. ~~Signal Confidence Heatmap~~ ✅ reads /api/health, 26 domains
7. ~~Hypothesis Generator~~ ✅ seed + API + panel connected
8. ~~Narrative Drift Detection~~ ✅ seed + API + panel connected
9. ~~Cross-Source Signal Fusion~~ ✅ 846-line correlation engine + CrossSourceSignalsPanel

### Tier 3 — NOT STARTED (next priorities)
10. **CII Backtesting Engine** — replay 180 days of snapshot archives
11. **PEP Network Visualizer** — OpenSanctions free data (no API key needed)
12. **Sanctions Evasion Graph Explorer** — OFAC SDN list (need `sax` npm package, port `seed-sanctions-pressure.mjs` from koala)
13. **Cable Cut Risk Forecaster** — submarine cable data + seismic correlation
14. **Flight Anomaly Detection** — ghost fleet patterns from ADS-B data (api.airplanes.live, already used)
15. **Dark Pool Monitor** — FINRA public short-sale data
16. **Election Interference Signals** — ACLED + media narrative analysis

### Tier 4 — ASPIRATIONAL (ongoing)
17-30. See todolist.md in repo

---

## KOALA SEEDS AVAILABLE TO PORT (no new deps needed)

| Seed | Lines | Dependencies | What It Does |
|------|-------|-------------|-------------|
| seed-conflict-intel.mjs | ~200 | _seed-utils only | Enriches conflict data |
| seed-forecasts.mjs | ~300 | _seed-utils only | Conflict forecast model |
| seed-research.mjs | ~150 | _seed-utils only | Research/tech events |
| seed-hormuz.mjs | ~200 | _seed-utils only | Strait of Hormuz monitoring |
| seed-sanctions-pressure.mjs | ~400 | needs `sax` npm | OFAC/SDN sanctions tracking |
| seed-fear-greed.mjs | 488 | needs proxy infra | Market sentiment composite |

These are in the `koala73/worldmonitor` repo. Import from there when ready.

---

## CHIP'S PREFERENCES

- **Working style:** Terse, directive. "proceed", "continue", "cont." Prefers action over explanation.
- **File delivery:** Complete file replacements in a zip with subfolders matching repo paths. Include session handoff + changelog + deploy manifest.
- **Proposal-first:** For major design decisions, pitch concepts before building.
- **No external links:** OSINT Toolkit tools run inline in the Analyst tab, never launch external websites.
- **No simulated values:** This is a commercial product. Every number shown must come from real data or be clearly labeled "N/A" when unavailable.
- **Deploy pattern:** GitHub Desktop for large files, GitHub web editor for small targeted changes.
- **Diagnosis:** `fetch('/api/endpoint').then(r=>r.json()).then(d=>console.log(d))` in browser console for real-time API inspection.
- **Handoff docs:** Comprehensive, tailored for both Claude and other AI assistants (e.g., Gemini).

---

## CUSTOM EVENTS

The app uses custom DOM events for cross-component communication:

| Event | Dispatched By | Listened By | Detail |
|-------|--------------|-------------|--------|
| `wm:toggle-layer` | analyst-tab.ts toolkit | App.ts | `{ layer: string, enabled: boolean }` |
| `wm:open-panel` | analyst-tab.ts toolkit | App.ts | `{ panelId: string }` |
| `wm:map-feature-click` | POIMapLayer, map layers | analyst-tab.ts Link Graph | `{ name, type, country }` |

---

## NEO4J AURADB FREE

- Instance ID: `3d7d5491` (used as both username and database name)
- Only Query API v2 works: `https://{host}/db/{database}/query/v2` on port 443
- HTTP transaction API on port 7473 is unavailable
- **Auto-pauses after inactivity** — must resume manually at `console.neo4j.io`
- Request body: `{"statement": "CYPHER", "parameters": {}}` (single statement per request)
- Response parsing: `result.data.fields` and `result.data.values` arrays

---

## KEY FILE LOCATIONS

| Purpose | File |
|---------|------|
| App entry + event listeners | `src/App.ts` |
| Panel layout + lazy registration | `src/app/panel-layout.ts` |
| **THE panel config that matters** | `src/config/panels.ts` (FULL_PANELS at line ~13) |
| Panel category map | `src/config/panels.ts` (PANEL_CATEGORY_MAP at line ~936) |
| Component exports | `src/components/index.ts` |
| Variant config (NOT used for panels) | `src/config/variants/full.ts` |
| OSINT Toolkit + Analyst Workspace | `src/services/analyst-tab.ts` |
| Map (5600+ lines) | `src/components/DeckGLMap.ts` |
| Map container (delegates to DeckGL/Globe/SVG) | `src/components/MapContainer.ts` |
| Data loader | `src/app/data-loader.ts` |
| GDELT cache layer | `scripts/_gdelt-cache.mjs` |
| Seed utilities | `scripts/_seed-utils.mjs` |
| Tracked persons | `scripts/shared/tracked-persons.json` |
| Seed workflow | `.github/workflows/seed.yml` |
| Health monitoring | `api/health.js` |
| Bootstrap (frontend data hydration) | `api/bootstrap.js` |
| AIS snapshot (vessel positions) | `api/ais-snapshot.js` |
