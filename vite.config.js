import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React client lives in /client and is built into /dist, which the Node server serves in production.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    host: true, // lets friends on the same Wi-Fi open http://<your-ip>:5173 during development
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});
