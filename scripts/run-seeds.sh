#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-seeds.sh — Parallel seed runner with per-seed timeouts
#
# Runs seeds in dependency-ordered waves. Within each wave, seeds execute in
# parallel (background processes). Each seed gets a hard timeout so one stuck
# seed never blocks the rest. Failures are logged but don't abort the run.
#
# Usage:
#   ./scripts/run-seeds.sh           # run all waves
#   ./scripts/run-seeds.sh --wave 1  # run only wave 1 (free sources)
#
# Designed for GitHub Actions cron. Replaces the sequential step-per-seed
# approach that caused 30-minute timeouts and cascading cancellations.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SEED_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMEOUT_DEFAULT=120   # 2 min per seed (most finish in 5-20s)
TIMEOUT_LONG=240      # 4 min for AIS, AI seeds
TIMEOUT_GDELT=180     # 3 min for GDELT consumers
LOG_DIR="/tmp/seed-logs"
mkdir -p "$LOG_DIR"

# Counters — use files because run_seed executes in background subshells
COUNT_DIR=$(mktemp -d)
echo 0 > "$COUNT_DIR/total"
echo 0 > "$COUNT_DIR/passed"
echo 0 > "$COUNT_DIR/failed"
echo 0 > "$COUNT_DIR/skipped"
: > "$COUNT_DIR/failed_seeds"
START_TIME=$(date +%s)

inc() { flock "$COUNT_DIR/$1" bash -c "echo \$(( \$(cat \"$COUNT_DIR/$1\") + 1 )) > \"$COUNT_DIR/$1\""; }

# ── Helpers ──────────────────────────────────────────────────────────────────

run_seed() {
  local script="$1"
  local timeout="${2:-$TIMEOUT_DEFAULT}"
  local name
  name=$(basename "$script" .mjs)
  local logfile="$LOG_DIR/$name.log"

  inc total

  if [ ! -f "$SEED_DIR/$script" ]; then
    echo "  SKIP  $name (file not found)"
    inc skipped
    return 0
  fi

  # Run with timeout; capture exit code
  local exit_code=0
  timeout --signal=KILL "$timeout" node "$SEED_DIR/$script" > "$logfile" 2>&1 || exit_code=$?

  if [ "$exit_code" -eq 0 ]; then
    echo "  OK    $name"
    inc passed
  elif [ "$exit_code" -eq 137 ]; then
    echo "  KILL  $name (timeout ${timeout}s)"
    inc failed
    flock "$COUNT_DIR/failed_seeds" bash -c "echo -n ' ${name}(timeout)' >> \"$COUNT_DIR/failed_seeds\""
  else
    echo "  FAIL  $name (exit $exit_code)"
    inc failed
    flock "$COUNT_DIR/failed_seeds" bash -c "echo -n ' ${name}(${exit_code})' >> \"$COUNT_DIR/failed_seeds\""
    # Print last 5 lines of log for diagnosis
    tail -5 "$logfile" 2>/dev/null | sed 's/^/        /'
  fi
}

# Run seeds in parallel within a wave. Wait for all to finish before next wave.
run_wave() {
  local wave_name="$1"
  shift
  echo ""
  echo "━━━ Wave: $wave_name ━━━"
  local pids=()

  for entry in "$@"; do
    # Format: "script.mjs" or "script.mjs:timeout"
    local script timeout
    script="${entry%%:*}"
    timeout="${entry#*:}"
    [ "$timeout" = "$script" ] && timeout="$TIMEOUT_DEFAULT"

    run_seed "$script" "$timeout" &
    pids+=($!)
  done

  # Wait for all background seeds in this wave
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}

# ── Wave Definitions ─────────────────────────────────────────────────────────
# Seeds in the same wave run in parallel. Waves run sequentially.
# Later waves may depend on keys written by earlier waves.

wave_1_free_sources() {
  run_wave "Free Data Sources (no API keys)" \
    "seed-earthquakes.mjs" \
    "seed-natural-events.mjs" \
    "seed-weather-alerts.mjs" \
    "seed-commodity-quotes.mjs" \
    "seed-unrest-events.mjs" \
    "seed-prediction-markets.mjs" \
    "seed-service-statuses.mjs" \
    "seed-climate-anomalies.mjs" \
    "seed-gulf-quotes.mjs" \
    "seed-etf-flows.mjs" \
    "seed-bis-data.mjs" \
    "seed-displacement-summary.mjs" \
    "seed-iran-events.mjs" \
    "seed-submarine-cables.mjs" \
    "seed-usa-spending.mjs" \
    "seed-wb-indicators.mjs"
}

wave_2_api_key_sources() {
  run_wave "API-Key Sources" \
    "seed-market-quotes.mjs" \
    "seed-cyber-threats.mjs" \
    "seed-crypto-quotes.mjs" \
    "seed-fire-detections.mjs" \
    "seed-ucdp-events.mjs" \
    "seed-internet-outages.mjs" \
    "seed-military-flights.mjs" \
    "seed-airport-delays.mjs" \
    "seed-stablecoin-markets.mjs" \
    "seed-webcams.mjs" \
    "seed-webcams-fallback.mjs" \
    "fetch-gpsjam.mjs" \
    "seed-ais-vessels.mjs:$TIMEOUT_LONG"
}

wave_3_gdelt_consumers() {
  run_wave "GDELT Consumers (read gdelt:raw:v1)" \
    "seed-gdelt-intel.mjs:$TIMEOUT_GDELT" \
    "seed-missile-events.mjs:$TIMEOUT_GDELT" \
    "seed-warcam.mjs:$TIMEOUT_GDELT" \
    "seed-telegram-narratives.mjs:$TIMEOUT_GDELT" \
    "seed-narrative-drift.mjs:$TIMEOUT_GDELT"
}

wave_4_aggregators() {
  run_wave "Aggregators + Non-GDELT Intel" \
    "seed-correlation.mjs" \
    "seed-chokepoint-flow.mjs" \
    "seed-telegram-osint.mjs" \
    "seed-orbital.mjs" \
    "seed-conflict-forecast.mjs" \
    "seed-disease-outbreaks.mjs" \
    "seed-radiation.mjs" \
    "seed-thermal-escalation.mjs" \
    "seed-security-advisories.mjs"
}

wave_5_ai_powered() {
  run_wave "AI-Powered Seeds (Groq)" \
    "seed-insights-from-cache.mjs:$TIMEOUT_LONG" \
    "seed-persons-of-interest.mjs:$TIMEOUT_LONG" \
    "seed-poi-discovery.mjs:$TIMEOUT_LONG"
}

TIMEOUT_COUNCIL=900   # 15 min for agent council (7 LLM calls)

wave_6_derivatives() {
  run_wave "Derivative Seeds (read upstream keys)" \
    "seed-alerts.mjs" \
    "agent-sitrep.mjs:$TIMEOUT_LONG" \
    "seed-hypothesis-generator.mjs:$TIMEOUT_LONG" \
    "seed-cross-source-signals.mjs" \
    "seed-agent-council.mjs:$TIMEOUT_COUNCIL"
}

wave_7_archival() {
  run_wave "Indexing + Archival (runs last)" \
    "seed-vector-index.mjs:$TIMEOUT_LONG" \
    "seed-snapshot.mjs" \
    "seed-entity-graph.mjs:$TIMEOUT_LONG"
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  OSINTview — Seed Pipeline Runner                   ║"
echo "║  $(date -u '+%Y-%m-%d %H:%M UTC')                                    ║"
echo "╚══════════════════════════════════════════════════════════╝"

WAVE_FILTER="${1:-all}"

if [ "$WAVE_FILTER" = "--wave" ]; then
  WAVE_NUM="${2:-all}"
  case "$WAVE_NUM" in
    1) wave_1_free_sources ;;
    2) wave_2_api_key_sources ;;
    3) wave_3_gdelt_consumers ;;
    4) wave_4_aggregators ;;
    5) wave_5_ai_powered ;;
    6) wave_6_derivatives ;;
    7) wave_7_archival ;;
    *) echo "Unknown wave: $WAVE_NUM"; exit 1 ;;
  esac
else
  wave_1_free_sources
  wave_2_api_key_sources
  wave_3_gdelt_consumers
  wave_4_aggregators
  wave_5_ai_powered
  wave_6_derivatives
  wave_7_archival
fi

# ── Summary ──────────────────────────────────────────────────────────────────

END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))

TOTAL=$(cat "$COUNT_DIR/total")
PASSED=$(cat "$COUNT_DIR/passed")
FAILED=$(cat "$COUNT_DIR/failed")
SKIPPED=$(cat "$COUNT_DIR/skipped")
FAILED_SEEDS=$(cat "$COUNT_DIR/failed_seeds")

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  SEED RUN COMPLETE in ${ELAPSED}s"
echo "  Total: $TOTAL | Passed: $PASSED | Failed: $FAILED | Skipped: $SKIPPED"
if [ -n "$FAILED_SEEDS" ]; then
  echo "  Failed:$FAILED_SEEDS"
fi
echo "═══════════════════════════════════════════════════════════"

# Cleanup temp files
rm -rf "$COUNT_DIR"

# Exit 0 even if some seeds failed — we don't want to cancel the whole run.
# The Telegram notification handles alerting on failures.
exit 0
