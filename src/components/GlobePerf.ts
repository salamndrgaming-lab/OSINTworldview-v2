/**
 * GlobePerf.ts — Globe Performance Optimization Module
 * World Monitor OSINT Platform
 *
 * Drop into: src/components/GlobePerf.ts
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PerfConfig {
  targetFPS: number;
  maxMarkersPerFrame: number;
  adaptiveQuality: boolean;
  minPixelRatio: number;
  maxPixelRatio: number;
  frameBudgetMs: number;
  enableLOD: boolean;
  enableFrustumCulling: boolean;
  lodSegments: [number, number, number];
}

export type QualityTier = 'high' | 'medium' | 'low' | 'potato';

interface FrameStats {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
  qualityTier: QualityTier;
  culledObjects: number;
  visibleMarkers: number;
}

// ── Default Config ───────────────────────────────────────────────────────────

const isMobileDevice = (): boolean =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  window.matchMedia('(max-width: 768px)').matches;

function defaultConfig(): PerfConfig {
  const mobile = isMobileDevice();
  return {
    targetFPS: mobile ? 30 : 60,
    maxMarkersPerFrame: mobile ? 80 : 200,
    adaptiveQuality: true,
    minPixelRatio: mobile ? 0.5 : 0.75,
    maxPixelRatio: Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2),
    frameBudgetMs: mobile ? 33.3 : 16.6,
    enableLOD: true,
    enableFrustumCulling: true,
    lodSegments: mobile ? [32, 20, 12] : [64, 32, 16],
  };
}

// ── FPS Tracker ──────────────────────────────────────────────────────────────

class FPSTracker {
  private samples: number[] = [];
  private maxSamples = 60;
  private lastTime = 0;

  tick(now: number): void {
    if (this.lastTime > 0) {
      const dt = now - this.lastTime;
      if (dt > 0) {
        this.samples.push(1000 / dt);
        if (this.samples.length > this.maxSamples) {
          this.samples.shift();
        }
      }
    }
    this.lastTime = now;
  }

  getFPS(): number {
    if (this.samples.length === 0) return 60;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  getPercentile(pct: number): number {
    if (this.samples.length === 0) return 60;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.floor((pct / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)] ?? 60;
  }

  reset(): void {
    this.samples = [];
    this.lastTime = 0;
  }
}

// ── Adaptive Quality Controller ──────────────────────────────────────────────

class QualityController {
  private config: PerfConfig;
  private currentTier: QualityTier = 'high';
  private currentPixelRatio: number;
  private tierStabilityFrames = 0;
  private readonly STABILITY_THRESHOLD = 90;
  private fpsTracker: FPSTracker;

  constructor(config: PerfConfig, fpsTracker: FPSTracker) {
    this.config = config;
    this.fpsTracker = fpsTracker;
    this.currentPixelRatio = config.maxPixelRatio;
  }

  update(): { tierChanged: boolean; tier: QualityTier; pixelRatio: number } {
    if (!this.config.adaptiveQuality) {
      return { tierChanged: false, tier: this.currentTier, pixelRatio: this.currentPixelRatio };
    }

    const fps = this.fpsTracker.getFPS();
    const p5 = this.fpsTracker.getPercentile(5);
    const target = this.config.targetFPS;

    let desiredTier: QualityTier = this.currentTier;

    if (p5 < target * 0.5) {
      desiredTier = 'potato';
    } else if (fps < target * 0.6) {
      desiredTier = 'low';
    } else if (fps < target * 0.8) {
      desiredTier = 'medium';
    }

    if (fps > target * 0.95 && p5 > target * 0.7) {
      if (this.currentTier === 'potato') desiredTier = 'low';
      else if (this.currentTier === 'low') desiredTier = 'medium';
      else if (this.currentTier === 'medium') desiredTier = 'high';
    }

    if (desiredTier === this.currentTier) {
      this.tierStabilityFrames = 0;
      return { tierChanged: false, tier: this.currentTier, pixelRatio: this.currentPixelRatio };
    }

    this.tierStabilityFrames++;
    if (this.tierStabilityFrames < this.STABILITY_THRESHOLD) {
      return { tierChanged: false, tier: this.currentTier, pixelRatio: this.currentPixelRatio };
    }

    const prevTier = this.currentTier;
    this.currentTier = desiredTier;
    this.tierStabilityFrames = 0;

    const ratioMap: Record<QualityTier, number> = {
      high: this.config.maxPixelRatio,
      medium: Math.max(this.config.minPixelRatio, this.config.maxPixelRatio * 0.75),
      low: Math.max(this.config.minPixelRatio, this.config.maxPixelRatio * 0.5),
      potato: this.config.minPixelRatio,
    };
    this.currentPixelRatio = ratioMap[this.currentTier];

    console.log(
      `[GlobePerf] Quality: ${prevTier} → ${this.currentTier} (FPS: ${fps.toFixed(1)}, P5: ${p5.toFixed(1)}, DPR: ${this.currentPixelRatio.toFixed(2)})`
    );

    return { tierChanged: true, tier: this.currentTier, pixelRatio: this.currentPixelRatio };
  }

  getTier(): QualityTier {
    return this.currentTier;
  }

  getPixelRatio(): number {
    return this.currentPixelRatio;
  }
}

// ── LOD Manager ──────────────────────────────────────────────────────────────

class LODManager {
  private config: PerfConfig;

  constructor(config: PerfConfig) {
    this.config = config;
  }

  getGlobeSegments(tier: QualityTier): number {
    if (!this.config.enableLOD) return this.config.lodSegments[0];
    switch (tier) {
      case 'high': return this.config.lodSegments[0];
      case 'medium': return this.config.lodSegments[1];
      case 'low':
      case 'potato': return this.config.lodSegments[2];
    }
  }

  getAtmosphereDetail(tier: QualityTier): { enabled: boolean; segments: number; opacity: number } {
    switch (tier) {
      case 'high': return { enabled: true, segments: 48, opacity: 0.15 };
      case 'medium': return { enabled: true, segments: 24, opacity: 0.12 };
      case 'low': return { enabled: true, segments: 16, opacity: 0.1 };
      case 'potato': return { enabled: false, segments: 0, opacity: 0 };
    }
  }

  getMaxArcs(tier: QualityTier): number {
    switch (tier) {
      case 'high': return 100;
      case 'medium': return 50;
      case 'low': return 20;
      case 'potato': return 8;
    }
  }

  getArcDetail(tier: QualityTier): number {
    switch (tier) {
      case 'high': return 32;
      case 'medium': return 16;
      case 'low': return 8;
      case 'potato': return 4;
    }
  }
}

// ── Frustum Culler ───────────────────────────────────────────────────────────

export class FrustumCuller {
  static cull(
    positions: Array<[number, number, number]>,
    cameraPos: [number, number, number],
    cameraDir: [number, number, number],
    fov: number,
    maxDistance: number
  ): number[] {
    const visible: number[] = [];
    const cosFov = Math.cos(fov * 0.6);

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      if (!pos) continue;
      const [px, py, pz] = pos;
      const dx = px - cameraPos[0];
      const dy = py - cameraPos[1];
      const dz = pz - cameraPos[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > maxDistance) continue;

      const dot = (dx * cameraDir[0] + dy * cameraDir[1] + dz * cameraDir[2]) / dist;
      if (dot > cosFov) {
        visible.push(i);
      }
    }

    return visible;
  }

  static isPointFacingCamera(
    lat: number,
    lng: number,
    cameraLat: number,
    cameraLng: number
  ): boolean {
    const latR = (lat * Math.PI) / 180;
    const lngR = (lng * Math.PI) / 180;
    const cLatR = (cameraLat * Math.PI) / 180;
    const cLngR = (cameraLng * Math.PI) / 180;

    const dot =
      Math.cos(latR) * Math.cos(cLatR) * Math.cos(lngR - cLngR) +
      Math.sin(latR) * Math.sin(cLatR);

    return dot > -0.1;
  }
}

// ── Frame Budget Manager ─────────────────────────────────────────────────────

export class FrameBudget {
  private budgetMs: number;
  private frameStart = 0;

  constructor(budgetMs: number) {
    this.budgetMs = budgetMs;
  }

  startFrame(): void {
    this.frameStart = performance.now();
  }

  hasTimeLeft(): boolean {
    return (performance.now() - this.frameStart) < this.budgetMs * 0.8;
  }

  remaining(): number {
    return Math.max(0, this.budgetMs * 0.8 - (performance.now() - this.frameStart));
  }

  processBatch<T>(items: T[], fn: (item: T, index: number) => void): number {
    let processed = 0;
    for (let i = 0; i < items.length; i++) {
      if (!this.hasTimeLeft()) break;
      const item = items[i];
      if (item !== undefined) {
        fn(item, i);
      }
      processed++;
    }
    return processed;
  }
}

// ── Texture Optimization ─────────────────────────────────────────────────────

export class TextureOptimizer {
  static getTextureDimensions(
    tier: QualityTier,
    originalWidth: number,
    originalHeight: number
  ): { width: number; height: number } {
    const maxDim: Record<QualityTier, number> = {
      high: 4096,
      medium: 2048,
      low: 1024,
      potato: 512,
    };

    const max = maxDim[tier];
    const aspect = originalWidth / originalHeight;

    if (originalWidth <= max && originalHeight <= max) {
      return { width: originalWidth, height: originalHeight };
    }

    if (aspect >= 1) {
      return { width: max, height: Math.round(max / aspect) };
    } else {
      return { width: Math.round(max * aspect), height: max };
    }
  }

  static downscaleTexture(
    source: HTMLImageElement | HTMLCanvasElement,
    targetWidth: number,
    targetHeight: number
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    }
    return canvas;
  }
}

// ── Marker Instance Pool ─────────────────────────────────────────────────────

export class MarkerPool {
  readonly maxCount: number;
  private activeCount = 0;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly scales: Float32Array;

  constructor(maxCount: number) {
    this.maxCount = maxCount;
    this.positions = new Float32Array(maxCount * 3);
    this.colors = new Float32Array(maxCount * 4);
    this.scales = new Float32Array(maxCount);
  }

  setMarker(
    index: number,
    x: number, y: number, z: number,
    r: number, g: number, b: number, a: number,
    scale: number
  ): void {
    const i3 = index * 3;
    const i4 = index * 4;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.colors[i4] = r;
    this.colors[i4 + 1] = g;
    this.colors[i4 + 2] = b;
    this.colors[i4 + 3] = a;
    this.scales[index] = scale;
    if (index >= this.activeCount) this.activeCount = index + 1;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  reset(): void {
    this.activeCount = 0;
  }
}

// ── Main GlobePerf Class ─────────────────────────────────────────────────────

export class GlobePerf {
  private config: PerfConfig;
  private fpsTracker: FPSTracker;
  private qualityController: QualityController;
  private lodManager: LODManager;
  private frameBudget: FrameBudget;
  private stats: FrameStats;
  private onQualityChange: ((tier: QualityTier, pixelRatio: number) => void) | null = null;

  constructor(config?: Partial<PerfConfig>) {
    this.config = { ...defaultConfig(), ...config };
    this.fpsTracker = new FPSTracker();
    this.qualityController = new QualityController(this.config, this.fpsTracker);
    this.lodManager = new LODManager(this.config);
    this.frameBudget = new FrameBudget(this.config.frameBudgetMs);
    this.stats = {
      fps: 60,
      frameTime: 0,
      drawCalls: 0,
      triangles: 0,
      qualityTier: 'high',
      culledObjects: 0,
      visibleMarkers: 0,
    };
  }

  onQualityChanged(cb: (tier: QualityTier, pixelRatio: number) => void): void {
    this.onQualityChange = cb;
  }

  beginFrame(): {
    tier: QualityTier;
    pixelRatio: number;
    tierChanged: boolean;
    budget: FrameBudget;
    globeSegments: number;
    maxArcs: number;
    arcDetail: number;
    atmosphere: { enabled: boolean; segments: number; opacity: number };
    maxMarkers: number;
  } {
    const now = performance.now();
    this.fpsTracker.tick(now);
    this.frameBudget.startFrame();

    const quality = this.qualityController.update();

    if (quality.tierChanged && this.onQualityChange) {
      this.onQualityChange(quality.tier, quality.pixelRatio);
    }

    const tier = quality.tier;

    const markerScale: Record<QualityTier, number> = {
      high: 1,
      medium: 0.6,
      low: 0.35,
      potato: 0.15,
    };
    const maxMarkers = Math.round(this.config.maxMarkersPerFrame * markerScale[tier]);

    this.stats.fps = this.fpsTracker.getFPS();
    this.stats.qualityTier = tier;

    return {
      tier,
      pixelRatio: quality.pixelRatio,
      tierChanged: quality.tierChanged,
      budget: this.frameBudget,
      globeSegments: this.lodManager.getGlobeSegments(tier),
      maxArcs: this.lodManager.getMaxArcs(tier),
      arcDetail: this.lodManager.getArcDetail(tier),
      atmosphere: this.lodManager.getAtmosphereDetail(tier),
      maxMarkers,
    };
  }

  endFrame(drawCalls?: number, triangles?: number): void {
    this.stats.drawCalls = drawCalls || 0;
    this.stats.triangles = triangles || 0;
  }

  getStats(): FrameStats {
    return { ...this.stats };
  }

  getTier(): QualityTier {
    return this.qualityController.getTier();
  }

  getPixelRatio(): number {
    return this.qualityController.getPixelRatio();
  }

  createMarkerPool(): MarkerPool {
    return new MarkerPool(this.config.maxMarkersPerFrame);
  }

  shouldSkipFrame(): boolean {
    const fps = this.fpsTracker.getFPS();
    if (fps < this.config.targetFPS * 0.3) {
      return Math.random() < 0.3;
    }
    return false;
  }

  createDebugOverlay(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'globe-perf-overlay';
    Object.assign(el.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: '99999',
      background: 'rgba(0,0,0,0.85)',
      color: '#22c55e',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10px',
      padding: '8px 12px',
      borderRadius: '6px',
      border: '1px solid #1e293b',
      lineHeight: '1.6',
      display: 'none',
      pointerEvents: 'none',
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === '`') {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
      }
    });

    const update = (): void => {
      if (el.style.display !== 'none') {
        const s = this.stats;
        const fpsColor = s.fps > 50 ? '#22c55e' : s.fps > 30 ? '#eab308' : '#ef4444';
        el.innerHTML = `
          <span style="color:${fpsColor}">FPS: ${s.fps.toFixed(0)}</span><br>
          TIER: ${s.qualityTier.toUpperCase()}<br>
          DPR: ${this.getPixelRatio().toFixed(2)}<br>
          DRAW: ${s.drawCalls}<br>
          TRIS: ${(s.triangles / 1000).toFixed(1)}k
        `;
      }
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);

    return el;
  }
}

export default GlobePerf;
