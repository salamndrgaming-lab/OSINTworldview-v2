# Changelog — Patch 7 Addendum

## Patch 7 — April 4, 2026

### Summary
Wiring audit of Tier 2 panels. Fixed SignalConfidencePanel which was permanently broken — it read `data.seedMeta` from `/api/health` but that field doesn't exist; the health API returns `data.checks` with `seedAgeMin` per key. Audited 6 other panels and confirmed they were already wired correctly.

### Modified Files

**`src/components/SignalConfidencePanel.ts`** (FIX)
- `HealthData` interface rewritten to match actual `/api/health` response: `{ status, checks: Record<string, { status, records, seedAgeMin, maxStaleMin }>, summary }`
- `DomainCell.metaKey` replaced with `healthKey` — maps to exact camelCase key names used in health.js (`gdeltIntel`, `ucdpEvents`, `weatherAlerts`, etc.)
- DOMAINS array expanded from 20 → 24 cells: added Forecasts (correlationCards), Predictions, Wildfires, Military Flights
- `render()` method reads `checks[healthKey].seedAgeMin` (minutes) instead of computing from `seedMeta[key].freshAt` (timestamp). Uses `checks[key].maxStaleMin` for per-domain threshold (falls back to 120 if absent)
- Confidence levels: status OK/OK_CASCADE → fresh, seedAgeMin ≤ threshold → fresh, ≤ 2×threshold → amber, else stale, EMPTY/EMPTY_DATA → missing
- `renderCell()` accepts optional `records` count for tooltip enrichment
- Removed unused `RED_MIN` constant (TypeScript `noUnusedLocals` compliance)

### Panels Audited (no changes needed)

| Panel | Data Source | Status |
|-------|-----------|--------|
| TimeTravelPanel | /api/snapshot → snapshots:index + snapshots:{date} | ✅ Already wired |
| AutoBriefPanel | /api/bootstrap (correlation cards) + /api/insights | ✅ Already wired |
| Entity Intel tab | /api/poi → intelligence:poi:v1 | ✅ Already wired |
| HypothesisGeneratorPanel | /api/bootstrap → hypotheses data | ✅ Already wired |
| NarrativeDriftPanel | /api/bootstrap → narrative drift data | ✅ Already wired |
| POIPanel | /api/poi → intelligence:poi:v1 | ✅ Already wired (385 lines, rich profile cards) |
