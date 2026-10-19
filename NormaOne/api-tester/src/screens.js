import { Bell, Bookmark, BookOpen, Building, Building2, CreditCard, Gauge, History, KeyRound, Megaphone, ScrollText, ShieldCheck, SquareTerminal, UserRound, Users, UsersRound } from 'lucide-react'
import Auth from './pages/account/Auth.jsx'
import Me from './pages/account/Me.jsx'
import Onboarding from './pages/account/Onboarding.jsx'
import SetPassword from './pages/account/SetPassword.jsx'
import MyOrganization from './pages/account/MyOrganization.jsx'
import Inbox from './pages/account/Inbox.jsx'
import InboxDetail from './pages/account/InboxDetail.jsx'
import Organization from './pages/tenant/Organization.jsx'
import TenantUsers from './pages/tenant/Users.jsx'
import TenantUserDetail from './pages/tenant/UserDetail.jsx'
import TenantNotifications from './pages/tenant/Notifications.jsx'
import TenantNotificationDetail from './pages/tenant/NotificationDetail.jsx'
import TenantPlans from './pages/tenant/Plans.jsx'
import TenantAudit from './pages/tenant/Audit.jsx'
import Plans from './pages/platform/Plans.jsx'
import PlanDetail from './pages/platform/PlanDetail.jsx'
import PlanRequests from './pages/platform/PlanRequests.jsx'
import PlanRequestDetail from './pages/platform/PlanRequestDetail.jsx'
import PlanHistory from './pages/platform/PlanHistory.jsx'
import SuperAdmins from './pages/platform/SuperAdmins.jsx'
import SuperAdminDetail from './pages/platform/SuperAdminDetail.jsx'
import Dashboard from './pages/platform/Dashboard.jsx'
import Admins from './pages/platform/Admins.jsx'
import AdminDetail from './pages/platform/AdminDetail.jsx'
import Audit from './pages/platform/Audit.jsx'
import Tenants from './pages/platform/Tenants.jsx'
import TenantDetail from './pages/platform/TenantDetail.jsx'
import PlatformUsers from './pages/platform/Users.jsx'
import PlatformUserDetail from './pages/platform/UserDetail.jsx'
import PlatformNotifications from './pages/platform/Notifications.jsx'
import PlatformNotificationDetail from './pages/platform/NotificationDetail.jsx'
import Console from './pages/workbench/Console.jsx'
import Endpoints from './pages/workbench/Endpoints.jsx'
import Saved from './pages/workbench/Saved.jsx'
import HistoryScreen from './pages/workbench/History.jsx'
import { moduleSlug, screenPath } from './paths.js'

/**
 * Every screen this app has, in the shape the navigation reads it: surface, then module, then
 * submodule — the reference tester's three levels.
 *
 * THE SURFACES ARE THE API'S OWN ACCESS RULES, not invented groupings. SecurityConfig decides who
 * may call what in exactly these four bands, so they are the outermost thing on screen:
 *
 *   1. ACCOUNT   /api/auth/** (public), /api/users/me, /api/onboarding/** (any valid token), and the
 *                member's own /api/organization and /api/notifications (ADMIN or USER).
 *   2. TENANT    /api/tenant/** — an ADMIN of an ACTIVE tenant. The tenant comes from the token's
 *                user record, never from the URL; there is no tenant id anywhere in these paths.
 *   3. PLATFORM  /api/super-admin/** — SUPER_ADMIN. Names the tenant, administrator or user in the URL.
 *                Administrators are managed; regular users are read only.
 *   4. WORKBENCH any request, built by hand, saved, and the history of what was sent.
 *
 * Mixing tenant and platform in one list would put "a user of MY tenant" next to "any user", which
 * are different endpoints with different answers — the same reason the reference keeps Platform
 * and School apart.
 *
 * The badges count catalogue endpoints, and they add up to LIVE_COUNT in config/endpoints.js.
 * smoke-test.mjs asserts that, so a badge cannot drift from the catalogue unnoticed.
 */
export const SURFACES = [
  {
    id: 'account',
    label: 'Account',
    note: 'Sign-up is public; the rest needs any valid token and no role.',
    modules: [
      {
        id: 'auth',
        label: 'Sign up & in',
        icon: KeyRound,
        submodules: [
          // Register, verify (with resend) and log in, one step at a time on one screen; the session
          // status, refresh and logout are the top bar's Session control. Seven endpoints.
          { id: 'auth', label: 'Auth', endpoints: 7, group: 'Auth', screen: Auth },
          // Reached only from a login that answered NEW_PASSWORD_REQUIRED, so it is not a tab: an
          // address of its own (a reload keeps the page), hidden from the module's navbar.
          { id: 'set-password', label: 'Set password', endpoints: 2, group: 'Auth', screen: SetPassword, hidden: true },
        ],
      },
      {
        id: 'me',
        label: 'Me',
        icon: UserRound,
        submodules: [
          // Who am I, onboarding status, and the module catalogue the profile's modules are read against.
          // Who am I, onboarding status, the module catalogue, and the own email preference (read, set).
          { id: 'profile', label: 'Profile & status', endpoints: 5, group: 'Account', screen: Me },
          { id: 'onboarding', label: 'Onboarding', endpoints: 1, group: 'Account', screen: Onboarding },
        ],
      },
      {
        // An ordinary member's read of their own organization. Administrators have the fuller view
        // (user count, package) under Tenant admin › Organization, so the tab is the USER's alone.
        id: 'organization',
        label: 'My organization',
        icon: Building2,
        role: 'USER',
        submodules: [
          { id: 'overview', label: 'My organization', endpoints: 1, group: 'Account', screen: MyOrganization },
        ],
      },
      {
        // The signed-in member's own notifications. Both tenant roles have an inbox; a Super Admin,
        // with no tenant, has none.
        id: 'notifications',
        label: 'Notifications',
        icon: Bell,
        role: ['ADMIN', 'USER'],
        submodules: [
          {
            id: 'inbox',
            label: 'Inbox',
            // Two here (inbox, unread count) and three on a notification's page (open, read state, attachment).
            endpoints: 5,
            group: 'Account',
            screen: Inbox,
            detail: { param: 'notificationId', screen: InboxDetail },
          },
        ],
      },
    ],
  },
  {
    id: 'tenant',
    label: 'Tenant admin',
    note: 'ADMIN of an ACTIVE tenant. The tenant is read from the token, never the URL.',
    modules: [
      {
        id: 'organization',
        label: 'Organization',
        icon: Building2,
        submodules: [
          { id: 'overview', label: 'Organization & package', endpoints: 2, group: 'Tenant admin', screen: Organization },
        ],
      },
      {
        id: 'users',
        label: 'Users',
        icon: Users,
        submodules: [
          {
            id: 'users',
            label: 'Users',
            // Two here (list, invite) and ten on a user's own page (open, update, status, resend, read,
            // set, set one, revoke one module, and read and set the email preference).
            endpoints: 12,
            group: 'Tenant admin',
            screen: TenantUsers,
            detail: { param: 'userId', screen: TenantUserDetail },
          },
        ],
      },
      {
        id: 'notifications',
        label: 'Notifications',
        icon: Megaphone,
        submodules: [
          {
            id: 'notifications',
            label: 'Notifications',
            // Two here (list, send) and six on a notification's page (open, edit, archive, and the
            // attachment's replace, remove and download).
            endpoints: 8,
            group: 'Tenant admin',
            screen: TenantNotifications,
            detail: { param: 'notificationId', screen: TenantNotificationDetail },
          },
        ],
      },
      {
        id: 'plans',
        label: 'Plans',
        icon: CreditCard,
        submodules: [
          // The catalogue, one plan, and request, list, open and cancel requests. The current
          // subscription (My package) is counted under Organization.
          { id: 'plans', label: 'Plans & subscription', endpoints: 6, group: 'Tenant admin', screen: TenantPlans },
        ],
      },
      {
        id: 'audit',
        label: 'Audit log',
        icon: ScrollText,
        submodules: [
          { id: 'audit', label: 'Audit log', endpoints: 1, group: 'Tenant admin', screen: TenantAudit },
        ],
      },
    ],
  },
  {
    id: 'platform',
    label: 'Super admin',
    note: 'SUPER_ADMIN: a platform account with no tenant. Names the tenant or user in the URL.',
    modules: [
      {
        id: 'overview',
        label: 'Overview',
        icon: Gauge,
        submodules: [
          { id: 'dashboard', label: 'Dashboard', endpoints: 1, group: 'Super admin', screen: Dashboard },
        ],
      },
      {
        id: 'tenants',
        label: 'Tenants',
        icon: Building,
        submodules: [
          {
            id: 'tenants',
            label: 'Tenants',
            // Two here (list, create) and six on a tenant's page (open, update, status, package,
            // change the plan, subscription history).
            endpoints: 8,
            group: 'Super admin',
            screen: Tenants,
            detail: { param: 'tenantId', screen: TenantDetail },
          },
        ],
      },
      {
        id: 'admins',
        label: 'Administrators',
        icon: ShieldCheck,
        submodules: [
          {
            id: 'admins',
            label: 'Administrators',
            // Two here (list, invite) and eight on an administrator's page (open, update, status,
            // resend, and read, set, set one, revoke one module).
            endpoints: 10,
            group: 'Super admin',
            screen: Admins,
            detail: { param: 'adminId', screen: AdminDetail },
          },
        ],
      },
      {
        id: 'super-admins',
        label: 'Super Admins',
        icon: KeyRound,
        submodules: [
          {
            id: 'super-admins',
            label: 'Super Admins',
            // Two here (list, add) and three on an account's page (open, remove or restore, resend).
            endpoints: 5,
            group: 'Super admin',
            screen: SuperAdmins,
            detail: { param: 'superAdminId', screen: SuperAdminDetail },
          },
        ],
      },
      {
        id: 'plans',
        label: 'Plans',
        icon: CreditCard,
        submodules: [
          {
            id: 'plans',
            label: 'Plans',
            // Two here (list, create) and four on a plan's page (open, edit, status, subscriptions).
            endpoints: 6,
            group: 'Super admin',
            screen: Plans,
            detail: { param: 'planId', screen: PlanDetail },
          },
          {
            id: 'requests',
            label: 'Change requests',
            // The list here, and open, approve and reject on a request's page.
            endpoints: 4,
            group: 'Super admin',
            screen: PlanRequests,
            detail: { param: 'requestId', screen: PlanRequestDetail },
          },
          { id: 'history', label: 'Plan history', endpoints: 1, group: 'Super admin', screen: PlanHistory },
        ],
      },
      {
        id: 'users',
        label: 'Users',
        icon: UsersRound,
        submodules: [
          {
            id: 'users',
            label: 'Users (read only)',
            // One here (list) and one on a user's page (open). Nothing else exists: the Super Admin
            // views regular users and never changes them.
            endpoints: 2,
            group: 'Super admin',
            screen: PlatformUsers,
            detail: { param: 'userId', screen: PlatformUserDetail },
          },
        ],
      },
      {
        id: 'audit',
        label: 'Audit',
        icon: ScrollText,
        submodules: [
          { id: 'audit', label: 'Audit trail', endpoints: 1, group: 'Super admin', screen: Audit },
        ],
      },
      {
        id: 'notifications',
        label: 'Notifications',
        icon: Megaphone,
        submodules: [
          {
            id: 'notifications',
            label: 'Notifications',
            // Two here (list, send) and six on a notification's page (open, edit, archive, and the
            // attachment's replace, remove and download).
            endpoints: 8,
            group: 'Super admin',
            screen: PlatformNotifications,
            detail: { param: 'notificationId', screen: PlatformNotificationDetail },
          },
        ],
      },
    ],
  },
  {
    id: 'workbench',
    label: 'Workbench',
    note: 'Any request by hand: build it, save it, send it again.',
    // No endpoint badges: every endpoint is reachable from all four, so a count would say nothing.
    modules: [
      { id: 'console', label: 'Console', icon: SquareTerminal, submodules: [{ id: 'console', label: 'Request console', screen: Console }] },
      { id: 'endpoints', label: 'Endpoints', icon: BookOpen, submodules: [{ id: 'endpoints', label: 'Endpoint reference', screen: Endpoints }] },
      { id: 'saved', label: 'Saved', icon: Bookmark, submodules: [{ id: 'saved', label: 'Saved requests', screen: Saved }] },
      { id: 'history', label: 'History', icon: History, submodules: [{ id: 'history', label: 'History', screen: HistoryScreen }] },
    ],
  },
]

export { detailPath, moduleSlug, screenPath } from './paths.js'

const sum = (submodules) => {
  const counted = submodules.filter((one) => Number.isFinite(one.endpoints))
  return counted.length ? counted.reduce((total, one) => total + one.endpoints, 0) : null
}

/** Every module, flattened, for the side panel. Each one knows where its first screen is. */
export const MODULE_LINKS = SURFACES.flatMap((surface) =>
  surface.modules.map((module) => ({
    surfaceId: surface.id,
    surfaceLabel: surface.label,
    moduleId: module.id,
    label: module.label,
    icon: module.icon,
    slug: moduleSlug(surface.id, module.id),
    role: module.role ?? null,
    to: screenPath(surface.id, module.id, module.submodules[0].id),
    endpoints: sum(module.submodules),
  })),
)

/** Every address, flattened, for the router. A submodule with a `detail` contributes two. */
export const ROUTES = SURFACES.flatMap((surface) =>
  surface.modules.flatMap((module) =>
    module.submodules.flatMap((submodule) => {
      const list = {
        path: screenPath(surface.id, module.id, submodule.id),
        surface,
        module,
        submodule,
        screen: submodule.screen,
      }
      if (!submodule.detail) return [list]
      return [list, {
        path: `${list.path}/:${submodule.detail.param}`,
        surface,
        module,
        submodule,
        screen: submodule.detail.screen,
      }]
    }),
  ),
)

/** The module a path belongs to, so the body navbar knows which submodules to offer. */
export function moduleForPath(pathname) {
  const slug = pathname.split('/')[1]
  for (const surface of SURFACES) {
    for (const module of surface.modules) {
      if (moduleSlug(surface.id, module.id) === slug) return { surface, module }
    }
  }
  return null
}
