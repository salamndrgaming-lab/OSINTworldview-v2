// This is a placeholder for the very large GlobeMap.ts file.
// The critical change is within the Deck.gl constructor's onClick method.

// ... imports, including the new WorkspaceService ...
import { Deck } from '@deck.gl/core';
import { workspaceService } from '../services/WorkspaceService';

class GlobeMap {
  deck: any;
  // ... existing properties: deck, map, etc. ...

  constructor(/*...args...*/) {
    // ... other constructor logic ...

    this.deck = new Deck({
      // ... other deck props ...
      onClick: (info, _event) => {
        if (info.object) {
          console.log('[GlobeMap] Clicked on layer object:', info.object);
          
          // Heuristic to identify if this is a POI or other addable entity
          // POI objects from the seed have 'name', 'role', etc.
          if (info.object.name && info.object.country) {
            const entity = {
              id: info.object.name.toLowerCase().replace(/\s+/g, '-'), // Create a stable ID
              label: info.object.name,
              type: 'Person' // Assuming POIs are Persons
            };
            workspaceService.addEntity(entity);
          }
          // Can add more else-if blocks for other layer types (e.g., ships, flights)
        }
      },
      // ... rest of deck props ...
    });

    // ... rest of constructor logic ...
  }

  // ... all other methods of GlobeMap.ts ...
}