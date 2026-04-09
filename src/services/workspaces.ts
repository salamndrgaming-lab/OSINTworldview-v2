/**
 * Workspace Tab Service
 * 
 * Workspaces extend the existing panel preset system with persistent state.
 * Each workspace remembers: which preset is active, map position, and custom
 * panel arrangements. The tab bar renders below the header.
 * 
 * Free tier: 4 built-in workspaces (non-deletable)
 * Pro tier: unlimited custom workspaces + sharing (future)
 */

const STORAGE_KEY = 'osintview-workspaces';
const ACTIVE_KEY = 'osintview-active-workspace';
const MAX_FREE_CUSTOM = 2;

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  /** Built-in workspaces can't be deleted or renamed */
  builtIn: boolean;
  /** Which panel preset to apply when switching to this workspace */
  presetId?: string;
  /** Saved map view state (lat, lng, zoom) */
  mapState?: { lat: number; lng: number; zoom: number };
  /** Custom panel enable/disable overrides (layered on top of preset) */
  panelOverrides?: Record<string, boolean>;
  /** Timestamp of last use */
  lastUsed?: number;
}

/** Default built-in workspaces */
const BUILT_IN_WORKSPACES: Workspace[] = [
  { id: 'geopolitical', name: 'Geopolitical', icon: '🛡', builtIn: true, presetId: 'full-osint' },
  { id: 'markets', name: 'Markets', icon: '📈', builtIn: true, presetId: 'markets' },
  { id: 'intel', name: 'Intel', icon: '🔍', builtIn: true, presetId: 'intel' },
  { id: 'custom', name: 'My View', icon: '⚙', builtIn: true, presetId: 'custom' },
];

/** Load workspaces from localStorage (merges built-in + user-created) */
function loadWorkspaces(): Workspace[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const custom: Workspace[] = stored ? JSON.parse(stored) : [];
    // Always include built-ins first, then append user-created
    return [...BUILT_IN_WORKSPACES, ...custom.filter(w => !w.builtIn)];
  } catch {
    return [...BUILT_IN_WORKSPACES];
  }
}

/** Save only user-created workspaces (built-ins don't need storage) */
function saveWorkspaces(workspaces: Workspace[]): void {
  const custom = workspaces.filter(w => !w.builtIn);
  if (custom.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  }
}

/** Get the active workspace ID */
export function getActiveWorkspaceId(): string {
  return localStorage.getItem(ACTIVE_KEY) || 'geopolitical';
}

/** Set the active workspace */
export function setActiveWorkspace(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
  // Update the workspace's lastUsed timestamp
  const workspaces = loadWorkspaces();
  const ws = workspaces.find(w => w.id === id);
  if (ws && !ws.builtIn) {
    ws.lastUsed = Date.now();
    saveWorkspaces(workspaces);
  }
  // Dispatch event so other components can react
  window.dispatchEvent(new CustomEvent('workspace-changed', { detail: { id } }));
}

/** Get all workspaces */
export function getWorkspaces(): Workspace[] {
  return loadWorkspaces();
}

/** Add a new custom workspace */
export function addWorkspace(name: string, icon: string = '📋'): Workspace | null {
  const workspaces = loadWorkspaces();
  const customCount = workspaces.filter(w => !w.builtIn).length;
  if (customCount >= MAX_FREE_CUSTOM) return null; // hit free tier limit

  const id = `ws-${Date.now().toString(36)}`;
  const ws: Workspace = {
    id,
    name,
    icon,
    builtIn: false,
    presetId: 'custom',
    lastUsed: Date.now(),
  };
  workspaces.push(ws);
  saveWorkspaces(workspaces);
  return ws;
}

/** Remove a custom workspace (can't remove built-ins) */
export function removeWorkspace(id: string): boolean {
  const workspaces = loadWorkspaces();
  const ws = workspaces.find(w => w.id === id);
  if (!ws || ws.builtIn) return false;

  const filtered = workspaces.filter(w => w.id !== id);
  saveWorkspaces(filtered);

  // If we removed the active workspace, switch to first built-in
  if (getActiveWorkspaceId() === id) {
    setActiveWorkspace('geopolitical');
  }
  return true;
}

/** Update a workspace's state (map position, panel overrides, etc.) */
export function updateWorkspace(id: string, updates: Partial<Workspace>): void {
  const workspaces = loadWorkspaces();
  const ws = workspaces.find(w => w.id === id);
  if (!ws) return;

  // Only allow renaming/icon changes on custom workspaces
  if (!ws.builtIn) {
    if (updates.name !== undefined) ws.name = updates.name;
    if (updates.icon !== undefined) ws.icon = updates.icon;
  }
  // These can be updated on any workspace
  if (updates.presetId !== undefined) ws.presetId = updates.presetId;
  if (updates.mapState !== undefined) ws.mapState = updates.mapState;
  if (updates.panelOverrides !== undefined) ws.panelOverrides = updates.panelOverrides;

  saveWorkspaces(workspaces);
}

/** Check if user can create more custom workspaces (free tier limit) */
export function canCreateWorkspace(): boolean {
  const workspaces = loadWorkspaces();
  return workspaces.filter(w => !w.builtIn).length < MAX_FREE_CUSTOM;
}

/** Get the count of custom workspaces remaining */
export function remainingWorkspaceSlots(): number {
  const workspaces = loadWorkspaces();
  return MAX_FREE_CUSTOM - workspaces.filter(w => !w.builtIn).length;
}

/**
 * Render the workspace tab bar HTML.
 * Called by panel-layout.ts during renderLayout().
 */
export function renderWorkspaceTabBar(): string {
  const workspaces = loadWorkspaces();
  const activeId = getActiveWorkspaceId();
  const canAdd = canCreateWorkspace();

  const tabs = workspaces.map(ws => {
    const isActive = ws.id === activeId;
    const closeBtn = ws.builtIn
      ? ''
      : `<button class="tab-close" data-ws-close="${ws.id}" title="Close workspace">&times;</button>`;
    return `<button class="workspace-tab${isActive ? ' active' : ''}" data-workspace="${ws.id}" title="${ws.name}">
      <span class="tab-icon">${ws.icon}</span>
      <span class="tab-label">${ws.name}</span>
      ${closeBtn}
    </button>`;
  }).join('');

  const addBtn = canAdd
    ? `<button class="workspace-tab-add" id="workspaceAddBtn" title="New workspace (${remainingWorkspaceSlots()} remaining)">+</button>`
    : `<button class="workspace-tab-add" id="workspaceAddBtn" title="Upgrade to Pro for unlimited workspaces" style="opacity:0.4;cursor:not-allowed" disabled>+</button>`;

  return `<div class="workspace-tab-bar" id="workspaceTabBar">
    ${tabs}
    ${addBtn}
    <div class="workspace-tab-bar-right">
      <span class="workspace-info">${workspaces.length} workspaces</span>
    </div>
  </div>`;
}

/**
 * Initialize workspace tab bar event listeners.
 * Called after renderLayout() injects the HTML.
 */
export function initWorkspaceTabBar(): void {
  const bar = document.getElementById('workspaceTabBar');
  if (!bar) return;

  // Tab click — switch workspace
  bar.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Close button on a tab
    const closeBtn = target.closest('[data-ws-close]') as HTMLElement;
    if (closeBtn) {
      e.stopPropagation();
      const wsId = closeBtn.dataset.wsClose!;
      if (confirm(`Remove workspace?`)) {
        removeWorkspace(wsId);
        refreshTabBar();
      }
      return;
    }

    // Tab itself
    const tab = target.closest('[data-workspace]') as HTMLElement;
    if (tab) {
      const wsId = tab.dataset.workspace!;
      if (wsId === getActiveWorkspaceId()) return;
      setActiveWorkspace(wsId);
      refreshTabBar();
      return;
    }
  });

  // Add workspace button
  const addBtn = document.getElementById('workspaceAddBtn');
  if (addBtn && !addBtn.hasAttribute('disabled')) {
    addBtn.addEventListener('click', () => {
      const name = prompt('Workspace name:');
      if (!name?.trim()) return;
      const ws = addWorkspace(name.trim());
      if (ws) {
        setActiveWorkspace(ws.id);
        refreshTabBar();
      } else {
        alert('Free tier limit reached. Upgrade to Pro for unlimited workspaces.');
      }
    });
  }
}

/** Refresh the tab bar UI without full page re-render */
function refreshTabBar(): void {
  const existing = document.getElementById('workspaceTabBar');
  if (!existing) return;

  const temp = document.createElement('div');
  temp.innerHTML = renderWorkspaceTabBar();
  const newBar = temp.firstElementChild;
  if (newBar) {
    existing.replaceWith(newBar);
    initWorkspaceTabBar();
  }
}
