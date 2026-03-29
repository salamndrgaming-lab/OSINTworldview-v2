/**
 * Saved Map Views Service
 *
 * Lets users bookmark specific map positions (lat/lng/zoom) and
 * jump back to them with one click from a dropdown in the map header.
 *
 * Includes built-in quick-views for common intelligence regions
 * (e.g., Taiwan Strait, Black Sea, Korean DMZ) plus user-created bookmarks.
 *
 * All custom views are persisted in localStorage.
 */

const STORAGE_KEY = 'worldmonitor-saved-views';

export interface SavedMapView {
  /** Unique ID (timestamp-based for user views, string for built-ins) */
  id: string;
  /** Display name */
  name: string;
  /** Center latitude */
  lat: number;
  /** Center longitude */
  lng: number;
  /** Zoom level */
  zoom: number;
  /** Whether this is a built-in view (cannot be deleted) */
  builtin?: boolean;
}

/**
 * Built-in quick-views for common intelligence hotspots.
 * These always appear at the top of the dropdown and cannot be deleted.
 */
export const BUILTIN_VIEWS: SavedMapView[] = [
  { id: 'bi-taiwan', name: 'Taiwan Strait', lat: 24.5, lng: 119.5, zoom: 6, builtin: true },
  { id: 'bi-ukraine', name: 'Ukraine Front', lat: 48.5, lng: 36.0, zoom: 6, builtin: true },
  { id: 'bi-korea', name: 'Korean DMZ', lat: 37.95, lng: 126.95, zoom: 7, builtin: true },
  { id: 'bi-hormuz', name: 'Strait of Hormuz', lat: 26.5, lng: 56.3, zoom: 7, builtin: true },
  { id: 'bi-black-sea', name: 'Black Sea', lat: 43.5, lng: 34.0, zoom: 5.5, builtin: true },
  { id: 'bi-south-china', name: 'South China Sea', lat: 14.0, lng: 114.0, zoom: 5, builtin: true },
  { id: 'bi-suez', name: 'Suez Canal / Red Sea', lat: 22.0, lng: 38.0, zoom: 5, builtin: true },
  { id: 'bi-baltics', name: 'Baltic Sea / NATO Flank', lat: 57.5, lng: 20.0, zoom: 5, builtin: true },
  { id: 'bi-gaza', name: 'Gaza / Israel', lat: 31.4, lng: 34.4, zoom: 9, builtin: true },
  { id: 'bi-sahel', name: 'Sahel Region', lat: 15.0, lng: 2.0, zoom: 5, builtin: true },
];

// ────────────────────────────────────────────────────────────
// CRUD operations
// ────────────────────────────────────────────────────────────

/** Load user-saved views from localStorage */
export function loadSavedViews(): SavedMapView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as SavedMapView[];
    }
  } catch { /* noop */ }
  return [];
}

/** Get all views: built-in first, then user-saved */
export function getAllViews(): SavedMapView[] {
  return [...BUILTIN_VIEWS, ...loadSavedViews()];
}

/** Save a new custom map view */
export function saveView(name: string, lat: number, lng: number, zoom: number): SavedMapView {
  const views = loadSavedViews();
  const view: SavedMapView = {
    id: 'sv-' + Date.now(),
    name,
    lat,
    lng,
    zoom: Math.round(zoom * 100) / 100,
  };
  views.push(view);
  persistViews(views);
  return view;
}

/** Delete a user-saved view by ID. Built-in views cannot be deleted. */
export function deleteView(id: string): void {
  const views = loadSavedViews().filter(v => v.id !== id);
  persistViews(views);
}

/** Rename a user-saved view */
export function renameView(id: string, newName: string): void {
  const views = loadSavedViews();
  const view = views.find(v => v.id === id);
  if (view) {
    view.name = newName;
    persistViews(views);
  }
}

function persistViews(views: SavedMapView[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch { /* noop */ }
}
