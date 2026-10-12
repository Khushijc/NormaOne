import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // FacturaFlow uses 5173; JornadaPulse runs alongside it on 5174.
  server: { port: 5174 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'], icons: ['lucide-react'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
