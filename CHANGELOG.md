# Changelog — Patch 9 Addendum

## Patch 9 — April 4, 2026

### Summary
Feature patch. Ports two koala seeds (thermal-escalation, security-advisories) that feed the cross-source-signals correlation engine. Adds a new CrossSourceSignalsPanel to display multi-domain intelligence fusion results. Before this patch, 2 of the 20 cross-source extractors returned empty because their source keys weren't populated. Now they produce real signals.

### New Files

**`scripts/seed-thermal-escalation.mjs`** (NEW — ported from koala)
- 62 lines. Reads `wildfire:fires:v1` (already seeded by seed-fire-detections). Computes thermal anomaly clusters using the lib below. Writes `thermal:escalation:v1` (6h TTL) + `thermal:escalation:history:v1`.
- Feeds cross-source-signals `extractThermalSpike()` extractor.

**`scripts/lib/thermal-escalation.mjs`** (NEW — ported from koala)
- 387 lines. Pure JavaScript, zero external dependencies.
- Clusters fire detections by proximity (20km radius), computes anomaly scores by comparing current activity to 7-day baseline, classifies conflict regions (Ukraine, Gaza, Syria, etc) for elevated alerting, maintains rolling history for trend detection.

**`scripts/seed-security-advisories.mjs`** (NEW — ported from koala)
- 225 lines. Scrapes travel advisory RSS feeds: US State Dept, UK FCDO, 12 US Embassy alert feeds, CDC Travel Notices, ECDC Epidemiological Updates.
- Writes `intelligence:advisories:v1` + `intelligence:advisories-bootstrap:v1` (3h TTL).
- Feeds cross-source-signals `extractOrefAlertCluster()` extractor.

**`src/components/CrossSourceSignalsPanel.ts`** (NEW)
- Reads `/api/bootstrap` → `crossSourceSignals`.
- Displays composite escalation zones as red banner cards (theater name, contributing categories, signal count, severity score).
- Individual signals listed by severity: icon, summary, theater, type label, age.
- Severity color coding: CRITICAL red, HIGH orange, MEDIUM amber, LOW green.
- Auto-refreshes every 5 minutes. Shows CRIT/HIGH counts in header.

### Modified Files

**`src/config/variants/full.ts`** — added `'cross-source-signals'` to DEFAULT_PANELS (priority 1)
**`src/components/index.ts`** — added `CrossSourceSignalsPanel` export
**`src/config/panels.ts`** — added to intelligence panelKeys array
**`src/app/panel-layout.ts`** — added lazy panel import
**`.github/workflows/seed.yml`** — added seed-thermal-escalation + seed-security-advisories before cross-source-signals in Job 2
