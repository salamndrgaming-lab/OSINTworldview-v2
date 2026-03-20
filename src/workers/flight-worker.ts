// src/workers/flight-worker.ts
self.onmessage = async () => {
  try {
    const res = await fetch('https://api.adsb.one/v2/all');
    const data = await res.json();
    
    const processed = data.ac.map((ac: any) => {
      const operator = ac.ownOp || ac.r || "Private/Unknown";
      const callsign = (ac.flight || '').trim();
      
      // Classification Logic
      let category = 'Commercial';
      let color = [0, 150, 255]; // Blue

      if (ac.mil === 1 || /AFB|NAVY|ARMY|MARINES|POLICE|BORD/i.test(operator)) {
        category = 'Military/Gov';
        color = [255, 50, 50]; // Red
      } else if (/FEDEX|UPS|DHL|AMZ/i.test(operator) || /FDX|UPS/i.test(callsign)) {
        category = 'Cargo';
        color = [150, 100, 255]; // Purple
      } else if (!ac.flight && ac.alt_baro < 15000) {
        category = 'General Aviation';
        color = [200, 200, 200]; // Grey
      }

      return {
        id: ac.hex,
        coords: [ac.lon, ac.lat, (ac.alt_baro || 0) * 0.3048],
        heading: ac.track || 0,
        label: callsign || ac.r || '---',
        desc: `${operator} (${ac.t || 'UNK'})`,
        color,
        category
      };
    });

    self.postMessage(processed);
  } catch (e) {
    console.error("Worker fetch failed", e);
  }
};
