/**
 * The NormaOne endpoints this tester covers: 92, in twelve controllers. (The cross-tenant account
 * directory and the notification-recipient endpoints are documented in docs/AUTH_RBAC_GUIDE.md and
 * the Postman collection and are not in this catalogue yet.)
 *
 * WRITTEN FROM THE SOURCE, NOT FROM MEMORY. The reference tester generates this file from its
 * Postman collection; NormaOne's collection covers the happy path only, so each entry here was read
 * out of the controller (method, path, status), its request DTO (fields, limits), the service
 * (every refusal it throws), SecurityConfig (who may call it) and docs/AUTH_RBAC_GUIDE.md.
 * When a controller changes, change its entry here — the smoke test counts them against this list.
 *
 * `access` is the rule SecurityConfig applies before the controller runs:
 *   public       /api/auth/**. No role needed; the backend ignores the session cookie there,
 *                and a Bearer header on a permitAll path is still validated, so an expired one would
 *                turn a public login into a 401.
 *   token        /api/onboarding/**, /api/users/me — any valid Cognito ID or access token.
 *   member       /api/organization, /api/notifications/** — an ADMIN or USER of an ACTIVE tenant (its own only).
 *   ADMIN        /api/tenant/** — an ACTIVE tenant administrator of an ACTIVE tenant.
 *   SUPER_ADMIN  /api/super-admin/** — an ACTIVE platform account (no tenantId).
 *
 * Every error body is {timestamp, status, error, message, path[, fieldErrors]}. There is no
 * machine-readable `code` field, so the tester shows `message`.
 */

const UNAUTHORIZED = { status: 401, when: 'No token, or the token is invalid, expired, or issued for another app client.' }
const NEEDS_ADMIN = {
  status: 403,
  when: 'The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization).',
}
const NEEDS_SUPER_ADMIN = { status: 403, when: 'The token is valid but the caller is not SUPER_ADMIN.' }
const VALIDATION = { status: 400, when: 'A field fails validation — fieldErrors names it.' }
const BAD_ENUM = { status: 400, when: 'An enum field has a value the backend does not have; the message lists the allowed ones.' }

const PAGING = [
  { key: 'page', value: '0', enabled: true, description: '0-based page index.' },
  { key: 'size', value: '20', enabled: true, description: '1 to 100.' },
]

const USER_RESPONSE = ['id', 'tenantId', 'name', 'email', 'phoneNumber', 'status', 'roles', 'effectiveRole',
  'linked', 'invitedAt', 'activatedAt', 'deactivatedAt', 'statusReason', 'createdAt', 'updatedAt', 'moduleAccess', 'modulePermissions']
// One module of a user's access, with only that module's permissions (ModuleAssignmentView).
// entitled is true for every module while plan entitlement is not enforced; inPlan only reports the plan.
const MODULE_VIEW = '{ moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions }'
const MODULE_ACCESS_RESPONSE = ['userId', 'active', 'planEnforced', 'assignedAt', `modules: [ ${MODULE_VIEW} ] (all six)`, 'assignedModules',
  'assignedPermissions', 'entitledModules', 'planModules', 'effectiveModules', 'effectivePermissions']
const MODULE_ERRORS = [
  { status: 400, when: 'NORMAONE or an unknown module, an unknown permission, or a permission of another module (the message names it).' },
]
const TENANT_RESPONSE = ['id', 'tenantName', 'accountHolderName', 'subdomain', 'logoUrl', 'phoneNumber',
  'emailAddress', 'defaultLocale', 'defaultTimeZone', 'addressLine', 'city', 'postalCode', 'countryCode',
  'status', 'activatedAt', 'suspendedAt', 'statusReason', 'createdAt', 'updatedAt', 'packageCode',
  'userCount', 'packageInfo']
const PACKAGE_RESPONSE = ['tenantId', 'subscriptionId', 'status', 'assignmentSource', 'startDate',
  'currentPeriodStart', 'currentPeriodEnd', 'agreedPrice', 'currencyCode', 'billingCycle', 'assignedAt',
  'plan { planId, planCode, planVersion, name, description, status, defaultPlan, listPrice, currencyCode, billingCycle, trialDays, maxEmployees, moduleApps }']
const ADMIN_RESPONSE = ['id', 'name', 'email', 'phoneNumber', 'role', 'status',
  'linked', 'organization { id, name, subdomain, status }', 'invitedAt', 'activatedAt', 'deactivatedAt', 'statusReason', 'createdAt', 'updatedAt',
  'moduleAccess', 'modulePermissions']
const PLATFORM_USER_RESPONSE = ['id', 'name', 'email', 'role', 'status', 'linked', 'organization { id, name, subdomain, status }',
  'invitedAt', 'activatedAt', 'deactivatedAt', 'statusReason', 'createdAt', 'updatedAt']
const PAGE_OF = (fields) => [`content: [ { ${fields.slice(0, 6).join(', ')}, … } ]`, 'page', 'size', 'totalElements', 'totalPages']
const AUDIT_PAGE = PAGE_OF(['id', 'action', 'occurredAt', 'actorUserId', 'actorRole', 'tenantId', 'targetType', 'targetId', 'details'])
const AUDIT_EXTRA_FILTERS = [
  { key: 'targetType', value: 'USER', enabled: false, description: 'USER, TENANT, PLAN, SUBSCRIPTION, PLAN_CHANGE_REQUEST, NOTIFICATION.' },
  { key: 'from', value: '2026-10-01T00:00:00Z', enabled: false, description: 'ISO-8601 instant, inclusive.' },
  { key: 'to', value: '2026-12-31T23:59:59Z', enabled: false, description: 'ISO-8601 instant, inclusive.' },
]

const GROUP_AUTH = {
  id: 'auth',
  module: 'Auth',
  controller: 'AuthController',
  endpoints: [
    {
      id: 'register',
      name: 'Register',
      method: 'POST',
      path: '/api/auth/register',
      access: 'public',
      summary: 'Starts a Cognito sign-up. Cognito emails a verification code. No user record is written yet.',
      requiredFields: ['name', 'email', 'password'],
      fields: 'name ≤100 · email ≤254 · password 8–256 (and Cognito\'s own password policy)',
      body: `{
  "name": "Ana Admin",
  "email": "ana@example.com",
  "password": "ChangeMe123!"
}`,
      successStatus: 202,
      responseFields: ['message'],
      errors: [
        VALIDATION,
        { status: 400, when: 'Cognito rejects the password (InvalidPassword) — its message says which rule.' },
        { status: 409, when: 'An account with this email already exists.' },
        { status: 429, when: 'Too many attempts.' },
      ],
    },
    {
      id: 'verify-email',
      name: 'Verify email',
      method: 'POST',
      path: '/api/auth/verify-email',
      access: 'public',
      summary: 'Confirms the emailed code. With a password it also signs in, setting the session cookies like Login.',
      requiredFields: ['email', 'code'],
      fields: 'email ≤254 · code ≤20 · password optional, 8–256',
      body: `{
  "email": "ana@example.com",
  "code": "123456"
}`,
      successStatus: 200,
      responseFields: ['message', 'verified', '— or, with password: tokenType "Cookie", expiresAt, requiresTenantSetup (+ Set-Cookie)'],
      errors: [
        VALIDATION,
        { status: 400, when: 'Wrong code (CodeMismatch) or an expired one (ExpiredCode).' },
        { status: 404, when: 'No Cognito user has this email.' },
        { status: 409, when: 'The account is already verified.' },
        { status: 429, when: 'Too many attempts.' },
      ],
    },
    {
      id: 'resend-code',
      name: 'Resend code',
      method: 'POST',
      path: '/api/auth/resend-code',
      access: 'public',
      summary: 'Sends a new verification code.',
      requiredFields: ['email'],
      fields: 'email ≤254',
      body: `{
  "email": "ana@example.com"
}`,
      successStatus: 200,
      responseFields: ['message'],
      errors: [
        VALIDATION,
        { status: 404, when: 'No Cognito user has this email.' },
        { status: 409, when: 'The account is already confirmed.' },
        { status: 429, when: 'Too many attempts.' },
      ],
    },
    {
      id: 'login',
      name: 'Login',
      method: 'POST',
      path: '/api/auth/login',
      access: 'public',
      summary: 'Cognito USER_PASSWORD_AUTH through the backend. Sets the session as HttpOnly cookies; the body carries no token.',
      requiredFields: ['email', 'password'],
      fields: 'email · password ≤256',
      body: `{
  "email": "ana@example.com",
  "password": "ChangeMe123!"
}`,
      successStatus: 200,
      responseFields: ['tokenType: "Cookie"', 'expiresAt', 'requiresTenantSetup (always true: read GET /api/users/me instead)',
        'or, for an invited account\'s temporary password: challenge "NEW_PASSWORD_REQUIRED", no session, the HttpOnly NORMAONE_CHALLENGE cookie — continue with POST /api/auth/new-password',
        'Set-Cookie: NORMAONE_SESSION (ID token, HttpOnly, SameSite=Strict, Path=/api)', 'Set-Cookie: NORMAONE_REFRESH (HttpOnly, Path=/api/auth)'],
      notes: 'The tokens go into HttpOnly cookies the page cannot read. A non-browser client sends X-Token-Delivery: body to receive accessToken, idToken and refreshToken in the body instead (and no cookies), then uses Authorization: Bearer <idToken>. Every /api/auth request needs X-Requested-With (CSRF); this app adds it.',
      errors: [
        VALIDATION,
        { status: 400, when: 'USER_PASSWORD_AUTH is not enabled on the Cognito app client.' },
        { status: 401, when: 'Wrong email or password, or an expired temporary password (the message says to ask for the invitation again).' },
        { status: 403, when: 'The email is not verified yet.' },
        { status: 404, when: 'No Cognito user has this email.' },
        { status: 429, when: 'Too many attempts.' },
      ],
    },
    {
      id: 'auth-new-password',
      name: 'Set permanent password',
      method: 'POST',
      path: '/api/auth/new-password',
      access: 'public',
      summary: 'Completes an invited account\'s first login: answers Cognito\'s NEW_PASSWORD_REQUIRED challenge and only then sets the session cookies.',
      requiredFields: ['email', 'newPassword'],
      fields: 'email · newPassword 8–256 and the user pool\'s policy · session only for a non-browser client (the browser\'s challenge is the HttpOnly NORMAONE_CHALLENGE cookie)',
      body: `{
  "email": "uma@example.com",
  "newPassword": "Permanent#Pass456"
}`,
      successStatus: 200,
      responseFields: ['tokenType: "Cookie"', 'expiresAt', 'Set-Cookie: NORMAONE_SESSION, NORMAONE_REFRESH; NORMAONE_CHALLENGE cleared'],
      errors: [
        VALIDATION,
        { status: 400, when: 'Cognito\'s password policy refuses the new password — its own message says which rule.' },
        { status: 401, when: 'No challenge in progress, or it expired (3 minutes by default): sign in again with the temporary password.' },
        { status: 403, when: 'The X-Requested-With header is missing (CSRF).' },
      ],
    },
    {
      id: 'auth-password-policy',
      name: 'Password policy',
      method: 'GET',
      path: '/api/auth/password-policy',
      access: 'public',
      summary: 'The user pool\'s password rules, for the set-password page. source COGNITO when the backend may describe the pool, DEFAULT otherwise.',
      successStatus: 200,
      responseFields: ['minimumLength', 'requireUppercase', 'requireLowercase', 'requireNumbers', 'requireSymbols', 'temporaryPasswordValidityDays', 'source'],
      errors: [],
    },
    {
      id: 'auth-session',
      name: 'Session status',
      method: 'GET',
      path: '/api/auth/session',
      access: 'public',
      summary: 'Whether the browser\'s session cookie holds a valid token, for whom, until when — never the token itself. Always 200.',
      successStatus: 200,
      responseFields: ['authenticated', 'email', 'tokenUse', 'expiresAt', 'refreshAvailable', 'reason (NO_SESSION · INVALID_OR_EXPIRED)'],
      notes: 'Reads the HttpOnly cookies on the server. This app sends it with the session, unlike the other auth endpoints.',
      errors: [],
    },
    {
      id: 'auth-refresh',
      name: 'Refresh the session',
      method: 'POST',
      path: '/api/auth/refresh',
      access: 'public',
      summary: 'A new session cookie from the refresh cookie (Cognito REFRESH_TOKEN_AUTH). On failure both cookies are cleared.',
      successStatus: 200,
      responseFields: ['authenticated: true', 'tokenUse', 'expiresAt', 'refreshAvailable', 'Set-Cookie: NORMAONE_SESSION'],
      errors: [
        { status: 401, when: 'No refresh cookie, or Cognito says it expired or was revoked. The cookies are cleared: sign in again.' },
        { status: 403, when: 'The X-Requested-With header is missing (CSRF).' },
      ],
    },
    {
      id: 'auth-logout',
      name: 'Log out',
      method: 'POST',
      path: '/api/auth/logout',
      access: 'public',
      summary: 'Revokes the refresh token at Cognito (best effort) and clears both cookies. Safe when already signed out.',
      successStatus: 200,
      responseFields: ['authenticated: false', 'reason: LOGGED_OUT', 'Set-Cookie: both cookies with Max-Age=0'],
      errors: [{ status: 403, when: 'The X-Requested-With header is missing (CSRF).' }],
    },
  ],
}

const GROUP_ACCOUNT = {
  id: 'account',
  module: 'Account',
  controller: 'UserController, OnboardingController',
  endpoints: [
    {
      id: 'me',
      name: 'Who am I',
      method: 'GET',
      path: '/api/users/me',
      access: 'token',
      summary: 'The caller\'s own profile, onboarding state, effective role and module access. Links a pending invitation on first call.',
      successStatus: 200,
      responseFields: ['userId', 'cognitoSub', 'name', 'email', 'phoneNumber', 'status', 'roles',
        'tenantId', 'organizationName', 'subdomain', 'requiresTenantSetup', 'createdAt', 'onboardingStatus',
        'accountType', 'effectiveRole', 'tenantStatus', 'modules: [moduleId] (usable now)', 'modulePermissions: [permissionId]'],
      notes: 'Before onboarding there is no user record: the answer is onboardingStatus NOT_STARTED with requiresTenantSetup true, not a 404. '
        + 'modules is just the ids of the modules the account can use now (assigned and the account active — the plan does not block a module while plan entitlement is not enforced), e.g. ["FACTURAFLOW", "JORNADAPULSE"]: navigation shows these. '
        + 'modulePermissions is every module permission the backend allows now. The per-module detail is on the administrators\' module routes. There is no separate general permission list. A Super Admin has no modules.',
      errors: [UNAUTHORIZED],
    },
    {
      id: 'onboarding-status',
      name: 'Onboarding status',
      method: 'GET',
      path: '/api/onboarding/status',
      access: 'token',
      summary: 'Whether the caller still has to create an organization, and what they are once they have.',
      successStatus: 200,
      responseFields: ['onboardingCompleted', 'onboardingStatus', 'requiresTenantSetup', 'accountType', 'userStatus',
        'role', 'tenantId', 'tenantStatus', 'packageCode', 'subscriptionStatus'],
      errors: [UNAUTHORIZED],
    },
    {
      id: 'onboard-tenant',
      name: 'Create my organization',
      method: 'POST',
      path: '/api/onboarding/tenant',
      access: 'token',
      summary: 'Creates the tenant, makes the caller its ADMIN and assigns the BASIC package. Idempotent for the same subdomain.',
      requiredFields: ['organizationName', 'subdomain', 'countryCode'],
      fields: 'organizationName ≤100 · subdomain 2–50, lowercase letters, digits, inner hyphens · countryCode enum · '
        + 'defaultLocale / defaultTimeZone enums, defaulted from the country when absent · the rest optional',
      body: `{
  "organizationName": "Demo Spain SL",
  "subdomain": "demo-{{$timestamp}}",
  "countryCode": "ES",
  "defaultLocale": "ES_ES",
  "defaultTimeZone": "EUROPE_MADRID",
  "accountHolderName": "Ana Admin",
  "emailAddress": "ana@example.com",
  "phoneNumber": "+34 600 000 000",
  "addressLine": "Calle Mayor 10",
  "city": "Madrid",
  "postalCode": "28013"
}`,
      successStatus: 201,
      responseFields: ['tenantId', 'organizationName', 'subdomain', 'status', 'countryCode', 'defaultLocale',
        'defaultTimeZone', 'userId', 'userName', 'userEmail', 'userRoles', 'createdAt', 'packageCode',
        'subscriptionId', 'subscriptionStatus', '…'],
      notes: 'The administrator is always the caller, from the token. There is no initialAdmin field here — that is the Super Admin\'s create.',
      errors: [
        VALIDATION,
        BAD_ENUM,
        UNAUTHORIZED,
        { status: 403, when: 'The ID token says email_verified is false, or the caller is a platform account.' },
        { status: 409, when: 'The caller already belongs to an organization with a different subdomain.' },
        { status: 409, when: 'The subdomain is taken, or this organization\'s onboarding is still in progress.' },
        { status: 503, when: 'The default package (BASIC) is not available.' },
      ],
    },
    {
      id: 'organization-own',
      name: 'My organization',
      method: 'GET',
      path: '/api/organization',
      access: 'member',
      summary: 'The caller\'s own organization, read only. Takes no id: the organization comes from the caller\'s stored user record, so no URL, query or body can name another one.',
      successStatus: 200,
      responseFields: ['id', 'name', 'subdomain', 'countryCode', 'defaultLocale', 'defaultTimeZone', 'accountHolderName',
        'emailAddress', 'phoneNumber', 'addressLine', 'city', 'postalCode', 'logoUrl', 'status', 'createdAt'],
      notes: 'Less than the administrators\' GET /api/tenant: no user count, package or status history.',
      errors: [UNAUTHORIZED, { status: 403, when: 'Not a member of an organization: a Super Admin, an account not onboarded, or one whose organization is not ACTIVE.' }],
    },
    {
      id: 'modules-catalog',
      name: 'Module catalog',
      method: 'GET',
      path: '/api/modules',
      access: 'active',
      summary: 'The six application modules and the permissions defined for each, with the roles that get each permission by default.',
      successStatus: 200,
      responseFields: ['[ { id, order, name, label, description, requirementsDocumented, permissions: [ { id, module, action, label, description, defaultFor } ] } ]'],
      notes: 'Static and the same for everybody: what one account may use is in GET /api/users/me.',
      errors: [UNAUTHORIZED, { status: 403, when: 'The account has no active role (not onboarded, inactive, or its organization is not ACTIVE).' }],
    },
  ],
}

const GROUP_TENANT = {
  id: 'tenant',
  module: 'Tenant admin',
  controller: 'TenantController',
  endpoints: [
    {
      id: 'tenant-own',
      name: 'My organization',
      method: 'GET',
      path: '/api/tenant',
      access: 'ADMIN',
      summary: 'The caller\'s own tenant, with its user count and package.',
      successStatus: 200,
      responseFields: TENANT_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_ADMIN],
    },
    {
      id: 'tenant-package',
      name: 'My package',
      method: 'GET',
      path: '/api/tenant/package',
      access: 'ADMIN',
      summary: 'The caller\'s tenant\'s current subscription and plan.',
      successStatus: 200,
      responseFields: PACKAGE_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_ADMIN, { status: 404, when: 'The tenant has no current package.' }],
    },
    {
      id: 'tenant-audit-events',
      name: 'My organization\'s audit log',
      method: 'GET',
      path: '/api/tenant/audit-events',
      access: 'ADMIN',
      summary: 'Read only. The audit trail of the caller\'s own organization, newest first. The tenant filter comes from the caller\'s record and is part of the database query: there is no tenantId parameter, and one sent is ignored.',
      queryParams: [
        { key: 'action', value: 'USER_STATUS_CHANGED', enabled: false, description: 'An AuditAction, e.g. USER_INVITED, USER_MODULE_ACCESS_CHANGED, PLAN_CHANGE_REQUESTED.' },
        { key: 'actorUserId', value: '', enabled: false, description: 'Who did it.' },
        { key: 'targetId', value: '', enabled: false, description: 'One user, subscription or request id.' },
        ...AUDIT_EXTRA_FILTERS,
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: AUDIT_PAGE,
      notes: 'Platform-only events (plan definitions, Super Admin accounts) carry no tenant and never appear here.',
      errors: [UNAUTHORIZED, NEEDS_ADMIN, { status: 400, when: 'An unknown action, a bad date, to before from, or a bad page or size.' }],
    },
    {
      id: 'tenant-list-users',
      name: 'List my users',
      method: 'GET',
      path: '/api/tenant/users',
      access: 'ADMIN',
      summary: 'Users of the caller\'s tenant only. Search matches name or email.',
      queryParams: [
        { key: 'search', value: '', enabled: false, description: 'Name or email, ≤100.' },
        { key: 'status', value: 'ACTIVE', enabled: false, description: 'INVITED · ACTIVE · SUSPENDED · DEACTIVATED' },
        { key: 'role', value: 'ADMIN', enabled: false, description: 'SUPER_ADMIN · ADMIN · USER (legacy values fold in)' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(USER_RESPONSE),
      errors: [UNAUTHORIZED, NEEDS_ADMIN, { status: 400, when: 'A bad status, role, page or size.' }],
    },
    {
      id: 'tenant-create-user',
      name: 'Invite a user',
      method: 'POST',
      path: '/api/tenant/users',
      access: 'ADMIN',
      summary: 'An INVITED user in the caller\'s tenant. Cognito emails them a temporary password; their first sign-in must set a permanent one, and the record turns ACTIVE at their first signed-in request.',
      requiredFields: ['name', 'email'],
      fields: 'name ≤100 · email ≤254 · phoneNumber ≤30 · role USER (default) or ADMIN · moduleAccess, modulePermissions optional — '
        + 'when both are absent all six modules are assigned with the role\'s defaults (USER: VIEW; ADMIN: all but DELETE), never more than the caller holds',
      body: `{
  "name": "Uma User",
  "email": "uma+{{$timestamp}}@example.com",
  "role": "USER"
}`,
      successStatus: 201,
      responseFields: USER_RESPONSE,
      errors: [
        VALIDATION, UNAUTHORIZED, NEEDS_ADMIN, ...MODULE_ERRORS,
        { status: 400, when: 'role is anything but USER or ADMIN.' },
        { status: 403, when: 'role is SUPER_ADMIN, or a module permission the caller does not hold.' },
        { status: 409, when: 'A user with this email already exists in the organization.' },
      ],
    },
    {
      id: 'tenant-get-user',
      name: 'Open a user',
      method: 'GET',
      path: '/api/tenant/users/{userId}',
      access: 'ADMIN',
      summary: 'One user of the caller\'s tenant. Another tenant\'s user answers 404, not 403.',
      pathParams: [{ name: 'userId', description: 'The user document id.' }],
      successStatus: 200,
      responseFields: USER_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_ADMIN, { status: 404, when: 'No such user in this tenant.' }],
    },
    {
      id: 'tenant-update-user',
      name: 'Update a user',
      method: 'PATCH',
      path: '/api/tenant/users/{userId}',
      access: 'ADMIN',
      summary: 'Partial: name, phoneNumber, role. Only the fields sent change.',
      pathParams: [{ name: 'userId', description: 'The user document id.' }],
      fields: 'name 1–100 · phoneNumber ≤30 · role USER or ADMIN',
      body: `{
  "role": "ADMIN"
}`,
      successStatus: 200,
      responseFields: USER_RESPONSE,
      errors: [
        VALIDATION, UNAUTHORIZED, NEEDS_ADMIN,
        { status: 403, when: 'Changing your own role, assigning SUPER_ADMIN, or touching a platform account.' },
        { status: 404, when: 'No such user in this tenant.' },
        { status: 409, when: 'Demoting the last active ADMIN.' },
      ],
    },
    {
      id: 'tenant-user-status',
      name: 'Change a user\'s status',
      method: 'PATCH',
      path: '/api/tenant/users/{userId}/status',
      access: 'ADMIN',
      summary: 'ACTIVE, SUSPENDED or DEACTIVATED (removal is DEACTIVATED: the record and its history are kept). A reason is required to suspend or deactivate. Cognito follows: signed out on SUSPENDED, signed out and disabled on DEACTIVATED, re-enabled first on reactivation.',
      pathParams: [{ name: 'userId', description: 'The user document id.' }],
      requiredFields: ['status'],
      fields: 'status ACTIVE · SUSPENDED · DEACTIVATED · reason ≤500',
      body: `{
  "status": "SUSPENDED",
  "reason": "On leave"
}`,
      successStatus: 200,
      responseFields: USER_RESPONSE,
      errors: [
        VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_ADMIN,
        { status: 400, when: 'No reason when suspending or deactivating, or status INVITED.' },
        { status: 403, when: 'Changing your own status, or a platform account.' },
        { status: 404, when: 'No such user in this tenant.' },
        { status: 409, when: 'Already in that status; activating an invitation; suspending an invitation; or removing the last active ADMIN.' },
        { status: 502, when: 'Reactivating: Cognito could not re-enable the account. Nothing was changed.' },
      ],
      notes: 'An administrator is removed only by another administrator, and the organization always keeps one active ADMIN. The audit event records what Cognito did (details.identityProvider: DONE, FAILED, NO_ACCOUNT or SKIPPED).',
    },
    {
      id: 'tenant-resend-invitation',
      name: 'Resend an invitation',
      method: 'POST',
      path: '/api/tenant/users/{userId}/resend-invitation',
      access: 'ADMIN',
      summary: 'Cognito emails the pending user a new temporary password — also the fix for an expired one.',
      pathParams: [{ name: 'userId', description: 'The user document id.' }],
      successStatus: 200,
      responseFields: ['…the user', 'invitation { delivery, emailSent, message }'],
      errors: [
        UNAUTHORIZED, NEEDS_ADMIN,
        { status: 404, when: 'No such user in this tenant.' },
        { status: 409, when: 'The user is not INVITED, already has a Cognito password of their own, or temporary-password invitations are off.' },
        { status: 502, when: 'Cognito refused to resend it.' },
      ],
    },
    {
      id: 'tenant-user-modules',
      name: 'A user\'s modules',
      method: 'GET',
      path: '/api/tenant/users/{userId}/modules',
      access: 'ADMIN',
      summary: 'All six modules for one user of the caller\'s tenant: assigned or not, and the permissions in each.',
      pathParams: [{ name: 'userId', description: 'The user document id.' }],
      successStatus: 200,
      responseFields: MODULE_ACCESS_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_ADMIN, { status: 404, when: 'No such user in this tenant.' }],
    },
    {
      id: 'tenant-set-user-modules',
      name: 'Set a user\'s modules',
      method: 'PUT',
      path: '/api/tenant/users/{userId}/modules',
      access: 'ADMIN',
      summary: 'Replaces the whole assignment. Every permission added or removed must be one the caller holds.',
      pathParams: [{ name: 'userId', description: 'The user document id.' }],
      requiredFields: ['modules', 'permissions'],
      fields: 'modules: list of the six module ids ([] = none) · permissions: module permissions, each inside an assigned module',
      body: `{
  "modules": ["FACTURAFLOW", "JORNADAPULSE"],
  "permissions": ["FACTURAFLOW_VIEW", "JORNADAPULSE_VIEW", "JORNADAPULSE_CREATE"]
}`,
      successStatus: 200,
      responseFields: MODULE_ACCESS_RESPONSE,
      errors: [
        VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_ADMIN, ...MODULE_ERRORS,
        { status: 403, when: 'Your own account, a platform account, or a permission you do not hold.' },
        { status: 404, when: 'No such user in this tenant.' },
      ],
    },
    {
      id: 'tenant-set-user-module',
      name: 'Set one module',
      method: 'PUT',
      path: '/api/tenant/users/{userId}/modules/{moduleId}',
      access: 'ADMIN',
      summary: 'Assigns one module with exactly these permissions; the user\'s other modules are not touched.',
      pathParams: [
        { name: 'userId', description: 'The user document id.' },
        { name: 'moduleId', description: 'FACTURAFLOW · JORNADAPULSE · DATOSPILOT · PREVENWORK · BUZONDESK · SAFEVOICE' },
      ],
      requiredFields: ['permissions'],
      fields: 'permissions: that module\'s permissions only ([] keeps the module with none)',
      body: `{
  "permissions": ["JORNADAPULSE_VIEW", "JORNADAPULSE_CREATE"]
}`,
      successStatus: 200,
      responseFields: MODULE_ACCESS_RESPONSE,
      errors: [
        VALIDATION, UNAUTHORIZED, NEEDS_ADMIN, ...MODULE_ERRORS,
        { status: 403, when: 'Your own account, a platform account, or a permission you do not hold.' },
        { status: 404, when: 'No such user in this tenant.' },
      ],
    },
    {
      id: 'tenant-revoke-user-module',
      name: 'Revoke one module',
      method: 'DELETE',
      path: '/api/tenant/users/{userId}/modules/{moduleId}',
      access: 'ADMIN',
      summary: 'Removes the module and every permission in it. Applies to the user\'s next request.',
      pathParams: [
        { name: 'userId', description: 'The user document id.' },
        { name: 'moduleId', description: 'One of the six module ids.' },
      ],
      successStatus: 200,
      responseFields: MODULE_ACCESS_RESPONSE,
      errors: [
        UNAUTHORIZED, NEEDS_ADMIN, ...MODULE_ERRORS,
        { status: 403, when: 'Your own account, or the module holds a permission you do not (you cannot remove what you were not given).' },
        { status: 404, when: 'No such user in this tenant.' },
      ],
    },
  ],
}

const GROUP_PLATFORM = {
  id: 'platform',
  module: 'Super admin',
  controller: 'SuperAdminController',
  endpoints: [
    {
      id: 'sa-dashboard',
      name: 'Platform dashboard',
      method: 'GET',
      path: '/api/super-admin/dashboard',
      access: 'SUPER_ADMIN',
      summary: 'Organizations, administrators and regular users by status, Super Admins, and subscriptions by plan — each a database aggregation.',
      successStatus: 200,
      responseFields: ['totalOrganizations', 'organizationsByStatus', 'totalAdmins', 'activeAdmins', 'inactiveAdmins',
        'adminsByStatus', 'totalUsers', 'activeUsers', 'inactiveUsers', 'usersByStatus', 'totalSuperAdmins', 'currentSubscriptionsByPlan'],
      notes: 'Active is ACTIVE; inactive is SUSPENDED plus DEACTIVATED; INVITED is neither. /api/super-admin/summary is an alias of the same read.',
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN],
    },
    {
      id: 'sa-list-tenants',
      name: 'List tenants',
      method: 'GET',
      path: '/api/super-admin/tenants',
      access: 'SUPER_ADMIN',
      summary: 'Every tenant. Search matches name or subdomain.',
      queryParams: [
        { key: 'search', value: '', enabled: false, description: 'Name or subdomain, ≤100.' },
        { key: 'status', value: 'ACTIVE', enabled: false, description: 'PROVISIONING · ACTIVE · SUSPENDED · DELETED' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(TENANT_RESPONSE),
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 400, when: 'A bad status, page or size.' }],
    },
    {
      id: 'sa-create-tenant',
      name: 'Create a tenant',
      method: 'POST',
      path: '/api/super-admin/tenants',
      access: 'SUPER_ADMIN',
      summary: 'A tenant on BASIC with an INVITED administrator, whom Cognito emails a temporary password. If that email cannot be sent, the tenant is discarded (502).',
      requiredFields: ['organizationName', 'subdomain', 'countryCode', 'initialAdmin.name', 'initialAdmin.email'],
      fields: 'as onboarding, plus initialAdmin { name ≤100, email ≤254, phoneNumber ≤30 }',
      body: `{
  "organizationName": "Beta Iberia SL",
  "subdomain": "beta-{{$timestamp}}",
  "countryCode": "ES",
  "defaultLocale": "ES_ES",
  "defaultTimeZone": "EUROPE_MADRID",
  "initialAdmin": {
    "name": "Bea Admin",
    "email": "bea+{{$timestamp}}@example.com"
  }
}`,
      successStatus: 201,
      responseFields: TENANT_RESPONSE,
      errors: [
        VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 409, when: 'The subdomain is taken.' },
        { status: 503, when: 'The default package (BASIC) is not available.' },
      ],
    },
    {
      id: 'sa-get-tenant',
      name: 'Open a tenant',
      method: 'GET',
      path: '/api/super-admin/tenants/{tenantId}',
      access: 'SUPER_ADMIN',
      summary: 'One tenant, with user count and package.',
      pathParams: [{ name: 'tenantId', description: 'The tenant document id.' }],
      successStatus: 200,
      responseFields: TENANT_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such tenant.' }],
    },
    {
      id: 'sa-update-tenant',
      name: 'Update a tenant',
      method: 'PATCH',
      path: '/api/super-admin/tenants/{tenantId}',
      access: 'SUPER_ADMIN',
      summary: 'Partial: only the fields sent change. Subdomain, status and package are not editable here.',
      pathParams: [{ name: 'tenantId', description: 'The tenant document id.' }],
      fields: 'tenantName 1–100 · accountHolderName 1–100 · emailAddress · phoneNumber ≤30 · addressLine ≤255 · city ≤100 · postalCode ≤20 · logoUrl ≤500 · defaultLocale · defaultTimeZone',
      body: `{
  "tenantName": "Acme Global",
  "city": "Valencia"
}`,
      successStatus: 200,
      responseFields: TENANT_RESPONSE,
      errors: [
        VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 400, when: 'tenantName or accountHolderName sent blank.' },
        { status: 404, when: 'No such tenant.' },
      ],
    },
    {
      id: 'sa-tenant-status',
      name: 'Change a tenant\'s status',
      method: 'PATCH',
      path: '/api/super-admin/tenants/{tenantId}/status',
      access: 'SUPER_ADMIN',
      summary: 'ACTIVE or SUSPENDED. Suspending needs a reason; its users lose their roles until it is ACTIVE again.',
      pathParams: [{ name: 'tenantId', description: 'The tenant document id.' }],
      requiredFields: ['status'],
      fields: 'status ACTIVE · SUSPENDED · reason ≤500 (required to suspend)',
      body: `{
  "status": "SUSPENDED",
  "reason": "Review"
}`,
      successStatus: 200,
      responseFields: TENANT_RESPONSE,
      errors: [
        VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 400, when: 'Any status but ACTIVE or SUSPENDED, or suspending without a reason.' },
        { status: 404, when: 'No such tenant.' },
        { status: 409, when: 'Already in that status, or a PROVISIONING / DELETED tenant.' },
      ],
    },
    {
      id: 'sa-tenant-package',
      name: 'A tenant\'s package',
      method: 'GET',
      path: '/api/super-admin/tenants/{tenantId}/package',
      access: 'SUPER_ADMIN',
      summary: 'The tenant\'s current subscription and plan.',
      pathParams: [{ name: 'tenantId', description: 'The tenant document id.' }],
      successStatus: 200,
      responseFields: PACKAGE_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such tenant, or it has no current package.' }],
    },
    {
      id: 'sa-list-admins',
      name: 'List administrators',
      method: 'GET',
      path: '/api/super-admin/admins',
      access: 'SUPER_ADMIN',
      summary: 'Tenant administrators (role ADMIN) across every organization, with their permissions and organization.',
      queryParams: [
        { key: 'search', value: '', enabled: false, description: 'Name or email, ≤100.' },
        { key: 'tenantId', value: '', enabled: false, description: 'One organization only.' },
        { key: 'status', value: 'ACTIVE', enabled: false, description: 'INVITED · ACTIVE · SUSPENDED · DEACTIVATED' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(ADMIN_RESPONSE),
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 400, when: 'A bad status, page or size.' }],
    },
    {
      id: 'sa-create-admin',
      name: 'Invite an administrator',
      method: 'POST',
      path: '/api/super-admin/admins',
      access: 'SUPER_ADMIN',
      summary: 'An INVITED ADMIN in an existing, ACTIVE organization. Cognito creates the account and emails a temporary password; the first sign-in sets a permanent one.',
      requiredFields: ['tenantId', 'name', 'email'],
      fields: 'tenantId ≤64 · name ≤100 · email ≤254 · phoneNumber ≤30. No role field: always ADMIN. '
        + 'moduleAccess, modulePermissions optional — when both are absent all six modules are assigned with the ADMIN defaults (every permission but DELETE).',
      body: `{
  "tenantId": "{{tenantId}}",
  "name": "Nora Admin",
  "email": "nora+{{$timestamp}}@example.com"
}`,
      successStatus: 201,
      responseFields: ADMIN_RESPONSE,
      notes: 'A role or roles field — SUPER_ADMIN included — is ignored like any unknown field; the account is created as ADMIN.',
      errors: [
        VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 404, when: 'No organization has that tenantId.' },
        { status: 409, when: 'The organization is not ACTIVE (an invitation into it could never be linked).' },
        { status: 409, when: 'The email already has a record in that organization, or is a live account in another one or on the platform.' },
      ],
    },
    {
      id: 'sa-get-admin',
      name: 'Open an administrator',
      method: 'GET',
      path: '/api/super-admin/admins/{adminId}',
      access: 'SUPER_ADMIN',
      summary: 'One administrator. A regular user\'s or a Super Admin\'s id answers 404 here.',
      pathParams: [{ name: 'adminId', description: 'The administrator\'s user document id.' }],
      successStatus: 200,
      responseFields: ADMIN_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'Not an administrator, or no such id.' }],
    },
    {
      id: 'sa-update-admin',
      name: 'Update an administrator',
      method: 'PUT',
      path: '/api/super-admin/admins/{adminId}',
      access: 'SUPER_ADMIN',
      summary: 'Replaces the editable profile: name and phone number. Email, organization, role and permissions are not reachable from here.',
      pathParams: [{ name: 'adminId', description: 'The administrator\'s user document id.' }],
      requiredFields: ['name'],
      fields: 'name ≤100 · phoneNumber ≤30 (absent or blank clears it)',
      body: `{
  "name": "Nora Admin-Ruiz",
  "phoneNumber": "+34 600 000 001"
}`,
      successStatus: 200,
      responseFields: ADMIN_RESPONSE,
      errors: [VALIDATION, UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'Not an administrator, or no such id.' }],
    },
    {
      id: 'sa-admin-status',
      name: 'Change an administrator\'s status',
      method: 'PATCH',
      path: '/api/super-admin/admins/{adminId}/status',
      access: 'SUPER_ADMIN',
      summary: 'ACTIVE, SUSPENDED or DEACTIVATED, through the same lifecycle as every account. Nothing is deleted and the organization is untouched; Cognito signs the account out (and disables it on DEACTIVATED).',
      pathParams: [{ name: 'adminId', description: 'The administrator\'s user document id.' }],
      requiredFields: ['status'],
      fields: 'status ACTIVE · SUSPENDED · DEACTIVATED · reason ≤500 (required to suspend or deactivate) · confirmNoActiveAdmin: true to remove the organization\'s only active ADMIN',
      body: `{
  "status": "SUSPENDED",
  "reason": "Security review"
}`,
      successStatus: 200,
      responseFields: ADMIN_RESPONSE,
      errors: [
        VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 400, when: 'No reason when suspending or deactivating, or status INVITED.' },
        { status: 404, when: 'Not an administrator — a regular user or a Super Admin cannot be changed here.' },
        { status: 409, when: 'Already in that status; activating an invitation; suspending an invitation; or the organization\'s only active administrator without confirmNoActiveAdmin: true.' },
        { status: 502, when: 'Reactivating: Cognito could not re-enable the account. Nothing was changed.' },
      ],
      notes: 'After removing an organization\'s only active administrator, invite a replacement (Invite an administrator): that is its way back.',
    },
    {
      id: 'sa-resend-admin-invitation',
      name: 'Resend an administrator\'s invitation',
      method: 'POST',
      path: '/api/super-admin/admins/{adminId}/resend-invitation',
      access: 'SUPER_ADMIN',
      summary: 'Cognito emails the pending administrator a new temporary password.',
      pathParams: [{ name: 'adminId', description: 'The administrator\'s user document id.' }],
      successStatus: 200,
      responseFields: ['…the administrator', 'invitation { delivery, emailSent, message }'],
      errors: [
        UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 404, when: 'Not an administrator, or no such id.' },
        { status: 409, when: 'Not INVITED, already has a Cognito password, or temporary-password invitations are off.' },
        { status: 502, when: 'Cognito refused to resend it.' },
      ],
    },
    {
      id: 'sa-admin-modules',
      name: 'An administrator\'s modules',
      method: 'GET',
      path: '/api/super-admin/admins/{adminId}/modules',
      access: 'SUPER_ADMIN',
      summary: 'All six modules for one administrator: assigned or not, and the permissions in each.',
      pathParams: [{ name: 'adminId', description: 'The administrator\'s user document id.' }],
      successStatus: 200,
      responseFields: MODULE_ACCESS_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'Not an administrator, or no such id.' }],
    },
    {
      id: 'sa-set-admin-modules',
      name: 'Set an administrator\'s modules',
      method: 'PUT',
      path: '/api/super-admin/admins/{adminId}/modules',
      access: 'SUPER_ADMIN',
      summary: 'Replaces the whole assignment. The Super Admin is not limited to permissions of their own.',
      pathParams: [{ name: 'adminId', description: 'The administrator\'s user document id.' }],
      requiredFields: ['modules', 'permissions'],
      fields: 'modules: list of the six module ids ([] = none) · permissions: module permissions, each inside an assigned module',
      body: `{
  "modules": ["FACTURAFLOW", "PREVENWORK"],
  "permissions": ["FACTURAFLOW_VIEW", "PREVENWORK_VIEW", "PREVENWORK_DELETE"]
}`,
      successStatus: 200,
      responseFields: MODULE_ACCESS_RESPONSE,
      errors: [VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN, ...MODULE_ERRORS, { status: 404, when: 'Not an administrator, or no such id.' }],
    },
    {
      id: 'sa-set-admin-module',
      name: 'Set one administrator module',
      method: 'PUT',
      path: '/api/super-admin/admins/{adminId}/modules/{moduleId}',
      access: 'SUPER_ADMIN',
      summary: 'Assigns one module with exactly these permissions; the administrator\'s other modules are kept.',
      pathParams: [
        { name: 'adminId', description: 'The administrator\'s user document id.' },
        { name: 'moduleId', description: 'One of the six module ids.' },
      ],
      requiredFields: ['permissions'],
      fields: 'permissions: that module\'s permissions only',
      body: `{
  "permissions": ["PREVENWORK_VIEW", "PREVENWORK_DELETE"]
}`,
      successStatus: 200,
      responseFields: MODULE_ACCESS_RESPONSE,
      errors: [VALIDATION, UNAUTHORIZED, NEEDS_SUPER_ADMIN, ...MODULE_ERRORS, { status: 404, when: 'Not an administrator, or no such id.' }],
    },
    {
      id: 'sa-revoke-admin-module',
      name: 'Revoke one administrator module',
      method: 'DELETE',
      path: '/api/super-admin/admins/{adminId}/modules/{moduleId}',
      access: 'SUPER_ADMIN',
      summary: 'Removes the module and every permission in it from the administrator.',
      pathParams: [
        { name: 'adminId', description: 'The administrator\'s user document id.' },
        { name: 'moduleId', description: 'One of the six module ids.' },
      ],
      successStatus: 200,
      responseFields: MODULE_ACCESS_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, ...MODULE_ERRORS, { status: 404, when: 'Not an administrator, or no such id.' }],
    },
    {
      id: 'sa-list-users',
      name: 'List users',
      method: 'GET',
      path: '/api/super-admin/users',
      access: 'SUPER_ADMIN',
      summary: 'Read only. Regular users (role USER) across every organization — administrators and Super Admins are not in it.',
      queryParams: [
        { key: 'search', value: '', enabled: false, description: 'Name or email, ≤100.' },
        { key: 'tenantId', value: '', enabled: false, description: 'One organization only.' },
        { key: 'status', value: 'ACTIVE', enabled: false, description: 'INVITED · ACTIVE · SUSPENDED · DEACTIVATED' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(PLATFORM_USER_RESPONSE),
      notes: 'There is no Super Admin route that creates, edits, deletes or changes the status of a regular user: other methods on /users answer 405, and /users/{id}/status answers 404.',
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 400, when: 'A bad status, page or size.' }],
    },
    {
      id: 'sa-get-user',
      name: 'Open a user',
      method: 'GET',
      path: '/api/super-admin/users/{userId}',
      access: 'SUPER_ADMIN',
      summary: 'Read only. One regular user with their organization; no phone number and no Cognito sub.',
      pathParams: [{ name: 'userId', description: 'The user document id.' }],
      successStatus: 200,
      responseFields: PLATFORM_USER_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'Not a regular user (administrators are under /admins), or no such id.' }],
    },
    {
      id: 'sa-audit-events',
      name: 'Audit trail',
      method: 'GET',
      path: '/api/super-admin/audit-events',
      access: 'SUPER_ADMIN',
      summary: 'Read only. Administrative actions, newest first.',
      queryParams: [
        { key: 'tenantId', value: '', enabled: false, description: 'One organization.' },
        { key: 'targetId', value: '', enabled: false, description: 'One user, tenant or subscription id.' },
        { key: 'actorUserId', value: '', enabled: false, description: 'Who did it.' },
        { key: 'action', value: 'USER_STATUS_CHANGED', enabled: false, description: 'An AuditAction, e.g. USER_INVITED, PLAN_CHANGE_REQUESTED.' },
        ...AUDIT_EXTRA_FILTERS,
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: AUDIT_PAGE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 400, when: 'An unknown action, a bad date, to before from, or a bad page or size.' }],
    },
  ],
}

/* ------------------------------------------------------------------ notifications (docs §10) */

const NOTIFICATION_RESPONSE = ['id', 'tenantId', 'subject', 'body', 'audience', 'status', 'archivedAt',
  'attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }',
  'users [ { userId, readStatus, readAt, name, email } ] — one notification only', 'recipientCount', 'readCount',
  'eligibleCount (TENANT)', 'createdBy', 'createdByRole', 'updatedBy', 'createdAt', 'updatedAt']
const INBOX_ITEM = ['id', 'subject', 'body', 'audience', 'readStatus', 'readAt',
  'attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }', 'createdByRole', 'createdAt', 'updatedAt']
const NEEDS_MEMBER = { status: 403, when: 'The caller is not an ADMIN or USER of an ACTIVE tenant (a Super Admin has no inbox).' }
const NOT_VISIBLE = {
  status: 404,
  when: 'Not visible to the caller: another tenant\'s, not a recipient, archived, or a broadcast from before they joined.',
}
const NOTIFICATION_ID = { name: 'notificationId', description: 'The notification document id.' }
const TENANT_ID = { name: 'tenantId', description: 'The organization (tenant) id.' }
const BAD_ATTACHMENT = { status: 400, when: 'Empty file, content that is not PDF/PNG/JPEG/DOCX/XLSX, or a file name whose extension does not match the content.' }
const TOO_LARGE = { status: 413, when: 'The file is larger than 10 MB (normaone.attachments.max-size).' }
const STORAGE_FAILED = { status: 502, when: 'The attachment storage (local disk or S3) failed. Nothing was saved.' }

const GROUP_INBOX = {
  id: 'inbox',
  module: 'Notifications',
  controller: 'NotificationController',
  endpoints: [
    {
      id: 'notif-inbox',
      name: 'My notifications',
      method: 'GET',
      path: '/api/notifications',
      access: 'member',
      summary: 'The caller\'s inbox, newest first: SELECTED ones naming them, and their tenant\'s broadcasts created on or after they joined. Only the caller\'s own read state; never the recipient list.',
      queryParams: [
        { key: 'filter', value: 'UNREAD', enabled: false, description: 'ALL (default) · UNREAD · READ — by the caller\'s own read state.' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(INBOX_ITEM),
      errors: [UNAUTHORIZED, NEEDS_MEMBER, { status: 400, when: 'A bad filter, page or size.' }],
    },
    {
      id: 'notif-unread-count',
      name: 'Unread count',
      method: 'GET',
      path: '/api/notifications/unread-count',
      access: 'member',
      summary: 'How many of the caller\'s ACTIVE notifications they have not read. Same visibility rules as the inbox.',
      successStatus: 200,
      responseFields: ['unreadCount'],
      errors: [UNAUTHORIZED, NEEDS_MEMBER],
    },
    {
      id: 'notif-get',
      name: 'Open a notification',
      method: 'GET',
      path: '/api/notifications/{notificationId}',
      access: 'member',
      summary: 'One visible notification. Opening it does NOT mark it read.',
      pathParams: [NOTIFICATION_ID],
      successStatus: 200,
      responseFields: INBOX_ITEM,
      errors: [UNAUTHORIZED, NEEDS_MEMBER, NOT_VISIBLE],
    },
    {
      id: 'notif-read-status',
      name: 'Mark read / unread',
      method: 'PATCH',
      path: '/api/notifications/{notificationId}/read-status',
      access: 'member',
      summary: 'The caller\'s own copy only: their element of users (SELECTED) or their receipt (TENANT). The server sets readAt; a repeat changes nothing.',
      pathParams: [NOTIFICATION_ID],
      requiredFields: ['read'],
      fields: 'read true or false. A userId or readAt in the body is ignored.',
      body: `{
  "read": true
}`,
      successStatus: 200,
      responseFields: INBOX_ITEM,
      errors: [VALIDATION, UNAUTHORIZED, NEEDS_MEMBER, NOT_VISIBLE],
    },
    {
      id: 'notif-attachment',
      name: 'Download the attachment',
      method: 'GET',
      path: '/api/notifications/{notificationId}/attachment',
      access: 'member',
      summary: 'The file, as a download (Content-Disposition: attachment). With S3 storage: 302 to a 60-second presigned URL. Same visibility check as opening the notification.',
      pathParams: [NOTIFICATION_ID],
      successStatus: 200,
      responseFields: ['the file\'s bytes — or 302 Location (S3)'],
      errors: [UNAUTHORIZED, NEEDS_MEMBER, NOT_VISIBLE, { status: 404, when: 'The notification has no attachment.' }],
    },
  ],
}

/**
 * The eight administrator endpoints, the same for a Tenant Admin (their own tenant, from their record)
 * and a Super Admin (the tenant in the path) — one definition so the two cannot drift apart.
 */
function adminNotificationEndpoints({ prefix, base, access, scopeParams, needs, who }) {
  const one = `${base}/{notificationId}`
  const params = [...scopeParams, NOTIFICATION_ID]
  const own = { access }
  const unknownTenant = scopeParams.length ? [{ status: 404, when: 'No such organization.' }] : []
  return [
    {
      id: `${prefix}-create`,
      ...own,
      name: 'Send a notification',
      method: 'POST',
      path: base,
      summary: `${who} SELECTED: userIds must all be INVITED or ACTIVE members of the tenant (one that is not refuses the whole request, without saying whether it exists elsewhere). TENANT: no userIds; every member who joined on or before it. Never platform-wide.`,
      pathParams: scopeParams,
      requiredFields: ['subject', 'body', 'audience'],
      fields: 'subject ≤200 · body ≤10000 (plain text) · audience SELECTED or TENANT · userIds (SELECTED only, ≤1000, duplicates removed)',
      body: `{
  "subject": "Important Compliance Update",
  "body": "Please review the updated compliance requirements.",
  "audience": "SELECTED",
  "userIds": ["{{userId}}"]
}`,
      notes: 'With an attachment the same endpoint takes multipart/form-data: a "notification" part (this JSON, Content-Type application/json) and an "attachment" file part. The notification screens send it that way; the console sends JSON only. A users array, tenantId or createdByRole in the body is ignored.',
      successStatus: 201,
      responseFields: NOTIFICATION_RESPONSE,
      errors: [
        VALIDATION, UNAUTHORIZED, needs, ...unknownTenant,
        { status: 400, when: 'SELECTED without userIds, TENANT with userIds, an id that is not an eligible member of this tenant, or more than 1000 recipients.' },
        BAD_ATTACHMENT, TOO_LARGE,
        { status: 409, when: 'The organization is not ACTIVE.' },
        STORAGE_FAILED,
      ],
    },
    {
      id: `${prefix}-list`,
      ...own,
      name: 'List notifications',
      method: 'GET',
      path: base,
      summary: 'The tenant\'s notifications, ACTIVE and ARCHIVED, newest first, with recipient and read counts (no recipient lists).',
      pathParams: scopeParams,
      queryParams: [
        { key: 'status', value: 'ACTIVE', enabled: false, description: 'ACTIVE · ARCHIVED' },
        { key: 'audience', value: 'TENANT', enabled: false, description: 'SELECTED · TENANT' },
        { key: 'createdBy', value: '', enabled: false, description: 'A creator\'s user id.' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(NOTIFICATION_RESPONSE),
      errors: [UNAUTHORIZED, needs, ...unknownTenant, { status: 400, when: 'A bad status, audience, page or size.' }],
    },
    {
      id: `${prefix}-get`,
      ...own,
      name: 'Open a notification',
      method: 'GET',
      path: one,
      summary: 'One notification with every recipient\'s read state (SELECTED) or the read and eligible counts (TENANT).',
      pathParams: params,
      successStatus: 200,
      responseFields: NOTIFICATION_RESPONSE,
      errors: [UNAUTHORIZED, needs, { status: 404, when: 'No such notification in this tenant.' }],
    },
    {
      id: `${prefix}-update`,
      ...own,
      name: 'Edit a notification',
      method: 'PATCH',
      path: one,
      summary: 'Only the fields sent change. Recipients (SELECTED only) are added unread and removed on the server, so everyone else keeps their read state. The audience never changes.',
      pathParams: params,
      fields: 'subject ≤200 · body ≤10000 · addUserIds · removeUserIds',
      body: `{
  "subject": "Important Compliance Update (revised)"
}`,
      successStatus: 200,
      responseFields: NOTIFICATION_RESPONSE,
      errors: [
        VALIDATION, UNAUTHORIZED, needs,
        { status: 400, when: 'Nothing to change, a blank subject or body, recipients on a TENANT notification, removing someone who is not a recipient or the last one, or an id that is not an eligible member.' },
        ...(prefix.startsWith('tenant') ? [{ status: 403, when: 'A Super Admin sent it: only a Super Admin changes it.' }] : []),
        { status: 404, when: 'No such notification in this tenant.' },
        { status: 409, when: 'It is archived, the organization is not ACTIVE, or it changed meanwhile.' },
      ],
    },
    {
      id: `${prefix}-status`,
      ...own,
      name: 'Archive a notification',
      method: 'PATCH',
      path: `${one}/status`,
      summary: 'ARCHIVED only: it leaves every inbox and unread count, stays in the admin lists, and is never deleted or reactivated. Archiving twice changes nothing.',
      pathParams: params,
      requiredFields: ['status'],
      fields: 'status ARCHIVED · reason ≤500 (to the audit trail)',
      body: `{
  "status": "ARCHIVED",
  "reason": "Superseded"
}`,
      successStatus: 200,
      responseFields: NOTIFICATION_RESPONSE,
      errors: [
        VALIDATION, BAD_ENUM, UNAUTHORIZED, needs,
        { status: 400, when: 'Any status but ARCHIVED.' },
        ...(prefix.startsWith('tenant') ? [{ status: 403, when: 'A Super Admin sent it.' }] : []),
        { status: 404, when: 'No such notification in this tenant.' },
      ],
    },
    {
      id: `${prefix}-attachment-put`,
      ...own,
      name: 'Replace the attachment',
      method: 'PUT',
      path: `${one}/attachment`,
      summary: 'multipart/form-data with an "attachment" file part. Adds or replaces it; the old file is deleted once nothing refers to it.',
      pathParams: params,
      notes: 'Multipart only — send it from the notification\'s page, which builds the form. The console cannot attach a file.',
      successStatus: 200,
      responseFields: NOTIFICATION_RESPONSE,
      errors: [
        UNAUTHORIZED, needs, BAD_ATTACHMENT, TOO_LARGE,
        { status: 400, when: 'No "attachment" part.' },
        ...(prefix.startsWith('tenant') ? [{ status: 403, when: 'A Super Admin sent it.' }] : []),
        { status: 404, when: 'No such notification in this tenant.' },
        { status: 409, when: 'It is archived.' },
        { status: 415, when: 'Not multipart/form-data.' },
        STORAGE_FAILED,
      ],
    },
    {
      id: `${prefix}-attachment-delete`,
      ...own,
      name: 'Remove the attachment',
      method: 'DELETE',
      path: `${one}/attachment`,
      summary: 'Removes the attachment and deletes its file. Without one, nothing changes.',
      pathParams: params,
      successStatus: 200,
      responseFields: NOTIFICATION_RESPONSE,
      errors: [
        UNAUTHORIZED, needs,
        ...(prefix.startsWith('tenant') ? [{ status: 403, when: 'A Super Admin sent it.' }] : []),
        { status: 404, when: 'No such notification in this tenant.' },
        { status: 409, when: 'It is archived.' },
      ],
    },
    {
      id: `${prefix}-attachment-get`,
      ...own,
      name: 'Download the attachment',
      method: 'GET',
      path: `${one}/attachment`,
      summary: 'The file as a download, ACTIVE or ARCHIVED. With S3 storage: 302 to a 60-second presigned URL.',
      pathParams: params,
      successStatus: 200,
      responseFields: ['the file\'s bytes — or 302 Location (S3)'],
      errors: [UNAUTHORIZED, needs, { status: 404, when: 'No such notification in this tenant, or it has no attachment.' }],
    },
  ]
}

const GROUP_TENANT_NOTIFICATIONS = {
  id: 'tenant-notifications',
  module: 'Tenant notifications',
  controller: 'TenantNotificationController',
  endpoints: adminNotificationEndpoints({
    prefix: 'tenant-notif',
    base: '/api/tenant/notifications',
    access: 'ADMIN',
    scopeParams: [],
    needs: NEEDS_ADMIN,
    who: 'To the caller\'s own tenant (from their record; a tenantId in the body is ignored).',
  }),
}

const GROUP_PLATFORM_NOTIFICATIONS = {
  id: 'sa-notifications',
  module: 'Super admin notifications',
  controller: 'SuperAdminNotificationController',
  endpoints: adminNotificationEndpoints({
    prefix: 'sa-notif',
    base: '/api/super-admin/tenants/{tenantId}/notifications',
    access: 'SUPER_ADMIN',
    scopeParams: [TENANT_ID],
    needs: NEEDS_SUPER_ADMIN,
    who: 'To the tenant in the path, which must exist (404) and be ACTIVE (409).',
  }),
}

/* ------------------------------------------------------------------ plans (docs §13) */

const PLAN_ID = { name: 'planId', description: 'The plan document id (one version of a plan code).' }
const REQUEST_ID = { name: 'requestId', description: 'The plan-change request id.' }
const PLAN_RESPONSE = ['id', 'planCode', 'planVersion', 'name', 'description', 'status', 'defaultPlan', 'billingCycle',
  'publiclyAvailable', 'effectiveFrom', 'effectiveUntil', 'trialDays', 'listPrice', 'currencyCode', 'maxEmployees', 'maxUsers',
  'durationMonths', 'moduleApps', 'currentSubscriptions (one plan only)', 'latestVersion', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']
const TENANT_PLAN_RESPONSE = ['id', 'planCode', 'planVersion', 'name', 'description', 'status', 'listPrice', 'currencyCode',
  'billingCycle', 'durationMonths', 'trialDays', 'maxEmployees', 'maxUsers', 'modules (application modules)', 'current', 'selectable']
const REQUEST_RESPONSE = ['id', 'organization { id, name, subdomain, status }', 'status', 'requestedBy { userId, name, email }',
  'requestedAt', 'reason', 'currentPlan { planId, planCode, planVersion, name }', 'requestedPlan { planId, planCode, planVersion, name }',
  'decidedBy', 'decidedByRole', 'decidedAt', 'decisionNote', 'appliedSubscriptionId',
  'notification { status, sentAt — and for a Super Admin: attempts, lastAttemptAt, lastError }']
const HISTORY_RESPONSE = ['id', 'eventType', 'occurredAt', 'tenantId', 'planId', 'planCode', 'planVersion', 'previousPlanId',
  'previousPlanCode', 'previousPlanVersion', 'changes [ { field, from, to } ]', 'actorUserId', 'actorRole', 'reason', 'status',
  'referenceType', 'referenceId', 'correlationId']
const PLAN_FIELDS = 'planCode ≤50 [A-Za-z0-9_-] · planVersion optional (next one) · name ≤100 · description ≤1000 · billingCycle MONTHLY · QUARTERLY · YEARLY · '
  + 'listPrice ≥0, 2 decimals · currencyCode ISO 4217 (EUR) · maxEmployees >0 · maxUsers 1–1000000 (seat limit; omit = none) · '
  + 'durationMonths 1–120 (omit = rolling) · trialDays ≥0 · publiclyAvailable (shown to Tenant Admins) · effectiveFrom/Until · moduleApps NORMAONE and the six modules'

const GROUP_TENANT_PLANS = {
  id: 'tenant-plans',
  module: 'Tenant plans',
  controller: 'TenantPlanController',
  endpoints: [
    {
      id: 'tenant-plans',
      name: 'Plan catalogue',
      method: 'GET',
      path: '/api/tenant/plans',
      access: 'ADMIN',
      summary: 'The plans this organization can see: every ACTIVE plan offered to customers (publiclyAvailable, or the default plan), and its own current plan whatever its status. Cheapest first.',
      successStatus: 200,
      responseFields: [`[ { ${TENANT_PLAN_RESPONSE.join(', ')} } ]`],
      notes: 'No platform data: no subscription counts, creators or sale windows. selectable is true for an ACTIVE plan that is not the current one. The organization\'s own subscription and its dates are My package.',
      errors: [UNAUTHORIZED, NEEDS_ADMIN],
    },
    {
      id: 'tenant-plan',
      name: 'One plan',
      method: 'GET',
      path: '/api/tenant/plans/{planId}',
      access: 'ADMIN',
      summary: 'One plan of the catalogue.',
      pathParams: [PLAN_ID],
      successStatus: 200,
      responseFields: TENANT_PLAN_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_ADMIN, { status: 404, when: 'Not in this organization\'s catalogue (not ACTIVE, not offered, or no such id).' }],
    },
    {
      id: 'tenant-plan-request',
      name: 'Request a plan change',
      method: 'POST',
      path: '/api/tenant/plan-change-requests',
      access: 'ADMIN',
      summary: 'Asks for this organization to move to another plan. Nothing changes until a Super Admin approves it — there is no billing or payment integration, so no change is applied on request. The Super Admins are emailed once the request is saved.',
      requiredFields: ['planId'],
      fields: 'planId (from the catalogue, selectable) · reason ≤500. There is no tenant field: a tenantId sent is ignored.',
      body: `{
  "planId": "{{planId}}",
  "reason": "We are growing past the seat limit"
}`,
      successStatus: 201,
      responseFields: REQUEST_RESPONSE,
      notes: 'notification.status is the Super Admin email: SENT, PENDING (not sent yet — waiting for a retry, or for email to be configured) or FAILED. An email problem never affects the saved request.',
      errors: [
        VALIDATION, UNAUTHORIZED, NEEDS_ADMIN,
        { status: 404, when: 'The plan is not in this organization\'s catalogue.' },
        { status: 409, when: 'Already on that plan, or the organization already has an open request.' },
      ],
    },
    {
      id: 'tenant-plan-requests',
      name: 'My plan-change requests',
      method: 'GET',
      path: '/api/tenant/plan-change-requests',
      access: 'ADMIN',
      summary: 'This organization\'s requests, newest first.',
      queryParams: [
        { key: 'status', value: 'PENDING', enabled: false, description: 'PENDING, PROCESSING, APPROVED, REJECTED or CANCELLED.' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(REQUEST_RESPONSE),
      errors: [UNAUTHORIZED, NEEDS_ADMIN, BAD_ENUM],
    },
    {
      id: 'tenant-plan-request-get',
      name: 'One plan-change request',
      method: 'GET',
      path: '/api/tenant/plan-change-requests/{requestId}',
      access: 'ADMIN',
      summary: 'One of this organization\'s requests, with the decision once there is one.',
      pathParams: [REQUEST_ID],
      successStatus: 200,
      responseFields: REQUEST_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_ADMIN, { status: 404, when: 'No such request in this organization (another organization\'s is 404 too).' }],
    },
    {
      id: 'tenant-plan-request-cancel',
      name: 'Cancel a plan-change request',
      method: 'POST',
      path: '/api/tenant/plan-change-requests/{requestId}/cancel',
      access: 'ADMIN',
      summary: 'Withdraws a PENDING request of this organization. No body.',
      pathParams: [REQUEST_ID],
      successStatus: 200,
      responseFields: REQUEST_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_ADMIN, { status: 404, when: 'No such request in this organization.' },
        { status: 409, when: 'It is no longer PENDING.' }],
    },
  ],
}

const GROUP_PLANS = {
  id: 'sa-plans',
  module: 'Super admin plans',
  controller: 'SuperAdminPlanController',
  endpoints: [
    {
      id: 'sa-list-plans',
      name: 'List plans',
      method: 'GET',
      path: '/api/super-admin/plans',
      access: 'SUPER_ADMIN',
      summary: 'Every plan version, by code then newest version first.',
      queryParams: [
        { key: 'status', value: 'ACTIVE', enabled: false, description: 'DRAFT, ACTIVE, INACTIVE or ARCHIVED.' },
        { key: 'planCode', value: 'BASIC', enabled: false, description: 'One plan code (any case).' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(PLAN_RESPONSE),
      notes: 'latestVersion false marks a historical version: a newer version of the same code exists.',
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, BAD_ENUM],
    },
    {
      id: 'sa-create-plan',
      name: 'Create a plan',
      method: 'POST',
      path: '/api/super-admin/plans',
      access: 'SUPER_ADMIN',
      summary: 'Creates a DRAFT plan, or a new DRAFT version of an existing code (planVersion omitted = the next one). Recorded in the plan history.',
      requiredFields: ['planCode', 'name', 'billingCycle', 'listPrice', 'maxEmployees'],
      fields: PLAN_FIELDS,
      body: `{
  "planCode": "PRO",
  "name": "Professional",
  "description": "For growing teams",
  "billingCycle": "MONTHLY",
  "listPrice": 49.90,
  "currencyCode": "EUR",
  "maxEmployees": 50,
  "maxUsers": 25,
  "durationMonths": 12,
  "publiclyAvailable": true,
  "moduleApps": ["NORMAONE", "FACTURAFLOW", "JORNADAPULSE"]
}`,
      successStatus: 201,
      responseFields: PLAN_RESPONSE,
      errors: [VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 400, when: 'Not an ISO 4217 currency, an unknown module, or effectiveUntil not after effectiveFrom.' },
        { status: 409, when: 'That code and version already exist.' }],
    },
    {
      id: 'sa-get-plan',
      name: 'Open a plan',
      method: 'GET',
      path: '/api/super-admin/plans/{planId}',
      access: 'SUPER_ADMIN',
      summary: 'One plan version, with how many organizations are on it now.',
      pathParams: [PLAN_ID],
      successStatus: 200,
      responseFields: PLAN_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such plan.' }],
    },
    {
      id: 'sa-update-plan',
      name: 'Edit a plan',
      method: 'PATCH',
      path: '/api/super-admin/plans/{planId}',
      access: 'SUPER_ADMIN',
      summary: 'A DRAFT changes anything. A published version changes only name, description, publiclyAvailable and the sale window: new terms (price, currency, cycle, duration, seats, trial, employees, modules) are a new version. Each changed field is recorded in the plan history with its previous and new value.',
      pathParams: [PLAN_ID],
      fields: 'Any field of Create a plan except planCode and planVersion; only the ones sent change.',
      body: `{
  "name": "Professional",
  "description": "For growing teams"
}`,
      successStatus: 200,
      responseFields: PLAN_RESPONSE,
      errors: [VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such plan.' },
        { status: 409, when: 'Archived, or a term of a published version (the message names the fields).' }],
    },
    {
      id: 'sa-plan-status',
      name: 'Activate or deactivate a plan',
      method: 'PATCH',
      path: '/api/super-admin/plans/{planId}/status',
      access: 'SUPER_ADMIN',
      summary: 'DRAFT → ACTIVE or ARCHIVED; ACTIVE ⇄ INACTIVE; ACTIVE or INACTIVE → ARCHIVED (final). Status decides only whether the plan can be assigned from now on: organizations on it and every history entry stay. Nothing deletes a plan.',
      pathParams: [PLAN_ID],
      requiredFields: ['status'],
      fields: 'status ACTIVE · INACTIVE · ARCHIVED · reason ≤500',
      body: `{
  "status": "INACTIVE",
  "reason": "Replaced by version 2"
}`,
      successStatus: 200,
      responseFields: PLAN_RESPONSE,
      errors: [VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such plan.' },
        { status: 409, when: 'Not an allowed move, or the last ACTIVE version of the default plan.' }],
    },
    {
      id: 'sa-subscriptions',
      name: 'Current subscriptions',
      method: 'GET',
      path: '/api/super-admin/subscriptions',
      access: 'SUPER_ADMIN',
      summary: 'Every organization\'s current subscription, newest first — with planId, which organizations are on one plan version.',
      queryParams: [
        { key: 'planId', value: '{{planId}}', enabled: false, description: 'One plan version.' },
        { key: 'planCode', value: 'BASIC', enabled: false, description: 'Every version of a code.' },
        { key: 'status', value: 'ACTIVE', enabled: false, description: 'A SubscriptionStatus.' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(['organization { id, name, subdomain, status }', 'subscription { …My package… }']),
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, BAD_ENUM],
    },
    {
      id: 'sa-change-tenant-plan',
      name: 'Move an organization to a plan',
      method: 'PUT',
      path: '/api/super-admin/tenants/{tenantId}/package',
      access: 'SUPER_ADMIN',
      summary: 'Applies an ACTIVE plan to an organization directly (no request needed). Recorded in the subscription and plan histories. No payment is taken.',
      pathParams: [TENANT_ID],
      requiredFields: ['planId'],
      fields: 'planId · reason ≤500',
      body: `{
  "planId": "{{planId}}",
  "reason": "Upgrade agreed with sales"
}`,
      successStatus: 200,
      responseFields: PACKAGE_RESPONSE,
      errors: [VALIDATION, UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such tenant or plan.' },
        { status: 409, when: 'The plan is not ACTIVE, the organization is not ACTIVE or SUSPENDED, or it is already on that plan.' }],
    },
    {
      id: 'sa-tenant-plan-history',
      name: 'An organization\'s subscription history',
      method: 'GET',
      path: '/api/super-admin/tenants/{tenantId}/package/history',
      access: 'SUPER_ADMIN',
      summary: 'The organization\'s subscription lifecycle, newest first (SubscriptionHistory).',
      pathParams: [TENANT_ID],
      queryParams: PAGING,
      successStatus: 200,
      responseFields: PAGE_OF(['id', 'tenantId', 'subscriptionId', 'eventType', 'eventDate', 'previousPlanId', 'newPlanId', 'performedBy', 'reason']),
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such tenant.' }],
    },
    {
      id: 'sa-plan-history',
      name: 'Plan history',
      method: 'GET',
      path: '/api/super-admin/plan-history',
      access: 'SUPER_ADMIN',
      summary: 'Every plan operation across the platform, newest first: plans created, updated (field by field), activated or deactivated, and organizations\' plan requests, decisions and changes. Append-only.',
      queryParams: [
        { key: 'eventType', value: 'TENANT_PLAN_CHANGED', enabled: false, description: 'A PlanHistoryEventType.' },
        { key: 'tenantId', value: '', enabled: false, description: 'One organization.' },
        { key: 'actorUserId', value: '', enabled: false, description: 'Who did it.' },
        { key: 'planId', value: '', enabled: false, description: 'One plan version (as the plan or as the previous plan).' },
        { key: 'from', value: '2026-10-01T00:00:00Z', enabled: false, description: 'ISO-8601 instant, inclusive.' },
        { key: 'to', value: '2026-12-31T23:59:59Z', enabled: false, description: 'ISO-8601 instant, inclusive.' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(HISTORY_RESPONSE),
      notes: 'The entries of one request (requested, approved, changed) share its id as correlationId.',
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, BAD_ENUM, { status: 400, when: 'A bad date, or to before from.' }],
    },
    {
      id: 'sa-plan-requests',
      name: 'Plan-change requests',
      method: 'GET',
      path: '/api/super-admin/plan-change-requests',
      access: 'SUPER_ADMIN',
      summary: 'Every organization\'s requests, newest first.',
      queryParams: [
        { key: 'status', value: 'PENDING', enabled: true, description: 'PENDING, PROCESSING, APPROVED, REJECTED or CANCELLED.' },
        { key: 'tenantId', value: '', enabled: false, description: 'One organization.' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(REQUEST_RESPONSE),
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, BAD_ENUM],
    },
    {
      id: 'sa-plan-request-get',
      name: 'Open a plan-change request',
      method: 'GET',
      path: '/api/super-admin/plan-change-requests/{requestId}',
      access: 'SUPER_ADMIN',
      summary: 'One request, with the Super Admin email\'s delivery attempts and last error.',
      pathParams: [REQUEST_ID],
      successStatus: 200,
      responseFields: REQUEST_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such request.' }],
    },
    {
      id: 'sa-plan-request-approve',
      name: 'Approve a plan-change request',
      method: 'POST',
      path: '/api/super-admin/plan-change-requests/{requestId}/approve',
      access: 'SUPER_ADMIN',
      summary: 'Approves a PENDING request and applies the plan (as Move an organization to a plan). If it cannot be applied, the request stays PENDING and nothing changes.',
      pathParams: [REQUEST_ID],
      fields: 'note ≤500 (optional)',
      body: `{
  "note": "Approved after the sales call"
}`,
      successStatus: 200,
      responseFields: REQUEST_RESPONSE,
      errors: [VALIDATION, UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'No such request.' },
        { status: 409, when: 'No longer PENDING; the plan is not ACTIVE; the organization is not ACTIVE or SUSPENDED or already on it.' }],
    },
    {
      id: 'sa-plan-request-reject',
      name: 'Reject a plan-change request',
      method: 'POST',
      path: '/api/super-admin/plan-change-requests/{requestId}/reject',
      access: 'SUPER_ADMIN',
      summary: 'Rejects a PENDING request; the organization keeps its plan and may ask again.',
      pathParams: [REQUEST_ID],
      requiredFields: ['note'],
      fields: 'note ≤500 (required)',
      body: `{
  "note": "Please contact sales first"
}`,
      successStatus: 200,
      responseFields: REQUEST_RESPONSE,
      errors: [VALIDATION, UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 400, when: 'No note.' },
        { status: 404, when: 'No such request.' }, { status: 409, when: 'No longer PENDING.' }],
    },
  ],
}

/* ------------------------------------------------------------------ Super Admin accounts (docs §12) */

const SUPER_ADMIN_ID = { name: 'superAdminId', description: 'The Super Admin\'s user document id.' }
const SUPER_ADMIN_RESPONSE = ['id', 'name', 'email', 'role', 'status', 'linked', 'invitedAt', 'activatedAt', 'deactivatedAt',
  'statusReason', 'createdAt', 'updatedAt', 'invitation { delivery, emailSent, message } (create and resend only — never a password)']

const GROUP_SUPER_ADMINS = {
  id: 'sa-super-admins',
  module: 'Super Admin accounts',
  controller: 'SuperAdminController',
  endpoints: [
    {
      id: 'sa-list-super-admins',
      name: 'List Super Admins',
      method: 'GET',
      path: '/api/super-admin/super-admins',
      access: 'SUPER_ADMIN',
      summary: 'Platform accounts, newest first.',
      queryParams: [
        { key: 'search', value: '', enabled: false, description: 'Name or email.' },
        { key: 'status', value: 'ACTIVE', enabled: false, description: 'A UserStatus.' },
        ...PAGING,
      ],
      successStatus: 200,
      responseFields: PAGE_OF(SUPER_ADMIN_RESPONSE),
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, BAD_ENUM],
    },
    {
      id: 'sa-create-super-admin',
      name: 'Add a Super Admin',
      method: 'POST',
      path: '/api/super-admin/super-admins',
      access: 'SUPER_ADMIN',
      summary: 'Invites a new platform account: Cognito creates it and emails a temporary password (never returned here). An existing account is never promoted.',
      requiredFields: ['name', 'email'],
      fields: 'name ≤100 · email ≤254',
      body: `{
  "name": "Sara Platform",
  "email": "sara@example.com"
}`,
      successStatus: 201,
      responseFields: SUPER_ADMIN_RESPONSE,
      errors: [VALIDATION, UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 409, when: 'The email already has a platform account, or belongs to an organization\'s account.' },
        { status: 502, when: 'Cognito refused or could not be reached. Nothing was saved.' }],
    },
    {
      id: 'sa-get-super-admin',
      name: 'Open a Super Admin',
      method: 'GET',
      path: '/api/super-admin/super-admins/{superAdminId}',
      access: 'SUPER_ADMIN',
      summary: 'One platform account.',
      pathParams: [SUPER_ADMIN_ID],
      successStatus: 200,
      responseFields: SUPER_ADMIN_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'Not a Super Admin.' }],
    },
    {
      id: 'sa-super-admin-status',
      name: 'Remove or restore a Super Admin',
      method: 'PATCH',
      path: '/api/super-admin/super-admins/{superAdminId}/status',
      access: 'SUPER_ADMIN',
      summary: 'Removing platform access is DEACTIVATED (the record and its history are kept; Cognito signs the account out and disables it); ACTIVE restores it (Cognito re-enabled first). Never yourself, and never the last active Super Admin.',
      pathParams: [SUPER_ADMIN_ID],
      requiredFields: ['status'],
      fields: 'status ACTIVE · SUSPENDED · DEACTIVATED · reason ≤500 (required to suspend or deactivate)',
      body: `{
  "status": "DEACTIVATED",
  "reason": "Left the company"
}`,
      successStatus: 200,
      responseFields: SUPER_ADMIN_RESPONSE,
      errors: [VALIDATION, BAD_ENUM, UNAUTHORIZED, NEEDS_SUPER_ADMIN,
        { status: 403, when: 'Your own account.' }, { status: 404, when: 'Not a Super Admin.' },
        { status: 409, when: 'Already in that status, or the platform would be left without an active Super Admin.' },
        { status: 502, when: 'Restoring: Cognito could not re-enable the account. Nothing was changed.' }],
    },
    {
      id: 'sa-resend-super-admin',
      name: 'Resend a Super Admin invitation',
      method: 'POST',
      path: '/api/super-admin/super-admins/{superAdminId}/resend-invitation',
      access: 'SUPER_ADMIN',
      summary: 'A new temporary password for an INVITED Super Admin (emailed by Cognito). No body.',
      pathParams: [SUPER_ADMIN_ID],
      successStatus: 200,
      responseFields: SUPER_ADMIN_RESPONSE,
      errors: [UNAUTHORIZED, NEEDS_SUPER_ADMIN, { status: 404, when: 'Not a Super Admin.' }, { status: 409, when: 'Not INVITED.' }],
    },
  ],
}

export const API_CATALOG = [GROUP_AUTH, GROUP_ACCOUNT, GROUP_INBOX, GROUP_TENANT, GROUP_TENANT_PLANS, GROUP_TENANT_NOTIFICATIONS,
  GROUP_PLATFORM, GROUP_SUPER_ADMINS, GROUP_PLANS, GROUP_PLATFORM_NOTIFICATIONS]

/** Fills the optional parts every entry may leave out, so no caller has to guard them. */
function normalise(endpoint, group) {
  return {
    pathParams: [],
    queryParams: [],
    requiredFields: [],
    errors: [],
    body: null,
    notes: null,
    fields: null,
    ...endpoint,
    module: group.module,
    groupId: group.id,
    controller: group.controller,
    bodyAllowed: !['GET', 'HEAD'].includes(endpoint.method),
  }
}

/** Flat list, for the catalogue, the console's picker and finding an endpoint from the history. */
export const ALL_ENDPOINTS = API_CATALOG.flatMap((group) =>
  group.endpoints.map((endpoint) => normalise(endpoint, group)),
)

export function findEndpoint(id) {
  return ALL_ENDPOINTS.find((endpoint) => endpoint.id === id) || null
}

export const LIVE_COUNT = ALL_ENDPOINTS.length

/** What `access` means, in words — the catalogue and the console both say it the same way. */
export const ACCESS_LABEL = {
  public: 'Public',
  member: 'A member of an organization (ADMIN or USER)',
  active: 'Any active account (SUPER_ADMIN, ADMIN or USER)',
  token: 'Any valid token',
  ADMIN: 'ADMIN of an active tenant',
  SUPER_ADMIN: 'SUPER_ADMIN',
}
