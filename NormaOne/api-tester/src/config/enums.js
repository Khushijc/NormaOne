/**
 * The backend's enums, mirrored, so a form offers exactly the values the API accepts.
 *
 * Each list is the enum's constant names, in declaration order, because that is what Jackson reads
 * and writes — none of these enums has a @JsonValue. `ES_ES` is sent, never `es-ES`, and a bare
 * `ES` is refused with 400 naming the field (GlobalExceptionHandler.notReadableMessage).
 *
 * Source of truth: backend/src/main/java/com/NormaOne/backend/model/core/enums/. Recheck these
 * there when the backend adds a value; a value missing here is still reachable from the console.
 */

/** CountryCode. */
export const COUNTRY_CODES = ['IN', 'US', 'ES', 'GB', 'MX', 'CA']

/** TenantLocale — name and the BCP 47 tag it stands for. */
export const LOCALES = [
  { value: 'EN_IN', label: 'EN_IN (en-IN)' },
  { value: 'EN_US', label: 'EN_US (en-US)' },
  { value: 'ES_ES', label: 'ES_ES (es-ES)' },
  { value: 'ES_MX', label: 'ES_MX (es-MX)' },
]

/** TenantTimeZone — name and the IANA zone it stands for. */
export const TIME_ZONES = [
  { value: 'ASIA_KOLKATA', label: 'ASIA_KOLKATA (Asia/Kolkata)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'AMERICA_NEW_YORK', label: 'AMERICA_NEW_YORK (America/New_York)' },
  { value: 'EUROPE_MADRID', label: 'EUROPE_MADRID (Europe/Madrid)' },
]

/** TenantStatus. PATCH …/status only accepts ACTIVE and SUSPENDED; the others are read-only. */
export const TENANT_STATUSES = ['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DELETED']
export const TENANT_STATUS_TARGETS = ['ACTIVE', 'SUSPENDED']

/** UserStatus. INVITED is set by the backend, never sent. */
export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']
export const USER_STATUS_TARGETS = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED']

/**
 * UserRole as a filter. The three canonical roles only: the legacy values (PLATFORM_ADMIN,
 * TENANT_ADMIN, HR_MANAGER, …) are folded into these by the search itself.
 */
export const ROLE_FILTERS = ['SUPER_ADMIN', 'ADMIN', 'USER']

/** The roles a tenant API will assign. SUPER_ADMIN is refused with 403, anything else with 400. */
export const ASSIGNABLE_ROLES = ['USER', 'ADMIN']

/** AuditAction, for the audit trail's filter. */
export const AUDIT_ACTIONS = [
  'TENANT_ONBOARDED', 'TENANT_CREATED', 'TENANT_UPDATED', 'TENANT_STATUS_CHANGED', 'USER_INVITED', 'USER_LINKED',
  'USER_UPDATED', 'USER_ROLE_CHANGED', 'USER_STATUS_CHANGED', 'USER_INVITATION_RESENT', 'ADMIN_PERMISSIONS_CHANGED',
  'USER_MODULE_ACCESS_CHANGED', 'SUPER_ADMIN_PROVISIONED', 'PACKAGE_ASSIGNED', 'PACKAGE_CHANGED', 'PLAN_CREATED', 'PLAN_UPDATED',
  'PLAN_STATUS_CHANGED', 'PLAN_CHANGE_REQUESTED', 'PLAN_CHANGE_APPROVED', 'PLAN_CHANGE_REJECTED', 'PLAN_CHANGE_CANCELLED',
  'NOTIFICATION_CREATED', 'NOTIFICATION_UPDATED', 'NOTIFICATION_ARCHIVED', 'NOTIFICATION_RESTORED', 'USER_EMAIL_PREFERENCE_CHANGED',
]

/** The actions a Tenant Admin's own audit log can hold (platform-only actions never carry a tenant). */
export const TENANT_AUDIT_ACTIONS = AUDIT_ACTIONS.filter((action) =>
  !['TENANT_CREATED', 'ADMIN_PERMISSIONS_CHANGED', 'SUPER_ADMIN_PROVISIONED', 'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_STATUS_CHANGED'].includes(action))

/** PlanStatus, and the moves PATCH /plans/{id}/status allows from each (PlanAdminService). */
export const PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']
export const PLAN_STATUS_MOVES = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['INACTIVE', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
}

/** BillingCycle. */
export const BILLING_CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY']

/** ModuleApps a plan can include: the NORMAONE portal and the six application modules. */
export const PLAN_MODULES = ['NORMAONE', 'FACTURAFLOW', 'JORNADAPULSE', 'DATOSPILOT', 'PREVENWORK', 'BUZONDESK', 'SAFEVOICE']

/** PlanHistoryEventType. */
export const PLAN_HISTORY_EVENTS = ['PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_STATUS_CHANGED', 'TENANT_PLAN_CHANGED',
  'PLAN_CHANGE_REQUESTED', 'PLAN_CHANGE_APPROVED', 'PLAN_CHANGE_REJECTED', 'PLAN_CHANGE_CANCELLED']

/** PlanChangeRequestStatus. PROCESSING lasts only while an approval is being applied. */
export const PLAN_REQUEST_STATUSES = ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELLED']

/** Badge tones, shared by every list so a status reads the same colour everywhere. */
export const STATUS_TONE = {
  ACTIVE: 'good',
  PROVISIONING: 'warn',
  INVITED: 'warn',
  SUSPENDED: 'bad',
  DEACTIVATED: 'bad',
  DELETED: 'bad',
  ARCHIVED: 'warn',
  DRAFT: 'warn',
  INACTIVE: 'bad',
  PENDING: 'warn',
  PROCESSING: 'warn',
  APPROVED: 'good',
  REJECTED: 'bad',
  CANCELLED: 'bad',
  SENT: 'good',
  FAILED: 'bad',
}
