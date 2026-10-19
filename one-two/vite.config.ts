import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app lives in app/; it imports shared code (search, types) from engine/.
// `vite build --mode demo` builds the server-less demo into dist-demo/ (see `npm run build:demo`).
export default defineConfig(({ mode }) => ({
  root: 'app',
  envDir: '..',
  base: mode === 'demo' ? './' : '/',
  plugins: [react()],
  build: { outDir: mode === 'demo' ? '../dist-demo' : '../dist', emptyOutDir: true },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
}));
