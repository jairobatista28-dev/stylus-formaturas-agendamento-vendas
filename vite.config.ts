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
    // Bibliotecas grandes em arquivos separados: ficam em cache no navegador
    // e so baixam quando a tela que usa precisa delas
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          graficos: ['recharts'],
          planilhas: ['xlsx'],
        },
      },
    },
  },
});
