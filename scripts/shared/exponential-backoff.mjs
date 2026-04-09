#!/usr/bin/env node
/**
 * exponential-backoff.mjs — Backoff and pacing utilities for GDELT seed scripts.
 *
 * EXPORTS:
 *   exponentialDelay(attempt, opts)         → ms to wait before attempt N
 *   cooldownDelay(consecutiveSuccesses, opts) → inter-request pacing ms (decays on success)
 *   retryWithBackoff(fn, opts)              → wrapper that retries fn with backoff
 *   sleep(ms, label)                        → promisified setTimeout with optional log
 */

/**
 * Compute wait time for attempt N using decorrelated jitter.
 *
 * Decorrelated jitter (Polled et al.) avoids thundering-herd when multiple
 * workers retry simultaneously. Formula: min(cap, random(base, prevSleep × 3)).
 *
 * @param {number} attempt — 0-indexed attempt number (0 = first retry)
 * @param {object} opts
 * @param {number} [opts.baseMs=2000]      — minimum sleep
 * @param {number} [opts.capMs=90000]      — maximum sleep
 * @param {number} [opts.jitterRatio=0.3]  — fraction of computed delay to randomise
 * @returns {number} milliseconds to sleep
 */
export function exponentialDelay(attempt, { baseMs = 2_000, capMs = 90_000, jitterRatio = 0.3 } = {}) {
  // Exponential base: base × 2^attempt
  const expMs = baseMs * Math.pow(2, attempt);
  const capped = Math.min(capMs, expMs);

  // Add decorrelated jitter: ± jitterRatio of the capped value
  const jitter = capped * jitterRatio * (Math.random() * 2 - 1);
  const result = Math.max(baseMs, capped + jitter);

  return Math.round(result);
}

/**
 * Compute inter-request cooldown that shrinks as consecutive successes accumulate.
 * Starts at initialMs, decreases by decayPerSuccess each success, floors at floorMs.
 *
 * This matches the "upstream" pattern of 20s base cooldown that adapts
 * downward when GDELT is responding quickly.
 *
 * @param {number} consecutiveSuccesses — how many requests in a row have succeeded
 * @param {object} opts
 * @param {number} [opts.initialMs=20000]       — starting cooldown
 * @param {number} [opts.floorMs=5000]          — minimum cooldown
 * @param {number} [opts.decayPerSuccess=2000]  — reduction per success
 * @returns {number} milliseconds to wait before next request
 */
export function cooldownDelay(consecutiveSuccesses, { initialMs = 20_000, floorMs = 5_000, decayPerSuccess = 2_000 } = {}) {
  const reduced = initialMs - (consecutiveSuccesses * decayPerSuccess);
  return Math.max(floorMs, reduced);
}

/**
 * Retry a function with exponential backoff.
 *
 * @param {() => Promise<any>} fn — async function to retry
 * @param {object} opts
 * @param {number}   [opts.maxRetries=3]     — max number of retry attempts (not counting first try)
 * @param {number}   [opts.baseMs=2000]
 * @param {number}   [opts.capMs=90000]
 * @param {number}   [opts.jitterRatio=0.3]
 * @param {(err: Error, attempt: number) => boolean} [opts.shouldRetry] — return false to abort
 * @param {(err: Error, attempt: number, delayMs: number) => void} [opts.onRetry] — called before each retry
 * @returns {Promise<any>} resolves with fn's result or rejects after all retries exhausted
 */
export async function retryWithBackoff(fn, {
  maxRetries    = 3,
  baseMs        = 2_000,
  capMs         = 90_000,
  jitterRatio   = 0.3,
  shouldRetry   = () => true,
  onRetry       = () => {},
} = {}) {
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) break;

      if (!shouldRetry(err, attempt)) {
        break;
      }

      const delayMs = exponentialDelay(attempt, { baseMs, capMs, jitterRatio });
      onRetry(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

/**
 * Sleep for ms milliseconds, with optional console log.
 * @param {number} ms
 * @param {string} [label] — if provided, logs "  ⏳ Waiting Xs [label]"
 * @returns {Promise<void>}
 */
export async function sleep(ms, label) {
  if (label) {
    process.stdout.write(`  ⏳ Waiting ${(ms / 1000).toFixed(1)}s${label ? ` [${label}]` : ''}…`);
  }
  await new Promise(resolve => setTimeout(resolve, ms));
  if (label) {
    process.stdout.write(' done\n');
  }
}
