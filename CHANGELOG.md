# Changelog

All notable changes to World Monitor are documented here.

## [Unreleased]

### Fixed — GDELT seed reliability patch 4 (GdeltSeedFix.md recommendations + Railway config)

**Root cause summary (from GdeltSeedFix.md analysis)**

GDELT DOC API enforces a **global** rate limit, not per-client. Shared Railway/Vercel
outbound IP pools mean multiple tenants' traffic counts against the same limit. Even a
perfectly-paced crawler with 20s gaps can hit 429s during high-traffic windows or when
another service on the same IP is hitting GDELT simultaneously. Additionally, the GKG
v1 endpoint is more aggressive than the DOC API and was previously incrementing the
main circuit-breaker counter, causing the circuit to trip early on otherwise good runs.

**`nixpacks.toml` (root) — NEW**

- Created `nixpacks.toml` at repo root for the Railway root service.
- Sets `NODE_OPTIONS=--dns-result-order=ipv4first` globally. Railway containers use
  shared outbound IPs; forcing IPv4 meaningfully reduces GDELT 429 frequency because
  GDELT's CDN responds differently to IPv4 vs IPv6 paths on shared-IP pools.
- Sets `aptPkgs = ["curl"]` for OREF polling compatibility.

**`scripts/nixpacks.toml` — NEW**

- Created `scripts/nixpacks.toml` for the Railway relay service (rootDirectory=`scripts`).
- Same `NODE_OPTIONS` and `curl` settings. Sets `start.cmd = "node ais-relay.cjs"`.

**`seed-gdelt-raw.mjs` — three GdeltSeedFix.md improvements**

- `COOLDOWN_BASE_MS` raised from 20s → **35s** (GdeltSeedFix.md §4 recommends
  35–45s for meaningful burst-relief vs the previous 20s which was too aggressive
  for peak-hour shared-IP conditions).
- **Slow-decay backoff on success** (`COOLDOWN_DECAY_MS = 5s`): on each successful
  fetch, cooldown decreases by 5s toward base rather than resetting instantly. Instant
  reset was re-triggering 429s after quiet periods within a long burst window.
- **GKG circuit isolation**: GKG v1 endpoint 429s and network errors no longer
  increment the main `consecutiveFailures` counter. GKG was previously tripping the
  circuit right at the end of an otherwise successful Phase 1 crawl. GKG failures log
  a warning and return null — the main crawl is unaffected.
- `maxrecords` for 7d person queries reduced from 250 → **100** (GdeltSeedFix.md §3:
  250-record 7d queries trigger GDELT's "heavy query" throttle disproportionately).

**`.github/workflows/seed.yml` — three improvements**

- Cron schedule changed from `0 */3 * * *` → `5 */3 * * *` (staggered to :05).
  Most automated crawlers fire at :00; offsetting by 5 minutes reduces shared-IP
  collision with other services hitting GDELT simultaneously.
- `NODE_OPTIONS: "--dns-result-order=ipv4first"` added to both `seed-gdelt-raw` and
  `seed-fast` job env blocks. GitHub Actions runners are also on shared IPs; same IPv4
  forcing benefit applies.
- Added `workflow_dispatch` input `force_gdelt: boolean` — allows manual re-run with
  `--force` flag without editing code. Notify job now distinguishes "GDELT rate-limited"
  from "general seed warning" in its Telegram message.

**`seed-persons-of-interest.mjs` — two fixes**

- `CACHE_TTL` raised from 3600s (1h) → **21600s (6h)**. At 1h the POI profiles expired
  between cron cycles whenever the GDELT raw crawl was slow. At 6h the key survives two
  full missed cycles before going stale.
- **LKG (Last Known Good) fallback**: if every person in the generated profiles has
  `mentionCount === 0` AND `recentArticles.length === 0` (i.e. `gdelt:raw:v1` was empty
  or missing), the script now reads the previous `intelligence:poi:v1` snapshot and
  returns it instead of publishing 21 zero-data profiles. This directly fixes the
  `0 mentions / 0 headlines` loop seen in the seed workflow logs.

### Fixed — GDELT seed reliability patch 3 (first-run guard + intel key upgrades)

**`seed-gdelt-raw.mjs` — first-run write guard + inactive person tracking**

- Added **first-run write guard**: when the circuit breaker trips on the very first run
  (no prior Redis snapshot exists to merge from), the script now skips the write entirely
  and exits 0 with a recovery message. Previously it wrote an empty `gdelt:raw:v1` payload
  which poisoned every consumer on the next cycle — directly causing the 0-article / 0-person
  output seen in the seed workflow logs after a fresh deploy.
- Marked deceased persons (`Prigozhin`, `Sinwar`, `Nasrallah`, `Haniyeh`) as
  `status: 'inactive'` in `TRACKED_PERSONS`. Inactive persons are skipped in live GDELT
  queries (saving 8 API calls per run) but their last known data is always preserved
  via the snapshot merge. Profile consumers continue to receive historical records.
- Log line `Cooldown: 6s base` corrected to `20s base` (the value was already 20s in
  code — this was a copy-paste error in the initial console.log).

**`seed-gdelt-intel.mjs` — worldmonitor parity: timeline keys + 24h TTL**

- `CACHE_TTL` raised from 3600s (1h) → 86400s (24h). At 1h the key expired between
  cron runs whenever GDELT was slow or the raw crawl was circuit-tripped. At 24h
  the key always has a previous snapshot to merge from. Matches worldmonitor's value.
- `publishTransform` added: strips `_tone`, `_vol`, `exhausted`, `preservedFromCache`
  private fields before writing to canonical Redis key. Consumers receive a clean payload.
- `afterPublish` hook added: writes per-topic tone/vol timeline keys
  (`gdelt:intel:tone:{id}`, `gdelt:intel:vol:{id}`) at 12h TTL.
- Snapshot merge: if a topic returns 0 articles from the raw cache, restores the
  previous snapshot's articles before publishing. Matches worldmonitor's per-topic merge.
- Validate threshold raised from 2/6 → 3/6 topics (at least half must have articles).

**`_gdelt-cache.mjs` — new helper for timeline data**

- Added `getGdeltIntelTopicsWithTimelines()`: returns 6 intel topics with `_vol`/`_tone`
  attached, used by `seed-gdelt-intel.mjs`'s `afterPublish` hook. Avoids dynamic import.

### Fixed — GDELT seed reliability patch 2 (worldmonitor parity + snapshot merge)

**`seed-gdelt-raw.mjs` — snapshot merge & smarter circuit-trip behaviour**

- Added snapshot merge on circuit trip: when the circuit breaker aborts Phase 1 or 2,
  the script now reads the previous `gdelt:raw:v1` Redis snapshot and restores any topic
  or person that returned 0 results in the current crawl. Consumers downstream receive
  the best available data rather than empty arrays.
- Added write-skip logic: if the merged result still has fewer than 4 populated topics
  AND the existing key already has ≥4, skips the write and extends the existing key's TTL
  instead. Healthy data in Redis is never overwritten by a near-empty circuit-trip payload.
- Raised base inter-call cooldown from 6s → 20s (matching worldmonitor's
  `INTER_TOPIC_DELAY_MS = 20_000` which avoids most rate limiting on a healthy IP).
- Added post-exhaust cooldown of 120s after any topic that fully exhausts retries
  (mirrors worldmonitor's `POST_EXHAUST_DELAY_MS = 120_000`). GDELT's rate-limit
  window for popular queries exceeds 50s and can reach 90–120s during peak hours.

**`_seed-utils.mjs` — worldmonitor parity: five missing features added**

- `isTransientRedisError(err)` — detects network/timeout errors (`UND_ERR_`,
  `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, etc.) so callers can skip vs hard-fail.
- `acquireLockSafely(...)` — wraps lock acquisition with retry and transient error
  detection. Returns `{ locked, skipped, reason }`. If Redis is unreachable, returns
  `skipped: true` and exits 0 instead of crashing the cron job.
- `extendExistingTtl(keys, ttl)` — pipeline `EXPIRE` on multiple keys in one Upstash
  request. Called by `runSeed` when fetch fails so stale data stays live during outages.
- `publishTransform` option in `runSeed` — transform applied to fetched data before
  writing to canonical key (strips private fields like `_tone`, `_vol`, `exhausted`).
- `afterPublish` hook in `runSeed` — called after successful write; used for writing
  per-topic side-channel keys (e.g. timeline keys) without coupling to main payload.
- Graceful fetch-failure path in `runSeed` — when `fetchFn` throws after all retries,
  extends existing key TTLs and exits 0. Was previously crashing the cron job.
- `writeExtraKeyWithMeta` — like `writeExtraKey` but also writes a `seed-meta`
  freshness key for health check visibility.
- `readSeedSnapshot` — reads canonical snapshot before overwrite; enables WoW deltas.

**`seed-insights.mjs` — three worldmonitor parity improvements**

- `CACHE_TTL` raised from 1800s (30 min) → 10800s (3h). The 30 min TTL matched the
  cron interval exactly, meaning any single delayed run caused the key to expire and
  the UI to show stale data. 3h = 6× the cron interval, surviving any missed run.
- `normalizeThreat()` added: converts proto enum strings (`THREAT_LEVEL_HIGH`) to
  lowercase client values (`high`) before publishing. Prevents consumers from
  receiving two different string formats for the same threat level.
- `extractCountryCode()` from `shared/geo-extract.mjs` now attaches ISO2 country code
  to each top story. Enables flag icons and country filtering in the UI.
- LLM provider chain extended to `ollama → groq → openrouter` (was groq-only).
- LKG preservation: never overwrites an `ok` payload with a `degraded` one.

### Added — `scripts/shared/geo-extract.mjs` + `country-names.json`

New lightweight headline → ISO2 extractor. Builds on the worldmonitor approach with:
- `extractCountryCode(text)` — first-match ISO2 (null for supranationals).
- `extractAllCountryCodes(text)` — all matches deduped in appearance order, for
  multi-country stories ("US and China trade talks" → `['US', 'CN']`).
- Extended `ALIAS_MAP` with OSINT conflict-zone terms: Donbas, Rafah, Houthi, Hamas,
  Hezbollah, Bucha, Mariupol, Aleppo, Mosul, etc.
- Supranational markers (NATO, EU, G7, UN, IAEA) return `null` not `'XX'`.
- `UNIGRAM_STOPWORDS` extended for OSINT context.

### Fixed — GDELT seed reliability (seed-gdelt-raw.mjs + _gdelt-cache.mjs)

**Root causes addressed:**

1. **Concurrent crawl causing immediate 429 saturation** — `Promise.allSettled([crawlTopics(), crawlPersons(), crawlGkg()])` fired all three phases simultaneously, sending dozens of requests to GDELT in parallel and saturating the per-IP rate limit within seconds. Replaced with strict sequential execution: Phase 1 (topics) → Phase 2 (persons) → Phase 3 (GKG). GDELT enforces a ~5s rate limit per IP; parallel execution makes this impossible to respect.

2. **No circuit breaker — script ran forever despite total failure** — after 5+ consecutive 429s or network errors the script continued looping through all remaining topics and persons, emitting ⚠ warnings but never stopping. Added a circuit breaker that trips after `CIRCUIT_TRIP_THRESHOLD` (5) consecutive failures, aborts all remaining GDELT calls, writes whatever partial data was collected, and sets a `gdelt:raw:ratelimit-at` flag key so consumers can surface a degraded-mode banner.

3. **No retry / exponential back-off** — every 429 was logged and silently skipped with no delay adjustment. Added exponential back-off: base cooldown doubles on each failure up to `MAX_BACKOFF_MS` (90s), then a single retry is attempted before giving up on that call.

4. **Static Redis — script always re-fetched even if cache was fresh** — running `seed-gdelt-raw.mjs` twice within a 4h TTL window hammered GDELT unnecessarily. Added cache-freshness gate: if `gdelt:raw:v1` is less than 30 minutes old, the script exits immediately with a cache-hit message. Override with `--force` flag.

5. **GKG v1 API called with invalid query syntax** — the GKG v1 endpoint does not support boolean operators `(OR …)` with parentheses. Changed to space-separated keywords (`protest riot demonstration unrest coup`) which GKG v1 treats as OR. Also increased `maxrecords` from 250 → 500 for better coverage.

6. **`timelinevol` response not normalised** — accepted `data ?? null` which could store a non-null but malformed object. Now guards both `data.timeline` and `data.timelines` shapes and stores `null` if the array is empty.

7. **`maxrecords` defaulted to 10** — most general topics were only returning 10 articles. Default raised to 50 across all general topics.

8. **_gdelt-cache.mjs: no staleness warnings** — consumers had no visibility into how old the cached data was. Added a `STALE_WARN_MIN` (90 min) threshold that logs a warning when data is getting old, and surfaces the `circuitTripped` flag set by the seed script.

**New behaviour summary:**
- `node scripts/seed-gdelt-raw.mjs` → cache-first; skips if cache < 30 min old
- `node scripts/seed-gdelt-raw.mjs --force` → always re-fetches
- On 429: doubles cooldown, retries once, trips circuit after 5 consecutive failures
- On circuit trip: writes partial data, sets `gdelt:raw:ratelimit-at` flag, exits cleanly
- Consumers receive `isGdeltDegraded()` helper to check for partial-data condition

### Added

- Chokepoint transit intelligence with 3 free data sources: IMF PortWatch (vessel transit counts), CorridorRisk (risk intelligence), AISStream (24h crossing counter) (#1560)
- 13 monitored chokepoints (was 6): added Cape of Good Hope, Gibraltar, Bosporus Strait (absorbs Dardanelles), Korea, Dover, Kerch, Lombok (#1560, #1572)
- Expandable chokepoint cards with TradingView lightweight-charts 180-day time-series (tanker vs cargo) (#1560)
- Real-time transit counting with enter+dwell+exit crossing detection, 30min cooldown (#1560)
- PortWatch, CorridorRisk, and transit seed loops on Railway relay (#1560)

### Fixed

- PortWatch ArcGIS URL, field names, and chokepoint name mappings (#1572)

## [2.6.1] - 2026-03-11

### Highlights

- **Blog Platform** — Astro-powered blog at /blog with 16 SEO-optimized posts, OG images, and site footer (#1401, #1405, #1409)
- **Country Intelligence** — country facts section with right-click context menu (#1400)
- **Satellite Imagery Overhaul** — globe-native rendering, outline-only polygons, CSP fixes (#1381, #1385, #1376)

### Added

- Astro blog at /blog with 16 SEO posts and build integration (#1401, #1403)
- Blog redesign to match /pro page design system (#1405)
- Blog SEO, OG images, favicon fix, and site footer (#1409)
- Country facts section and right-click context menu for intel panel (#1400)
- Satellite imagery panel enabled in orbital surveillance layer (#1375)
- Globe-native satellite imagery, removed sidebar panel (#1381)
- Layer search filter with synonym support (#1369)
- Close buttons on panels and Add Panel block (#1354)
- Enterprise contact form endpoint (#1365)
- Commodity and happy variants shown on all header versions (#1407)

### Fixed

- NOTAM closures merged into Aviation layer (#1408)
- Intel deep dive layout reordered, duplicate headlines removed (#1404)
- Satellite imagery outline-only polygons to eliminate alpha stacking blue tint (#1385)
- Enterprise form hardened with mandatory fields and lead qualification (#1382)
- Country intel silently dismisses when geocode cannot identify a country (#1383)
- Globe hit targets enlarged for small marker types (#1378)
- Imagery panel hidden for existing users and viewport refetch deadlock (#1377)
- CSP violations for satellite preview images (#1376)
- Safari TypeError filtering and Sentry noise patterns (#1380)
- Swedish locale 'avbruten' TypeError variant filtered (#1402)
- Satellite imagery STAC backend fix, merged into Orbital Surveillance (#1364)
- Aviation "Computed" source replaced with specific labels, reduced cache TTLs (#1374)
- Close button and hover-pause on all marker tooltips (#1371)
- Invalid 'satelliteImagery' removed from LAYER_SYNONYMS (#1370)
- Risk scores seeding gap and seed-meta key mismatch (#1366)
- Consistent LIVE header pattern across news and webcams panels (#1367)
- Globe null guards in path accessor callbacks (#1372)
- Node_modules guard in pre-push hook, pinned Node 22 (#1368)
- Typecheck CI workflow: removed paths-ignore, added push trigger (#1373)
- Theme toggle removed from header (#1407)

## [2.6.0] - 2026-03-09

### Highlights

- **Orbital Surveillance** — real-time satellite tracking layer with TLE propagation (#1278)
- **Premium Finance Suite** — stock analysis tools for Pro tier (#1268)
- **Self-hosted Basemap** — migrated from CARTO to PMTiles on Cloudflare R2 (#1064)
- **GPS Jamming v2** — migrated from gpsjam.org to Wingbits API with H3 hexagons (#1240)
- **Military Flights Overhaul** — centralized via Redis seed + edge handler with OpenSky/Wingbits fallbacks (#1263, #1274, #1275, #1276)
- **Pro Waitlist & Landing Page** — referral system, Turnstile CAPTCHA, 21-language localization (#1140, #1187)
- **Server-side AI Classification** — batch headline classification moves from client to server (#1195)
- **Commodity Variant** — new app variant focused on commodities with relevant panels & layers (#1040, #1100)
- **Health Check System** — comprehensive health endpoint with auto seed-meta freshness tracking (#1091, #1127, #1128)

### Added

- Orbital surveillance layer with real-time satellite tracking via satellite.js (#1278, #1281)
- Premium finance stock analysis suite for Pro tier (#1268)
- GPS jamming migration to Wingbits API with H3 hex grid (#1240)
- Commodity app variant with dedicated panels and map layers (#1040, #1100)
- Pro waitlist landing page with referral system and Turnstile CAPTCHA (#1140)
- Pro landing page localization — 21 languages (#1187)
- Pro page repositioning toward markets, macro & geopolitics (#1261)
- Referral invite banner when visiting via `?ref=` link (#1232)
- Server-side batch AI classification for news headlines (#1195)
- Self-hosted PMTiles basemap on Cloudflare R2, replacing CARTO (#1064)
- Per-provider map theme selector (#1101)
- Globe visual preset setting (Earth / Cosmos) with texture selection (#1090, #1076)
- Comprehensive health check endpoint for UptimeRobot (#1091)
- Auto seed-meta freshness tracking for all RPC handlers (#1127)
- Submarine cables expanded to 86 via TeleGeography API (#1224)
- Pak-Afghan conflict zone and country boundary override system (#1150)
- Sudan and Myanmar conflict zone polygon improvements (#1216)
- Iran events: 28 new location coords, 48h TTL (#1251)
- Tech HQs in Ireland data (#1244)
- BIS data seed job (#1131)
- CoinPaprika fallback for crypto/stablecoin data (#1092)
- Rudaw TV live stream and RSS feed (#1117)
- Dubai and Riyadh added to default airport watchlist (#1144)
- Cmd+K: 16 missing layer toggles (#1289), "See all commands" link with category list (#1270)
- UTM attribution tags on all outbound links (#1233)
- Performance warning dialog replaces hard layer limit (#1088)
- Unified error/retry UX with muted styling and countdown (#1115)
- Settings reorganized into collapsible groups (#1110)
- Reset Layout button with tooltip (#1267, #1250)
- Markdown lint in pre-push hook (#1166)

### Changed

- Military flights centralized via Redis seed + edge handler pattern (#1263)
- Military flights seed with OpenSky anonymous fallback + Wingbits fallback (#1274, #1275)
- Theater posture computed directly in relay instead of pinging Vercel RPC (#1259)
- Countries GeoJSON served from R2 CDN (#1164)
- Consolidated duplicated market data lists into shared JSON configs (#1212)
- Eliminate all frontend external API calls — enforce gold standard pattern (#1217)
- WB indicators seeded on Railway, never called from frontend (#1159, #1157)
- Temporal baseline for news + fires moved to server-side (#1194)
- Panel creation guarded by variant config (#1221)
- Panel tab styles unified to underline pattern across all panels (#1106, #1182, #1190, #1192)
- Reduce default map layers (#1141)
- Share dialog dismissals persist across subdomains via cookies (#1286)
- Country-wide conflict zones use actual country geometry (#1245)
- Aviation seed interval reduced to 1h (#1258)
- Replace curl with native Node.js HTTP CONNECT tunnel in seeds (#1287)
- Seed scripts use `_seed-utils.mjs` shared configs from `scripts/shared/` (#1231, #1234)

### Fixed

- **Rate Limiting**: prioritize `cf-connecting-ip` over `x-real-ip` for correct per-user rate limiting behind CF proxy (#1241)
- **Security**: harden cache keys against injection and hash collision (#1103), per-endpoint rate limits for summarize endpoints (#1161)
- **Map**: prevent ghost layers rendering without a toggle (#1264), DeckGL layer toggles getting stuck (#1248), auto-fallback to OpenFreeMap on basemap failure (#1109), CORS fallback for Carto basemap (#1142), use CORS-enabled R2 URL for PMTiles in Tauri (#1119), CII Instability layer disabled in 3D mode (#1292)
- **Layout**: reconcile ultrawide zones when map is hidden (#1246), keep settings button visible on scaled desktop widths (#1249), exit fullscreen before switching variants (#1253), apply map-hidden layout class on initial load (#1087), preserve panel column position across refresh (#1170, #1108, #1112)
- **Panels**: event delegation to survive setContent debounce (#1203), guard RPC response array access with optional chaining (#1174), clear stuck error headers and sanitize error messages (#1175), lazy panel race conditions + server feed gaps (#1113), Tech Readiness panel loading on full variant (#1208), Strategic Risk panel button listeners (#1214), World Clock green home row (#1202), Airline Intelligence CSS grid layouts (#1197)
- **Pro/Turnstile**: explicit rendering to fix widget race condition (#1189), invisible widget support (#1215), CSP allow Turnstile (#1155), handle `already_registered` state (#1183), reset on enterprise form error (#1222), registration feedback and referral code gen (#1229, #1228), no-cache header for /pro (#1179), correct API endpoint path (#1177), www redirect loop fix (#1198, #1201)
- **SEO**: comprehensive improvements for /pro and main pages (#1271)
- **Railway**: remove custom railpack.json install step causing ENOENT builds (#1296, #1290, #1288)
- **Aviation**: correct cancellation rate calculation and add 12 airports (#1209), unify NOTAM status logic (#1225)
- **Sentry**: triage 26 issues, fix 3 bugs, add 29 noise filters (#1173, #1098)
- **Health**: treat missing seed-meta as stale (#1128), resolve BIS credit and theater posture warnings (#1124), add WB seed loop (#1239), UCDP auth handling (#1252)
- **Country Brief**: formatting, duplication, and news cap fixes (#1219), prevent modal stuck on geocode failure (#1134)
- **Economic**: guard BIS and spending data against undefined (#1162, #1169)
- **Webcams**: detect blocked YouTube embeds on web (#1107), use iframe load event fallback (#1123), MTV Lebanon as live stream (#1122)
- **Desktop**: recover stranded routing fixes and unified error UX (#1160), DRY debounce, error handling, retry cap (#1084), debounce cache writes, batch secret push, lazy panels (#1077)
- **PWA**: bump SW nuke key to v2 for CF-cached 404s (#1081), one-time SW nuke on first visit (#1079)
- **Performance**: only show layer warning when adding layers, not removing (#1265), reduce unnecessary Vercel edge invocations (#1176)
- **i18n**: sync all 20 locales to en.json — zero drift (#1104), correct indentation for geocode error keys (#1147)
- **Insights**: graceful exit, LKG fallback, swap to Gemini 2.5 Flash (#1153, #1154)
- **Seeds**: prevent API quota burn and respect rate limits (#1167), gracefully skip write when validation fails (#1089), seed-meta tracking for all bootstrap keys (#1163, #1138)

## [2.5.25] - 2026-03-04

### Changed

- **Supply Chain v2** — bump chokepoints & minerals cache keys to v2; add `aisDisruptions` field to `ChokepointInfo` (proto, OpenAPI, generated types, handler, UI panel); rename Malacca Strait → Strait of Malacca; reduce chokepoint Redis TTL from 15 min to 5 min; expand description to always show warning + AIS disruption counts; remove Nickel & Copper from critical minerals data (focus on export-controlled minerals); slice top producers to 3; use full FRED series names for shipping indices; add `daily` cache tier (86400s) and move minerals route to it; align client-side circuit breaker TTLs with server TTLs; fix upstream-unavailable banner to only show when no data is present; register supply-chain routes in Vite dev server plugin
- **Cache migration**: old `supply_chain:chokepoints:v1` and `supply_chain:minerals:v1` Redis keys are no longer read by any consumer — they will expire via TTL with no action required

## [2.5.24] - 2026-03-03

### Highlights

- **UCDP conflict data** — integrated Uppsala Conflict Data Program for historical & ongoing armed conflict tracking (#760)
- **Country brief sharing** — maximize mode, shareable URLs, native browser share button, expanded sections (#743, #854)
- **Unified Vercel deployment** — consolidated 4 separate deployments into 1 via runtime variant detection (#756)
- **CDN performance overhaul** — POST→GET conversion, per-domain edge functions, tiered bootstrap for ~46% egress reduction (#753, #795, #838)
- **Security hardening** — CSP script hashes replace unsafe-inline, crypto.randomUUID() for IDs, XSS-safe i18n, Finnhub token header (#781, #844, #861, #744)
- **i18n expansion** — French support with Live TV channels, hardcoded English strings replaced with translation keys (#794, #851, #839)

### Added

- UCDP (Uppsala Conflict Data Program) integration for armed conflict tracking (#760)
- Iran & Strait of Hormuz conflict zones, upgraded Ukraine polygon (#731)
- 100 Iran war events seeded with expanded geocoder (#792)
- Country brief maximize mode, shareable URLs, expanded sections & i18n (#743)
- Native browser share button for country briefs (#854)
- French i18n support with French Live TV channels (#851)
- Geo-restricted live channel support, restored WELT (#765)
- Manage Channels UX — toggle from grid + show all channels (#745)
- Command palette: disambiguate Map vs Panel commands, split country into map/brief (#736)
- Command palette: rotating contextual tips replace static empty state (#737)
- Download App button for web users with dropdown (#734, #735)
- Reset layout button to restore default panel sizes and order (#801)
- System status moved into settings (#735)
- Vercel cron to pre-warm AviationStack cache (#776)
- Runtime variant detection — consolidate 4 Vercel deployments into 1 (#756)
- CJS syntax check in pre-push hook (#769)

### Fixed

- **Security**: XSS — wrap `t()` calls in `escapeHtml()` (#861), use `crypto.randomUUID()` instead of `Math.random()` for ID generation (#844), move Finnhub API key from query string to `X-Finnhub-Token` header (#744)
- **i18n**: replace hardcoded English strings with translation keys (#839), i18n improvements (#794)
- **Market**: parse comma-separated query params and align Railway cache keys (#856), Railway market data cron + complete missing tech feed categories (#850), Yahoo relay fallback + RSS digest relay for blocked feeds (#835), tech UNAVAILABLE feeds + Yahoo batch early-exit + sector heatmap gate (#810)
- **Aviation**: move AviationStack fetching to Railway relay, reduce to 40 airports (#858)
- **UI**: cancel pending debounced calls on component destroy (#848), guard async operations against stale DOM references (#843)
- **Sentry**: guard stale DOM refs, audio.play() compat, add 16 noise filters (#855)
- **Relay**: exponential backoff for failing RSS feeds (#853), deduplicate UCDP constants crashing Railway container (#766)
- **API**: remove `[domain]` catch-all that intercepted all RPC routes (#753 regression) (#785), pageSize bounds validation on research handlers (#819), return 405 for wrong HTTP method (#757), pagination cursor for cyber threats (#754)
- **Conflict**: bump Iran events cache-bust to v7 (#724)
- **OREF**: prevent LLM translation cache from poisoning Hebrew→English pipeline (#733), strip translation labels from World Brief input (#768)
- **Military**: harden USNI fleet report ship name regex (#805)
- **Sidecar**: add required params to ACLED API key validation probe (#804)
- **Macro**: replace hardcoded BTC mining thresholds with Mayer Multiple (#750)
- **Cyber**: reduce GeoIP per-IP timeout from 3s to 1.5s (#748)
- **CSP**: restore unsafe-inline for Vercel bot-challenge pages (#788), add missing script hash and finance variant (#798)
- **Runtime**: route all /api/* calls through CDN edge instead of direct Vercel (#780)
- **Desktop**: detect Linux node target from host arch (#742), harden Windows installer update path + map resize (#739), close update toast after clicking download (#738), only open valid http(s) links externally (#723)
- **Webcams**: replace dead Tel Aviv live stream (#732), replace stale Jerusalem feed (#849)
- Story header uses full domain WORLDMONITOR.APP (#799)
- Open variant nav links in same window instead of new tab (#721)
- Suppress map renders during resize drag (#728)
- Append deduction panel to DOM after async import resolves (#764)
- Deduplicate stale-while-revalidate background fetches in CircuitBreaker (#793)
- CORS fallback, rate-limit bump, RSS proxy allowlist (#814)
- Unavailable stream error messages updated (#759)

### Performance

- Tier slow/fast bootstrap data for ~46% CDN egress reduction (#838)
- Convert POST RPCs to GET for CDN caching (#795)
- Split monolithic edge function into per-domain functions (#753)
- Increase CDN cache TTLs + add stale-if-error across edge functions (#777)
- Bump CDN cache TTLs for oref-alerts and youtube/live (#791)
- Skip wasted direct fetch for Vercel-blocked domains in RSS proxy (#815)

### Security

- Replace CSP unsafe-inline with script hashes and add trust signals (#781)
- Expand Permissions-Policy and tighten CSP connect-src (#779)

### Changed

- Extend support for larger screens (#740)
- Green download button + retire sliding popup (#747)
- Extract shared relay helper into `_relay.js` (#782)
- Consolidate `SummarizeArticleResponse` status fields (#813)
- Consolidate `declare const process` into shared `env.d.ts` (#752)
- Deduplicate `clampInt` into `server/_shared/constants`
- Add error logging for network errors in error mapper (#746)
- Redis error logging + reduced timeouts for edge functions (#749)

---

## [2.5.21] - 2026-03-01

### Highlights

- **Iran Attacks map layer** — conflict events with severity badges, related event popups, and CII integration (#511, #527, #547, #549)
- **Telegram Intel panel** — 27 curated OSINT channels via MTProto relay (#550)
- **OREF Israel Sirens** — real-time alerts with Hebrew→English translation and 24h history bootstrap (#545, #556, #582)
- **GPS/GNSS jamming layer** — detection overlay with CII integration (#570)
- **Day/night terminator** — solar terminator overlay on map (#529)
- **Breaking news alert banner** — audio alerts for critical/high RSS items with cooldown bypass (#508, #516, #533)
- **AviationStack integration** — global airport delays for 128 airports with NOTAM closure detection (#552, #581, #583)
- **Strategic risk score** — theater posture + breaking news wired into scoring algorithm (#584)

### Added

- Iran Attacks map layer with conflict event popups, severity badges, and priority rendering (#511, #527, #549)
- Telegram Intel panel with curated OSINT channel list (#550, #600)
- OREF Israel Sirens panel with Hebrew-to-English translation (#545, #556)
- OREF 24h history bootstrap on relay startup (#582)
- GPS/GNSS jamming detection map layer + CII integration (#570)
- Day/night solar terminator overlay (#529)
- Breaking news active alert banner with audio for critical/high items (#508)
- AviationStack integration for non-US airports + NOTAM closure detection (#552, #581, #583)
- RT (Russia Today) HLS livestream + RSS feeds (#585, #586)
- Iran webcams tab with 4 feeds (#569, #572, #601)
- CBC News optional live channel (#502)
- Strategic risk score wired to theater posture + breaking news (#584)
- CII scoring: security advisories, Iran strikes, OREF sirens, GPS jamming (#547, #559, #570, #579)
- Country brief + CII signal coverage expansion (#611)
- Server-side military bases with 125K+ entries + rate limiting (#496)
- AVIATIONSTACK_API key in desktop settings (#553)
- Iran events seed script and latest data (#575)

### Fixed

- **Aviation**: stale IndexedDB cache invalidation + reduced CDN TTL (#607), broken lock replaced with direct cache + cancellation tiers (#591), query all airports instead of rotating batch (#557), NOTAM routing through Railway relay (#599), always show all monitored airports (#603)
- **Telegram**: AUTH_KEY_DUPLICATED fixes — latch to stop retry spam (#543), 60s startup delay (#587), graceful shutdown + poll guard (#562), ESM import path fixes (#537, #542), missing relay auth headers (#590)
- **Relay**: Polymarket OOM prevention — circuit breaker + concurrency limiter (#519), request deduplication (#513), queue backpressure + response slicing (#593), cache stampede fix (#592), kill switch (#523); smart quotes crash (#563); graceful shutdown (#562, #565); curl for OREF (#546, #567, #571); maxBuffer ENOBUFS (#609); rsshub.app blocked (#526); ERR_HTTP_HEADERS_SENT guard (#509); Telegram memory cleanup (#531)
- **Live news**: 7 stale YouTube fallback IDs replaced (#535, #538), broken Europe channel handles (#541), eNCA handle + VTC NOW removal + CTI News (#604), RT HLS recovery (#610), YouTube proxy auth alignment (#554, #555), residential proxy + gzip for detection (#551)
- **Breaking news**: critical alerts bypass cooldown (#516), keyword gaps filled (#517, #521), fake pubDate filter (#517), SESSION_START gate removed (#533)
- **Threat classifier**: military/conflict keyword gaps + news-to-conflict bridge (#514), Groq 429 stagger (#520)
- **Geo**: tokenization-based matching to prevent false positives (#503), 60+ missing locations in hub index (#528)
- **Iran**: CDN cache-bust pipeline v4 (#524, #532, #544), read-only handler (#518), Gulf misattribution via bbox disambiguation (#532)
- **CII**: Gulf country strike misattribution (#564), compound escalation for military action (#548)
- **Bootstrap**: 401/429 rate limiting fix (#512), hydration cache + polling hardening (#504)
- **Sentry**: guard YT player methods + GM/InvalidState noise (#602), Android OEM WebView bridge injection (#510), setView invalid preset (#580), beforeSend null-filename leak (#561)
- Rate limiting raised to 300 req/min sliding window (#515)
- Vercel preview origin regex generalized + bases cache key (#506)
- Cross-env for Windows-compatible npm scripts (#499)
- Download banner repositioned to bottom-right (#536)
- Stale/expired Polymarket markets filtered (#507)
- Cyber GeoIP centroid fallback jitter made deterministic (#498)
- Cache-control headers hardened for polymarket and rss-proxy (#613)

### Performance

- Server-side military base fetches: debounce + static edge cache tier (#497)
- RSS: refresh interval raised to 10min, cache TTL to 20min (#612)
- Polymarket cache TTL raised to 10 minutes (#568)

### Changed

- Stripped 61 debug console.log calls from 20 service files (#501)
- Bumped version to 2.5.21 (#605)

---

## [2.5.20] - 2026-02-27

### Added

- **Edge caching**: Complete Cloudflare edge cache tier coverage with degraded-response policy (#484)
- **Edge caching**: Cloudflare edge caching for proxy.worldmonitor.app (#478) and api.worldmonitor.app (#471)
- **Edge caching**: Tiered edge Cache-Control aligned to upstream TTLs (#474)
- **API migration**: Convert 52 API endpoints from POST to GET for edge caching (#468)
- **Gateway**: Configurable VITE_WS_API_URL + harden POST-to-GET shim (#480)
- **Cache**: Negative-result caching for cachedFetchJson (#466)
- **Security advisories**: New panel with government travel alerts (#460)
- **Settings**: Redesign settings window with VS Code-style sidebar layout (#461)

### Fixed

- **Commodities panel**: Was showing stocks instead of commodities — circuit breaker SWR returned stale data from a different call when cacheTtlMs=0 (#483)
- **Analytics**: Use greedy regex in PostHog ingest rewrites (#481)
- **Sentry**: Add noise filters for 4 unresolved issues (#479)
- **Gateway**: Convert stale POST requests to GET for backwards compat (#477)
- **Desktop**: Enable click-to-play YouTube embeds + CISA feed fixes (#476)
- **Tech variant**: Use rss() for CISA feed, drop build from pre-push hook (#475)
- **Security advisories**: Route feeds through RSS proxy to avoid CORS blocks (#473)
- **API routing**: Move 5 path-param endpoints to query params for Vercel routing (#472)
- **Beta**: Eagerly load T5-small model when beta mode is enabled
- **Scripts**: Handle escaped apostrophes in feed name regex (#455)
- **Wingbits**: Add 5-minute backoff on /v1/flights failures (#459)
- **Ollama**: Strip thinking tokens, raise max_tokens, fix panel summary cache (#456)
- **RSS/HLS**: RSS feed repairs, HLS native playback, summarization cache fix (#452)

### Performance

- **AIS proxy**: Increase AIS snapshot edge TTL from 2s to 10s (#482)

---

## [2.5.10] - 2026-02-26

### Fixed

- **Yahoo Finance rate-limit UX**: Show "rate limited — retrying shortly" instead of generic "Failed to load" on Markets, ETF, Commodities, and Sector panels when Yahoo returns 429 (#407)
- **Sequential Yahoo calls**: Replace `Promise.all` with staggered batching in commodity quotes, ETF flows, and macro signals to prevent 429 rate limiting (#406)
- **Sector heatmap Yahoo fallback**: Sector data now loads via Yahoo Finance when `FINNHUB_API_KEY` is missing (#406)
- **Finnhub-to-Yahoo fallback**: Market quotes route Finnhub symbols through Yahoo when API key is not configured (#407)
- **ETF early-exit on rate limit**: Skip retry loop and show rate-limit message immediately instead of waiting 60s (#407)
- **Sidecar auth resilience**: 401-retry with token refresh for stale sidecar tokens after restart; `diagFetch` auth helper for settings window diagnostics (#407)
- **Verbose toggle persistence**: Write verbose state to writable data directory instead of read-only app bundle on macOS (#407)
- **AI summary verbosity**: Tighten prompts to 2 sentences / 60 words max with `max_tokens` reduced from 150 to 100 (#404)
- **Settings modal title**: Rename from "PANELS" to "SETTINGS" across all 17 locales (#403)
- **Sentry noise filters**: CSS.escape() for news ID selectors, player.destroy guard, 11 new ignoreErrors patterns, blob: URL extension frame filter (#402)

---

## [2.5.6] - 2026-02-23

### Added

- **Greek (Ελληνικά) locale** — full translation of all 1,397 i18n keys (#256)
- **Nigeria RSS feeds** — 5 new sources: Premium Times, Vanguard, Channels TV, Daily Trust, ThisDay Live
- **Greek locale feeds** — Naftemporiki, in.gr, iefimerida.gr for Greek-language news coverage
- **Brasil Paralelo source** — Brazilian news with RSS feed and source tier (#260)

### Performance

- **AIS relay optimization** — backpressure queue with configurable watermarks, spatial indexing for chokepoint detection (O(chokepoints) vs O(chokepoints × vessels)), pre-serialized + pre-gzipped snapshot cache eliminating per-request JSON.stringify + gzip CPU (#266)

### Fixed

- **Vietnam flag country code** — corrected flag emoji in language selector (#245)
- **Sentry noise filters** — added patterns for SW FetchEvent, PostHog ingest; enabled SW POST method for PostHog analytics (#246)
- **Service Worker same-origin routing** — restricted SW route patterns to same-origin only, preventing cross-origin fetch interception (#247, #251)
- **Social preview bot allowlisting** — whitelisted Twitterbot, facebookexternalhit, and other crawlers on OG image assets (#251)
- **Windows CORS for Tauri** — allow `http://` origin from `tauri.localhost` for Windows desktop builds (#262)
- **Linux AppImage GLib crash** — fix GLib symbol mismatch on newer distros by bundling compatible libraries (#263)

---

## [2.5.2] - 2026-02-21

### Fixed

- **QuotaExceededError handling** — detect storage quota exhaustion and stop further writes to localStorage/IndexedDB instead of silently failing; shared `markStorageQuotaExceeded()` flag across persistent-cache and utility storage
- **deck.gl null.getProjection crash** — wrap `setProps()` calls in try/catch to survive map mid-teardown races in debounced/RAF callbacks
- **MapLibre "Style is not done loading"** — guard `setFilter()` in mousemove/mouseout handlers during theme switches
- **YouTube invalid video ID** — validate video ID format (`/^[\w-]{10,12}$/`) before passing to IFrame Player constructor
- **Vercel build skip on empty SHA** — guard `ignoreCommand` against unset `VERCEL_GIT_PREVIOUS_SHA` (first deploy, force deploy) which caused `git diff` to fail and cancel builds
- **Sentry noise filters** — added 7 patterns: iOS readonly property, SW FetchEvent, toLowerCase/trim/indexOf injections, QuotaExceededError

---

## [2.5.1] - 2026-02-20

### Performance

- **Batch FRED API requests** — frontend now sends a single request with comma-separated series IDs instead of 7 parallel edge function invocations, eliminating Vercel 25s timeouts
- **Parallel UCDP page fetches** — replaced sequential loop with Promise.all for up to 12 pages, cutting fetch time from ~96s worst-case to ~8s
- **Bot protection middleware** — blocks known social-media crawlers from hitting API routes, reducing unnecessary edge function invocations
- **Extended API cache TTLs** — country-intel 12h→24h, GDELT 2h→4h, nuclear 12h→24h; Vercel ignoreCommand skips non-code deploys

### Fixed

- **Partial UCDP cache poisoning** — failed page fetches no longer silently produce incomplete results cached for 6h; partial results get 10-min TTL in both Redis and memory, with `partial: true` flag propagated to CDN cache headers
- **FRED upstream error masking** — single-series failures now return 502 instead of empty 200; batch mode surfaces per-series errors and returns 502 when all fail
- **Sentry `Load failed` filter** — widened regex from `^TypeError: Load failed$` to `^TypeError: Load failed( \(.*\))?$` to catch host-suffixed variants (e.g., gamma-api.polymarket.com)
- **Tooltip XSS hardening** — replaced `rawHtml()` with `safeHtml()` allowlist sanitizer for panel info tooltips
- **UCDP country endpoint** — added missing HTTP method guards (OPTIONS/GET)
- **Middleware exact path matching** — social preview bot allowlist uses `Set.has()` instead of `startsWith()` prefix matching

### Changed

- FRED batch API supports up to 15 comma-separated series IDs with deduplication
- Missing FRED API key returns 200 with `X-Data-Status: skipped-no-api-key` header instead of silent empty response
- LAYER_TO_SOURCE config extracted from duplicate inline mappings into shared constant

---

## [2.5.0] - 2026-02-20

### Highlights

**Local LLM Support (Ollama / LM Studio)** — Run AI summarization entirely on your own hardware with zero cloud dependency. The desktop app auto-discovers models from any OpenAI-compatible local inference server (Ollama, LM Studio, llama.cpp, vLLM) and populates a selection dropdown. A 4-tier fallback chain ensures summaries always generate: Local LLM → Groq → OpenRouter → browser-side T5. Combined with the Tauri desktop app, this enables fully air-gapped intelligence analysis where no data leaves your machine.

### Added

- **Ollama / LM Studio integration** — local AI summarization via OpenAI-compatible `/v1/chat/completions` endpoint with automatic model discovery, embedding model filtering, and fallback to manual text input
- **4-tier summarization fallback chain** — Ollama (local) → Groq (cloud) → OpenRouter (cloud) → Transformers.js T5 (browser), each with 5-second timeout before silently advancing to the next
- **Shared summarization handler factory** — all three API tiers use identical logic for headline deduplication (Jaccard >0.6), variant-aware prompting, language-aware output, and Redis caching (`summary:v3:{mode}:{variant}:{lang}:{hash}`)
- **Settings window with 3 tabs** — dedicated **LLMs** tab (Ollama endpoint/model, Groq, OpenRouter), **API Keys** tab (12+ data source credentials), and **Debug & Logs** tab (traffic log, verbose mode, log file access). Each tab runs an independent verification pipeline
- **Consolidated keychain vault** — all desktop secrets stored as a single JSON blob in one OS keychain entry (`secrets-vault`), reducing macOS Keychain authorization prompts from 20+ to exactly 1 on app startup. One-time auto-migration from individual entries with cleanup
- **Cross-window secret synchronization** — saving credentials in the Settings window immediately syncs to the main dashboard via `localStorage` broadcast, with no app restart needed
- **API key verification pipeline** — each credential is validated against its provider's actual API endpoint. Network errors (timeouts, DNS failures) soft-pass to prevent transient failures from blocking key storage; only explicit 401/403 marks a key invalid
- **Plaintext URL inputs** — endpoint URLs (Ollama API, relay URLs, model names) display as readable text instead of masked password dots in Settings
- **5 new defense/intel RSS feeds** — Military Times, Task & Purpose, USNI News, Oryx OSINT, UK Ministry of Defence
- **Koeberg nuclear power plant** — added to the nuclear facilities map layer (the only commercial reactor in Africa, Cape Town, South Africa)
- **Privacy & Offline Architecture** documentation — README now details the three privacy levels: full cloud, desktop with cloud APIs, and air-gapped local with Ollama
- **AI Summarization Chain** documentation — README includes provider fallback flow diagram and detailed explanation of headline deduplication, variant-aware prompting, and cross-user cache deduplication

### Changed

- AI fallback chain now starts with Ollama (local) before cloud providers
- Feature toggles increased from 14 to 15 (added AI/Ollama)
- Desktop architecture uses consolidated vault instead of per-key keychain entries
- README expanded with ~85 lines of new content covering local LLM support, privacy architecture, summarization chain internals, and desktop readiness framework

### Fixed

- URL and model fields in Settings display as plaintext instead of masked password dots
- OpenAI-compatible endpoint flow hardened for Ollama/LM Studio response format differences (thinking tokens, missing `choices` array edge cases)
- Sentry null guard for `getProjection()` crash with 6 additional noise filters
- PathLayer cache cleared on layer toggle-off to prevent stale WebGL buffer rendering

---

## [2.4.1] - 2026-02-19

### Fixed

- **Map PathLayer cache**: Clear PathLayer on toggle-off to prevent stale WebGL buffers
- **Sentry noise**: Null guard for `getProjection()` crash and 6 additional noise filters
- **Markdown docs**: Resolve lint errors in documentation files

---

## [2.4.0] - 2026-02-19

### Added

- **Live Webcams Panel**: 2x2 grid of live YouTube webcam feeds from global hotspots with region filters (Middle East, Europe, Asia-Pacific, Americas), grid/single view toggle, idle detection, and full i18n support (#111)
- **Linux download**: added `.AppImage` option to download banner

### Changed

- **Mobile detection**: use viewport width only for mobile detection; touch-capable notebooks (e.g. ROG Flow X13) now get desktop layout (#113)
- **Webcam feeds**: curated Tel Aviv, Mecca, LA, Miami; replaced dead Tokyo feed; diverse ALL grid with Jerusalem, Tehran, Kyiv, Washington

### Fixed

- **Le Monde RSS**: English feed URL updated (`/en/rss/full.xml` → `/en/rss/une.xml`) to fix 404
- **Workbox precache**: added `html` to `globPatterns` so `navigateFallback` works for offline PWA
- **Panel ordering**: one-time migration ensures Live Webcams follows Live News for existing users
- **Mobile popups**: improved sheet/touch/controls layout (#109)
- **Intelligence alerts**: disabled on mobile to reduce noise (#110)
- **RSS proxy**: added 8 missing domains to allowlist
- **HTML tags**: repaired malformed tags in panel template literals
- **ML worker**: wrapped `unloadModel()` in try/catch to prevent unhandled timeout rejections
- **YouTube player**: optional chaining on `playVideo?.()` / `pauseVideo?.()` for initialization race
- **Panel drag**: guarded `.closest()` on non-Element event targets
- **Beta mode**: resolved race condition and timeout failures
- **Sentry noise**: added filters for Firefox `too much recursion`, maplibre `_layers`/`id`/`type` null crashes

## [2.3.9] - 2026-02-18

### Added

- **Full internationalization (14 locales)**: English, French, German, Spanish, Italian, Polish, Portuguese, Dutch, Swedish, Russian, Arabic, Chinese Simplified, Japanese — each with 1100+ translated keys
- **RTL support**: Arabic locale with `dir="rtl"`, dedicated RTL CSS overrides, regional language code normalization (e.g. `ar-SA` correctly triggers RTL)
- **Language switcher**: in-app locale picker with flag icons, persists to localStorage
- **i18n infrastructure**: i18next with browser language detection and English fallback
- **Community discussion widget**: floating pill linking to GitHub Discussions with delayed appearance and permanent dismiss
- **Linux AppImage**: added `ubuntu-22.04` to CI build matrix with webkit2gtk/appindicator dependencies
- **NHK World and Nikkei Asia**: added RSS feeds for Japan news coverage
- **Intelligence Findings badge toggle**: option to disable the findings badge in the UI

### Changed

- **Zero hardcoded English**: all UI text routed through `t()` — panels, modals, tooltips, popups, map legends, alert templates, signal descriptions
- **Trending proper-noun detection**: improved mid-sentence capitalization heuristic with all-caps fallback when ML classifier is unavailable
- **Stopword suppression**: added missing English stopwords to trending keyword filter

### Fixed

- **Dead UTC clock**: removed `#timeDisplay` element that permanently displayed `--:--:-- UTC`
- **Community widget duplicates**: added DOM idempotency guard preventing duplicate widgets on repeated news refresh cycles
- **Settings help text**: suppressed raw i18n key paths rendering when translation is missing
- **Intelligence Findings badge**: fixed toggle state and listener lifecycle
- **Context menu styles**: restored intel-findings context menu styles
- **CSS theme variables**: defined missing `--panel-bg` and `--panel-border` variables

## [2.3.8] - 2026-02-17

### Added

- **Finance variant**: Added a dedicated market-first variant (`finance.worldmonitor.app`) with finance/trading-focused feeds, panels, and map defaults
- **Finance desktop profile**: Added finance-specific desktop config and build profile for Tauri packaging

### Changed

- **Variant feed loading**: `loadNews` now enumerates categories dynamically and stages category fetches with bounded concurrency across variants
- **Feed resilience**: Replaced direct MarketWatch RSS usage in finance/full/tech paths with Google News-backed fallback queries
- **Classification pressure controls**: Tightened AI classification budgets for tech/full and tuned per-feed caps to reduce startup burst pressure
- **Timeline behavior**: Wired timeline filtering consistently across map and news panels
- **AI summarization defaults**: Switched OpenRouter summarization to auto-routed free-tier model selection

### Fixed

- **Finance panel parity**: Kept data-rich panels while adding news panels for finance instead of removing core data surfaces
- **Desktop finance map parity**: Finance variant now runs first-class Deck.GL map/layer behavior on desktop runtime
- **Polymarket fallback**: Added one-time direct connectivity probe and memoized fallback to prevent repeated `ERR_CONNECTION_RESET` storms
- **FRED fallback behavior**: Missing `FRED_API_KEY` now returns graceful empty payloads instead of repeated hard 500s
- **Preview CSP tooling**: Allowed `https://vercel.live` script in CSP so Vercel preview feedback injection is not blocked
- **Trending quality**: Suppressed noisy generic finance terms in keyword spike detection
- **Mobile UX**: Hidden desktop download prompt on mobile devices

## [2.3.7] - 2026-02-16

### Added

- **Full light mode theme**: Complete light/dark theme system with CSS custom properties, ThemeManager module, FOUC prevention, and `getCSSColor()` utility for theme-aware inline styles
- **Theme-aware maps and charts**: Deck.GL basemap, overlay layers, and CountryTimeline charts respond to theme changes in real time
- **Dark/light mode header toggle**: Sun/moon icon in the header bar for quick theme switching, replacing the duplicate UTC clock
- **Desktop update checker**: Architecture-aware download links for macOS (ARM/Intel) and Windows
- **Node.js bundled in Tauri installer**: Sidecar no longer requires system Node.js
- **Markdown linting**: Added markdownlint config and CI workflow

### Changed

- **Panels modal**: Reverted from "Settings" back to "Panels" — removed redundant Appearance section now that header has theme toggle
- **Default panels**: Enabled UCDP Conflict Events, UNHCR Displacement, Climate Anomalies, and Population Exposure panels by default

### Fixed

- **CORS for Tauri desktop**: Fixed CORS issues for desktop app requests
- **Markets panel**: Keep Yahoo-backed data visible when Finnhub API key is skipped
- **Windows UNC paths**: Preserve extended-length path prefix when sanitizing sidecar script path
- **Light mode readability**: Darkened neon semantic colors and overlay backgrounds for light mode contrast

## [2.3.6] - 2026-02-16

### Fixed

- **Windows console window**: Hide the `node.exe` console window that appeared alongside the desktop app on Windows

## [2.3.5] - 2026-02-16

### Changed

- **Panel error messages**: Differentiated error messages per panel so users see context-specific guidance instead of generic failures
- **Desktop config auto-hide**: Desktop configuration panel automatically hides on web deployments where it is not relevant

## [2.3.4] - 2026-02-16

### Fixed

- **Windows sidecar crash**: Strip `\\?\` UNC extended-length prefix from paths before passing to Node.js — Tauri `resource_dir()` on Windows returns UNC-prefixed paths that cause `EISDIR: lstat 'C:'` in Node.js module resolution
- **Windows sidecar CWD**: Set explicit `current_dir` on the Node.js Command to prevent bare drive-letter working directory issues from NSIS shortcut launcher
- **Sidecar package scope**: Add `package.json` with `"type": "module"` to sidecar directory, preventing Node.js from walking up the entire directory tree during ESM scope resolution

## [2.3.3] - 2026-02-16

### Fixed

- **Keychain persistence**: Enable `apple-native` (macOS) and `windows-native` (Windows) features for the `keyring` crate — v3 ships with no default platform backends, so API keys were stored in-memory only and lost on restart
- **Settings key verification**: Soft-pass network errors during API key verification so transient sidecar failures don't block saving
- **Resilient keychain reads**: Use `Promise.allSettled` in `loadDesktopSecrets` so a single key failure doesn't discard all loaded secrets
- **Settings window capabilities**: Add `"settings"` to Tauri capabilities window list for core plugin permissions
- **Input preservation**: Capture unsaved input values before DOM re-render in settings panel

## [2.3.0] - 2026-02-15

### Security

- **CORS hardening**: Tighten Vercel preview deployment regex to block origin spoofing (`worldmonitorEVIL.vercel.app`)
- **Sidecar auth bypass**: Move `/api/local-env-update` behind `LOCAL_API_TOKEN` auth check
- **Env key allowlist**: Restrict sidecar env mutations to 18 known secret keys (matching `SUPPORTED_SECRET_KEYS`)
- **postMessage validation**: Add `origin` and `source` checks on incoming messages in LiveNewsPanel
- **postMessage targetOrigin**: Replace wildcard `'*'` with specific embed origin
- **CORS enforcement**: Add `isDisallowedOrigin()` check to 25+ API endpoints that were missing it
- **Custom CORS migration**: Migrate `gdelt-geo` and `eia` from custom CORS to shared `_cors.js` module
- **New CORS coverage**: Add CORS headers + origin check to `firms-fires`, `stock-index`, `youtube/live`
- **YouTube embed origins**: Tighten `ALLOWED_ORIGINS` regex in `youtube/embed.js`
- **CSP hardening**: Remove `'unsafe-inline'` from `script-src` in both `index.html` and `tauri.conf.json`
- **iframe sandbox**: Add `sandbox="allow-scripts allow-same-origin allow-presentation"` to YouTube embed iframe
- **Meta tag validation**: Validate URL query params with regex allowlist in `parseStoryParams()`

### Fixed

- **Service worker stale assets**: Add `skipWaiting`, `clientsClaim`, and `cleanupOutdatedCaches` to workbox config — fixes `NS_ERROR_CORRUPTED_CONTENT` / MIME type errors when users have a cached SW serving old HTML after redeployment

## [2.2.6] - 2026-02-14

### Fixed

- Filter trending noise and fix sidecar auth
- Restore tech variant panels
- Remove Market Radar and Economic Data panels from tech variant

### Docs

- Add developer X/Twitter link to Support section
- Add cyber threat API keys to `.env.example`

## [2.2.5] - 2026-02-13

### Security

- Migrate all Vercel edge functions to CORS allowlist
- Restrict Railway relay CORS to allowed origins only

### Fixed

- Hide desktop config panel on web
- Route World Bank & Polymarket via Railway relay

## [2.2.3] - 2026-02-12

### Added

- Cyber threat intelligence map layer (Feodo Tracker, URLhaus, C2IntelFeeds, OTX, AbuseIPDB)
- Trending keyword spike detection with end-to-end flow
- Download desktop app slide-in banner for web visitors
- Country briefs in Cmd+K search

### Changed

- Redesign 4 panels with table layouts and scoped styles
- Redesign population exposure panel and reorder UCDP columns
- Dramatically increase cyber threat map density

### Fixed

- Resolve z-index conflict between pinned map and panels grid
- Cap geo enrichment at 12s timeout, prevent duplicate download banners
- Replace ipwho.is/ipapi.co with ipinfo.io/freeipapi.com for geo enrichment
- Harden trending spike processing and optimize hot paths
- Improve cyber threat tooltip/popup UX and dot visibility

## [2.2.2] - 2026-02-10

### Added

- Full-page Country Brief Page replacing modal overlay
- Download redirect API for platform-specific installers

### Fixed

- Normalize country name from GeoJSON to canonical TIER1 name
- Tighten headline relevance, add Top News section, compact markets
- Hide desktop config panel on web, fix irrelevant prediction markets
- Tone down climate anomalies heatmap to stop obscuring other layers
- macOS: hide window on close instead of quitting

### Performance

- Reduce idle CPU from pulse animation loop
- Harden regression guardrails in CI, cache, and map clustering

## [2.2.1] - 2026-02-08

### Fixed

- Consolidate variant naming and fix PWA tile caching
- Windows settings window: async command, no menu bar, no white flash
- Constrain layers menu height in DeckGLMap
- Allow Cloudflare Insights script in CSP
- macOS build failures when Apple signing secrets are missing

## [2.2.0] - 2026-02-07

Initial v2.2 release with multi-variant support (World + Tech), desktop app (Tauri), and comprehensive geopolitical intelligence features.
