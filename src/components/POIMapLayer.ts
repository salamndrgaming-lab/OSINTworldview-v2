/**
 * POIMapLayer.ts — POI Location Pins for DeckGL Map & Globe
 * Drop into: src/components/POIMapLayer.ts
 */

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
  'élysée': [48.8704, 2.3167],
  'elysee': [48.8704, 2.3167],
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
  'kiev': [50.4501, 30.5234],
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
  // Expanded locations for better POI coverage
  'singapore': [1.3521, 103.8198],
  'kuala lumpur': [3.1390, 101.6869],
  'mumbai': [19.0760, 72.8777],
  'shanghai': [31.2304, 121.4737],
  'hong kong': [22.3193, 114.1694],
  'dubai': [25.2048, 55.2708],
  'tel aviv': [32.0853, 34.7818],
  'beirut': [33.8938, 35.5018],
  'damascus': [33.5138, 36.2765],
  'baghdad': [33.3152, 44.3661],
  'kabul': [34.5553, 69.2075],
  'minsk': [53.9045, 27.5615],
  'tbilisi': [41.7151, 44.8271],
  'baku': [40.4093, 49.8671],
  'yerevan': [40.1792, 44.4991],
  'algiers': [36.7538, 3.0588],
  'tunis': [36.8065, 10.1815],
  'tripoli': [32.8872, 13.1913],
  'khartoum': [15.5007, 32.5599],
  'sanaa': [15.3694, 44.1910],
  'muscat': [23.5880, 58.3829],
  'amman': [31.9454, 35.9284],
  'warsaw': [52.2297, 21.0122],
  'bucharest': [44.4268, 26.1025],
  'budapest': [47.4979, 19.0402],
  'vienna': [48.2082, 16.3738],
  'prague': [50.0755, 14.4378],
  'madrid': [40.4168, -3.7038],
  'lisbon': [38.7223, -9.1393],
  'athens': [37.9838, 23.7275],
  'stockholm': [59.3293, 18.0686],
  'oslo': [59.9139, 10.7522],
  'helsinki': [60.1699, 24.9384],
  'copenhagen': [55.6761, 12.5683],
  'amsterdam': [52.3676, 4.9041],
  'zurich': [47.3769, 8.5417],
  'lima': [-12.0464, -77.0428],
  'bogota': [4.7110, -74.0721],
  'santiago': [-33.4489, -70.6693],
  'havana': [23.1136, -82.3666],
  'caracas': [10.4806, -66.9036],
  'accra': [5.6037, -0.1870],
  'dakar': [14.7167, -17.4677],
  'kampala': [0.3476, 32.5825],
  'dhaka': [23.8103, 90.4125],
  'colombo': [6.9271, 79.8612],
  'phnom penh': [11.5564, 104.9282],
  'vientiane': [17.9757, 102.6331],
  'yangon': [16.8661, 96.1951],
  'ulaanbaatar': [47.8864, 106.9057],
  'astana': [51.1694, 71.4491],
  'tashkent': [41.2995, 69.2401],
};

/** Country/region name → capital fallback for POIs with unrecognized locations */
const COUNTRY_FALLBACKS: Record<string, [number, number]> = {
  'united states': [38.8977, -77.0365],
  'usa': [38.8977, -77.0365],
  'russia': [55.7558, 37.6173],
  'china': [39.9042, 116.4074],
  'united kingdom': [51.5074, -0.1278],
  'uk': [51.5074, -0.1278],
  'france': [48.8566, 2.3522],
  'germany': [52.5200, 13.4050],
  'italy': [41.9028, 12.4964],
  'japan': [35.6762, 139.6503],
  'india': [28.6139, 77.2090],
  'brazil': [-15.7975, -47.8919],
  'canada': [45.4215, -75.6972],
  'australia': [-35.2809, 149.1300],
  'south korea': [37.5665, 126.9780],
  'north korea': [39.0392, 125.7625],
  'saudi arabia': [24.7136, 46.6753],
  'turkey': [39.9334, 32.8597],
  'egypt': [30.0444, 31.2357],
  'south africa': [-25.7461, 28.1881],
  'ukraine': [50.4501, 30.5234],
  'iran': [35.6892, 51.3890],
  'pakistan': [33.6844, 73.0479],
  'mexico': [19.4326, -99.1332],
  'argentina': [-34.6037, -58.3816],
  'israel': [31.7683, 35.2137],
  'taiwan': [25.0330, 121.5654],
  'indonesia': [-6.2088, 106.8456],
  'philippines': [14.5995, 120.9842],
  'vietnam': [21.0278, 105.8342],
  'thailand': [13.7563, 100.5018],
  'uae': [24.4539, 54.3773],
  'qatar': [25.2854, 51.5310],
  'ethiopia': [9.0250, 38.7469],
  'kenya': [-1.2921, 36.8219],
  'nigeria': [6.5244, 3.3792],
  'poland': [52.2297, 21.0122],
  'syria': [33.5138, 36.2765],
  'iraq': [33.3152, 44.3661],
  'lebanon': [33.8938, 35.5018],
  'afghanistan': [34.5553, 69.2075],
  'belarus': [53.9045, 27.5615],
  'yemen': [15.3694, 44.1910],
  'sudan': [15.5007, 32.5599],
  'libya': [32.8872, 13.1913],
  'venezuela': [10.4806, -66.9036],
  'cuba': [23.1136, -82.3666],
  'colombia': [4.7110, -74.0721],
  'peru': [-12.0464, -77.0428],
  'chile': [-33.4489, -70.6693],
};

const DEFAULT_RISK_COLOR: [number, number, number, number] = [234, 179, 8, 200];

const RISK_RGBA: Record<string, [number, number, number, number]> = {
  low: [34, 197, 94, 200],
  medium: [234, 179, 8, 200],
  high: [249, 115, 22, 220],
  critical: [239, 68, 68, 240],
};

function geocodeLocal(location: string): { coords: [number, number]; predicted: boolean } | null {
  const normalized = location.toLowerCase().trim();

  // Direct match in known locations
  const direct = KNOWN_LOCATIONS[normalized];
  if (direct) return { coords: direct, predicted: false };

  // Partial match — location contains or is contained by a known key
  for (const [key, coords] of Object.entries(KNOWN_LOCATIONS)) {
    if (normalized.includes(key) || key.includes(normalized)) return { coords, predicted: false };
  }

  // Country/region fallback — predict based on country name in the location string
  for (const [country, coords] of Object.entries(COUNTRY_FALLBACKS)) {
    if (normalized.includes(country) || country.includes(normalized)) return { coords, predicted: true };
  }

  return null;
}

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
      let predicted = 0;
      for (const p of persons) {
        const result = geocodeLocal(p.lastKnownLocation);
        if (!result) continue;
        if (result.predicted) predicted++;
        this.pins.push({
          name: p.name,
          role: p.role,
          location: p.lastKnownLocation,
          riskLevel: p.riskLevel,
          lat: result.coords[0],
          lng: result.coords[1],
          riskColor: RISK_RGBA[p.riskLevel] || DEFAULT_RISK_COLOR,
          confidence: result.predicted ? Math.min(p.locationConfidence, 0.3) : p.locationConfidence,
          activityScore: p.activityScore,
        });
      }
      console.log(`[POIMapLayer] Geocoded ${this.pins.length}/${persons.length} persons (${predicted} predicted from country)`);
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
        const confidenceScale = d.confidence < 0.4 ? 0.7 : 1;
        const pulse = 1 + 0.15 * Math.sin(Date.now() / 600 + d.activityScore);
        return base * pulse * confidenceScale;
      },
      lineWidthMinPixels: 1,
      stroked: true,
      filled: true,
      radiusMinPixels: 6,
      radiusMaxPixels: 30,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 60],
      updateTriggers: { getRadius: [this.animationFrame] },
    };
  }

  getGlobePoints(): Array<{ lat: number; lng: number; name: string; role: string; riskLevel: string; color: string; size: number }> {
    return this.pins.map((p) => ({
      lat: p.lat, lng: p.lng, name: p.name, role: p.role, riskLevel: p.riskLevel,
      color: `rgba(${p.riskColor.join(',')})`,
      size: p.riskLevel === 'critical' ? 0.8 : p.riskLevel === 'high' ? 0.6 : 0.4,
    }));
  }

  tick(): void { this.animationFrame++; }
  getPins(): GeocodedPOI[] { return this.pins; }
  destroy(): void { this.tooltipEl?.remove(); this.tooltipEl = null; }
}

export default POIMapLayer;
