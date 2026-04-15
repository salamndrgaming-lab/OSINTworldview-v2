/**
 * Strongly-typed pub/sub event bus.
 *
 * Usage:
 *   import { bus } from './events/bus';
 *   bus.on('tab:opened', ({ tab }) => { ... });
 *   bus.emit('tab:opened', { tab });
 */

export interface Tab {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  isLoading: boolean;
  history: string[];
  forward: string[];
}

export interface BreakingAlert {
  id: string;
  headline: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  source: string;
  timestamp: number;
  url?: string | undefined;
}

export type SidebarMode = 'expanded' | 'collapsed' | 'overlay';

export interface EventMap {
  'tab:opened': { tab: Tab };
  'tab:closed': { id: string };
  'tab:activated': { id: string };
  'tab:updated': { tab: Tab };
  'nav:navigate': { url: string };
  'nav:back': Record<string, never>;
  'nav:forward': Record<string, never>;
  'nav:reload': Record<string, never>;
  'sidebar:toggle': { mode: SidebarMode };
  'intel:breaking': { alert: BreakingAlert };
  'intel:count': { unread: number };
  'webview:loaded': { url: string; title: string };
  'shortcut:intel-overlay': Record<string, never>;
  'shortcut:new-tab': Record<string, never>;
  'shortcut:close-tab': Record<string, never>;
  'shortcut:focus-url': Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class EventBus<M extends Record<string, unknown>> {
  private handlers = new Map<keyof M, Set<Handler<M[keyof M]>>>();

  on<K extends keyof M>(event: K, handler: Handler<M[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<M[keyof M]>);
    return () => this.off(event, handler);
  }

  off<K extends keyof M>(event: K, handler: Handler<M[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as Handler<M[keyof M]>);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        (handler as Handler<M[K]>)(payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[bus] handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus<EventMap>();
