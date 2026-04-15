import { bus, type Tab } from '../events/bus';
import * as bridge from './webview-bridge';

export const HOMEPAGE_URL = 'asset://localhost/homepage/index.html';

/**
 * Frontend tab manager. Mirrors backend state and broadcasts mutations via the
 * event bus. All persistence lives in Rust; this class is a thin cache.
 */
export class TabManager {
  private _tabs: Tab[] = [];
  private _activeId: string | null = null;

  get tabs(): readonly Tab[] {
    return this._tabs;
  }

  get activeTabId(): string | null {
    return this._activeId;
  }

  get activeTab(): Tab | null {
    if (!this._activeId) return null;
    return this._tabs.find((t) => t.id === this._activeId) ?? null;
  }

  async bootstrap(): Promise<void> {
    this._tabs = await bridge.getTabs();
    this._activeId = await bridge.getActiveTabId();
    if (this._tabs.length === 0) {
      await this.openTab(HOMEPAGE_URL);
    }
  }

  async openTab(url?: string): Promise<Tab> {
    const tab = await bridge.newTab(url);
    this._tabs.push(tab);
    this._activeId = tab.id;
    bus.emit('tab:opened', { tab });
    bus.emit('tab:activated', { id: tab.id });
    return tab;
  }

  async closeTab(id: string): Promise<void> {
    const newActive = await bridge.closeTab(id);
    this._tabs = this._tabs.filter((t) => t.id !== id);
    this._activeId = newActive;
    bus.emit('tab:closed', { id });
    if (newActive) {
      bus.emit('tab:activated', { id: newActive });
    } else if (this._tabs.length === 0) {
      // Always keep at least one tab open.
      await this.openTab(HOMEPAGE_URL);
    }
  }

  async activateTab(id: string): Promise<void> {
    if (this._activeId === id) return;
    await bridge.activateTab(id);
    this._activeId = id;
    bus.emit('tab:activated', { id });
  }

  async navigateActive(url: string): Promise<Tab | null> {
    if (!this._activeId) {
      return this.openTab(url);
    }
    const updated = await bridge.navigate(url);
    this.mergeTab(updated);
    bus.emit('nav:navigate', { url: updated.url });
    return updated;
  }

  async back(): Promise<void> {
    const updated = await bridge.goBack();
    if (updated) this.mergeTab(updated);
    bus.emit('nav:back', {});
  }

  async forward(): Promise<void> {
    const updated = await bridge.goForward();
    if (updated) this.mergeTab(updated);
    bus.emit('nav:forward', {});
  }

  async reload(): Promise<void> {
    const updated = await bridge.reload();
    if (updated) this.mergeTab(updated);
    bus.emit('nav:reload', {});
  }

  private mergeTab(updated: Tab): void {
    const idx = this._tabs.findIndex((t) => t.id === updated.id);
    if (idx >= 0) {
      this._tabs[idx] = updated;
    } else {
      this._tabs.push(updated);
    }
    bus.emit('tab:updated', { tab: updated });
  }
}

export const tabManager = new TabManager();
