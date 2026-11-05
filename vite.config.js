import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (/examples[\\/]jsm[\\/]controls[\\/]TransformControls/.test(id))
            return 'workplane-controls';
          if (/node_modules[\\/]three/.test(id)) return 'three';
        },
      },
    },
  },
});
