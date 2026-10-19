/**
 * How an address is built. No dependency on the screen list, and that is the point.
 *
 * screens.js imports every page, so a page that builds a link back to its list would import it
 * back and close a cycle — the reference hit exactly that ("Cannot access 'screenPath' before
 * initialization") at module load, with the bundler perfectly happy.
 *
 * A MODULE'S ADDRESS IS ONE SEGMENT, `surface-module`, and the submodule is the second. The dev
 * server proxies `^/api($|/)` to the backend, and no address built here can start with `/api`, so
 * a screen can never be swallowed by the proxy and answered by Spring with a 404.
 */

export const moduleSlug = (surfaceId, moduleId) => `${surfaceId}-${moduleId}`

export const screenPath = (surfaceId, moduleId, submoduleId) =>
  `/${moduleSlug(surfaceId, moduleId)}/${submoduleId}`

/** One row of a submodule, addressed by its own id. */
export const detailPath = (surfaceId, moduleId, submoduleId, id) =>
  `${screenPath(surfaceId, moduleId, submoduleId)}/${encodeURIComponent(id)}`

/** The console, the one address other screens link to with a request already filled in. */
export const CONSOLE_PATH = screenPath('workbench', 'console', 'console')

/**
 * Which surface an address is on, from the address alone. Here rather than in screens.js because
 * the top bar needs it, and importing screens.js from the shell is how a cycle forms.
 */
export function surfaceOf(pathname) {
  const slug = String(pathname).split('/')[1] ?? ''
  const surface = slug.split('-')[0]
  return ['account', 'tenant', 'platform', 'workbench'].includes(surface) ? surface : null
}
