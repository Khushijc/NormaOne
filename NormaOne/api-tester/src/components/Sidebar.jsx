import { ChevronLeft, ChevronRight } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { useApiState } from '../api/apiContext.js'
import { moduleAllowed, surfaceAllowed } from '../lib/landing.js'
import { MODULE_LINKS, SURFACES } from '../screens.js'

/**
 * The side panel: which surface, and which module inside it. The reference's, with NormaOne's
 * surfaces.
 *
 * ONE SECTION PER ACCESS RULE, BECAUSE THAT IS THE BIGGEST QUESTION. Whether a screen needs no
 * token, any token, a tenant ADMIN or a SUPER_ADMIN decides what it can show — so it is the
 * outermost thing on screen, and the section title's tooltip says the rule.
 *
 * A MODULE'S SUBMODULES ARE NOT HERE. They are a navbar in the body (ModuleNav), where a row of
 * labels reads at a glance; the same list indented a third level in a narrow column does not.
 *
 * The active row is matched on the module, not the exact path, because the address carries a
 * submodule and an id the panel does not know or care about.
 */
export default function Sidebar({ collapsed, onToggle }) {
  const { pathname } = useLocation()
  const currentSlug = pathname.split('/')[1]
  const { account } = useApiState()
  // Signed in: only the surfaces the role may use — an ordinary user never sees the platform-wide
  // organization browser. Signed out: everything, as a tester should. The backend enforces either way.
  const surfaces = SURFACES.filter((surface) => surfaceAllowed(surface.id, account) !== false)
  // And inside a surface, a module meant for one role only (My organization: USER).
  const links = MODULE_LINKS.filter((one) => moduleAllowed(one, account) !== false)

  return (
    <aside className="sidebar" data-collapsed={collapsed || undefined}>
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <a className="brand" href="/" aria-label="NormaOne API tester home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M6 18V6l12 12V6" fill="none" stroke="currentColor" strokeWidth="2.4"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="brand-name">NormaOne</span>
          </a>
          <button
            type="button"
            className="collapse-btn"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {surfaces.map((surface) => (
            <div className="nav-section" key={surface.id}>
              <p className="nav-section-title" title={surface.note}>{surface.label}</p>
              <ul>
                {links.filter((one) => one.surfaceId === surface.id).map((one) => (
                  <li key={one.slug}>
                    <NavLink
                      to={one.to}
                      className={`nav-item${one.slug === currentSlug ? ' is-active' : ''}`}
                      title={collapsed ? one.label : undefined}
                    >
                      <one.icon size={17} strokeWidth={1.9} className="nav-icon" aria-hidden="true" />
                      <span className="nav-label">{one.label}</span>
                      {one.endpoints != null ? <span className="nav-badge">{one.endpoints}</span> : null}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  )
}
