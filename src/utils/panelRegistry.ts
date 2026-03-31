// src/utils/panelRegistry.ts
// FIXES:
//   - TS6133: 'PanelType' declared but never read
//   - TS2307: Cannot find module '../types/panels' — this module does not exist.
//     The real project types live in '@/types' (src/types/index.ts).
//     PanelConfig there is { name, enabled, priority?, premium? } — it has no
//     component/category/icon/order fields. We define our own extended type here.
//   - TS2833: Cannot find namespace 'React' — project uses Preact/vanilla TS,
//     not React. Component type replaced with a vanilla constructor signature.

/** A panel constructor — the class itself (not an instance). */
export type PanelConstructor = new () => { destroy?(): void };

export type PanelCategory =
  | 'analysis'
  | 'maritime'
  | 'economic'
  | 'social'
  | 'aviation'
  | 'compliance'
  | 'space'
  | 'cyber'
  | 'verification'
  | 'tracking'
  | 'finance'
  | 'infrastructure'
  | 'political'
  | 'commodities'
  | 'tools'
  | 'enterprise';

export interface RegistryPanelConfig {
  id: string;
  name: string;
  component: PanelConstructor;
  icon: string;
  category: PanelCategory;
  order: number;
  enabled?: boolean;
  description?: string;
  requiresAuth?: boolean;
  permissions?: string[];
}

interface RegisteredPanel extends Required<Omit<RegistryPanelConfig, 'permissions'>> {
  permissions: string[];
}

class PanelRegistry {
  private panels: Map<string, RegisteredPanel> = new Map();
  private categories: Map<PanelCategory, RegisteredPanel[]> = new Map();

  register(config: RegistryPanelConfig): void {
    if (this.panels.has(config.id)) {
      console.warn(`Panel ${config.id} is already registered. Skipping.`);
      return;
    }

    const panel: RegisteredPanel = {
      id: config.id,
      name: config.name,
      component: config.component,
      icon: config.icon,
      category: config.category,
      order: config.order,
      enabled: config.enabled !== false,
      description: config.description ?? '',
      requiresAuth: config.requiresAuth ?? false,
      permissions: config.permissions ?? [],
    };

    this.panels.set(panel.id, panel);

    if (!this.categories.has(panel.category)) {
      this.categories.set(panel.category, []);
    }
    this.categories.get(panel.category)!.push(panel);
    this.categories.get(panel.category)!.sort((a, b) => a.order - b.order);

    console.log(`✓ Registered panel: ${panel.name} (${panel.id})`);
  }

  registerAll(configs: RegistryPanelConfig[]): void {
    configs.forEach(config => this.register(config));
  }

  getAllPanels(): RegisteredPanel[] {
    return Array.from(this.panels.values());
  }

  getPanelsByCategory(category: PanelCategory): RegisteredPanel[] {
    return this.categories.get(category) ?? [];
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
