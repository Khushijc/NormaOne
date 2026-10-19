import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * Port 1500, so this and ../../orbit-sphere-new-api/new-api-tester (1400) run side by side.
 *
 * `/api/**` is proxied to the NormaOne backend. Going through the dev server rather than straight
 * at the backend means no CORS — and the backend has no CORS configuration, deliberately: adding
 * one only so a test tool can call it would widen what every browser origin is allowed to do. The
 * proxy also lets the page read every response header, including `WWW-Authenticate` on a 401.
 *
 * The backend address is VITE_API_BASE_URL (see .env.example), read here and nowhere else in the
 * build, so changing backends is one line in .env.local rather than a search through the source.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const backend = env.VITE_API_BASE_URL || 'http://localhost:8881'

  return {
    plugins: [react()],
    server: {
      port: 1500,
      // Fail rather than quietly starting a second copy on 1501. Two dev servers on two ports
      // means two tabs both loading, which reads in the backend log as the app asking twice.
      strictPort: true,
      // The page and the API share this origin, and the session rides on cookies: nothing should be
      // calling this dev server from another origin, so it does not answer CORS preflights at all.
      cors: false,
      proxy: {
        // Anchored to a whole path segment, so a screen in this app whose address merely starts
        // with "api" is not sent to the backend by mistake.
        '^/api($|/)': { target: backend, changeOrigin: true },
      },
    },
  }
})
