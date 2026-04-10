import { getRpcBaseUrl } from '@/services/rpc-client';
import {
  MaritimeServiceClient,
  type AisDensityZone as ProtoDensityZone,
  type AisDisruption as ProtoDisruption,
  type GetVesselSnapshotResponse,
} from '@/generated/client/osintview/maritime/v1/service_client';
import { createCircuitBreaker } from '@/utils';
import type { AisDisruptionEvent, AisDensityZone, AisDisruptionType } from '@/types';
import { dataFreshness } from '../data-freshness';
import { isFeatureAvailable } from '../runtime-config';
import { startSmartPollLoop, toApiUrl, type SmartPollLoopHandle } from '../runtime';

// ---- Proto fallback (desktop safety when relay URL is unavailable) ----

const client = new MaritimeServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) });
const snapshotBreaker = createCircuitBreaker<GetVesselSnapshotResponse>({ name: 'Maritime Snapshot', cacheTtlMs: 10 * 60 * 1000, persistCache: true });
const emptySnapshotFallback: GetVesselSnapshotResponse = { snapshot: undefined };

const DISRUPTION_TYPE_REVERSE: Record<string, AisDisruptionType> = {
  AIS_DISRUPTION_TYPE_GAP_SPIKE: 'gap_spike',
  AIS_DISRUPTION_TYPE_CHOKEPOINT_CONGESTION: 'chokepoint_congestion',
};

const SEVERITY_REVERSE: Record<string, 'low' | 'elevated' | 'high'> = {
  AIS_DISRUPTION_SEVERITY_LOW: 'low',
  AIS_DISRUPTION_SEVERITY_ELEVATED: 'elevated',
  AIS_DISRUPTION_SEVERITY_HIGH: 'high',
};

function toDisruptionEvent(proto: ProtoDisruption): AisDisruptionEvent {
  return {
    id: proto.id,
    name: proto.name,
    type: DISRUPTION_TYPE_REVERSE[proto.type] || 'gap_spike',
    lat: proto.location?.latitude ?? 0,
    lon: proto.location?.longitude ?? 0,
    severity: SEVERITY_REVERSE[proto.severity] || 'low',
    changePct: proto.changePct,
    windowHours: proto.windowHours,
    darkShips: proto.darkShips,
    vesselCount: proto.vesselCount,
    region: proto.region,
    description: proto.description,
  };
}

function toDensityZone(proto: ProtoDensityZone): AisDensityZone {
  return {
    id: proto.id,
    name: proto.name,
    lat: proto.location?.latitude ?? 0,
    lon: proto.location?.longitude ?? 0,
    intensity: proto.intensity,
    deltaPct: proto.deltaPct,
    shipsPerDay: proto.shipsPerDay,
    note: proto.note,
  };
}

// ---- Feature Gating ----

const isClientRuntime = typeof window !== 'undefined';
const aisConfigured = isClientRuntime && import.meta.env.VITE_ENABLE_AIS !== 'false';

export function isAisConfigured(): boolean {
  return aisConfigured && isFeatureAvailable('aisRelay');
}

// ---- AisPositionData (exported for military-vessels.ts) ----

export interface AisPositionData {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  shipType?: number;
  heading?: number;
  speed?: number;
  course?: number;
}

// ---- Internal Interfaces ----

interface SnapshotStatus {
  connected: boolean;
  vessels: number;
  messages: number;
}

interface SnapshotCandidateReport extends AisPositionData {
  timestamp: number;
}

interface AisSnapshotResponse {
  sequence?: number;
  timestamp?: string;
  status?: {
    connected?: boolean;
    vessels?: number;
    messages?: number;
  };
  disruptions?: AisDisruptionEvent[];
  density?: AisDensityZone[];
  candidateReports?: SnapshotCandidateReport[];
  // Seed-populated format (seed-ais-vessels.mjs writes vessel positions directly)
  vessels?: Array<{
    mmsi: string;
    name?: string;
    lat: number;
    lon: number;
    shipType?: number;
    heading?: number;
    speed?: number;
    course?: number;
  }>;
  configured?: boolean;
  source?: string;
  note?: string;
}

// ---- Callback System ----

type AisCallback = (data: AisPositionData) => void;
const positionCallbacks = new Set<AisCallback>();
const lastCallbackTimestampByMmsi = new Map<string, number>();

// ---- Polling State ----

let pollLoop: SmartPollLoopHandle | null = null;
let inFlight = false;
let isPolling = false;
let lastPollAt = 0;
let lastSequence = 0;

let latestDisruptions: AisDisruptionEvent[] = [];
let latestDensity: AisDensityZone[] = [];
let latestVessels: AisPositionData[] = [];
let latestStatus: SnapshotStatus = {
  connected: false,
  vessels: 0,
  messages: 0,
};

// ---- Constants ----

const SNAPSHOT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const SNAPSHOT_STALE_MS = 6 * 60 * 1000;
const CALLBACK_RETENTION_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_CALLBACK_TRACKED_VESSELS = 20000;

// ---- Raw Relay URL (for candidate reports path) ----

const SNAPSHOT_PROXY_URL = toApiUrl('/api/ais-snapshot');
const wsRelayUrl = import.meta.env.VITE_WS_RELAY_URL || '';
const DIRECT_RAILWAY_SNAPSHOT_URL = wsRelayUrl
  ? wsRelayUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace(/\/$/, '') + '/ais/snapshot'
  : '';
const LOCAL_SNAPSHOT_FALLBACK = 'http://localhost:3004/ais/snapshot';
const isLocalhost = isClientRuntime && window.location.hostname === 'localhost';

// ---- Internal Helpers ----

function shouldIncludeCandidates(): boolean {
  return positionCallbacks.size > 0;
}

function parseSnapshot(data: unknown): {
  sequence: number;
  status: SnapshotStatus;
  disruptions: AisDisruptionEvent[];
  density: AisDensityZone[];
  vessels: AisPositionData[];
  candidateReports: SnapshotCandidateReport[];
} | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as AisSnapshotResponse;

  // Relay format: has disruptions + density arrays
  if (Array.isArray(raw.disruptions) && Array.isArray(raw.density)) {
    const status = raw.status || {};
    const candidates: SnapshotCandidateReport[] = Array.isArray(raw.candidateReports) ? raw.candidateReports : [];

    // Extract vessel positions from candidateReports for map display.
    // The relay sends individual vessel positions as candidates; we
    // promote them to the vessels array so DeckGL renders ship markers.
    const vessels: AisPositionData[] = candidates
      .filter(c => c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.mmsi)
      .map(c => ({
        mmsi: String(c.mmsi),
        name: c.name || '',
        lat: c.lat,
        lon: c.lon,
        shipType: c.shipType,
        heading: c.heading,
        speed: c.speed,
        course: c.course,
      }));

    return {
      sequence: Number.isFinite(raw.sequence as number) ? Number(raw.sequence) : 0,
      status: {
        connected: Boolean(status.connected),
        vessels: Number.isFinite(status.vessels as number) ? Number(status.vessels) : vessels.length,
        messages: Number.isFinite(status.messages as number) ? Number(status.messages) : 0,
      },
      disruptions: raw.disruptions,
      density: raw.density,
      vessels,
      candidateReports: candidates,
    };
  }

  // Seed format: has vessels array (from seed-ais-vessels.mjs via Redis)
  if (Array.isArray(raw.vessels)) {
    const vessels: AisPositionData[] = raw.vessels
      .filter(v => v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && v.mmsi)
      .map(v => ({
        mmsi: String(v.mmsi),
        name: v.name || '',
        lat: v.lat,
        lon: v.lon,
        shipType: v.shipType,
        heading: v.heading,
        speed: v.speed,
        course: v.course,
      }));

    // Compute density zones by clustering vessels into grid cells
    const density = computeDensityFromVessels(vessels);

    return {
      sequence: 0,
      status: { connected: vessels.length > 0, vessels: vessels.length, messages: 0 },
      disruptions: [],
      density,
      vessels,
      candidateReports: [],
    };
  }

  // Recognized response structure but no usable data — return empty rather than null
  // to avoid throwing and allow graceful fallback
  if (raw.configured !== undefined || raw.timestamp || raw.note) {
    return {
      sequence: 0,
      status: { connected: false, vessels: 0, messages: 0 },
      disruptions: [],
      density: [],
      vessels: [],
      candidateReports: [],
    };
  }

  return null;
}

/** Cluster vessel positions into density zones using a grid. */
function computeDensityFromVessels(vessels: AisPositionData[]): AisDensityZone[] {
  const GRID_SIZE = 2; // degrees
  const cells = new Map<string, { lats: number[]; lons: number[]; count: number }>();

  for (const v of vessels) {
    const gx = Math.floor(v.lon / GRID_SIZE);
    const gy = Math.floor(v.lat / GRID_SIZE);
    const key = gx + ',' + gy;
    const cell = cells.get(key);
    if (cell) {
      cell.lats.push(v.lat);
      cell.lons.push(v.lon);
      cell.count++;
    } else {
      cells.set(key, { lats: [v.lat], lons: [v.lon], count: 1 });
    }
  }

  const zones: AisDensityZone[] = [];
  let idx = 0;
  for (const [key, cell] of cells) {
    if (cell.count < 3) continue; // skip sparse cells
    const avgLat = cell.lats.reduce((a, b) => a + b, 0) / cell.count;
    const avgLon = cell.lons.reduce((a, b) => a + b, 0) / cell.count;
    const intensity = Math.min(cell.count / 20, 1);
    zones.push({
      id: 'density-' + key + '-' + idx++,
      name: 'Vessel cluster (' + cell.count + ' ships)',
      lat: avgLat,
      lon: avgLon,
      intensity,
      deltaPct: 0,
      shipsPerDay: cell.count,
    });
  }
  return zones;
}

// ---- Hybrid Fetch Strategy ----

async function fetchRawRelaySnapshot(includeCandidates: boolean, signal?: AbortSignal): Promise<unknown> {
  const query = `?candidates=${includeCandidates ? 'true' : 'false'}`;

  try {
    const proxied = await fetch(`${SNAPSHOT_PROXY_URL}${query}`, { headers: { Accept: 'application/json' }, signal });
    if (proxied.ok) return proxied.json();
  } catch { /* Proxy unavailable -- fall through */ }

  // Local development fallback only.
  if (isLocalhost && DIRECT_RAILWAY_SNAPSHOT_URL) {
    try {
      const railway = await fetch(`${DIRECT_RAILWAY_SNAPSHOT_URL}${query}`, { headers: { Accept: 'application/json' }, signal });
      if (railway.ok) return railway.json();
    } catch { /* Railway unavailable -- fall through */ }
  }

  if (isLocalhost) {
    const local = await fetch(`${LOCAL_SNAPSHOT_FALLBACK}${query}`, { headers: { Accept: 'application/json' }, signal });
    if (local.ok) return local.json();
  }

  throw new Error('AIS raw relay snapshot unavailable');
}

async function fetchSnapshotPayload(includeCandidates: boolean, signal?: AbortSignal): Promise<unknown> {
  if (includeCandidates) {
    // Candidate reports are only available on the raw relay endpoint.
    return fetchRawRelaySnapshot(true, signal);
  }

  try {
    // Prefer direct relay path to avoid normal web traffic double-hop via Vercel.
    return await fetchRawRelaySnapshot(false, signal);
  } catch (rawError) {
    // Desktop fallback: use proto route when relay URL/local relay is unavailable.
    const response = await snapshotBreaker.execute(async () => {
      return client.getVesselSnapshot({ neLat: 0, neLon: 0, swLat: 0, swLon: 0 });
    }, emptySnapshotFallback);

    if (response.snapshot) {
      return {
        sequence: 0, // Proto payload does not include relay sequence.
        status: { connected: true, vessels: 0, messages: 0 },
        disruptions: response.snapshot.disruptions.map(toDisruptionEvent),
        density: response.snapshot.densityZones.map(toDensityZone),
        candidateReports: [],
      };
    }

    throw rawError;
  }
}

// ---- Callback Emission ----

function pruneCallbackTimestampIndex(now: number): void {
  if (lastCallbackTimestampByMmsi.size <= MAX_CALLBACK_TRACKED_VESSELS) {
    return;
  }

  const threshold = now - CALLBACK_RETENTION_MS;
  for (const [mmsi, ts] of lastCallbackTimestampByMmsi) {
    if (ts < threshold) {
      lastCallbackTimestampByMmsi.delete(mmsi);
    }
  }

  if (lastCallbackTimestampByMmsi.size <= MAX_CALLBACK_TRACKED_VESSELS) {
    return;
  }

  const oldest = Array.from(lastCallbackTimestampByMmsi.entries())
    .sort((a, b) => a[1] - b[1]);
  const toDelete = lastCallbackTimestampByMmsi.size - MAX_CALLBACK_TRACKED_VESSELS;
  for (let i = 0; i < toDelete; i++) {
    const entry = oldest[i];
    if (!entry) break;
    lastCallbackTimestampByMmsi.delete(entry[0]);
  }
}

function emitCandidateReports(reports: SnapshotCandidateReport[]): void {
  if (positionCallbacks.size === 0 || reports.length === 0) return;
  const now = Date.now();

  for (const report of reports) {
    if (!report?.mmsi || !Number.isFinite(report.lat) || !Number.isFinite(report.lon)) continue;

    const reportTs = Number.isFinite(report.timestamp) ? Number(report.timestamp) : now;
    const lastTs = lastCallbackTimestampByMmsi.get(report.mmsi) || 0;
    if (reportTs <= lastTs) continue;

    lastCallbackTimestampByMmsi.set(report.mmsi, reportTs);
    const callbackData: AisPositionData = {
      mmsi: report.mmsi,
      name: report.name || '',
      lat: report.lat,
      lon: report.lon,
      shipType: report.shipType,
      heading: report.heading,
      speed: report.speed,
      course: report.course,
    };

    for (const callback of positionCallbacks) {
      try {
        callback(callbackData);
      } catch {
        // Ignore callback errors
      }
    }
  }

  pruneCallbackTimestampIndex(now);
}

// ---- Polling ----

async function pollSnapshot(force = false, signal?: AbortSignal): Promise<void> {
  if (!isAisConfigured()) return;
  if (inFlight && !force) return;
  if (signal?.aborted) return;

  inFlight = true;
  try {
    const includeCandidates = shouldIncludeCandidates();
    const payload = await fetchSnapshotPayload(includeCandidates, signal);
    const snapshot = parseSnapshot(payload);
    if (!snapshot) throw new Error('Invalid snapshot payload');

    latestDisruptions = snapshot.disruptions;
    latestDensity = snapshot.density;
    latestVessels = snapshot.vessels;
    latestStatus = snapshot.status;
    lastPollAt = Date.now();

    if (includeCandidates) {
      if (snapshot.sequence > lastSequence) {
        emitCandidateReports(snapshot.candidateReports);
        lastSequence = snapshot.sequence;
      } else if (lastSequence === 0) {
        emitCandidateReports(snapshot.candidateReports);
        lastSequence = snapshot.sequence;
      }
    } else {
      lastSequence = snapshot.sequence;
    }

    const itemCount = latestDisruptions.length + latestDensity.length;
    if (itemCount > 0 || latestStatus.vessels > 0) {
      dataFreshness.recordUpdate('ais', itemCount > 0 ? itemCount : latestStatus.vessels);
    }
  } catch {
    latestStatus.connected = false;
  } finally {
    inFlight = false;
  }
}

function startPolling(): void {
  if (isPolling || !isAisConfigured()) return;
  isPolling = true;
  void pollSnapshot(true);
  pollLoop?.stop();
  pollLoop = startSmartPollLoop(({ signal }) => pollSnapshot(false, signal), {
    intervalMs: SNAPSHOT_POLL_INTERVAL_MS,
    // AIS relay traffic is high-cost; pause entirely in hidden tabs.
    pauseWhenHidden: true,
    refreshOnVisible: true,
    runImmediately: false,
  });
}

// ---- Exported Functions ----

export function registerAisCallback(callback: AisCallback): void {
  positionCallbacks.add(callback);
  startPolling();
}

export function unregisterAisCallback(callback: AisCallback): void {
  positionCallbacks.delete(callback);
  if (positionCallbacks.size === 0) {
    lastCallbackTimestampByMmsi.clear();
  }
}

export function initAisStream(): void {
  startPolling();
}

export function disconnectAisStream(): void {
  pollLoop?.stop();
  pollLoop = null;
  isPolling = false;
  inFlight = false;
  latestStatus.connected = false;
}

export function getAisStatus(): { connected: boolean; vessels: number; messages: number } {
  const isFresh = Date.now() - lastPollAt <= SNAPSHOT_STALE_MS;
  return {
    connected: latestStatus.connected && isFresh,
    vessels: latestStatus.vessels,
    messages: latestStatus.messages,
  };
}

export async function fetchAisSignals(): Promise<{ disruptions: AisDisruptionEvent[]; density: AisDensityZone[]; vessels: AisPositionData[] }> {
  if (!aisConfigured) {
    return { disruptions: [], density: [], vessels: [] };
  }

  startPolling();
  const shouldRefresh = Date.now() - lastPollAt > SNAPSHOT_STALE_MS;
  if (shouldRefresh) {
    await pollSnapshot(true);
  }

  return {
    disruptions: latestDisruptions,
    density: latestDensity,
    vessels: latestVessels,
  };
}
