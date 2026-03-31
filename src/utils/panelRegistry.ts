// src/utils/panelRegistry.ts
// BUG FIX 1: Central panel registration system to ensure all panels appear in the sidebar.

import { PanelType, PanelConfig, PanelCategory } from '../types/panels';

interface RegisteredPanel {
  id: string;
  name: string;
  component: React.ComponentType<any>;
  icon: string;
  category: PanelCategory;
  order: number;
  enabled: boolean;
  description?: string;
  requiresAuth?: boolean;
  permissions?: string[];
}

class PanelRegistry {
  private panels: Map<string, RegisteredPanel> = new Map();
  private categories: Map<PanelCategory, RegisteredPanel[]> = new Map();

  register(config: PanelConfig): void {
    if (this.panels.has(config.id)) {
      console.warn(`Panel ${config.id} is already registered. Skipping.`);
      return;
    }

    const panel: RegisteredPanel = {
      id: config.id,
      name: config.name,
      component: config.component,
      icon: config.icon || 'default-icon',
      category: config.category || 'analysis',
      order: config.order || 999,
      enabled: config.enabled !== false,
      description: config.description,
      requiresAuth: config.requiresAuth || false,
      permissions: config.permissions || [],
    };

    this.panels.set(panel.id, panel);

    if (!this.categories.has(panel.category)) {
      this.categories.set(panel.category, []);
    }
    this.categories.get(panel.category)!.push(panel);
    this.categories.get(panel.category)!.sort((a, b) => a.order - b.order);

    console.log(`✓ Registered panel: ${panel.name} (${panel.id})`);
  }

  registerAll(configs: PanelConfig[]): void {
    configs.forEach(config => this.register(config));
  }

  getAllPanels(): RegisteredPanel[] {
    return Array.from(this.panels.values());
  }

  getPanelsByCategory(category: PanelCategory): RegisteredPanel[] {
    return this.categories.get(category) || [];
  }

  getEnabledPanels(): RegisteredPanel[] {
    return this.getAllPanels().filter(panel => panel.enabled);
  }

  getPanel(id: string): RegisteredPanel | undefined {
    return this.panels.get(id);
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    this.panels.forEach((panel, id) => {
      if (!panel.name) errors.push(`Panel ${id} is missing a name`);
      if (!panel.component) errors.push(`Panel ${id} is missing a component`);
      if (!panel.category) errors.push(`Panel ${id} is missing a category`);
    });

    return { valid: errors.length === 0, errors };
  }
}

export const panelRegistry = new PanelRegistry();
