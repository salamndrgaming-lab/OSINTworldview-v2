// src/components/Sidebar/usePanelRegistration.ts
//
// *** RENAME: delete usePanelRegistration.tsx → .ts ***
//
// FIXES:
//   - TS7016: @types/react not installed
//   - TS6142: resolved as .tsx but --jsx not set
//
// React hooks don't exist in this project. Replaced with a plain utility
// that returns panel data from the registry synchronously.

import { panelRegistry, type PanelCategory } from '../../utils/panelRegistry';

export interface PanelRegistrationResult {
  panels: ReturnType<typeof panelRegistry.getEnabledPanels>;
  categories: Map<PanelCategory, ReturnType<typeof panelRegistry.getEnabledPanels>>;
}

export function getPanelRegistration(): PanelRegistrationResult {
  const validation = panelRegistry.validate();
  if (!validation.valid) {
    console.error('Panel registration errors:', validation.errors);
  }

  const panels = panelRegistry.getEnabledPanels();

  const categories = new Map<PanelCategory, typeof panels>();
  panels.forEach(panel => {
    const cat = panel.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(panel);
  });

  return { panels, categories };
}
