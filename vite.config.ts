import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 8080,
    host: true,
    proxy: {
      '/api/uazapi': {
        target: 'https://free.uazapi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/uazapi/, ''),
        headers: {
          'Origin': 'https://free.uazapi.com',
        },
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
  build: {
    outDir: 'dist',
  },
});
