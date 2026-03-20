/**
 * DeckGLMap - WebGL-accelerated map visualization for desktop
 * Uses deck.gl for high-performance rendering of large datasets
 * Mobile devices gracefully degrade to the D3/SVG-based Map component
 */
import { MapboxOverlay } from '@deck.gl/mapbox';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScenegraphLayer } from '@deck.gl/mesh-layers';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import { GeoJsonLayer, ScatterplotLayer, PathLayer, IconLayer, TextLayer, PolygonLayer } from '@deck.gl/layers';
import maplibregl from 'maplibre-gl';
import { registerPMTilesProtocol, FALLBACK_DARK_STYLE, FALLBACK_LIGHT_STYLE, getMapProvider, getMapTheme, getStyleForProvider, isLightMapTheme } from '@/config/basemap';
import Supercluster from 'supercluster';
import type {
  MapLayers,
  Hotspot,
  NewsItem,
  InternetOutage,
  RelatedAsset,
  AssetType,
  AisDisruptionEvent,
  AisDensityZone,
  CableAdvisory,
  RepairShip,
  SocialUnrestEvent,
  AIDataCenter,
  MilitaryFlight,
  MilitaryVessel,
  MilitaryFlightCluster,
  MilitaryVesselCluster,
  NaturalEvent,
  UcdpGeoEvent,
  MapProtestCluster,
  MapTechHQCluster,
  MapTechEventCluster,
  MapDatacenterCluster,
  CyberThreat,
  CableHealthRecord,
  MilitaryBaseEnriched,
} from '@/types';
import { fetchMilitaryBases, type MilitaryBaseCluster as ServerBaseCluster } from '@/services/military-bases';
import type { AirportDelayAlert, PositionSample } from '@/services/aviation';
import { fetchAircraftPositions } from '@/services/aviation';
import { type IranEvent, getIranEventColor, getIranEventRadius } from '@/services/conflict';
import type { GpsJamHex } from '@/services/gps-interference';
import { fetchImageryScenes } from '@/services/imagery';
import type { ImageryScene } from '@/generated/server/worldmonitor/imagery/v1/service_server';
import type { DisplacementFlow } from '@/services/displacement';
import type { Earthquake } from '@/services/earthquakes';
import type { ClimateAnomaly } from '@/services/climate';
import { ArcLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { debounce } from 'lodash';
import rafSchedule from 'raf-schd';
import { INTEL_HOTSPOTS } from '@/config/hotspots';
import { setMilitaryData } from '@/store/military';

// ... (Rest of your existing COLORS and ICON_MAPPING constants remain here)

export class DeckGLMap {
  private container: HTMLElement;
  private maplibreMap: maplibregl.Map | null = null;
  private deckOverlay: MapboxOverlay | null = null;
  
  // Updated Flight Properties
  private flightWorker: Worker | null = null;
  private flightHistory: Map<string, {path: number[][], timestamps: number[]}> = new Map();
  private aircraftPositions: any[] = [];
  private aircraftFetchTimer: ReturnType<typeof setInterval> | null = null;

  // ... (Other existing properties: militaryFlights, hotspots, etc.)

  constructor(container: HTMLElement, initialState: DeckMapState) {
    this.container = container;
    this.state = { ...initialState };
    
    this.debouncedRebuildLayers = debounce(() => {
      if (this.renderPaused || this.webglLost || !this.maplibreMap) return;
      try { this.deckOverlay?.setProps({ layers: this.buildLayers() }); } catch {}
    }, 150);

    this.debouncedFetchAircraft = debounce(() => this.fetchViewportAircraft(), 500);

    // Setup Global Flight Worker
    try {
      this.flightWorker = new Worker(new URL('../workers/flight-worker.ts', import.meta.url));
      this.flightWorker.onmessage = (e) => {
        const flights = e.data;
        const now = Date.now() / 1000;
        
        flights.forEach((f: any) => {
          const existing = this.flightHistory.get(f.id) || { path: [], timestamps: [] };
          const lastCoord = existing.path[existing.path.length - 1];
          
          // Update history if position changed to keep trails accurate
          if (!lastCoord || lastCoord[0] !== f.coords[0] || lastCoord[1] !== f.coords[1]) {
            const newPath = [...existing.path.slice(-14), f.coords];
            const newTimes = [...existing.timestamps.slice(-14), now];
            this.flightHistory.set(f.id, { path: newPath, timestamps: newTimes });
          }
        });

        this.aircraftPositions = flights;
        this.debouncedRebuildLayers();
      };
    } catch (err) {
      console.error('Failed to initialize flight worker', err);
    }
  }

  private buildLayers(): LayersList {
    const { mapLayers } = this.state;
    const layers: Layer[] = [];

    // ... (Existing logic for GeoJSON, Heatmaps, etc.)

    // Global Flight Intelligence Stack
    if (mapLayers.flights && this.aircraftPositions.length > 0) {
      // 1. FAINT TRAILS (TripsLayer)
      layers.push(new TripsLayer({
        id: 'flight-trails',
        data: Array.from(this.flightHistory.values()),
        getPath: d => d.path,
        getTimestamps: d => d.timestamps,
        getColor: [255, 255, 255],
        opacity: 0.12, 
        widthMinPixels: 1,
        trailLength: 600,
        currentTime: Date.now() / 1000
      }));

      // 2. 3D MODELS (ScenegraphLayer)
      layers.push(new ScenegraphLayer({
        id: 'global-flights',
        data: this.aircraftPositions,
        scenegraph: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/luma.gl/examples/objects/airplane.glb',
        getPosition: d => d.coords,
        getOrientation: d => [0, -d.heading, 90],
        sizeScale: this.state.viewState.zoom > 4 ? 45 : 0, 
        _instanced: true, 
        pickable: true
      }));

      // 3. ENTITY LABELS (TextLayer)
      layers.push(new TextLayer({
        id: 'flight-labels',
        data: this.aircraftPositions,
        getPosition: d => [d.coords[0], d.coords[1], d.coords[2] + 200],
        getText: d => this.state.viewState.zoom > 7 ? `${d.label}\n${d.desc}` : '',
        getSize: 12,
        getColor: d => d.color,
        outlineWidth: 2,
        outlineColor: [0, 0, 0]
      }));
    }

    // ... (Military and other existing layers continue below)
    return layers;
  }

  private fetchViewportAircraft(): void {
    if (!this.state.layers.flights) return;
    // We signal the worker to perform the global fetch
    this.flightWorker?.postMessage('fetch');
  }

  // ... (Rest of class methods like destroy, handleMove, etc.)
}
