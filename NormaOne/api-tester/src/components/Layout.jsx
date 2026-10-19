import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ModuleNav from './ModuleNav.jsx'
import ResponseModal from './ResponseModal.jsx'
import ScreenBoundary from './ScreenBoundary.jsx'
import Sidebar from './Sidebar.jsx'
import Topbar from './Topbar.jsx'

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()

  // The drawer remembers which route opened it, so navigating away closes it
  // during render — no effect, no cascading re-render.
  const [drawer, setDrawer] = useState({ open: false, path: pathname })
  const mobileOpen = drawer.open && drawer.path === pathname
  const closeDrawer = () => setDrawer({ open: false, path: pathname })

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setDrawer({ open: false, path: pathname })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen, pathname])

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-drawer-open' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      {mobileOpen ? (
        <button type="button" className="scrim" aria-label="Close navigation" onClick={closeDrawer} />
      ) : null}
      <div className="main">
        <Topbar onMenuClick={() => setDrawer({ open: true, path: pathname })} />
        <main>
          <ModuleNav />
          {/* Keyed on the route, so navigating away from a screen that threw clears the error
              instead of leaving the panel up for everything visited afterwards. The nav and the
              side panel sit outside it and keep working. */}
          <ScreenBoundary key={pathname}>{children}</ScreenBoundary>
        </main>
        {/* In the shell, so a call made anywhere can be inspected and no screen has to
            remember to render it. */}
        <ResponseModal />
      </div>
    </div>
  )
}
