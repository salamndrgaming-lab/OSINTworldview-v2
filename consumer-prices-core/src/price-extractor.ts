// consumer-prices-core/src/price-extractor.ts
// Standalone consumer price snapshot using only public FRED + retail indices

export async function getConsumerSnapshot() {
  const responses = await Promise.all([
    fetch('https://api.stlouisfed.org/fred/series/observations?series_id=DCOILWTICO&api_key=demo&limit=1').then(r => r.json()),
    fetch('https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=demo&limit=1').then(r => r.json()),
    fetch('https://public.retailindex.org/electronics/latest').then(r => r.json())
  ]);

  return {
    basketIndex: (responses[0].value + responses[1].value + responses[2].value) / 3,
    spikes: responses.filter(r => r.change > 5),
    timestamp: Date.now()
  };
}