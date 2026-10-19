/**
 * Which backend the app talks to.
 *
 * Nothing in the app writes a base URL inline. Requests go to this page's own origin and the dev
 * server forwards /api/** to VITE_API_BASE_URL (vite.config.js), so switching backends is one line
 * in .env.local and a restart of `npm run dev`.
 *
 * ONE ENVIRONMENT, ON PURPOSE. The reference tester also lists "Development (direct)", which calls
 * Spring Boot without the proxy and relies on a dev-only CORS config there. NormaOne has no CORS
 * configuration, so that entry would fail every request — a control that cannot work. Its staging
 * and production entries have no address and no screen to pick them from, so they are not copied
 * either. Add one here when there is a real server to point it at.
 */

/** Where the dev server forwards /api/**. Compiled in from .env.local; only displayed by the page. */
export const PROXY_TARGET = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8881'

export const DEFAULT_ENVIRONMENTS = [
  {
    id: 'local-proxy',
    name: 'Local',
    // An empty base URL means this page's own origin; the proxy does the forwarding. No CORS,
    // and every response header — WWW-Authenticate on a 401 included — is readable.
    baseUrl: '',
    target: PROXY_TARGET,
    description: `Through this dev server on port 1500, forwarded to ${PROXY_TARGET}.`,
  },
]

/** Give up on a request after this long, so a dead backend does not hang the page forever. */
export const DEFAULT_TIMEOUT_MS = 30000
