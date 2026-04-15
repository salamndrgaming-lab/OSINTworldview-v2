/**
 * Thin wrapper around Tauri's `invoke()` bridge.
 *
 * All backend commands are funneled through here so callers stay unaware of
 * Tauri's internals and so failures can be centralized.
 */

import type { Tab } from '../events/bus';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (cachedInvoke) return cachedInvoke;
  try {
    const mod = await import('@tauri-apps/api/core');
    cachedInvoke = mod.invoke as InvokeFn;
    return cachedInvoke;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[webview-bridge] Tauri API unavailable — running in browser-only dev mode.', err);
    cachedInvoke = mockInvoke;
    return cachedInvoke;
  }
}

/**
 * Fallback invoker used when the app runs outside Tauri (e.g. `vite preview`).
 * Returns sensible defaults so the UI still renders.
 */
const mockInvoke: InvokeFn = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  switch (cmd) {
    case 'get_tabs':
      return [] as unknown as T;
    case 'get_active_tab_id':
      return null as unknown as T;
    case 'new_tab': {
      const tab: Tab = {
        id: `mock-${Date.now()}`,
        url: (args?.['url'] as string) ?? 'asset://localhost/homepage/index.html',
        title: 'New Tab',
        favicon: null,
        isLoading: false,
        history: [(args?.['url'] as string) ?? 'asset://localhost/homepage/index.html'],
        forward: [],
      };
      return tab as unknown as T;
    }
    case 'fetch_intel': {
      const url = (args?.['url'] as string) ?? '';
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      return (await res.text()) as unknown as T;
    }
    default:
      return null as unknown as T;
  }
};

export async function invokeBackend<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await getInvoke();
  return invoke<T>(cmd, args);
}

export async function fetchIntel(url: string): Promise<string> {
  return invokeBackend<string>('fetch_intel', { url });
}

export async function fetchIntelJson<T>(url: string): Promise<T> {
  const raw = await fetchIntel(url);
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`fetch_intel returned non-JSON body: ${(err as Error).message}`);
  }
}

export async function navigate(url: string): Promise<Tab> {
  return invokeBackend<Tab>('navigate', { url });
}

export async function newTab(url?: string): Promise<Tab> {
  return invokeBackend<Tab>('new_tab', url ? { url } : {});
}

export async function closeTab(id: string): Promise<string | null> {
  return invokeBackend<string | null>('close_tab', { id });
}

export async function activateTab(id: string): Promise<boolean> {
  return invokeBackend<boolean>('activate_tab', { id });
}

export async function getTabs(): Promise<Tab[]> {
  return invokeBackend<Tab[]>('get_tabs');
}

export async function getActiveTabId(): Promise<string | null> {
  return invokeBackend<string | null>('get_active_tab_id');
}

export async function goBack(): Promise<Tab | null> {
  return invokeBackend<Tab | null>('go_back');
}

export async function goForward(): Promise<Tab | null> {
  return invokeBackend<Tab | null>('go_forward');
}

export async function reload(): Promise<Tab | null> {
  return invokeBackend<Tab | null>('reload');
}

export async function openDevtools(): Promise<void> {
  return invokeBackend<void>('open_devtools');
}

export async function windowMinimize(): Promise<void> {
  return invokeBackend<void>('window_minimize');
}

export async function windowToggleMaximize(): Promise<void> {
  return invokeBackend<void>('window_toggle_maximize');
}

export async function windowClose(): Promise<void> {
  return invokeBackend<void>('window_close');
}
