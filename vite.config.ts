import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __DEV__: JSON.stringify(mode !== 'production'),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
}));
