/**
 * GlobeRenderSettings
 * Profiles render performance dynamically and returns optimized Deck.GL parameters.
 */
class GlobeRenderSettingsManager {
    private lastTime: number = performance.now();
    private frames: number = 0;
    private fps: number = 60;
    public isLowPowerMode: boolean = false;
    private checkIntervalMs: number = 2000; // Profile every 2 seconds
  
    constructor() {
      this.monitorFPS();
    }
  
    private monitorFPS() {
      requestAnimationFrame(() => this.monitorFPS());
      this.frames++;
      const now = performance.now();
      
      if (now - this.lastTime >= this.checkIntervalMs) {
        this.fps = (this.frames * 1000) / (now - this.lastTime);
        this.frames = 0;
        this.lastTime = now;
        this.adjustSettings();
      }
    }
  
    private adjustSettings() {
      // If we drop below 30 FPS, trigger low power mode to degrade visual quality gracefully
      if (this.fps < 30 && !this.isLowPowerMode) {
        this.isLowPowerMode = true;
        console.warn(`[GlobePerf] FPS dropped to ${Math.round(this.fps)}. Engaging low-power mode.`);
        window.dispatchEvent(new CustomEvent('globe-perf-mode', { detail: { lowPower: true }}));
      } 
      // If we are recovering well (above 50 FPS) while throttled, attempt to restore quality
      else if (this.fps >= 50 && this.isLowPowerMode) {
        this.isLowPowerMode = false;
        console.log(`[GlobePerf] FPS recovered to ${Math.round(this.fps)}. Restoring full quality.`);
        window.dispatchEvent(new CustomEvent('globe-perf-mode', { detail: { lowPower: false }}));
      }
    }
  
    /**
     * Inject these props directly into the DeckGL instance configuration
     */
    public getDeckGLProps() {
      return {
        // Disabling device pixels on retina screens massively improves performance in low-power mode
        useDevicePixels: !this.isLowPowerMode,
        parameters: {
          depthTest: true,
          cull: true,
          blend: true,
          // Disable antialiasing in low power mode
          antialias: !this.isLowPowerMode
        }
      };
    }
  
    public getCurrentFPS(): number {
      return Math.round(this.fps);
    }
  }
  
  export const globeSettings = new GlobeRenderSettingsManager();