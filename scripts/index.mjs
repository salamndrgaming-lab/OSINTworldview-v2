import { chokepointSimulatorSeed } from './chokepointSimulatorSeed.mjs';
import { supplierRiskSeed } from './supplierRiskSeed.mjs';
import { telegramNarrativeSeed } from './telegramNarrativeSeed.mjs';
// ... import all other seeds

/**
 * Master seed registry
 */
export const seeds = [
  chokepointSimulatorSeed,
  supplierRiskSeed,
  telegramNarrativeSeed,
  // ... all other seeds
];

/**
 * Initialize all seeds
 */
export async function initializeSeeds(redis) {
  console.log(`Initializing ${seeds.length} data seeds...`);
  
  for (const seed of seeds) {
    try {
      console.log(`Starting seed: ${seed.name}`);
      
      // Run initial fetch
      const data = await seed.fetch();
      await seed.process(data, redis);
      
      // Set up interval for ongoing updates
      setInterval(async () => {
        try {
          const data = await seed.fetch();
          await seed.process(data, redis);
        } catch (error) {
          console.error(`Error in ${seed.name} interval:`, error);
        }
      }, seed.interval);
      
      console.log(`✓ ${seed.name} initialized`);
    } catch (error) {
      console.error(`Failed to initialize ${seed.name}:`, error);
    }
  }
  
  console.log('✓ All seeds initialized');
}