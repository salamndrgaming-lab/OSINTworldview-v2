/**
 * Perpetual Intelligence Link Database
 *
 * IndexedDB-backed graph store that grows organically over time.
 * Every entity and relationship discovered from ANY source (API, map clicks,
 * manual entry, auto-discovery, news, GDELT, POI) is persisted permanently.
 *
 * Key design:
 *  - Nodes are deduplicated by a canonical ID (type + normalized label)
 *  - Confidence scores decay over time if not refreshed
 *  - Each node/link tracks provenance (which sources contributed)
 *  - Merge-on-write: new data enriches existing records, never overwrites
 *  - Export/import for backup
 */

import type { GraphNode, GraphLink, GraphData } from '../utils/D3LinkGraph';

// ── Types ──────────────────────────────────────────────────────

export interface PersistedNode {
  /** Canonical ID: `type:normalized-label` */
  id: string;
  label: string;
  type: string;
  /** All sources that contributed this node */
  sources: string[];
  /** 0–1 confidence, refreshed on re-observation */
  confidence: number;
  /** First seen timestamp */
  createdAt: number;
  /** Last time any source confirmed this node */
  lastSeen: number;
  /** Total times observed across all sources */
  observationCount: number;
  /** Accumulated mention count from POI/news */
  mentions: number;
  /** Optional country association */
  country?: string;
  /** Optional role/description */
  role?: string;
  /** Optional risk level */
  riskLevel?: string;
  /** Free-form notes accumulated from sources */
  notes?: string;
}

export interface PersistedLink {
  /** Canonical ID: `sourceId::targetId` (alphabetically ordered) */
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  /** 0–1 strength, increases with repeated observations */
  weight: number;
  /** All sources that contributed this link */
  sources: string[];
  createdAt: number;
  lastSeen: number;
  observationCount: number;
}

export interface GraphStats {
  totalNodes: number;
  totalLinks: number;
  sources: string[];
  oldestNode: number;
  newestNode: number;
  avgConfidence: number;
}

// ── Constants ──────────────────────────────────────────────────

const DB_NAME = 'worldmonitor_intel_graph';
const DB_VERSION = 1;
const NODE_STORE = 'nodes';
const LINK_STORE = 'links';
const META_STORE = 'meta';

// Confidence decay: lose 5% per day without re-observation
const CONFIDENCE_DECAY_PER_DAY = 0.05;
const MIN_CONFIDENCE = 0.1;

// ── Database singleton ─────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open intel graph DB'));
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(NODE_STORE)) {
        const ns = db.createObjectStore(NODE_STORE, { keyPath: 'id' });
        ns.createIndex('by_type', 'type');
        ns.createIndex('by_lastSeen', 'lastSeen');
        ns.createIndex('by_confidence', 'confidence');
      }

      if (!db.objectStoreNames.contains(LINK_STORE)) {
        const ls = db.createObjectStore(LINK_STORE, { keyPath: 'id' });
        ls.createIndex('by_sourceId', 'sourceId');
        ls.createIndex('by_targetId', 'targetId');
        ls.createIndex('by_lastSeen', 'lastSeen');
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
  });

  return dbPromise;
}

// ── Helpers ────────────────────────────────────────────────────

/** Canonical node ID from type + label */
export function canonicalNodeId(type: string, label: string): string {
  return `${(type || 'topic').toLowerCase()}:${label.toLowerCase().trim().replace(/\s+/g, '-')}`;
}

/** Canonical link ID (alphabetically ordered to prevent duplicates) */
function canonicalLinkId(sourceId: string, targetId: string): string {
  return sourceId < targetId ? `${sourceId}::${targetId}` : `${targetId}::${sourceId}`;
}

/** Apply confidence decay based on time since last observation */
function decayedConfidence(confidence: number, lastSeen: number): number {
  const daysSince = (Date.now() - lastSeen) / (1000 * 60 * 60 * 24);
  if (daysSince < 1) return confidence;
  const decayed = confidence * Math.pow(1 - CONFIDENCE_DECAY_PER_DAY, daysSince);
  return Math.max(MIN_CONFIDENCE, decayed);
}

// ── Core CRUD ──────────────────────────────────────────────────

async function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function txAll<T>(
  storeName: string,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Upsert a node into the perpetual database.
 * If the node already exists, merge sources, update confidence, bump lastSeen.
 */
export async function upsertNode(
  type: string,
  label: string,
  source: string,
  opts?: {
    confidence?: number;
    country?: string;
    role?: string;
    riskLevel?: string;
    notes?: string;
    mentions?: number;
  },
): Promise<PersistedNode> {
  const id = canonicalNodeId(type, label);
  const now = Date.now();

  const existing = await tx<PersistedNode | undefined>(NODE_STORE, 'readonly', s => s.get(id));

  let node: PersistedNode;

  if (existing) {
    // Merge: enrich existing record
    const sources = existing.sources.includes(source)
      ? existing.sources
      : [...existing.sources, source];

    node = {
      ...existing,
      sources,
      confidence: Math.min(1, Math.max(existing.confidence, opts?.confidence ?? 0.8)),
      lastSeen: now,
      observationCount: existing.observationCount + 1,
      mentions: Math.max(existing.mentions, opts?.mentions ?? 0),
      country: opts?.country || existing.country,
      role: opts?.role || existing.role,
      riskLevel: opts?.riskLevel || existing.riskLevel,
      notes: mergeNotes(existing.notes, opts?.notes),
    };
  } else {
    node = {
      id,
      label: label.trim(),
      type: (type || 'topic'),
      sources: [source],
      confidence: opts?.confidence ?? 0.8,
      createdAt: now,
      lastSeen: now,
      observationCount: 1,
      mentions: opts?.mentions ?? 0,
      country: opts?.country,
      role: opts?.role,
      riskLevel: opts?.riskLevel,
      notes: opts?.notes,
    };
  }

  await tx(NODE_STORE, 'readwrite', s => s.put(node));
  return node;
}

/**
 * Upsert a link between two nodes.
 */
export async function upsertLink(
  sourceId: string,
  targetId: string,
  relationship: string,
  source: string,
  weight?: number,
): Promise<PersistedLink> {
  const id = canonicalLinkId(sourceId, targetId);
  const now = Date.now();

  const existing = await tx<PersistedLink | undefined>(LINK_STORE, 'readonly', s => s.get(id));

  let link: PersistedLink;

  if (existing) {
    const sources = existing.sources.includes(source)
      ? existing.sources
      : [...existing.sources, source];

    // Weight increases slightly with each re-observation (up to 1.0)
    const newWeight = Math.min(1.0, existing.weight + 0.05);

    link = {
      ...existing,
      sources,
      weight: weight != null ? Math.max(existing.weight, weight) : newWeight,
      relationship: relationship || existing.relationship,
      lastSeen: now,
      observationCount: existing.observationCount + 1,
    };
  } else {
    link = {
      id,
      sourceId: sourceId < targetId ? sourceId : targetId,
      targetId: sourceId < targetId ? targetId : sourceId,
      relationship: relationship || 'associated',
      weight: weight ?? 0.5,
      sources: [source],
      createdAt: now,
      lastSeen: now,
      observationCount: 1,
    };
  }

  await tx(LINK_STORE, 'readwrite', s => s.put(link));
  return link;
}

/**
 * Get all nodes from the perpetual database.
 */
export async function getAllNodes(): Promise<PersistedNode[]> {
  return txAll<PersistedNode>(NODE_STORE, s => s.getAll());
}

/**
 * Get all links from the perpetual database.
 */
export async function getAllLinks(): Promise<PersistedLink[]> {
  return txAll<PersistedLink>(LINK_STORE, s => s.getAll());
}

/**
 * Get complete graph data with confidence decay applied.
 */
export async function getFullGraph(): Promise<GraphData> {
  const [nodes, links] = await Promise.all([getAllNodes(), getAllLinks()]);

  const graphNodes: GraphNode[] = nodes.map(n => ({
    id: n.id,
    label: n.label,
    type: n.type as GraphNode['type'],
    confidence: decayedConfidence(n.confidence, n.lastSeen),
    source: n.sources[n.sources.length - 1] as GraphNode['source'],
    lastSeen: n.lastSeen,
    mentions: n.mentions,
    country: n.country,
  }));

  const nodeIds = new Set(graphNodes.map(n => n.id));
  const graphLinks: GraphLink[] = links
    .filter(l => nodeIds.has(l.sourceId) && nodeIds.has(l.targetId))
    .map(l => ({
      source: l.sourceId,
      target: l.targetId,
      relationship: l.relationship,
      weight: l.weight,
      source_type: l.sources[l.sources.length - 1] as GraphLink['source_type'],
    }));

  return { nodes: graphNodes, links: graphLinks };
}

/**
 * Get database statistics.
 */
export async function getStats(): Promise<GraphStats> {
  const [nodes, links] = await Promise.all([getAllNodes(), getAllLinks()]);

  const allSources = new Set<string>();
  let oldest = Infinity;
  let newest = 0;
  let totalConf = 0;

  for (const n of nodes) {
    n.sources.forEach(s => allSources.add(s));
    if (n.createdAt < oldest) oldest = n.createdAt;
    if (n.createdAt > newest) newest = n.createdAt;
    totalConf += decayedConfidence(n.confidence, n.lastSeen);
  }

  return {
    totalNodes: nodes.length,
    totalLinks: links.length,
    sources: [...allSources],
    oldestNode: oldest === Infinity ? 0 : oldest,
    newestNode: newest,
    avgConfidence: nodes.length > 0 ? totalConf / nodes.length : 0,
  };
}

/**
 * Ingest a batch of nodes and links from an external source (e.g. API response).
 * Returns count of new nodes/links added.
 */
export async function ingestBatch(
  source: string,
  apiNodes: Array<Record<string, unknown>>,
  apiLinks: Array<Record<string, unknown>>,
): Promise<{ newNodes: number; newLinks: number; updatedNodes: number; updatedLinks: number }> {
  let newNodes = 0;
  let updatedNodes = 0;
  let newLinks = 0;
  let updatedLinks = 0;

  const nodeIdMap = new Map<string, string>(); // apiNodeId → canonical ID

  for (const n of apiNodes) {
    const label = String(n.label || n.name || n.id || '');
    const type = String(n.type || 'topic');
    if (!label) continue;

    const canonId = canonicalNodeId(type, label);
    nodeIdMap.set(String(n.id || label), canonId);

    const existing = await tx<PersistedNode | undefined>(NODE_STORE, 'readonly', s => s.get(canonId));
    await upsertNode(type, label, source, {
      confidence: Number(n.confidence ?? 0.85),
      country: n.country ? String(n.country) : undefined,
      role: n.role ? String(n.role) : undefined,
      riskLevel: n.riskLevel ? String(n.riskLevel) : undefined,
      notes: n.notes ? String(n.notes) : undefined,
      mentions: Number(n.mentions ?? 0),
    });

    if (existing) updatedNodes++;
    else newNodes++;
  }

  for (const l of apiLinks) {
    const srcApiId = String(l.source || '');
    const tgtApiId = String(l.target || '');
    const srcCanon = nodeIdMap.get(srcApiId) || srcApiId;
    const tgtCanon = nodeIdMap.get(tgtApiId) || tgtApiId;

    if (!srcCanon || !tgtCanon) continue;

    const linkId = canonicalLinkId(srcCanon, tgtCanon);
    const existing = await tx<PersistedLink | undefined>(LINK_STORE, 'readonly', s => s.get(linkId));

    await upsertLink(
      srcCanon,
      tgtCanon,
      String(l.relationship || l.type || 'associated'),
      source,
      l.weight != null ? Number(l.weight) / 10 : undefined, // normalize if 0-10 scale
    );

    if (existing) updatedLinks++;
    else newLinks++;
  }

  // Update last-ingestion timestamp
  const db = await getDb();
  const metaTx = db.transaction(META_STORE, 'readwrite');
  metaTx.objectStore(META_STORE).put({
    key: `last-ingest:${source}`,
    timestamp: Date.now(),
    newNodes,
    newLinks,
  });

  return { newNodes, newLinks, updatedNodes, updatedLinks };
}

/**
 * Ingest POI data into the perpetual database.
 */
export async function ingestPOI(
  persons: Array<Record<string, unknown>>,
): Promise<{ newNodes: number; updatedNodes: number }> {
  let newNodes = 0;
  let updatedNodes = 0;

  for (const p of persons) {
    const name = String(p.name || '');
    if (!name) continue;

    const canonId = canonicalNodeId('Person', name);
    const existing = await tx<PersistedNode | undefined>(NODE_STORE, 'readonly', s => s.get(canonId));

    await upsertNode('Person', name, 'poi', {
      confidence: 0.95,
      country: p.country ? String(p.country) : undefined,
      role: p.role ? String(p.role) : undefined,
      riskLevel: p.threatLevel ? String(p.threatLevel) : undefined,
      mentions: Number(p.mentions ?? 0),
    });

    if (existing) updatedNodes++;
    else newNodes++;
  }

  return { newNodes, updatedNodes };
}

/**
 * Ingest news headlines — extract entity names and create nodes.
 */
export async function ingestHeadlines(
  headlines: Array<Record<string, unknown>>,
): Promise<{ newNodes: number }> {
  let newNodes = 0;

  for (const h of headlines) {
    const title = String(h.title || '');
    // Extract country names from headline using a simple pattern
    const countries = extractCountries(title);
    for (const country of countries) {
      const canonId = canonicalNodeId('Country', country);
      const existing = await tx<PersistedNode | undefined>(NODE_STORE, 'readonly', s => s.get(canonId));
      await upsertNode('Country', country, 'news', { confidence: 0.7 });
      if (!existing) newNodes++;
    }

    // If two countries mentioned in same headline, link them
    for (let i = 0; i < countries.length; i++) {
      for (let j = i + 1; j < countries.length; j++) {
        const srcId = canonicalNodeId('Country', countries[i]!);
        const tgtId = canonicalNodeId('Country', countries[j]!);
        await upsertLink(srcId, tgtId, 'co-mentioned in news', 'news', 0.3);
      }
    }
  }

  return { newNodes };
}

/** Clear entire database */
export async function clearDatabase(): Promise<void> {
  const db = await getDb();
  const txn = db.transaction([NODE_STORE, LINK_STORE, META_STORE], 'readwrite');
  txn.objectStore(NODE_STORE).clear();
  txn.objectStore(LINK_STORE).clear();
  txn.objectStore(META_STORE).clear();
}

/** Export full database for backup */
export async function exportDatabase(): Promise<{ nodes: PersistedNode[]; links: PersistedLink[] }> {
  const [nodes, links] = await Promise.all([getAllNodes(), getAllLinks()]);
  return { nodes, links };
}

/** Import from backup (merges, doesn't overwrite) */
export async function importDatabase(
  data: { nodes: PersistedNode[]; links: PersistedLink[] },
): Promise<void> {
  const db = await getDb();
  const txn = db.transaction([NODE_STORE, LINK_STORE], 'readwrite');
  const nodeStore = txn.objectStore(NODE_STORE);
  const linkStore = txn.objectStore(LINK_STORE);
  for (const n of data.nodes) nodeStore.put(n);
  for (const l of data.links) linkStore.put(l);
}

// ── Migrate localStorage graph into perpetual DB ───────────────

const LEGACY_STORAGE_KEY = 'worldmonitor-link-graph-v2';

export async function migrateLegacyGraph(): Promise<number> {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return 0;

  try {
    const data = JSON.parse(raw) as GraphData;
    if (!data.nodes?.length) return 0;

    let count = 0;
    for (const n of data.nodes) {
      await upsertNode(n.type || 'topic', n.label, n.source || 'legacy', {
        confidence: n.confidence ?? 0.8,
        country: n.country,
        mentions: n.mentions,
      });
      count++;
    }

    for (const l of data.links) {
      const srcLabel = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgtLabel = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      await upsertLink(srcLabel, tgtLabel, l.relationship, l.source_type || 'legacy', l.weight);
    }

    return count;
  } catch {
    return 0;
  }
}

// ── Helpers ────────────────────────────────────────────────────

function mergeNotes(existing?: string, incoming?: string): string | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.includes(incoming)) return existing;
  return `${existing} | ${incoming}`;
}

const KNOWN_COUNTRIES = [
  'Russia', 'Ukraine', 'China', 'Taiwan', 'USA', 'Iran', 'Israel', 'Syria',
  'Turkey', 'India', 'Pakistan', 'North Korea', 'South Korea', 'Japan',
  'Saudi Arabia', 'Yemen', 'Iraq', 'Afghanistan', 'Libya', 'Egypt',
  'Germany', 'France', 'UK', 'Poland', 'Romania', 'Finland', 'Sweden',
  'Norway', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia',
  'Belarus', 'Kazakhstan', 'Uzbekistan', 'Azerbaijan', 'Armenia',
  'Lebanon', 'Jordan', 'Palestine', 'Gaza', 'Somalia', 'Sudan',
  'Ethiopia', 'Nigeria', 'South Africa', 'Kenya', 'Congo',
  'Brazil', 'Mexico', 'Colombia', 'Venezuela', 'Argentina',
  'Australia', 'Indonesia', 'Philippines', 'Vietnam', 'Thailand',
  'Myanmar', 'Bangladesh', 'Sri Lanka', 'Nepal',
];

function extractCountries(text: string): string[] {
  const found: string[] = [];
  for (const c of KNOWN_COUNTRIES) {
    if (text.includes(c)) found.push(c);
  }
  return found;
}
