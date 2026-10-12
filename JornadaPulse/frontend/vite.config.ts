import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Portal mini-apps run on consecutive ports: FacturaFlow 3001, JornadaPulse 3002, …
  server: { port: 3002, strictPort: true },
  preview: { port: 3002, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'], icons: ['lucide-react'], i18n: ['./src/i18n/en/index.ts'], seed: ['./src/data/seed.ts'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
