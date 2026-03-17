/**
 * POIMapLayer.ts — POI Location Pins for DeckGL Map & Globe
 * World Monitor OSINT Platform
 *
 * Provides a reusable layer that geocodes POI lastKnownLocation strings
 * and renders pulsing, risk-colored pins on the map.
 *
 * Usage in DeckGLMap.ts or GlobeMap.ts:
 *   import { POIMapLayer } from './POIMapLayer';
 *   const poiLayer = new POIMapLayer();
 *   await poiLayer.load();
 *   // Add poiLayer.getScatterplotLayer() to your deck.gl layers array
 *   // Or use poiLayer.getGlobePoints() for Three.js globe markers
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
  riskColor: [number, number, number, number]; // RGBA 0-255
  confidence: number;
  activityScore: number;
}

interface POIPerson {
  name: string;
  role: string;
  lastKnownLocation: string;
  riskLevel: string;
  locationConfidence: number;
  activityScore: number;
}

// ── Known location coordinates (offline geocoding fallback) ──────────────────

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
  'elysée palace': [48.8706, 2.3167],
  'berlin': [52.5200, 13.4050],
  'rome': [41.9028, 12.4964],
  'tokyo': [35.6762, 139.6503],
  'new delhi': [28.6139, 77.2090],
  'delhi': [28.6139, 77.2090],
  'brasília': [-15.7975, -47.8919],
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

// ── Geocoding ────────────────────────────────────────────────────────────────

function geocodeLocal(location: string): [number, number] | null {
  const normalized = location.toLowerCase().trim();

  // Direct match
  if (KNOWN_LOCATIONS[normalized]) return KNOWN_LOCATIONS[normalized];

  // Partial match: check if any known key is contained in the location string
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

  async load(): Promise<void> {
    try {
      const res = await fetch('/api/poi');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const persons: POIPerson[] = data.persons || [];

      this.pins = persons
        .map((p) => {
          const coords = geocodeLocal(p.lastKnownLocation);
          if (!coords) return null;
          return {
            name: p.name,
            role: p.role,
            location: p.lastKnownLocation,
            riskLevel: p.riskLevel,
            lat: coords[0],
            lng: coords[1],
            riskColor: RISK_RGBA[p.riskLevel] || RISK_RGBA.medium,
            confidence: p.locationConfidence,
            activityScore: p.activityScore,
          };
        })
        .filter(Boolean) as GeocodedPOI[];

      console.log(`[POIMapLayer] Geocoded ${this.pins.length}/${persons.length} persons`);
    } catch (err) {
      console.error('[POIMapLayer] Failed to load POI data:', err);
    }
  }

  /**
   * Returns a deck.gl ScatterplotLayer config object.
   * Import and add to your layers array in DeckGLMap.ts:
   *
   *   import { ScatterplotLayer } from '@deck.gl/layers';
   *   const poiScatter = new ScatterplotLayer(poiMapLayer.getScatterplotConfig());
   */
  getScatterplotConfig(): Record<string, unknown> {
    return {
      id: 'poi-pins',
      data: this.pins,
      getPosition: (d: GeocodedPOI) => [d.lng, d.lat],
      getFillColor: (d: GeocodedPOI) => d.riskColor,
      getLineColor: [255, 255, 255, 120],
      getRadius: (d: GeocodedPOI) => {
        const base = d.riskLevel === 'critical' ? 80000 : d.riskLevel === 'high' ? 60000 : 40000;
        // Pulse effect based on activity score
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
      onHover: (info: { object?: GeocodedPOI; x: number; y: number }) => {
        if (info.object) {
          this.showTooltip(info.object, info.x, info.y);
        } else {
          this.hideTooltip();
        }
      },
      onClick: (info: { object?: GeocodedPOI }) => {
        if (info.object) {
          // Dispatch custom event for panel to catch
          window.dispatchEvent(
            new CustomEvent('poi-pin-click', { detail: info.object })
          );
        }
      },
      updateTriggers: {
        getRadius: [this.animationFrame],
      },
    };
  }

  /**
   * Returns 3D point data for Three.js Globe rendering.
   * Use in GlobeMap.ts to place markers on the sphere.
   */
  getGlobePoints(): Array<{
    lat: number;
    lng: number;
    name: string;
    role: string;
    riskLevel: string;
    color: string;
    size: number;
  }> {
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

  /**
   * Start animation loop for pulsing pins (call in your render loop)
   */
  tick(): void {
    this.animationFrame++;
  }

  getPins(): GeocodedPOI[] {
    return this.pins;
  }

  // ── Tooltip ──────────────────────────────────────────────────────────────

  private tooltipEl: HTMLElement | null = null;

  private showTooltip(poi: GeocodedPOI, x: number, y: number): void {
    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement('div');
      this.tooltipEl.id = 'poi-map-tooltip';
      Object.assign(this.tooltipEl.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '10000',
        background: '#111827',
        border: '1px solid #1e293b',
        borderRadius: '8px',
        padding: '10px 14px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '12px',
        color: '#e2e8f0',
        maxWidth: '260px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        transition: 'opacity 150ms ease',
      });
      document.body.appendChild(this.tooltipEl);
    }

    const riskHex = `rgb(${poi.riskColor.slice(0, 3).join(',')})`;
    this.tooltipEl.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px">${poi.name}</div>
      <div style="color:#94a3b8;font-size:11px;margin-bottom:6px">${poi.role}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
        <span style="color:${riskHex};font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:0.5px">
          ${poi.riskLevel}
        </span>
        <span style="color:#64748b">·</span>
        <span style="color:#94a3b8;font-size:11px">📍 ${poi.location}</span>
      </div>
      <div style="font-size:10px;color:#64748b">
        Confidence: ${Math.round(poi.confidence * 100)}% · Activity: ${poi.activityScore}
      </div>
    `;

    this.tooltipEl.style.opacity = '1';
    this.tooltipEl.style.left = `${x + 12}px`;
    this.tooltipEl.style.top = `${y - 10}px`;
  }

  private hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.style.opacity = '0';
    }
  }

  destroy(): void {
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }
}

export default POIMapLayer;
