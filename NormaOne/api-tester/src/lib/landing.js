/**
 * Where an account belongs, from GET /api/users/me — the only source of truth for onboarding.
 *
 * The fields are the backend's own (UserProfileResponse): requiresTenantSetup, onboardingStatus
 * (NOT_STARTED · IN_PROGRESS · COMPLETED · PLATFORM_ACCOUNT) and effectiveRole (SUPER_ADMIN · ADMIN ·
 * USER, or absent while the account cannot act). Nothing here is remembered between page loads: the
 * profile is fetched again whenever the app establishes the session.
 */

import { screenPath } from '../paths.js'

export const ONBOARDING_PATH = screenPath('account', 'me', 'onboarding')
export const PROFILE_PATH = screenPath('account', 'me', 'profile')
export const SIGN_IN_PATH = screenPath('account', 'auth', 'auth')
export const SET_PASSWORD_PATH = screenPath('account', 'auth', 'set-password')

/**
 * Whether the account still has to create its organization. IN_PROGRESS is a tenant stuck in
 * PROVISIONING, which the owner recovers by submitting onboarding again — so it counts too.
 */
export function needsOnboarding(me) {
  if (!me) return false
  if (me.accountType === 'PLATFORM' || me.onboardingStatus === 'PLATFORM_ACCOUNT' || me.effectiveRole === 'SUPER_ADMIN') {
    return false
  }
  return me.requiresTenantSetup === true || me.onboardingStatus === 'NOT_STARTED' || me.onboardingStatus === 'IN_PROGRESS'
}

/** The address to land on after signing in or onboarding. */
export function landingFor(me) {
  if (!me) return SIGN_IN_PATH
  if (needsOnboarding(me)) return ONBOARDING_PATH
  switch (me.effectiveRole) {
    case 'SUPER_ADMIN': return screenPath('platform', 'overview', 'dashboard')
    case 'ADMIN': return screenPath('tenant', 'organization', 'overview')
    // A USER, or an account that cannot act right now (suspended, or its tenant is): its own
    // profile, which says which.
    default: return PROFILE_PATH
  }
}

/**
 * Surfaces an account with unfinished onboarding may not open: everything that needs a role. The
 * account surface (sign-in, profile, onboarding itself) and the workbench stay open — the workbench
 * is a raw API tool, and the backend refuses what the account may not do whatever the page allows.
 */
export const GATED_SURFACES = ['tenant', 'platform']

/** The role each gated surface is for. Everything else is open to any account. */
export const SURFACE_ROLE = { tenant: 'ADMIN', platform: 'SUPER_ADMIN' }

/**
 * Whether the signed-in account has `role` (none needed: true). True or false once the profile is
 * known, null while signed out or not yet checked — then everything is shown, as a tester should, and
 * the backend answers for itself. Hiding is convenience; the backend enforces the same rules.
 */
export function roleAllowed(role, account) {
  if (!role || (Array.isArray(role) && !role.length)) return true
  if (!account?.checked || !account.session?.authenticated || !account.me) return null
  return Array.isArray(role) ? role.includes(account.me.effectiveRole) : account.me.effectiveRole === role
}

/** A role rule in words: "USER", or "ADMIN or USER". */
export const roleLabel = (role) => (Array.isArray(role) ? role.join(' or ') : role)

/** Whether the account's role may use a surface (tenant: ADMIN, platform: SUPER_ADMIN). */
export function surfaceAllowed(surfaceId, account) {
  return roleAllowed(SURFACE_ROLE[surfaceId], account)
}

/**
 * The same for one module that is narrower than its surface — My organization (USER) and
 * Notifications (ADMIN or USER) on the open account surface. `role` is the module's own (screens.js):
 * one role, a list of roles, or none for open.
 */
export const moduleAllowed = (link, account) => roleAllowed(link?.role, account)
