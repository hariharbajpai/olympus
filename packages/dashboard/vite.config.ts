import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const daemon = `127.0.0.1:${process.env.OLYMPUS_PORT ?? '4800'}`;

// In dev, run the daemon with OLYMPUS_ALLOWED_ORIGINS=http://localhost:5173 so it accepts
// the proxied WebSocket from this dev server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://${daemon}` },
      '/ws': { target: `ws://${daemon}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Served from the Owner's own machine; one bundle with charts and Markdown is fine.
    chunkSizeWarningLimit: 1200,
  },
});
