export type GlobeRenderScale = 'auto' | '0.5' | '0.75' | '1.0' | '1.5' | '2.0' | (string & {});
export type GlobePerformanceProfile = 'low' | 'balanced' | 'high' | (string & {});
export type GlobeVisualPreset = 'default' | 'satellite' | 'dark' | 'blueprint' | 'minimal' | (string & {});

export const GLOBE_TEXTURE_URLS: Record<string, string> = {
  default: '/textures/earth-dark.jpg',
  dark: '/textures/earth-dark.jpg',
  satellite: '/textures/earth-satellite.jpg',
  blueprint: '/textures/earth-blueprint.jpg',
  minimal: '/textures/earth-minimal.jpg'
};

export const GLOBE_VISUAL_PRESET_OPTIONS =[
  { id: 'default', label: 'Default' },
  { id: 'dark', label: 'Dark Mode' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'minimal', label: 'Minimal' }
];

let currentScale: GlobeRenderScale = 'auto';
let currentPreset: GlobeVisualPreset = 'default';

// Attempt to restore user preferences safely
if (typeof window !== 'undefined') {
  try {
    const storedScale = localStorage.getItem('wm_globe_scale');
    if (storedScale) currentScale = storedScale as GlobeRenderScale;
    
    const storedPreset = localStorage.getItem('wm_globe_preset');
    if (storedPreset) currentPreset = storedPreset as GlobeVisualPreset;
  } catch (e) {
    // Ignore localStorage errors
  }
}

// Using a hardcoded string literal fallback ensures TS never evaluates this as 'string | undefined'
let currentTexture: string = GLOBE_TEXTURE_URLS[currentPreset as string] || '/textures/earth-dark.jpg';

type Callback<T> = (val: T) => void;
const scaleSubscribers: Callback<GlobeRenderScale>[] = [];
const presetSubscribers: Callback<GlobeVisualPreset>[] =[];
const textureSubscribers: Callback<string>[] =[];

// --- ORIGINAL EXPORTS FOR GLOBEMAP.TS AND PREFERENCES-CONTENT.TS ---

export function getGlobeRenderScale(): GlobeRenderScale {
  return currentScale;
}

export function setGlobeRenderScale(scale: GlobeRenderScale) {
  currentScale = scale;
  if (typeof window !== 'undefined') {
    try { localStorage.setItem('wm_globe_scale', scale as string); } catch(e) {}
  }
  scaleSubscribers.forEach(cb => cb(currentScale));
}

export function getGlobeVisualPreset(): GlobeVisualPreset {
  return currentPreset;
}

export function setGlobeVisualPreset(preset: GlobeVisualPreset) {
  currentPreset = preset;
  if (typeof window !== 'undefined') {
    try { localStorage.setItem('wm_globe_preset', preset as string); } catch(e) {}
  }
  
  // Hardcoded string fallback used here as well for TS strict compliance
  currentTexture = GLOBE_TEXTURE_URLS[preset as string] || '/textures/earth-dark.jpg';
  
  presetSubscribers.forEach(cb => cb(currentPreset));
  textureSubscribers.forEach(cb => cb(currentTexture));
}

export function getGlobeTexture(): string {
  return currentTexture;
}

export function resolveGlobePixelRatio(scale: GlobeRenderScale): number {
  if (typeof window === 'undefined') return 1;
  if (scale === 'auto') return Math.min(window.devicePixelRatio || 1, 2);
  return parseFloat(scale as string) || 1;
}

export function resolvePerformanceProfile(scale: GlobeRenderScale): GlobePerformanceProfile {
  if (scale === 'auto') return 'balanced';
  const val = parseFloat(scale as string);
  if (val < 1.0) return 'low';
  if (val > 1.0) return 'high';
  return 'balanced';
}

export function subscribeGlobeRenderScaleChange(cb: Callback<GlobeRenderScale>) {
  scaleSubscribers.push(cb);
  return () => {
    const idx = scaleSubscribers.indexOf(cb);
    if (idx > -1) scaleSubscribers.splice(idx, 1);
  };
}

export function subscribeGlobeVisualPresetChange(cb: Callback<GlobeVisualPreset>) {
  presetSubscribers.push(cb);
  return () => {
    const idx = presetSubscribers.indexOf(cb);
    if (idx > -1) presetSubscribers.splice(idx, 1);
  };
}

export function subscribeGlobeTextureChange(cb: Callback<string>) {
  textureSubscribers.push(cb);
  return () => {
    const idx = textureSubscribers.indexOf(cb);
    if (idx > -1) textureSubscribers.splice(idx, 1);
  };
}


// --- BATCH 2 NEW PERFORMANCE THROTTLING MANAGER ---

class GlobeRenderSettingsManager {
  private lastTime: number;
  private frames: number = 0;
  private fps: number = 60;
  public isLowPowerMode: boolean = false;
  private checkIntervalMs: number = 2000;

  constructor() {
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (typeof window !== 'undefined') {
      this.monitorFPS();
    }
  }

  private monitorFPS() {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => this.monitorFPS());
    }
    this.frames++;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    
    if (now - this.lastTime >= this.checkIntervalMs) {
      this.fps = (this.frames * 1000) / (now - this.lastTime);
      this.frames = 0;
      this.lastTime = now;
      this.adjustSettings();
    }
  }

  private adjustSettings() {
    if (this.fps < 30 && !this.isLowPowerMode) {
      this.isLowPowerMode = true;
      console.warn(`[GlobePerf] FPS dropped to ${Math.round(this.fps)}. Engaging low-power mode.`);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('globe-perf-mode', { detail: { lowPower: true }}));
      }
    } 
    else if (this.fps >= 50 && this.isLowPowerMode) {
      this.isLowPowerMode = false;
      console.log(`[GlobePerf] FPS recovered to ${Math.round(this.fps)}. Restoring full quality.`);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('globe-perf-mode', { detail: { lowPower: false }}));
      }
    }
  }

  public getDeckGLProps() {
    return {
      useDevicePixels: !this.isLowPowerMode,
      parameters: {
        depthTest: true,
        cull: true,
        blend: true,
        antialias: !this.isLowPowerMode
      }
    };
  }

  public getCurrentFPS(): number {
    return Math.round(this.fps);
  }
}

export const globeSettings = new GlobeRenderSettingsManager();