// src/components/Sidebar/usePanelRegistration.tsx
// BUG FIX 2: Sidebar auto-registration hook

import { useEffect, useState } from 'react';
import { panelRegistry } from '../../utils/panelRegistry';

export function usePanelRegistration() {
  const [panels, setPanels] = useState(panelRegistry.getEnabledPanels());
  const [categories, setCategories] = useState<Map<string, any[]>>(new Map());

  useEffect(() => {
    const validation = panelRegistry.validate();
    if (!validation.valid) {
      console.error('Panel registration errors:', validation.errors);
    }

    const enabledPanels = panelRegistry.getEnabledPanels();
    setPanels(enabledPanels);

    const categoryMap = new Map<string, any[]>();
    enabledPanels.forEach(panel => {
      if (!categoryMap.has(panel.category)) {
        categoryMap.set(panel.category, []);
      }
      categoryMap.get(panel.category)!.push(panel);
    });

    setCategories(categoryMap);
  }, []);

  return { panels, categories };
}
