import { NavLink, useLocation } from 'react-router-dom'
import { moduleForPath } from '../screens.js'
import { screenPath } from '../paths.js'

/**
 * The navbar in the body: the submodules of whichever module the side panel is on. The
 * reference's, less its link to the module's plan on GitHub — NormaOne's equivalent is
 * backend/docs/AUTH_RBAC_GUIDE.md, a file in the repository rather than an address, and the
 * Endpoints screen carries what that guide says per endpoint.
 *
 * It names where you are — the surface and module above the row — so a screen is never ambiguous
 * about which caller it acts as. `Tenant admin › Users` and `Super admin › Users` are different
 * endpoints with different reach, and this line is what tells the two screens apart.
 *
 * A module with one submodule still gets the bar, so the heading is in the same place on every
 * screen and the surface is always stated.
 */
export default function ModuleNav() {
  const { pathname } = useLocation()
  const here = moduleForPath(pathname)
  if (!here) return null

  const { surface, module } = here

  return (
    <div className="module-nav">
      <p className="module-nav-where">
        <span className="module-nav-surface" title={surface.note}>{surface.label}</span>
        <span aria-hidden="true">›</span>
        <span>{module.label}</span>
      </p>

      <div className="segmented" role="tablist" aria-label={`${module.label} screens`}>
        {/* A hidden submodule has an address but no tab — set-password, reached only from a login. */}
        {module.submodules.filter((submodule) => !submodule.hidden).map((submodule) => (
          <NavLink
            key={submodule.id}
            to={screenPath(surface.id, module.id, submodule.id)}
            role="tab"
            className={({ isActive }) => `segmented-item${isActive ? ' is-on' : ''}`}
          >
            {submodule.label}
            {Number.isFinite(submodule.endpoints)
              ? <span className="module-nav-count">{submodule.endpoints}</span>
              : null}
          </NavLink>
        ))}
      </div>
    </div>
  )
}
