/**
 * POIMapLayer.ts — POI Location Pins for DeckGL Map & Globe
 * World Monitor OSINT Platform
 *
 * Provides a reusable layer that geocodes POI lastKnownLocation strings
 * and renders pulsing, risk-colored pins on the map.
 *
 * Drop into: src/components/POIMapLayer.ts
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface GeocodedPOI {
  name: string;
  role: string;
  location: string;
  riskLevel: string;
  lat: number;
  lng: number;
  riskColor: [number, number, number, number];
  confidence: number;
  activityScore: number;
}

interface POIPersonMinimal {
  name: string;
  role: string;
  lastKnownLocation: string;
  riskLevel: string;
  locationConfidence: number;
  activityScore: number;
}

// ── Known location coordinates ───────────────────────────────────────────────

const KNOWN_LOCATIONS: Record<string, [number, number]> = {
  'washington': [38.8977, -77.0365],
  'washington d.c.': [38.8977, -77.0365],
  'washington, d.c.': [38.8977, -77.0365],
  'white house': [38.8977, -77.0365],
  'moscow': [55.7558, 37.6173],
  'kremlin': [55.7520, 37.6175],
  'beijing': [39.9042, 116.4074],
  'zhongnanhai': [39.9130, 116.3862],
  'london': [51.5074, -0.1278],
  '10 downing street': [51.5034, -0.1276],
  'paris': [48.8566, 2.3522],
  'berlin': [52.5200, 13.4050],
  'rome': [41.9028, 12.4964],
  'tokyo': [35.6762, 139.6503],
  'new delhi': [28.6139, 77.2090],
  'delhi': [28.6139, 77.2090],
  'brasilia': [-15.7975, -47.8919],
  'ottawa': [45.4215, -75.6972],
  'canberra': [-35.2809, 149.1300],
  'seoul': [37.5665, 126.9780],
  'riyadh': [24.7136, 46.6753],
  'ankara': [39.9334, 32.8597],
  'cairo': [30.0444, 31.2357],
  'pretoria': [-25.7461, 28.1881],
  'kyiv': [50.4501, 30.5234],
  'tehran': [35.6892, 51.3890],
  'islamabad': [33.6844, 73.0479],
  'mexico city': [19.4326, -99.1332],
  'buenos aires': [-34.6037, -58.3816],
  'vatican city': [41.9029, 12.4534],
  'jerusalem': [31.7683, 35.2137],
  'taipei': [25.0330, 121.5654],
  'pyongyang': [39.0392, 125.7625],
  'jakarta': [-6.2088, 106.8456],
  'manila': [14.5995, 120.9842],
  'hanoi': [21.0278, 105.8342],
  'bangkok': [13.7563, 100.5018],
  'abu dhabi': [24.4539, 54.3773],
  'doha': [25.2854, 51.5310],
  'addis ababa': [9.0250, 38.7469],
  'nairobi': [-1.2921, 36.8219],
  'lagos': [6.5244, 3.3792],
  'mar-a-lago': [26.6776, -80.0370],
  'mar a lago': [26.6776, -80.0370],
  'united nations': [40.7489, -73.9680],
  'un headquarters': [40.7489, -73.9680],
  'brussels': [50.8503, 4.3517],
  'geneva': [46.2044, 6.1432],
  'davos': [46.8003, 9.8361],
  'the hague': [52.0705, 4.3007],
};

const RISK_RGBA: Record<string, [number, number, number, number]> = {
  low: [34, 197, 94, 200],
  medium: [234, 179, 8, 200],
  high: [249, 115, 22, 220],
  critical: [239, 68, 68, 240],
};

function geocodeLocal(location: string): [number, number] | null {
  const normalized = location.toLowerCase().trim();
  if (KNOWN_LOCATIONS[normalized]) return KNOWN_LOCATIONS[normalized];
  for (const [key, coords] of Object.entries(KNOWN_LOCATIONS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return coords;
    }
  }
  return null;
}

// ── POI Map Layer Class ──────────────────────────────────────────────────────

export class POIMapLayer {
  private pins: GeocodedPOI[] = [];
  private animationFrame = 0;
  private tooltipEl: HTMLElement | null = null;

  async load(): Promise<void> {
    try {
      const res = await fetch('/api/poi');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const persons: POIPersonMinimal[] = data.persons || [];

      this.pins = [];
      for (const p of persons) {
        const coords = geocodeLocal(p.lastKnownLocation);
        if (!coords) continue;
        this.pins.push({
          name: p.name,
          role: p.role,
          location: p.lastKnownLocation,
          riskLevel: p.riskLevel,
          lat: coords[0],
          lng: coords[1],
          riskColor: RISK_RGBA[p.riskLevel] || RISK_RGBA.medium,
          confidence: p.locationConfidence,
          activityScore: p.activityScore,
        });
      }

      console.log(`[POIMapLayer] Geocoded ${this.pins.length}/${persons.length} persons`);
    } catch (err) {
      console.error('[POIMapLayer] Failed to load POI data:', err);
    }
  }

  getScatterplotConfig(): Record<string, unknown> {
    return {
      id: 'poi-pins',
      data: this.pins,
      getPosition: (d: GeocodedPOI) => [d.lng, d.lat],
      getFillColor: (d: GeocodedPOI) => d.riskColor,
      getLineColor: [255, 255, 255, 120],
      getRadius: (d: GeocodedPOI) => {
        const base = d.riskLevel === 'critical' ? 80000 : d.riskLevel === 'high' ? 60000 : 40000;
        const pulse = 1 + 0.15 * Math.sin(Date.now() / 600 + d.activityScore);
        return base * pulse;
      },
      lineWidthMinPixels: 1,
      stroked: true,
      filled: true,
      radiusMinPixels: 6,
      radiusMaxPixels: 30,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 60],
      updateTriggers: {
        getRadius: [this.animationFrame],
      },
    };
  }

  getGlobePoints(): Array<{ lat: number; lng: number; name: string; role: string; riskLevel: string; color: string; size: number }> {
    return this.pins.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      name: p.name,
      role: p.role,
      riskLevel: p.riskLevel,
      color: `rgba(${p.riskColor.join(',')})`,
      size: p.riskLevel === 'critical' ? 0.8 : p.riskLevel === 'high' ? 0.6 : 0.4,
    }));
  }

  tick(): void {
    this.animationFrame++;
  }

  getPins(): GeocodedPOI[] {
    return this.pins;
  }

  destroy(): void {
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }
}

export default POIMapLayer;
