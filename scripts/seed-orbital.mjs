// scripts/seed-orbital.mjs
import { fetchWithRetry } from './shared/_seed-utils.mjs';

async function seedOrbital() {
  const tles = await fetchWithRetry('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json');
  const redis = /* your Redis */;
  await redis.set('orbital:tle', JSON.stringify(tles), { EX: 7200 });
  console.log('✅ Orbital seeded');
}

seedOrbital().catch(console.error);