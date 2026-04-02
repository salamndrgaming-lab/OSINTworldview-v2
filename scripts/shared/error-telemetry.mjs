#!/usr/bin/env node
/**
 * error-telemetry.mjs — In-memory telemetry accumulator for GDELT seed runs.
 *
 * Errors and metrics accumulate in memory during a seed run. Call
 * flushTelemetry(redis) at the end to persist to Redis.
 *
 * Redis layout:
 *   errors:seed       LIST — last 200 error entries (LPUSH + LTRIM), 7-day TTL
 *   metrics:seed      STRING (JSON) — aggregate counters merged on each flush
 *
 * EXPORTS:
 *   recordError(entry)
 *   recordSuccess()
 *   recordCacheHit()
 *   recordCacheMiss()
 *   recordValidationReject()
 *   recordCircuitTrip()
 *   flushTelemetry(redis)   — redis: { url, token }
 */

import { validateErrorEntry } from './zod-schemas.mjs';

const ERRORS_KEY      = 'errors:seed';
const METRICS_KEY     = 'metrics:seed';
const ERRORS_MAX      = 200;
const ERRORS_TTL      = 7 * 24 * 3600; // 7 days
const METRICS_TTL     = 30 * 24 * 3600; // 30 days

// ── In-memory state ───────────────────────────────────────────────────────────

/** @type {object[]} */
const pendingErrors = [];

const sessionMetrics = {
  gdelt_calls:         0,
  successes:           0,
  failures:            0,
  cache_hits:          0,
  cache_misses:        0,
  validation_rejects:  0,
  circuit_trips:       0,
};

let runStarted = false;

// ── Accumulators ──────────────────────────────────────────────────────────────

/**
 * Record an error event.
 * @param {{ level?: string, endpoint?: string, message: string, label?: string, status?: number, attempt?: number }} entry
 */
export function recordError(entry) {
  const sanitised = validateErrorEntry({ ...entry, at: new Date().toISOString() });
  pendingErrors.push(sanitised);
  sessionMetrics.failures++;
}

/** Record a successful GDELT fetch. */
export function recordSuccess() {
  sessionMetrics.gdelt_calls++;
  sessionMetrics.successes++;
  runStarted = true;
}

/** Record a cache hit (key existed in Redis, no GDELT call needed). */
export function recordCacheHit() {
  sessionMetrics.cache_hits++;
}

/** Record a cache miss (key absent or expired, GDELT call required). */
export function recordCacheMiss() {
  sessionMetrics.cache_misses++;
  sessionMetrics.gdelt_calls++;
  runStarted = true;
}

/** Record a validation rejection (response parsed but failed schema check). */
export function recordValidationReject() {
  sessionMetrics.validation_rejects++;
}

/** Record a circuit breaker trip event. */
export function recordCircuitTrip() {
  sessionMetrics.circuit_trips++;
}

// ── Flush ─────────────────────────────────────────────────────────────────────

/**
 * Flush accumulated errors and metrics to Redis.
 * Errors are prepended to the errors:seed list (newest first, capped at 200).
 * Metrics are merged into the existing metrics:seed key.
 *
 * @param {{ url: string, token: string }} redis
 */
export async function flushTelemetry({ url, token }) {
  if (!url || !token) {
    console.warn('[telemetry] Redis credentials missing — skipping flush');
    return;
  }

  const commands = [];

  // ── Errors: LPUSH each entry, then LTRIM + EXPIRE ──────────────────────────
  if (pendingErrors.length > 0) {
    for (const err of pendingErrors) {
      commands.push(['LPUSH', ERRORS_KEY, JSON.stringify(err)]);
    }
    commands.push(['LTRIM', ERRORS_KEY, 0, ERRORS_MAX - 1]);
    commands.push(['EXPIRE', ERRORS_KEY, ERRORS_TTL]);
  }

  // ── Metrics: GET existing, merge, SET back ─────────────────────────────────
  let existingMetrics = {};
  try {
    const getResp = await fetch(`${url}/get/${encodeURIComponent(METRICS_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(5_000),
    });
    if (getResp.ok) {
      const body = await getResp.json();
      if (body.result) {
        existingMetrics = typeof body.result === 'string'
          ? JSON.parse(body.result)
          : body.result;
      }
    }
  } catch {
    // Non-fatal — start fresh if read fails
    existingMetrics = {};
  }

  const mergedMetrics = {
    gdelt_calls:        (existingMetrics.gdelt_calls        ?? 0) + sessionMetrics.gdelt_calls,
    successes:          (existingMetrics.successes           ?? 0) + sessionMetrics.successes,
    failures:           (existingMetrics.failures            ?? 0) + sessionMetrics.failures,
    cache_hits:         (existingMetrics.cache_hits          ?? 0) + sessionMetrics.cache_hits,
    cache_misses:       (existingMetrics.cache_misses        ?? 0) + sessionMetrics.cache_misses,
    validation_rejects: (existingMetrics.validation_rejects  ?? 0) + sessionMetrics.validation_rejects,
    circuit_trips:      (existingMetrics.circuit_trips       ?? 0) + sessionMetrics.circuit_trips,
    runs:               (existingMetrics.runs                ?? 0) + (runStarted ? 1 : 0),
    last_run:           new Date().toISOString(),
  };

  commands.push(['SET', METRICS_KEY, JSON.stringify(mergedMetrics), 'EX', METRICS_TTL]);

  // ── Pipeline flush ─────────────────────────────────────────────────────────
  if (commands.length === 0) {
    console.log('[telemetry] Nothing to flush');
    return;
  }

  try {
    const pipeResp = await fetch(`${url}/pipeline`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(commands),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!pipeResp.ok) {
      console.warn(`[telemetry] Flush pipeline failed: HTTP ${pipeResp.status}`);
      return;
    }
    console.log(
      `[telemetry] Flushed — ${pendingErrors.length} errors, ` +
      `gdelt_calls=${mergedMetrics.gdelt_calls} successes=${mergedMetrics.successes} ` +
      `failures=${mergedMetrics.failures} cache_hits=${mergedMetrics.cache_hits} ` +
      `circuit_trips=${mergedMetrics.circuit_trips}`
    );
  } catch (err) {
    console.warn(`[telemetry] Flush exception: ${err.message}`);
  }

  // Reset pending errors (metrics accumulate across the process lifetime)
  pendingErrors.length = 0;
}

/** Return a snapshot of session metrics (for logging). */
export function sessionMetricsSummary() {
  return { ...sessionMetrics };
}
