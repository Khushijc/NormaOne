import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import OnboardingGate from './components/OnboardingGate.jsx'
import NotFound from './pages/NotFound.jsx'
import { ROUTES } from './screens.js'

/**
 * The router, built from the same list the navigation is built from.
 *
 * `ROUTES` is derived from `SURFACES` in screens.js, so a nav item pointing at an address that
 * has no screen is not something to remember to check — it cannot be written down.
 *
 * "/" opens Account › Me: the first question with a session is "who does the backend think I am",
 * and without one that screen says how to sign in. OnboardingGate keeps an account that has not
 * finished onboarding off the screens that need a role.
 */
export default function App() {
  return (
    <Layout>
      <OnboardingGate>
        <Routes>
          <Route path="/" element={<Navigate to="/account-me/profile" replace />} />
          {ROUTES.map(({ path, screen: Screen }) => (
            <Route key={path} path={path} element={<Screen />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </OnboardingGate>
    </Layout>
  )
}
