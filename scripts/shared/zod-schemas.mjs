#!/usr/bin/env node
/**
 * zod-schemas.mjs — Dependency-free runtime validation for GDELT API responses.
 *
 * No external libraries. Manual checks that mirror what Zod would produce.
 *
 * EXPORTS:
 *   validateArtlistResponse(raw)   → {valid, data, rejected, warning}
 *   validateTimelineResponse(raw)  → {valid, data, warning}
 *   validateGkgResponse(raw)       → {valid, data, warning}
 *   validateErrorEntry(entry)      → sanitised telemetry error entry
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function isNonEmptyString(v, minLen = 1) {
  return typeof v === 'string' && v.trim().length >= minLen;
}

function isValidUrl(str) {
  if (!isNonEmptyString(str, 10)) return false;
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function coerceString(v, maxLen = 500, fallback = '') {
  if (typeof v === 'string') return v.slice(0, maxLen);
  if (v == null) return fallback;
  return String(v).slice(0, maxLen);
}

function coerceNumber(v, fallback = 0) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

// ── Article validation ────────────────────────────────────────────────────────

/**
 * Validate and coerce a single GDELT artlist article.
 * Required: url (string >= 10 chars, valid URL), title (string >= 3 chars),
 *           seendate (string).
 * Optional coerced: tone, domain, language, socialimage.
 *
 * @param {unknown} raw
 * @returns {{ article: object|null, reason: string|null }}
 */
function validateArticle(raw) {
  if (!raw || typeof raw !== 'object') {
    return { article: null, reason: 'not an object' };
  }

  const url = raw.url || '';
  if (!isValidUrl(url)) {
    return { article: null, reason: `invalid url: "${String(url).slice(0, 80)}"` };
  }

  const title = raw.title || '';
  if (!isNonEmptyString(title, 3)) {
    return { article: null, reason: 'title too short' };
  }

  const seendate = raw.seendate || '';
  if (!isNonEmptyString(seendate)) {
    return { article: null, reason: 'missing seendate' };
  }

  // Coerce optional fields
  const domain    = coerceString(raw.domain    || raw.source?.domain || '', 200);
  const language  = coerceString(raw.language  || '', 10);
  const tone      = coerceNumber(raw.tone, 0);
  const socialimage = isValidUrl(raw.socialimage || '') ? raw.socialimage : '';

  return {
    article: {
      title:    coerceString(title, 500),
      url,
      domain,
      source:   domain,
      date:     coerceString(seendate, 30),
      seendate: coerceString(seendate, 30),
      image:    socialimage,
      language,
      tone,
    },
    reason: null,
  };
}

/**
 * Validate a full GDELT artlist API response.
 * @param {unknown} raw — raw JSON from GDELT
 * @returns {{ valid: boolean, data: object[]|null, rejected: number, warning: string|null }}
 */
export function validateArtlistResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, data: null, rejected: 0, warning: 'response is not an object' };
  }

  const articles = raw.articles;
  if (!Array.isArray(articles)) {
    return { valid: false, data: null, rejected: 0, warning: 'articles field is missing or not an array' };
  }

  const valid_articles = [];
  let rejected = 0;

  for (const item of articles) {
    const { article, reason } = validateArticle(item);
    if (article) {
      valid_articles.push(article);
    } else {
      rejected++;
    }
  }

  const rejectionRate = articles.length > 0 ? rejected / articles.length : 0;
  let warning = null;
  if (rejectionRate > 0.3) {
    warning = `High rejection rate: ${rejected}/${articles.length} articles rejected (${(rejectionRate * 100).toFixed(0)}%)`;
  }

  return {
    valid: true,
    data:  valid_articles,
    rejected,
    warning,
  };
}

// ── Timeline validation ───────────────────────────────────────────────────────

/**
 * Validate a single timeline series point.
 * @param {unknown} raw
 * @returns {boolean}
 */
function isValidTimelinePoint(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (!isNonEmptyString(raw.date)) return false;
  if (typeof raw.value !== 'number' || !isFinite(raw.value)) return false;
  return true;
}

/**
 * Validate a GDELT timelinevol API response.
 * @param {unknown} raw
 * @returns {{ valid: boolean, data: object[]|null, warning: string|null }}
 */
export function validateTimelineResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, data: null, warning: 'response is not an object' };
  }

  // GDELT returns either raw.timeline or raw.timelines (array of series)
  let series = raw.timeline ?? raw.timelines ?? null;

  if (!Array.isArray(series)) {
    return { valid: false, data: null, warning: 'timeline/timelines field missing or not array' };
  }

  // Filter to populated series with valid points
  const validSeries = [];
  for (const s of series) {
    if (!s || typeof s !== 'object') continue;
    const points = Array.isArray(s.data) ? s.data.filter(isValidTimelinePoint) : [];
    if (points.length > 0) {
      validSeries.push({ ...s, data: points });
    }
  }

  return {
    valid: true,
    data:  validSeries,
    warning: validSeries.length === 0 ? 'no valid timeline series found' : null,
  };
}

// ── GKG validation ────────────────────────────────────────────────────────────

/**
 * Basic validation for a GDELT GKG GeoJSON response.
 * We just confirm it's a GeoJSON FeatureCollection with a features array.
 * @param {unknown} raw
 * @returns {{ valid: boolean, data: object|null, warning: string|null }}
 */
export function validateGkgResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, data: null, warning: 'GKG response is not an object' };
  }

  if (raw.type !== 'FeatureCollection') {
    return { valid: false, data: null, warning: `GKG response type is "${raw.type}", expected FeatureCollection` };
  }

  if (!Array.isArray(raw.features)) {
    return { valid: false, data: null, warning: 'GKG features field is missing or not array' };
  }

  return {
    valid:   true,
    data:    raw,
    warning: raw.features.length === 0 ? 'GKG returned 0 features' : null,
  };
}

// ── Error telemetry validation ────────────────────────────────────────────────

const VALID_LEVELS = new Set(['error', 'warn', 'info']);

/**
 * Sanitise an error telemetry entry before storing in Redis.
 * Coerces all fields to safe types and bounded lengths.
 * @param {unknown} entry
 * @returns {object} sanitised entry
 */
export function validateErrorEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return {
      level:    'error',
      endpoint: 'unknown',
      message:  String(entry ?? '').slice(0, 300),
      at:       new Date().toISOString(),
    };
  }

  return {
    level:    VALID_LEVELS.has(entry.level) ? entry.level : 'error',
    endpoint: coerceString(entry.endpoint, 50, 'unknown'),
    message:  coerceString(entry.message,  300, 'no message'),
    label:    entry.label  ? coerceString(entry.label,  100) : undefined,
    status:   entry.status ? coerceNumber(entry.status, 0)   : undefined,
    attempt:  entry.attempt != null ? coerceNumber(entry.attempt, 0) : undefined,
    at:       isNonEmptyString(entry.at) ? entry.at.slice(0, 30) : new Date().toISOString(),
  };
}
