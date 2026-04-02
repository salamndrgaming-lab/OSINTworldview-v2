#!/usr/bin/env node
/**
 * circuit-breaker.mjs — Per-endpoint circuit breakers for GDELT fetches.
 *
 * ENDPOINTS: artlist | timelinevol | gkg | person
 * Each endpoint has its own independent breaker. GKG failures NEVER trip
 * artlist or person breakers, and vice versa.
 *
 * STATES:
 *   closed    — normal operation
 *   open      — circuit tripped; all requests blocked until reset timeout elapses
 *   half-open — one probe request allowed; success → closed, failure → open again
 *
 * RESET TIMEOUT:
 *   Exponential with base 120s × 1.5^trips, capped at 10 minutes.
 *   Each successive trip increases the cooldown before the next probe.
 *
 * EXPORTS:
 *   getBreaker(name)       → breaker object for an endpoint
 *   breakerSummary()       → concise status string for logging
 *   resetAllBreakers()     → force-close all breakers (used with --force flag)
 *   anyBreakerOpen()       → true if any non-gkg breaker is open/half-open
 */

const FAILURE_THRESHOLD  = 5;      // consecutive failures before tripping
const BASE_RESET_MS      = 120_000; // 120s base reset window
const RESET_MULTIPLIER   = 1.5;    // exponential growth per trip
const MAX_RESET_MS       = 600_000; // 10 minute cap

const ENDPOINTS = ['artlist', 'timelinevol', 'gkg', 'person'];

/** @typedef {'closed'|'open'|'half-open'} BreakerState */

/**
 * @typedef {Object} Breaker
 * @property {string}       name
 * @property {BreakerState} state
 * @property {number}       failures     — consecutive failure count
 * @property {number}       trips        — total times the circuit has opened
 * @property {number|null}  openedAt     — Date.now() when circuit opened
 * @property {number}       resetMs      — current reset timeout (grows per trip)
 */

/** @type {Map<string, Breaker>} */
const breakers = new Map();

function createBreaker(name) {
  return {
    name,
    state:    'closed',
    failures: 0,
    trips:    0,
    openedAt: null,
    resetMs:  BASE_RESET_MS,
  };
}

// Initialise one breaker per endpoint
for (const ep of ENDPOINTS) {
  breakers.set(ep, createBreaker(ep));
}

/**
 * Compute reset timeout for a given trip count.
 * base × multiplier^trips, capped at MAX_RESET_MS.
 * @param {number} trips
 * @returns {number} milliseconds
 */
function computeResetMs(trips) {
  return Math.min(BASE_RESET_MS * Math.pow(RESET_MULTIPLIER, trips), MAX_RESET_MS);
}

/**
 * Retrieve the breaker for a named endpoint.
 * Also transitions open → half-open if the reset window has elapsed.
 * @param {string} name — one of 'artlist' | 'timelinevol' | 'gkg' | 'person'
 * @returns {Breaker}
 */
export function getBreaker(name) {
  if (!breakers.has(name)) {
    console.warn(`[circuit-breaker] Unknown endpoint "${name}" — creating ad-hoc breaker`);
    breakers.set(name, createBreaker(name));
  }

  const b = breakers.get(name);

  // Transition: open → half-open after reset window elapses
  if (b.state === 'open' && b.openedAt !== null) {
    const elapsed = Date.now() - b.openedAt;
    if (elapsed >= b.resetMs) {
      b.state = 'half-open';
      console.log(`[circuit-breaker] ${name}: open → half-open (reset after ${(elapsed / 1000).toFixed(0)}s)`);
    }
  }

  return b;
}

/**
 * Record a successful request for an endpoint.
 * Transitions half-open → closed. Resets failure counter.
 * @param {string} name
 */
export function recordSuccess(name) {
  const b = getBreaker(name);
  if (b.state === 'half-open') {
    console.log(`[circuit-breaker] ${name}: half-open → closed (probe succeeded)`);
  }
  b.state    = 'closed';
  b.failures = 0;
  b.openedAt = null;
  // Keep trips and resetMs — they reset only on explicit resetAllBreakers()
}

/**
 * Record a failed request for an endpoint.
 * Increments failure counter; trips the breaker when threshold is reached.
 * A half-open probe failure also trips the breaker.
 * @param {string} name
 */
export function recordFailure(name) {
  const b = getBreaker(name);

  if (b.state === 'half-open') {
    // Probe failed — trip again with increased reset window
    b.trips++;
    b.resetMs  = computeResetMs(b.trips);
    b.state    = 'open';
    b.openedAt = Date.now();
    console.warn(`[circuit-breaker] ${name}: half-open probe FAILED → open again (trip #${b.trips}, reset in ${(b.resetMs / 1000).toFixed(0)}s)`);
    return;
  }

  b.failures++;

  if (b.failures >= FAILURE_THRESHOLD) {
    b.trips++;
    b.resetMs  = computeResetMs(b.trips);
    b.state    = 'open';
    b.openedAt = Date.now();
    console.warn(`[circuit-breaker] ${name}: TRIPPED after ${b.failures} failures (trip #${b.trips}, reset in ${(b.resetMs / 1000).toFixed(0)}s)`);
  } else {
    console.warn(`[circuit-breaker] ${name}: failure ${b.failures}/${FAILURE_THRESHOLD}`);
  }
}

/**
 * Returns true if the named endpoint's circuit is open or half-open
 * (i.e. requests should be blocked or carefully probed).
 * @param {string} name
 * @returns {boolean}
 */
export function isBreakerOpen(name) {
  const b = getBreaker(name);
  return b.state === 'open';
}

/**
 * Returns true if any non-gkg breaker is open (full circuit trip on main path).
 * Used by seed-gdelt-raw to decide whether to abort the crawl.
 * @returns {boolean}
 */
export function anyBreakerOpen() {
  for (const [name, b] of breakers) {
    if (name === 'gkg') continue;
    // Force state transition check
    getBreaker(name);
    if (b.state === 'open') return true;
  }
  return false;
}

/**
 * Returns true if the endpoint should be allowed to make a request.
 * closed → true, open → false, half-open → true (one probe allowed).
 * @param {string} name
 * @returns {boolean}
 */
export function canRequest(name) {
  const b = getBreaker(name);
  return b.state !== 'open';
}

/**
 * Force-close all breakers and reset failure counts.
 * Called when --force flag is passed to seed-gdelt-raw.
 */
export function resetAllBreakers() {
  for (const [name] of breakers) {
    breakers.set(name, createBreaker(name));
  }
  console.log('[circuit-breaker] All breakers reset (--force)');
}

/**
 * Returns a concise summary string for logging at end of seed run.
 * @returns {string}
 */
export function breakerSummary() {
  const parts = [];
  for (const [name, b] of breakers) {
    // Force state transition so summary reflects current state
    getBreaker(name);
    const icon = b.state === 'closed' ? '✅' : b.state === 'half-open' ? '⚡½' : '⛔';
    const detail = b.state === 'open'
      ? ` (trip #${b.trips}, next probe in ${Math.max(0, (b.resetMs - (Date.now() - (b.openedAt ?? Date.now()))) / 1000).toFixed(0)}s)`
      : b.trips > 0 ? ` (${b.trips} total trips)` : '';
    parts.push(`${icon} ${name}${detail}`);
  }
  return `Circuit breakers: ${parts.join(' | ')}`;
}
