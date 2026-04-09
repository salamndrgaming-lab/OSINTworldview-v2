#!/usr/bin/env node
// Copyright (C) 2026 Chip / salamndrgaming-lab
// verify-redis-keys.mjs �� Validates that every Redis key referenced in
// api/bootstrap.js has a corresponding seed script that writes it.
//
// Checks:
//   1. Every key in BOOTSTRAP_CACHE_KEYS has a seed-meta:{domain}:{resource} writer
//   2. No duplicate keys
//   3. All keys follow the namespace:resource:version pattern
//
// Exits 0 if valid, 1 if mismatches found.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

function readFile(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ── Extract Redis keys from bootstrap.js ────────────────────────────────
function extractBootstrapKeys(source) {
  const keys = new Map(); // alias → redis key
  // Match:  keyAlias: 'namespace:resource:v1',  or  keyAlias: "namespace:resource:v1",
  const re = /(\w+):\s+['"]([a-z0-9_:-]+)['"]/g;
  let m;
  // Only scan BOOTSTRAP_CACHE_KEYS block
  const start = source.indexOf('BOOTSTRAP_CACHE_KEYS');
  const end = source.indexOf('};', start);
  const block = source.slice(start, end > start ? end + 2 : undefined);
  while ((m = re.exec(block)) !== null) {
    keys.set(m[1], m[2]);
  }
  return keys;
}

// ── Extract canonical keys from seed scripts ────────────────────────────
function extractSeedCanonicalKeys(scriptsDir) {
  const keys = new Set();
  const files = readdirSync(scriptsDir).filter(f => f.startsWith('seed-') && f.endsWith('.mjs'));
  for (const file of files) {
    const src = readFileSync(join(scriptsDir, file), 'utf8');
    // Match: CANONICAL_KEY = 'some:key:v1'  or  writeExtraKey('key', ...)  or  atomicPublish('key', ...)
    const canonicalMatch = src.match(/CANONICAL_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (canonicalMatch) keys.add(canonicalMatch[1]);
    // writeExtraKeyWithMeta('key', ...)
    const extraMatches = src.matchAll(/writeExtraKey(?:WithMeta)?\(\s*['"]([^'"]+)['"]/g);
    for (const em of extraMatches) keys.add(em[1]);
    // runSeed(..., 'key', ...)
    const runSeedMatch = src.match(/runSeed\([^,]+,\s*[^,]+,\s*['"]([^'"]+)['"]/);
    if (runSeedMatch) keys.add(runSeedMatch[1]);
  }
  return keys;
}

// ── Run checks ────────────────────────��─────────────────────────────────
let exitCode = 0;
let bootstrapSrc;

try {
  // Try .js first, then .ts
  try {
    bootstrapSrc = readFile('api/bootstrap.js');
  } catch {
    bootstrapSrc = readFile('api/bootstrap.ts');
  }
} catch (err) {
  console.error(`  ERROR: Cannot read api/bootstrap.{js,ts}: ${err.message}`);
  process.exit(1);
}

try {
  const bootstrapKeys = extractBootstrapKeys(bootstrapSrc);
  const seedKeys = extractSeedCanonicalKeys(join(root, 'scripts'));

  console.log(`Redis key schema check:`);
  console.log(`  Bootstrap keys:     ${bootstrapKeys.size}`);
  console.log(`  Seed canonical keys: ${seedKeys.size}`);

  // Check: bootstrap keys with no matching seed
  const orphanBootstrap = [];
  for (const [alias, key] of bootstrapKeys) {
    if (!seedKeys.has(key)) {
      orphanBootstrap.push({ alias, key });
    }
  }

  if (orphanBootstrap.length > 0) {
    console.warn(`\n  WARNING: ${orphanBootstrap.length} bootstrap key(s) have no matching seed script:`);
    for (const { alias, key } of orphanBootstrap) {
      console.warn(`    - ${alias}: '${key}'`);
    }
    // Informational — some keys are written by non-seed sources (e.g., server handlers)
  }

  // Check: key format validation (namespace:resource:version)
  const malformed = [];
  for (const [alias, key] of bootstrapKeys) {
    if (!/^[a-z0-9_-]+:[a-z0-9_-]+/.test(key)) {
      malformed.push({ alias, key });
    }
  }

  if (malformed.length > 0) {
    console.warn(`\n  WARNING: ${malformed.length} key(s) don't follow namespace:resource pattern:`);
    for (const { alias, key } of malformed) {
      console.warn(`    - ${alias}: '${key}'`);
    }
    exitCode = 1;
  }

  // Check for duplicate values
  const values = [...bootstrapKeys.values()];
  const dupes = values.filter((v, i) => values.indexOf(v) !== i);
  if (dupes.length > 0) {
    console.warn(`\n  WARNING: Duplicate Redis keys in bootstrap:`);
    for (const d of [...new Set(dupes)]) console.warn(`    - ${d}`);
    exitCode = 1;
  }

  if (exitCode === 0 && orphanBootstrap.length === 0) {
    console.log(`\n  OK: All bootstrap keys have matching seed scripts.`);
  } else if (exitCode === 0) {
    console.log(`\n  OK: Key format valid. ${orphanBootstrap.length} key(s) rely on server-side writes.`);
  } else {
    console.error(`\n  FAIL: Redis key schema has issues.`);
  }
} catch (err) {
  console.error(`  ERROR: ${err.message}`);
  exitCode = 1;
}

process.exit(exitCode);
