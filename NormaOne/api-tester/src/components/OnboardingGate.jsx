import { Navigate, useLocation } from 'react-router-dom'
import { useApiState } from '../api/apiContext.js'
import { GATED_SURFACES, moduleAllowed, needsOnboarding, ONBOARDING_PATH, roleLabel, SURFACE_ROLE, surfaceAllowed } from '../lib/landing.js'
import { MODULE_LINKS } from '../screens.js'
import { Empty } from './ui/Kit.jsx'
import { surfaceOf } from '../paths.js'

/**
 * Sends a signed-in account that has not finished onboarding to the onboarding screen, and keeps a
 * signed-in account off a surface its role is not for (tenant: ADMIN, platform: SUPER_ADMIN), whatever
 * address it typed — for the tenant and platform surfaces, which need a role it does not have yet.
 *
 * It decides from the account the provider read from GET /api/users/me, never from local state, and
 * it waits for that read: until the account is checked nothing is redirected. It cannot loop — the
 * onboarding screen is on the account surface, which is never gated.
 *
 * A convenience, not security. The backend refuses every tenant and platform call from an account
 * without a role whether or not this redirect happens.
 */
export default function OnboardingGate({ children }) {
  const { account } = useApiState()
  const { pathname } = useLocation()

  if (account.checked && needsOnboarding(account.me) && GATED_SURFACES.includes(surfaceOf(pathname))) {
    return <Navigate to={ONBOARDING_PATH} replace state={{ from: pathname }} />
  }
  // A signed-in account whose role is not the surface's: a panel, not a redirect, so nothing loops.
  const surface = surfaceOf(pathname)
  const link = MODULE_LINKS.find((one) => one.slug === pathname.split('/')[1])
  const blockedModule = surfaceAllowed(surface, account) !== false && moduleAllowed(link, account) === false
  if (surfaceAllowed(surface, account) === false || blockedModule) {
    const needed = roleLabel(blockedModule ? link.role : SURFACE_ROLE[surface])
    return (
      <div className="page">
        <section className="card">
          <Empty
            title="Not available to your role"
            description={`This area is for ${needed} accounts; you are signed in as ${account.me.effectiveRole || 'an account without a role'}.${needed === 'USER' && account.me.effectiveRole === 'ADMIN' ? ' Administrators see their organization under Tenant admin › Organization.' : ' The backend refuses its requests either way.'}`}
          />
        </section>
      </div>
    )
  }
  return children
}
