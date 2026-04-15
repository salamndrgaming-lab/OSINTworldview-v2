import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// @ts-expect-error - `process` is available in the Node.js Vite config runtime.
const host: string | undefined = process.env['TAURI_DEV_HOST'];

export default defineConfig(async () => ({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target:
      // @ts-expect-error - process typings come from @types/node which we don't bundle.
      process.env['TAURI_ENV_PLATFORM'] === 'windows' ? 'chrome105' : 'safari13',
    // @ts-expect-error - env var is string-or-undefined.
    minify: !process.env['TAURI_ENV_DEBUG'] ? 'esbuild' : false,
    // @ts-expect-error
    sourcemap: !!process.env['TAURI_ENV_DEBUG'],
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        homepage: resolve(__dirname, 'src/homepage/index.html'),
      },
    },
  },
}));
