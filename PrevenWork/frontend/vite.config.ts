import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Portal mini-apps run on consecutive ports: FacturaFlow 3001, JornadaPulse 3002, DatosPilot 3003, PrevenWork 3004
  server: { port: 3004, strictPort: true },
  preview: { port: 3004, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
