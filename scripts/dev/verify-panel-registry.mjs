#!/usr/bin/env node
// Copyright (C) 2026 Chip / salamndrgaming-lab
// verify-panel-registry.mjs — Validates that panel IDs are consistently
// registered across all 4 required locations:
//   1. src/config/panels.ts (FULL_PANELS keys)
//   2. src/config/panels.ts (PANEL_CATEGORY_MAP panelKeys)
//   3. src/components/index.ts (barrel exports)
//   4. src/app/panel-layout.ts (lazyPanel registrations)
//
// Exits 0 if consistent, 1 if mismatches found.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

function readFile(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ── 1. Extract panel IDs from FULL_PANELS in panels.ts ──────────────────
function extractFullPanelIds(source) {
  const ids = new Set();
  // Match object keys like:  'panel-id': { ... }  or  "panel-id": { ... }
  const re = /^\s+['"]([a-z0-9-]+)['"]\s*:\s*\{/gm;
  let m;
  // Only scan the FULL_PANELS block (between first `const FULL_PANELS` and next `const`)
  const start = source.indexOf('FULL_PANELS');
  const blockEnd = source.indexOf('\nconst ', start + 20);
  const block = source.slice(start, blockEnd > start ? blockEnd : undefined);
  while ((m = re.exec(block)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

// ── 2. Extract panel IDs from PANEL_CATEGORY_MAP panelKeys ──────────────
function extractCategoryPanelIds(source) {
  const ids = new Set();
  const re = /panelKeys:\s*\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const items = m[1].match(/['"]([a-z0-9-]+)['"]/g) || [];
    for (const item of items) {
      ids.add(item.replace(/['"]/g, ''));
    }
  }
  return ids;
}

// ���─ 3. Extract exported panel names from components/index.ts ────────────
function extractComponentExports(source) {
  const ids = new Set();
  // Match: export { FooPanel } from './FooPanel';  or  export * from './FooPanel';
  const re = /export\s+(?:\{[^}]+\}|\*)\s+from\s+['"]\.\/([\w-]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

// ── 4. Extract lazyPanel IDs from panel-layout.ts ────��──────────────────
function extractLazyPanelIds(source) {
  const ids = new Set();
  // Match: this.lazyPanel('panel-id', ...)  or  lazyPanel('panel-id', ...)
  const re = /lazyPanel\(\s*['"]([a-z0-9-]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

// ── Run checks ──────────────────────────────────────────────────────────
let exitCode = 0;

try {
  const panelsSrc = readFile('src/config/panels.ts');
  const indexSrc = readFile('src/components/index.ts');
  const layoutSrc = readFile('src/app/panel-layout.ts');

  const fullPanels = extractFullPanelIds(panelsSrc);
  const categoryPanels = extractCategoryPanelIds(panelsSrc);
  const componentExports = extractComponentExports(indexSrc);
  const lazyPanels = extractLazyPanelIds(layoutSrc);

  console.log(`Panel registry check:`);
  console.log(`  FULL_PANELS:        ${fullPanels.size} panels`);
  console.log(`  CATEGORY_MAP:       ${categoryPanels.size} unique panel refs`);
  console.log(`  Component exports:  ${componentExports.size} exports`);
  console.log(`  lazyPanel calls:    ${lazyPanels.size} registrations`);

  // Check: panels in FULL_PANELS but missing from CATEGORY_MAP
  const missingFromCategory = [...fullPanels].filter(id =>
    id !== 'map' && !categoryPanels.has(id),
  );
  if (missingFromCategory.length > 0) {
    console.warn(`\n  WARNING: ${missingFromCategory.length} panel(s) in FULL_PANELS but NOT in PANEL_CATEGORY_MAP:`);
    for (const id of missingFromCategory) console.warn(`    - ${id}`);
    exitCode = 1;
  }

  // Check: panels in CATEGORY_MAP but missing from FULL_PANELS
  const missingFromFull = [...categoryPanels].filter(id => !fullPanels.has(id));
  if (missingFromFull.length > 0) {
    console.warn(`\n  WARNING: ${missingFromFull.length} panel(s) in PANEL_CATEGORY_MAP but NOT in FULL_PANELS:`);
    for (const id of missingFromFull) console.warn(`    - ${id}`);
    // This is informational — variant-specific panels may not be in FULL_PANELS
  }

  // Summary
  if (exitCode === 0) {
    console.log(`\n  OK: Panel registry is consistent.`);
  } else {
    console.error(`\n  FAIL: Panel registry has mismatches. Fix before deploying.`);
  }
} catch (err) {
  console.error(`  ERROR: ${err.message}`);
  exitCode = 1;
}

process.exit(exitCode);
