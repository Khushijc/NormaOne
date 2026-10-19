# NormaOne backend: authentication, onboarding, packages and role-based access

This guide covers how the backend handles:
- registration, email verification and login (Cognito)
- tenant onboarding and the default BASIC package
- the three roles (SUPER_ADMIN, ADMIN, USER) and tenant isolation

It also covers notifications (section 10), the module catalog and module access (section 11), Super Admin accounts (section 12) and plans and subscriptions (section 13), explains how to provision the first Super Admin and how to test every endpoint with Postman. A ready-to-import collection is in `postman/NormaOne-Auth-RBAC.postman_collection.json`.

Base URL: `http://localhost:8881`

---

## 1. Lifecycle

**Registration → email verification → login → tenant onboarding → default package → dashboard-ready user**

1. **Register:** `POST /api/auth/register`. Cognito sends a verification code by email.
2. **Verify:** `POST /api/auth/verify-email`. Use `POST /api/auth/resend-code` if the code expired.
3. **Log in:** `POST /api/auth/login`. A browser gets the session as HttpOnly cookies and no token in the body (see **Browser sessions** below). A non-browser client sends `X-Token-Delivery: body` and receives `accessToken`, `idToken` and `refreshToken` instead. An unverified account cannot log in (Cognito returns `UserNotConfirmed`, which the API answers with 403).
4. **Check onboarding:** `GET /api/users/me` or `GET /api/onboarding/status` with `Authorization: Bearer <token>`.
   - `onboardingStatus: NOT_STARTED` with `requiresTenantSetup: true` means the frontend should show the onboarding step.
5. **Onboard:** `POST /api/onboarding/tenant` creates the organization:
   1. a tenant with status `PROVISIONING`;
   2. the default package assignment (BASIC);
   3. the caller as `ADMIN` (status `ACTIVE`);
   4. the tenant set to `ACTIVE`.
6. The user is dashboard-ready: `onboardingStatus: COMPLETED` and `effectiveRole: ADMIN`.

**Identity.** Identity always comes from the validated JWT `sub`. The role, tenant and status always come from the stored user record. Values in a request body (`cognitoSub`, `tenantId`, `roles`, `status`, package) are never trusted.

**Invited users.** Users created by a Tenant Admin or Super Admin start as **invitations**: status `INVITED`, plus a Cognito account that Cognito creates and emails a **temporary password** for (AdminCreateUser). The invited person does not register or verify:
1. logs in with the email and the temporary password; the API answers `challenge: NEW_PASSWORD_REQUIRED` and no session;
2. sets a permanent password with `POST /api/auth/new-password`, which opens the session;
3. calls `GET /api/users/me`.

On that call the invitation is linked to their Cognito account and becomes `ACTIVE`. Linking happens only when:
- the email is verified (`email_verified` claim in the ID token, or Cognito AdminGetUser). Invited accounts are created with `email_verified=true`, since the temporary password reached that inbox;
- exactly one pending invitation matches, in an `ACTIVE` tenant — or a platform invitation of a Super Admin, which has no tenant (section 12). A linked Super Admin gets `accountType: PLATFORM`, `onboardingStatus: PLATFORM_ACCOUNT` and `requiresTenantSetup: false`, so the frontend routes them to the Super Admin dashboard, never to onboarding.

Section 7 has the whole flow, including resending and the self-registration fallback.

### Browser sessions (cookies)

A browser never holds a Cognito token. `POST /api/auth/login` (and `verify-email` with a password) answers with `Set-Cookie`:

| Cookie | Holds | Path | Lifetime |
|---|---|---|---|
| `NORMAONE_SESSION` | the Cognito **ID token** (the token this API already prefers: it carries the verified email) | `/api` | the token's own (`expiresIn`, 1 h by default) |
| `NORMAONE_REFRESH` | the refresh token | `/api/auth` only | `normaone.auth.cookies.refresh-token-days` (30) |
| `NORMAONE_CHALLENGE` | Cognito's `NEW_PASSWORD_REQUIRED` session, between a temporary-password login and `/api/auth/new-password`. Not a token: it opens nothing but that one step | `/api/auth` only | `normaone.auth.cookies.challenge-seconds` (180) |

All three are `HttpOnly` (no script can read them) and `SameSite=Strict`. They are `Secure` when the request arrived over HTTPS (`NORMAONE_COOKIE_SECURE=AUTO`, the default); set `ALWAYS` in production. The access token is not stored: nothing on the server uses it, and revoking the refresh token at logout revokes the access tokens issued with it. Token values are never logged.

- **Authentication.** The resource server reads the `Authorization` header first, then the session cookie. On `/api/auth/**` the cookie is ignored, so a stale cookie never breaks a login. API clients that send `Authorization: Bearer` behave exactly as before.
- **CSRF.** `SameSite=Strict` stops other sites' pages from sending the cookies. In addition, a POST/PUT/PATCH/DELETE without an `Authorization` header that carries a session cookie, or goes to `/api/auth/**`, must send `X-Requested-With` (any value); otherwise it gets 403. Another origin cannot add that header without a CORS preflight, and none is granted.
- **CORS** is off. Set `NORMAONE_CORS_ALLOWED_ORIGINS` (comma-separated) to let exact origins call with credentials. The API tester needs none: it calls through its own dev-server proxy, same-origin.
- **Expiry.** A 401 on a cookie request means the session cookie expired; `POST /api/auth/refresh` renews it while the refresh cookie lasts. `GET /api/auth/session` says which is the case without failing.

---

## 2. Endpoints

| Method | URL | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | public | Cognito sign-up (unchanged) |
| POST | `/api/auth/verify-email` | public | Confirm the email code (unchanged) |
| POST | `/api/auth/resend-code` | public | Resend the code (unchanged) |
| POST | `/api/auth/login` | public | Cognito login. Browser: HttpOnly session cookies, no token in the body. `X-Token-Delivery: body`: tokens in the body. A temporary password answers `{challenge:"NEW_PASSWORD_REQUIRED"}` with no session (section 7) |
| POST | `/api/auth/new-password` | public (challenge cookie) | `{email, newPassword}`. Completes `NEW_PASSWORD_REQUIRED` and opens the session like a login. 400: the pool's policy refused the password; 401: no challenge, expired, or another email |
| GET | `/api/auth/password-policy` | public | The pool's password rules (`minimumLength`, `requireUppercase`, `requireLowercase`, `requireNumbers`, `requireSymbols`, `temporaryPasswordValidityDays`, `source`). `source: DEFAULT` means Cognito's defaults because the pool could not be read |
| GET | `/api/auth/session` | public | The cookie session's state (`authenticated`, `email`, `expiresAt`, `refreshAvailable`). Never returns a token |
| POST | `/api/auth/refresh` | public (refresh cookie) | New session cookie through Cognito REFRESH_TOKEN_AUTH. On failure: 401, both cookies cleared |
| POST | `/api/auth/logout` | public | Revokes the refresh token at Cognito (best effort) and clears both cookies |
| GET | `/api/users/me` | any authenticated user | Own profile, including onboarding status, effective role and tenant status. Links a pending invitation. |
| GET | `/api/onboarding/status` | any authenticated user | Onboarding state, account type, role and package code |
| POST | `/api/onboarding/tenant` | authenticated, verified, not yet onboarded | Create the organization, assign ADMIN and the BASIC package (idempotent) |
| GET | `/api/organization` | ADMIN or USER | **Read only.** The caller's own organization, taken from their stored record. It takes no id, so no other organization can be asked for |
| GET | `/api/tenant` | ADMIN | Own tenant details, user count and package |
| GET | `/api/tenant/package` | ADMIN | Own tenant's package and subscription |
| GET, PUT | `/api/users/me/email-preference` | SUPER_ADMIN, ADMIN or USER (active) | The caller's own email-notification preference; `PUT {"enabled": true\|false}` (section 15) |
| GET, PUT | `/api/tenant/users/{userId}/email-preference` | ADMIN (own tenant, USER accounts only) | A USER's email-notification preference (section 15) |
| GET | `/api/tenant/audit-events` | ADMIN (own tenant) | Own organization's audit log: `action`, `actorUserId`, `targetId`, `targetType`, `from`, `to`, `page`, `size` — no tenant parameter (section 14) |
| GET | `/api/tenant/plans`, `/api/tenant/plans/{planId}` | ADMIN (own tenant) | The plan catalogue offered to the organization, and one plan (section 13) |
| POST, GET | `/api/tenant/plan-change-requests` | ADMIN (own tenant) | Request a plan change (PENDING until a Super Admin decides); list own requests (`status`, `page`, `size`) |
| GET | `/api/tenant/plan-change-requests/{requestId}` | ADMIN (own tenant) | One own request |
| POST | `/api/tenant/plan-change-requests/{requestId}/cancel` | ADMIN (own tenant) | Withdraw a PENDING request |
| GET | `/api/tenant/users` | ADMIN | List users of own tenant: `search`, `status`, `role`, `page` (0-based), `size` (1–100) |
| POST | `/api/tenant/users` | ADMIN | Invite a user (USER or ADMIN) into own tenant. Cognito emails a temporary password; the response's `invitation` says what was sent |
| POST | `/api/tenant/users/{userId}/resend-invitation` | ADMIN | Send an `INVITED` user a new temporary password (409 for any other status) |
| GET | `/api/tenant/users/{userId}` | ADMIN | View a user of own tenant (other tenants: 404) |
| PATCH | `/api/tenant/users/{userId}` | ADMIN | Update name, phone, role (USER / ADMIN) |
| PATCH | `/api/tenant/users/{userId}/status` | ADMIN | ACTIVE / SUSPENDED / DEACTIVATED (reason required to suspend or deactivate) |
| GET | `/api/super-admin/dashboard` | SUPER_ADMIN | Organizations, admins and users by status, Super Admins, subscriptions by plan (`/summary` is an alias) |
| GET | `/api/super-admin/tenants` | SUPER_ADMIN | List and search tenants: `search`, `status`, `page`, `size` |
| POST | `/api/super-admin/tenants` | SUPER_ADMIN | Create a tenant with BASIC and an invited ADMIN, who is emailed a temporary password (`adminInvitation` in the response) |
| GET | `/api/super-admin/tenants/{tenantId}` | SUPER_ADMIN | Tenant details, user count and package |
| PATCH | `/api/super-admin/tenants/{tenantId}` | SUPER_ADMIN | Update permitted tenant fields |
| PATCH | `/api/super-admin/tenants/{tenantId}/status` | SUPER_ADMIN | ACTIVE / SUSPENDED (reason required to suspend) |
| GET | `/api/super-admin/tenants/{tenantId}/package` | SUPER_ADMIN | Package assigned to a tenant |
| GET | `/api/super-admin/admins` | SUPER_ADMIN | Tenant administrators: `search`, `tenantId`, `status`, `page`, `size` |
| POST | `/api/super-admin/admins` | SUPER_ADMIN | Invite an ADMIN into an ACTIVE organization (`tenantId`, `name`, `email`, optional `phoneNumber`, `moduleAccess`, `modulePermissions`). Cognito emails a temporary password |
| POST | `/api/super-admin/admins/{adminId}/resend-invitation` | SUPER_ADMIN | Send an `INVITED` administrator a new temporary password (409 for any other status) |
| GET | `/api/super-admin/admins/{adminId}` | SUPER_ADMIN | One administrator, with module access and organization |
| PUT | `/api/super-admin/admins/{adminId}` | SUPER_ADMIN | Replace the editable profile: `name`, `phoneNumber` |
| PATCH | `/api/super-admin/admins/{adminId}/status` | SUPER_ADMIN | ACTIVE / SUSPENDED / DEACTIVATED (reason required to suspend or deactivate) |
| GET | `/api/super-admin/users` | SUPER_ADMIN | **Read only.** Regular users across tenants: `search`, `tenantId`, `status`, `page`, `size` |
| GET | `/api/super-admin/users/{userId}` | SUPER_ADMIN | **Read only.** One regular user (no Cognito sub, no phone) |
| GET | `/api/super-admin/audit-events` | SUPER_ADMIN | **Read only.** Audit trail: `tenantId`, `targetId`, `actorUserId`, `action`, `page`, `size` |
| GET | `/api/modules` | any active role | The static module catalog: the six modules and their permissions (section 11) |
| GET, PUT | `/api/super-admin/admins/{adminId}/modules` | SUPER_ADMIN | An administrator's module assignment and effective access; replace the assignment (section 11) |
| PUT, DELETE | `/api/super-admin/admins/{adminId}/modules/{moduleId}` | SUPER_ADMIN | Assign one module with exactly these permissions; revoke one module |
| GET, PUT | `/api/tenant/users/{userId}/modules` | ADMIN (own tenant) | A user's module view; replace the assignment within the caller's own module permissions (section 11) |
| PUT, DELETE | `/api/tenant/users/{userId}/modules/{moduleId}` | ADMIN (own tenant) | Assign one module with exactly these permissions; revoke one module |
| GET, POST | `/api/super-admin/super-admins` | SUPER_ADMIN | List (`search`, `status`, `page`, `size`); invite another Super Admin, emailed a temporary password (section 12) |
| GET | `/api/super-admin/super-admins/{id}` | SUPER_ADMIN | One Super Admin |
| PATCH | `/api/super-admin/super-admins/{id}/status` | SUPER_ADMIN | ACTIVE / SUSPENDED / DEACTIVATED another Super Admin (never yourself; reason required to suspend or deactivate) |
| POST | `/api/super-admin/super-admins/{id}/resend-invitation` | SUPER_ADMIN | New temporary password for an `INVITED` Super Admin |
| GET | `/api/super-admin/accounts` | SUPER_ADMIN | **Read only.** Every account across tenants: `search`, `role`, `tenantId`, `status`, `module`, `page`, `size` (section 12) |
| GET, POST | `/api/super-admin/plans` | SUPER_ADMIN | List plans (`status`, `planCode`); create a DRAFT plan or a new version (section 13) |
| GET, PATCH | `/api/super-admin/plans/{planId}` | SUPER_ADMIN | One plan with its current subscription count; change it (metadata only once published) |
| PATCH | `/api/super-admin/plans/{planId}/status` | SUPER_ADMIN | ACTIVE / INACTIVE / ARCHIVED |
| GET | `/api/super-admin/subscriptions` | SUPER_ADMIN | Every organization's current subscription: `planCode`, `status`, `page`, `size` |
| PUT | `/api/super-admin/tenants/{tenantId}/package` | SUPER_ADMIN | Move the organization to another ACTIVE plan (`planId`, `reason`) |
| GET | `/api/super-admin/tenants/{tenantId}/package/history` | SUPER_ADMIN | The organization's subscription history, newest first |
| GET | `/api/super-admin/plan-history` | SUPER_ADMIN | Every plan operation, newest first: `eventType`, `tenantId`, `actorUserId`, `planId`, `from`, `to`, `page`, `size` (section 13) |
| GET | `/api/super-admin/plan-change-requests` | SUPER_ADMIN | Every organization's plan-change requests: `status`, `tenantId`, `page`, `size` |
| GET | `/api/super-admin/plan-change-requests/{requestId}` | SUPER_ADMIN | One request, with the Super Admin email's delivery state |
| POST | `/api/super-admin/plan-change-requests/{requestId}/approve`, `…/reject` | SUPER_ADMIN | Approve (applies the plan) with an optional `note`; reject with a required `note` |
| POST, GET | `/api/tenant/notifications` | ADMIN (own tenant) | Send a notification to the own tenant (JSON, or multipart with an attachment); list them (section 10) |
| GET | `/api/tenant/notifications/recipients` | ADMIN (own tenant) | Members who can be recipients (`INVITED` or `ACTIVE`): `search`, `page`, `size` |
| GET, PATCH | `/api/tenant/notifications/{id}`, `…/{id}/status` | ADMIN (own tenant) | View with read states; edit; archive |
| PUT, DELETE, GET | `/api/tenant/notifications/{id}/attachment` | ADMIN (own tenant) | Replace, remove, download the attachment |
| (same) | `/api/super-admin/tenants/{tenantId}/notifications[…]` | SUPER_ADMIN | The same, in the tenant named in the path |
| GET | `/api/notifications`, `/api/notifications/unread-count`, `/api/notifications/{id}` | ADMIN or USER | The caller's inbox (`filter=ALL\|UNREAD\|READ`), unread count, one notification (not marked read) |
| PATCH | `/api/notifications/{id}/read-status` | ADMIN or USER | `{"read": true\|false}` on the caller's own copy |
| GET | `/api/notifications/{id}/attachment` | ADMIN or USER | Download, with the same visibility check |

**The Super Admin cannot change regular users.** `/api/super-admin/users` is GET only: other methods answer 405, and `/users/{id}/status` does not exist (404). A regular user's profile, role and status are managed by their organization's ADMIN. The earlier `PATCH /api/super-admin/users/{id}/status` was removed; administrators' status is `PATCH /api/super-admin/admins/{id}/status`, and an id that is not an administrator answers 404 there.

**Status codes:**

| Code | When |
|---|---|
| 400 | Validation or an invalid transition |
| 401 | No token, or an invalid or expired token |
| 403 | Missing role, inactive account, suspended tenant, not onboarded, or a forbidden operation |
| 404 | Unknown resource, or another tenant's record |
| 405 | No such operation on that path |
| 409 | Duplicate or conflicting state |
| 413 | An attachment larger than `normaone.attachments.max-size` (10 MB) |
| 415 | A content type the endpoint does not take (e.g. creating a notification with neither JSON nor multipart) |
| 502 | Cognito refused or could not be reached while sending an invitation, or attachment storage failed. Nothing was saved |
| 503 | Default package not available |

Every error body has the shape `{timestamp, status, error, message, path[, fieldErrors]}`, with no stack traces or token details.

---

## 3. Role and permission matrix

| Capability | SUPER_ADMIN | ADMIN | USER | Authenticated, not onboarded |
|---|---|---|---|---|
| Own profile (`/api/users/me`) | ✓ | ✓ | ✓ | ✓ (`requiresTenantSetup: true`) |
| Onboard an organization | ✗ (platform account) | ✗ (already onboarded: idempotent or 409) | ✗ (already a member) | ✓ (verified email) |
| View own organization (`/api/organization`, read only) | ✗ (no tenant) | ✓ | ✓ | ✗ |
| View own tenant and package | — (no tenant) | ✓ | ✗ | ✗ |
| Create and invite users in own tenant | — | ✓ (USER, ADMIN) | ✗ | ✗ |
| View, update and change status of own tenant's users | — | ✓ (not own role or status) | ✗ | ✗ |
| Access another tenant's users or package | ✓ (platform, read only) | ✗ (404) | ✗ | ✗ |
| List, create and update tenants; change tenant status | ✓ | ✗ | ✗ | ✗ |
| View any tenant's package | ✓ | ✗ | ✗ | ✗ |
| Create, edit and activate/suspend/deactivate administrators; set their module access and module permissions | ✓ | ✗ | ✗ | ✗ |
| Invite another Super Admin; view and activate/suspend/deactivate Super Admins | ✓ (new platform accounts only; never self) | ✗ | ✗ | ✗ |
| Cross-tenant account directory (all roles) | ✓ (read only) | ✗ | ✗ | ✗ |
| Read the module catalog (`/api/modules`) | ✓ | ✓ | ✓ | ✗ |
| Use an application module | ✗ (no tenant) | every assigned module while the account and organization are ACTIVE (the plan is not enforced, section 11), with explicit module permissions (default: all six; every permission for the owner who registered, every permission but DELETE for an invited administrator, or what the inviter chose) | same (default: all six, VIEW, or what the inviter chose) | ✗ |
| Assign modules and module permissions | ✓ (tenant administrators, any) | ✓ (own tenant's users, only permissions they hold, not themselves) | ✗ | ✗ |
| Manage plans; change a tenant's plan; view subscriptions and history | ✓ | ✗ | ✗ | ✗ |
| View regular users across tenants | ✓ (read only) | ✗ | ✗ | ✗ |
| Create, edit, delete or change the status or role of a regular user | ✗ (no endpoint) | ✓ (own tenant) | ✗ | ✗ |
| View the audit trail | ✓ | ✗ | ✗ | ✗ |
| Send, edit and archive notifications | ✓ (any tenant, named in the path) | ✓ (own tenant; not a Super Admin's notification) | ✗ | ✗ |
| Read own notifications, mark own copy read or unread | ✗ (no tenant) | ✓ | ✓ | ✗ |
| Promote an existing account to SUPER_ADMIN | ✗ (no endpoint: Super Admins are new platform invitations) | ✗ (403) | ✗ | ✗ |
| Change own role, tenant or status | ✗ | ✗ | ✗ | ✗ |

**Enforcement points.**
1. **HTTP rules** in `SecurityConfig`:
   - `/api/super-admin/**` requires SUPER_ADMIN.
   - `/api/tenant/**` requires ADMIN.
   - `/api/organization` falls under the any-role rule below; `@PreAuthorize` on its controller narrows it to ADMIN or USER.
   - Any other protected API requires an onboarded role.
2. **Method security:** `@PreAuthorize` on both admin controllers and the organization controller.
3. **Service layer:** `CurrentUserService` re-reads the caller from MongoDB, and every Tenant Admin query is filtered by the tenant on the caller's stored record.

**No general permissions.** Platform and tenant administration are decided by role and tenant only:
- every `/api/tenant/**` operation (organization, package, users, notifications, module assignment) needs an ACTIVE ADMIN of an ACTIVE tenant, and works only on that tenant's records (another tenant's record answers 404);
- every `/api/super-admin/**` operation needs an ACTIVE platform SUPER_ADMIN;
- the resource rules stay as before: an ADMIN cannot change their own role, status or modules, cannot touch a Super Admin's notification, and grants only module permissions they hold.

The only permissions are the module permissions (section 11). The former administrator list (`ORGANIZATION_VIEW`, `PACKAGE_VIEW`, `USERS_VIEW`, `USERS_MANAGE`, `NOTIFICATIONS_MANAGE`) and its routes (`/api/super-admin/admins/{id}/permissions`, `/api/super-admin/permissions`, now 404) were removed. A `permissions` array still stored on an old user document is ignored when read — it neither grants nor removes anything — and is dropped the next time the record is saved; a `permissions` field in a request body is ignored. `GET /api/users/me` no longer has a `permissions` field.

**Effective role** (`CurrentUserResolver.effectiveRole`). The account must be `ACTIVE`, and:
- `SUPER_ADMIN` needs a platform-scoped record, meaning no `tenantId`;
- tenant roles need the tenant to be `ACTIVE`.

**Legacy role values.** These map as follows:

| Stored value | Treated as |
|---|---|
| `PLATFORM_ADMIN` | SUPER_ADMIN |
| `HR_MANAGER`, `FINANCE_MANAGER`, `COMPLIANCE_MANAGER`, `EMPLOYEE` | USER |

Existing documents keep their stored values. When a Tenant Admin changes a user's role, the user's roles are replaced by the canonical value.

---

## 4. Documents

### BASIC package (`plan_definitions`)

```json
{
  "_id": "ObjectId",
  "planCode": "BASIC",
  "planVersion": 1,
  "name": "Basic",
  "description": "Default free package assigned to every new organization. No payment is taken.",
  "status": "ACTIVE",
  "defaultPlan": true,
  "billingCycle": "MONTHLY",
  "publiclyAvailable": true,
  "effectiveFrom": "ISODate",
  "trialDays": 0,
  "listPrice": "Decimal128(0)",
  "currencyCode": "EUR",
  "maxEmployees": 10,
  "moduleApps": ["NORMAONE"],
  "createdAt": "ISODate", "updatedAt": "ISODate",
  "createdByDocsId": "system", "updatedByDocsId": "system", "version": 0,
  "_class": "com.NormaOne.backend.model.plans.PlanDefinition"
}
```

- **Seeding:** the plan is seeded at startup only when no `BASIC`/`1` plan exists. A stored plan is never overwritten on restart.
- **Initial values:** `maxEmployees` and `moduleApps` are starting values from `application.properties`, because the model requires them. Change them there before the first start, or edit the stored plan afterwards.
- **Pricing:** no paid pricing and no payment provider are defined.

### Tenant package assignment (`tenant_subscriptions`)

```json
{
  "_id": "ObjectId",
  "tenantId": "<tenant id>",
  "recordState": "ACTIVE",
  "planDocsId": "<plan_definitions _id>",
  "planVersion": 1,
  "planCode": "BASIC",
  "current": true,
  "status": "ACTIVE",
  "startDate": "ISODate",
  "currentPeriodStart": "ISODate",
  "agreedPrice": 0,
  "currencyCode": "EUR",
  "billingCycle": "MONTHLY",
  "autoRenew": false,
  "assignmentSource": "ONBOARDING | SUPER_ADMIN | BACKFILL",
  "assignedBy": "<cognito sub during onboarding, user id, or 'system'>",
  "createdAt": "ISODate", "updatedAt": "ISODate", "version": 0
}
```

A matching `subscription_history` entry (`eventType: CREATED`) and an `audit_events` entry (`PACKAGE_ASSIGNED`) are written with it.

### Indexes

`MongoIndexInitializer` creates these at startup. Before creating a unique index it checks the existing documents for duplicates.

| Collection | Index | Rule |
|---|---|---|
| users | `user_cognito_sub_uniq` | unique, partial on `cognitoSub` being a string (invitations and legacy records without a sub are excluded) |
| users | `tenant_user_email_uniq` | unique `{tenantId, email}` (emails are stored lowercase) |
| tenants | `subdomain` | unique |
| plan_definitions | `plan_code_version_uniq` | unique `{planCode, planVersion}` |
| plan_definitions | `plan_default_uniq` | unique, partial on `defaultPlan: true` (only one default plan) |
| tenant_subscriptions | `tenant_current_subscription_uniq` | unique `{tenantId}`, partial on `current: true` (one current package per tenant) |

There are also non-unique indexes for status, invitation lookup, history and audit queries.

---

## 5. Onboarding and package-assignment sequence

1. Reject a token without `sub`, and an ID token whose `email_verified` is false (403).
2. Link a pending invitation if one matches.
3. If the caller already has a user record:
   - a platform account gets 403;
   - a different subdomain gets 409;
   - the same subdomain gets the existing organization back. Any unfinished step is completed first (package, activation).
4. If the subdomain is taken, return 409. The one exception is the caller's own abandoned `PROVISIONING` tenant older than 120 s, which is discarded and recreated. A younger one returns 409 ("in progress").
5. Insert the tenant (`PROVISIONING`), assign BASIC with history, insert the ADMIN user, then set the tenant to `ACTIVE`.
6. Audit `TENANT_ONBOARDED` and `PACKAGE_ASSIGNED`.

**Atomicity.**
- **Replica set or sharded cluster:** step 5 runs in one MongoDB transaction (detected at runtime).
- **Standalone server (the local development MongoDB):** transactions are not available, so a failure deletes the user, the subscription and its history, and the tenant (compensation).

Compensation is best-effort. If the process stops between steps, a `PROVISIONING` tenant can remain. It is unusable, because users of a non-ACTIVE tenant get no role, and the owner's next onboarding attempt recovers it.

**Concurrency.** Concurrent retries are safe because of the unique indexes on subdomain, Cognito sub and current subscription; the loser of a race returns the winner's result. This is covered by tests.

---

## 6. Super Admin provisioning

There is no API that creates or promotes a Super Admin, and the first registered user is never one. The only way is `SuperAdminBootstrap`, which runs when the server starts with explicit configuration naming one Cognito account. It never accepts a role from a request, and it has no endpoint that an Admin or User could call.

### What it does and refuses

| Situation | Result |
|---|---|
| Configured, verified account with no NormaOne record | A platform record is created: no `tenantId`, roles `[SUPER_ADMIN]`, `ACTIVE`. Audited as `SUPER_ADMIN_PROVISIONED`. |
| Run again for the same account | Nothing changes (`ALREADY_PROVISIONED`). A deactivated Super Admin is **not** reactivated. |
| The account already belongs to an organization (ADMIN or USER) | Refused (`TENANT_ACCOUNT`). A tenant account is never promoted, because a Super Admin has no tenant. Use a separate Cognito account. |
| A Super Admin already exists for a different account | Refused (`ANOTHER_SUPER_ADMIN_EXISTS`) unless `allow-additional=true` is set deliberately. |
| The email belongs to a live account in an organization | Refused (`EMAIL_IN_USE`). |
| The sub, email, verification or confirmation do not match | Refused (`IDENTITY_NOT_VERIFIED`). |

Every refusal is logged with its reason, and nothing is written.

### The two verification modes

| `NORMAONE_SUPER_ADMIN_VERIFICATION` | When | How the identity is proven | Needs |
|---|---|---|---|
| `COGNITO` (default) | At startup | Cognito `AdminGetUser`: the account exists, is `CONFIRMED`, and has this sub and this verified email | AWS credentials allowed `cognito-idp:AdminGetUser` on the user pool |
| `TOKEN` | At the account's first sign-in | A validated **ID token** with this sub, this email and `email_verified: true` | Nothing extra. Use this for local development without AWS credentials |

In `TOKEN` mode the record is created by the configured account's first authenticated request (`GET /api/users/me`, `GET /api/onboarding/status` or `POST /api/onboarding/tenant`). The token's signature, issuer and app client have already been checked by the resource server. Tokens from any other account are ignored, as are access tokens (they carry no email) and ID tokens with a different or unverified email.

### Local setup, step by step

The backend runs on `http://localhost:8881`. The commands use `curl` in Git Bash; the API tester (`NormaOne/api-tester`, Account › Sign up & in) and Postman folder 1 do the same.

**1. Register and verify a dedicated account.** Use an email that is **not** an ADMIN or USER in any organization, and **do not onboard** with it: onboarding makes it a tenant account, which the bootstrap refuses.

```bash
curl -s -X POST http://localhost:8881/api/auth/register -H 'Content-Type: application/json' -H 'X-Requested-With: curl' \
  -d '{"name":"Platform Admin","email":"you+platform@example.com","password":"<password>"}'
curl -s -X POST http://localhost:8881/api/auth/verify-email -H 'Content-Type: application/json' -H 'X-Requested-With: curl' \
  -d '{"email":"you+platform@example.com","code":"<code from the email>"}'
```

**2. Log in and get the Cognito sub.** Any of these three ways works:

```bash
# a) Log in, then ask the backend. /api/users/me creates no record for an account with none.
# X-Token-Delivery: body returns the tokens in the body for a non-browser client (a browser gets cookies).
ID_TOKEN=$(curl -s -X POST http://localhost:8881/api/auth/login -H 'Content-Type: application/json' \
  -H 'X-Requested-With: curl' -H 'X-Token-Delivery: body' \
  -d '{"email":"you+platform@example.com","password":"<password>"}' | sed -E 's/.*"idToken":"([^"]+)".*/\1/')
curl -s http://localhost:8881/api/users/me -H "Authorization: Bearer $ID_TOKEN"
#    -> {"cognitoSub":"<SUB>", "onboardingStatus":"NOT_STARTED", "accountType":"NONE", ...}

# b) Decode the ID token: its "sub" claim (the API tester's Token control shows the decoded token).
echo "$ID_TOKEN" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null; echo

# c) With AWS credentials, from Cognito directly:
aws cognito-idp list-users --region eu-central-1 --user-pool-id eu-central-1_DuNWXi6EQ \
  --filter 'email = "you+platform@example.com"' --query 'Users[0].Attributes[?Name==`sub`].Value' --output text
```

**3. Start the backend once with the bootstrap enabled.** Pick `TOKEN` unless your AWS credentials may call `AdminGetUser` on the pool.

```bash
# Git Bash
cd NormaOne/backend
NORMAONE_SUPER_ADMIN_ENABLED=true \
NORMAONE_SUPER_ADMIN_COGNITO_SUB=<SUB> \
NORMAONE_SUPER_ADMIN_EMAIL=you+platform@example.com \
NORMAONE_SUPER_ADMIN_VERIFICATION=TOKEN \
./mvnw spring-boot:run
```

```powershell
# PowerShell
cd NormaOne\backend
$env:NORMAONE_SUPER_ADMIN_ENABLED='true'
$env:NORMAONE_SUPER_ADMIN_COGNITO_SUB='<SUB>'
$env:NORMAONE_SUPER_ADMIN_EMAIL='you+platform@example.com'
$env:NORMAONE_SUPER_ADMIN_VERIFICATION='TOKEN'
.\mvnw.cmd spring-boot:run
```

The same values can be passed as arguments instead of environment variables. Optional: `NORMAONE_SUPER_ADMIN_NAME` (display name).

```bash
./mvnw spring-boot:run -Dspring-boot.run.arguments="--normaone.bootstrap.super-admin.enabled=true --normaone.bootstrap.super-admin.cognito-sub=<SUB> --normaone.bootstrap.super-admin.email=you+platform@example.com --normaone.bootstrap.super-admin.verification=TOKEN"
```

The startup log says what happened:
- `COGNITO`: `Provisioned Super Admin <id> (...)`, or the reason it refused.
- `TOKEN`: `... will be provisioned at its first sign-in. Sign in as ... and call GET /api/users/me with the ID token.`

**4. (TOKEN mode) Sign in once.** Log in again if the token from step 2 has expired, then:

```bash
curl -s http://localhost:8881/api/users/me -H "Authorization: Bearer $ID_TOKEN"
#    -> {"effectiveRole":"SUPER_ADMIN", "accountType":"PLATFORM", "onboardingStatus":"PLATFORM_ACCOUNT", ...}
```

It must be the **ID token**. An access token is ignored, because it carries no email to compare.

**5. Verify Super Admin access.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8881/api/super-admin/dashboard -H "Authorization: Bearer $ID_TOKEN"   # 200
mongosh --quiet mongodb://localhost:27017/normaone --eval \
  'printjson(db.users.find({roles:"SUPER_ADMIN"},{email:1,tenantId:1,roles:1,status:1}).toArray())'
#    -> one record, no tenantId, roles ["SUPER_ADMIN"], status "ACTIVE"
mongosh --quiet mongodb://localhost:27017/normaone --eval \
  'printjson(db.audit_events.find({action:"SUPER_ADMIN_PROVISIONED"}).toArray())'
```

An ADMIN or USER token gets `403` on the same URL.

**6. Turn the bootstrap off.** Restart without the `NORMAONE_SUPER_ADMIN_*` variables. If they stay set, later starts log `ALREADY_PROVISIONED` and change nothing. But a forgotten configuration is still a standing instruction to provision, so remove it.

**If it refused:**

| Log says | Fix |
|---|---|
| `IDENTITY_NOT_VERIFIED` in COGNITO mode | AWS credentials cannot call `AdminGetUser` (switch to `TOKEN`), or the sub/email do not match the confirmed account |
| `IDENTITY_NOT_VERIFIED` in TOKEN mode | Sign in with the ID token of that exact account; its email must be verified |
| `TENANT_ACCOUNT` | That account was onboarded or invited into an organization. Register a separate account |
| `EMAIL_IN_USE` | The email belongs to someone in an organization. Use another address |
| `ANOTHER_SUPER_ADMIN_EXISTS` | One already exists. Add `NORMAONE_SUPER_ADMIN_ALLOW_ADDITIONAL=true` only if a second one is really intended |
| `MISCONFIGURED` | Set both `NORMAONE_SUPER_ADMIN_COGNITO_SUB` and `NORMAONE_SUPER_ADMIN_EMAIL` |

---

## 7. Invitations and first sign-in

### The flow

1. **Invite.** One of these creates an `INVITED` record:
   - a Tenant Admin, with `POST /api/tenant/users` (USER or ADMIN);
   - a Super Admin, with `POST /api/super-admin/admins`;
   - a Super Admin, with `POST /api/super-admin/tenants` (its `initialAdmin`).

   After the record is saved, the backend calls Cognito **AdminCreateUser** with:
   - username = the email;
   - attributes `email`, `name` and `email_verified=true`;
   - delivery `EMAIL`;
   - **no `TemporaryPassword`**.

   Cognito generates the temporary password and emails it with the pool's invitation template. The backend never sees, stores, logs or returns the password.
2. **Report.** The response carries what happened: `invitation` for users and administrators, `adminInvitation` for a new tenant. It has the form `{delivery, emailSent, message}`, where `delivery` is one of:

   | `delivery` | When | Email sent |
   |---|---|---|
   | `TEMPORARY_PASSWORD` | Cognito created the account and emailed the temporary password | yes |
   | `EXISTING_ACCOUNT` | The email already has a Cognito account with its own password. The invitation links at its next sign-in | no |
   | `SELF_REGISTRATION` | Temporary passwords are switched off (see below). The person registers and verifies as an owner does | no |

   If Cognito refuses or cannot be reached, the request answers **502** and **nothing is saved**: the record is deleted again, and a new tenant is discarded.
3. **First login.** `POST /api/auth/login` with the email and the temporary password. Cognito answers `NEW_PASSWORD_REQUIRED`, and the API returns `200 {"challenge":"NEW_PASSWORD_REQUIRED"}` with **no tokens and no session**:
   - a browser gets the challenge session as the HttpOnly `NORMAONE_CHALLENGE` cookie, and any older session cookies are cleared;
   - an `X-Token-Delivery: body` client gets it as `challengeSession` instead.
4. **Set the permanent password.** `POST /api/auth/new-password` with `{"email", "newPassword"}`. Body-mode clients add `"session"`. The backend answers the challenge with **RespondToAuthChallenge**:
   - **Success:** the session opens exactly like a login (cookies, or tokens in body mode), and the challenge cookie is cleared.
   - **400:** the pool's password policy refused the password. Cognito's message is returned and the challenge cookie is kept, so another password can be tried. If Cognito no longer accepts that session, the next attempt answers 401.
   - **401:** there is no challenge, it has expired (the app client's authentication-flow session, 3 minutes by default), or it belongs to another email. Sign in again with the temporary password.
5. **Link.** The frontend reads `GET /api/users/me`. The invitation links, the record becomes `ACTIVE`, and the person lands on their screens. Every protected endpoint stays 401 until step 4 has produced a session.

**Password rules on screen.** `GET /api/auth/password-policy` returns the pool's policy, read with DescribeUserPool and cached. If the backend may not read the pool, it returns Cognito's defaults with `source: "DEFAULT"`. Cognito enforces the real policy either way.

**Expired temporary password.** It is valid for the pool's *temporary password validity* (7 days by default). After that, login answers 401 *"The temporary password has expired. Ask your administrator to resend the invitation."* An administrator then calls one of:
- `POST /api/tenant/users/{id}/resend-invitation` (ADMIN of the same tenant);
- `POST /api/super-admin/admins/{id}/resend-invitation` (SUPER_ADMIN).

Either one calls AdminCreateUser with `MessageAction=RESEND`, which emails a new temporary password and invalidates the old one. It works only while the record is `INVITED` and the Cognito account is still `FORCE_CHANGE_PASSWORD`; otherwise it answers 409. If the Cognito account is missing (for example, it was deleted by hand), it is created again.

**Audit.** `USER_INVITED` and `USER_INVITATION_RESENT` record the delivery kind, but never a password, token or challenge session.

**Fallback.** `NORMAONE_INVITATIONS_TEMPORARY_PASSWORD=false` (`normaone.invitations.send-temporary-password`) turns AdminCreateUser off. Invitations are then recorded only, `delivery` is `SELF_REGISTRATION`, and the invited person registers and verifies the email themselves, as before this feature. Use it where the backend has no AWS credentials.

### Manual Cognito setup

These are settings in AWS that the code cannot make for you:

1. **IAM.** The credentials the backend runs with need these actions on the user pool:
   - `cognito-idp:AdminCreateUser` (invite and resend);
   - `cognito-idp:AdminGetUser` (an existing account's status; email from access tokens);
   - `cognito-idp:DescribeUserPool` (password rules; optional, since the defaults are used without it).

   Login, `new-password`, refresh and logout use the public client APIs (InitiateAuth, RespondToAuthChallenge, RevokeToken) and need no IAM permission.
2. **App client** (the one in `aws.cognito.client-id`):
   - no client secret;
   - `ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH` enabled;
   - token revocation enabled;
   - *Authentication flow session duration* at least as long as `normaone.auth.cookies.challenge-seconds` (both are 3 minutes by default; the cookie should not outlive Cognito's session).
3. **User pool sign-in.** Email must be the username or a sign-in alias, because the backend creates the account with the email as its username. Keep *self-registration* enabled: owners still sign up through `/api/auth/register`.
4. **Invitation message** (*Messaging → Message templates → Invitation message*). Write the email the invited person receives. It must contain `{username}` and `{####}` (the temporary password). Add the sign-in address, for example:

   > You have been invited to NormaOne. Sign in at https://app.example.com/account-auth/auth with the email {username} and the temporary password {####}. You will be asked to choose your own password. This password expires in 7 days.

5. **Temporary password validity** (*Authentication methods → Password policy*): the number of days an invitation is usable. Match the number in the template.
6. **Email delivery.** Cognito's built-in sender has a low daily quota and is meant for testing. In production, configure Amazon SES as the pool's email provider, with a verified sending domain.

---

## 8. Postman test sequence

Import `postman/NormaOne-Auth-RBAC.postman_collection.json` and set the `baseUrl` variable.

**Tokens.**
- Login requests send `X-Token-Delivery: body` and store the **ID token** in a collection variable. Every `/api/auth` request sends `X-Requested-With`.
- Login stores the **ID token** in a collection variable by default. The ID token carries `email` and `email_verified`, which onboarding and invitation linking use without extra Cognito calls.
- Access tokens also work. In that case email details are read with AdminGetUser, which needs AWS credentials.
- Every protected request sends `Authorization: Bearer {{...Token}}` and `Content-Type: application/json`.

Use three Cognito accounts: **A** (future Tenant Admin), **U** (invited user) and **S** (Super Admin, provisioned as in section 6).

| # | Request | Token | Body | Expected |
|---|---|---|---|---|
| 1 | POST `/api/auth/register` | — | `{"name":"Ana","email":"a@…","password":"…"}` | 202 `{message}` |
| 2 | POST `/api/auth/verify-email` | — | `{"email":"a@…","code":"123456"}` | 200 `{message, verified:true}` |
| 3 | POST `/api/auth/login` | — | `{"email":"a@…","password":"…"}` | 200 `{accessToken,idToken,refreshToken,tokenType}` (saved as `tenantAdminToken`) |
| 4 | GET `/api/onboarding/status` | A | — | 200 `{onboardingStatus:"NOT_STARTED", requiresTenantSetup:true, accountType:"NONE"}` |
| 5 | GET `/api/tenant/users` | A | — | **403** (not onboarded) |
| 6 | POST `/api/onboarding/tenant` | A | `{"organizationName":"Acme","subdomain":"acme-demo","countryCode":"ES"}` | 201 `{tenantId, status:"ACTIVE", userRoles:["ADMIN"], packageCode:"BASIC", subscriptionStatus:"ACTIVE", …}` |
| 7 | Same as 6 again | A | same | 201, same `tenantId` (idempotent) |
| 8 | POST `/api/onboarding/tenant` | A | other subdomain | **409** |
| 9 | GET `/api/users/me` | A | — | 200 `{onboardingStatus:"COMPLETED", effectiveRole:"ADMIN", tenantId, tenantStatus:"ACTIVE"}` |
| 10 | GET `/api/tenant/package` | A | — | 200 `{tenantId, status:"ACTIVE", assignmentSource:"ONBOARDING", plan:{planCode:"BASIC", name:"Basic", listPrice:0, …}}` |
| 11 | POST `/api/tenant/users` | A | `{"name":"Uma","email":"u@…","role":"USER"}` | 201 `{id, status:"INVITED", linked:false, tenantId:<A's>, invitation:{delivery:"TEMPORARY_PASSWORD", emailSent:true, message}}`. Cognito emails `u@…` a temporary password |
| 12 | POST `/api/tenant/users` | A | `{"name":"X","email":"x@…","role":"SUPER_ADMIN"}` | **403** |
| 12a | POST `/api/tenant/users/{{userId}}/resend-invitation` | A | — | 200, a new temporary password emailed (the old one stops working) |
| 13 | POST `/api/auth/login` as **U** with the temporary password from the email | — | `{"email":"u@…","password":"<temporary>"}` | 200 `{challenge:"NEW_PASSWORD_REQUIRED", challengeSession}`, no tokens (`challengeSession` saved) |
| 13a | POST `/api/auth/new-password` | — | `{"email":"u@…","newPassword":"short"}` + `session` | **400** (password policy) |
| 13b | POST `/api/auth/new-password` | — | `{"email":"u@…","newPassword":"<permanent>","session":"{{challengeSession}}"}` | 200 tokens, saved as `userToken` |
| 14 | GET `/api/users/me` | U | — | 200 `{effectiveRole:"USER", tenantId:<A's>, onboardingStatus:"COMPLETED"}` (invitation linked) |
| 14a | GET `/api/organization` | U | — | 200 `{id:<A's tenant>, name, subdomain, status:"ACTIVE", …}` (read only) |
| 14b | POST `/api/tenant/users/{{userId}}/resend-invitation` | A | — | **409** (U is ACTIVE now) |
| 15 | GET `/api/tenant/users` | U | — | **403** |
| 16 | GET `/api/tenant/package` | U | — | **403** |
| 17 | GET `/api/super-admin/tenants` | U or A | — | **403** |
| 18 | GET `/api/tenant/users?search=uma` | A | — | 200 `{content:[{… status:"ACTIVE", linked:true}], totalElements:1}` |
| 19 | PATCH `/api/tenant/users/{{userId}}/status` | A | `{"status":"SUSPENDED","reason":"Leave"}` | 200 `{status:"SUSPENDED"}` (U now gets 403 everywhere except `/me`) |
| 20 | PATCH `/api/tenant/users/{{selfId}}` | A | `{"role":"USER"}` | **403** (own role) |
| 21 | Log in **S** | — | — | 200, saved as `superAdminToken` |
| 22 | GET `/api/super-admin/dashboard` | S | — | 200 `{totalOrganizations, totalAdmins, activeAdmins, totalUsers, activeUsers, totalSuperAdmins, currentSubscriptionsByPlan:{BASIC:n}, …}` |
| 23 | GET `/api/super-admin/tenants?search=acme` | S | — | 200 page with `packageCode:"BASIC"` |
| 24 | GET `/api/super-admin/tenants/{{tenantId}}/package` | S | — | 200 package |
| 25 | POST `/api/super-admin/tenants` | S | `{"organizationName":"Beta","subdomain":"beta-demo","countryCode":"ES","initialAdmin":{"name":"Bea","email":"bea@…"}}` | 201 `{status:"ACTIVE", packageCode:"BASIC", userCount:1}` |
| 26 | PATCH `/api/super-admin/tenants/{{tenantId}}` | S | `{"tenantName":"Acme Global","city":"Valencia"}` | 200 |
| 27 | PATCH `/api/super-admin/tenants/{{tenantId}}/status` | S | `{"status":"SUSPENDED"}` | **400** (reason required) |
| 28 | Same as 27 | S | `{"status":"SUSPENDED","reason":"Review"}` | 200. A and U now get 403 on tenant APIs. |
| 29 | Same as 27 | S | `{"status":"ACTIVE"}` | 200 |
| 30 | GET `/api/super-admin/admins?tenantId={{tenantId}}` | S | — | 200 page of `{id, role:"ADMIN", moduleAccess, modulePermissions, organization:{id,name,subdomain,status}, …}` |
| 31 | POST `/api/super-admin/admins` | S | `{"tenantId":"{{tenantId}}","name":"Nora","email":"nora@…"}` | 201 `{status:"INVITED", role:"ADMIN", linked:false, moduleAccess:[six modules]}` |
| 32 | Same as 31 | S | same email | **409** |
| 33 | Same as 31 | S | `"tenantId":"000000000000000000000000"` | **404** organization not found |
| 34 | PUT `/api/super-admin/admins/{{adminId}}` | S | `{"name":"Nora Ruiz","phoneNumber":"+34 600 000 001"}` | 200 |
| 35 | PUT `/api/super-admin/admins/{{adminId}}/modules/JORNADAPULSE` | S | `{"permissions":["JORNADAPULSE_VIEW"]}` | 200 module view |
| 36 | Same as 35 | S | `{"permissions":["FACTURAFLOW_VIEW"]}` | **400** (a permission of another module) |
| 37 | PATCH `/api/super-admin/admins/{{selfId}}/status` | S | `{"status":"SUSPENDED","reason":"Review","confirmNoActiveAdmin":true}` | 200 (without `confirmNoActiveAdmin`: **409**, A is the only active administrator). A gets 403 on tenant APIs until reactivated. |
| 38 | GET `/api/super-admin/users?tenantId={{tenantId}}` | S | — | 200 page of regular users only |
| 39 | PATCH `/api/super-admin/users/{{userId}}/status` | S | `{"status":"DEACTIVATED","reason":"x"}` | **404** (no such route: users are read only) |
| 40 | PUT / POST / DELETE `/api/super-admin/users…` | S | — | **405** |
| 41 | GET `/api/super-admin/admins` | A or U | — | **403** |
| 41a | GET `/api/organization` | S | — | **403** (a platform account has no organization) |
| 41b | POST `/api/super-admin/admins/{{adminId}}/resend-invitation` | S | — | 200 while Nora is INVITED |
| 42 | Any protected request | none / expired | — | **401** JSON |

---

## 9. Limitations and manual steps

1. **Atomicity on standalone MongoDB:** compensation is not atomic (see section 5). Use a replica set in production to get real transactions.
2. **Audit writes:** a failed audit write does not undo the action. It is logged as an error.
3. **Email from access tokens:** with access tokens, email-based features (invitation linking, onboarding names) need AWS credentials allowed to call `cognito-idp:AdminGetUser`. ID tokens work without them.
4. **Email changes:** emails of linked users cannot be changed through the API, since the email belongs to Cognito.
5. **Invitations:** an invitation can only be linked by someone who is not already a member of another tenant (one tenant per Cognito account).
6. **Not implemented:**
   - billing and payment collection (plan changes take no payment; a Tenant Admin's change is a request a Super Admin approves; section 13);
   - subscription renewals, cancellations and expiries (no workflow performs them, so the plan history has no such events);
   - email delivery is off until an SMTP server and sender are configured (section 13, "Email notifications"); it has not been tested against a real mail server;
   - tenant deletion and changing a subdomain;
   - promoting an existing account to Super Admin, or demoting one (by design: Super Admins are new platform invitations, section 12);
   - module-level endpoints: the module backends do not exist in this repository yet. They must call `ModuleAccessService.requireModulePermission` (section 11);
   - changing an administrator's role or organization from the Super Admin API: an administrator is always an ADMIN of the organization they were invited into, and turning one into a regular user is their organization's decision (`PATCH /api/tenant/users/{id}` with `role`).
7. **Administrators are invitations.** `POST /api/super-admin/admins` invites exactly as a Tenant Admin invites a user: Cognito emails a temporary password and the record links at the first sign-in (section 7). An email already used by a live account in another organization, or on the platform, is refused with 409.
8. **Existing data:**
   - On first start, existing ACTIVE or SUSPENDED tenants without a package get BASIC (`normaone.packages.backfill-existing-tenants=true`; set it to `false` to skip).
   - If duplicate Cognito subs, tenant emails or subdomains already exist, the matching unique index is **not** created and the log shows an error naming the duplicate values. Remove the duplicates and restart.
9. **Health endpoint:** the previous `HealthController` (`/api/health`) was already deleted in the working copy before this change, so no health endpoint exists.
10. **Invitations and Cognito together.** The invitation record and the Cognito account are written one after the other, not atomically. If Cognito fails, the record is removed (502). If the record is later deleted by hand, the Cognito account stays; delete it in the console. The Cognito setup in section 7 is manual.

---

## 10. Notifications

Messages from a Tenant Admin or a Super Admin to members of **one** tenant. There is no platform-wide notification.

### Documents

**`notifications`** (`Notification` extends `TenantBase`):

| Field | Meaning |
|---|---|
| `_id`, `tenantId`, `createdAt`, `updatedAt`, `createdByDocsId`, `updatedByDocsId`, `version` | Inherited. `createdByDocsId` is the creator's user id |
| `recordState`, `archivedAt` | Inherited. `ACTIVE` or `ARCHIVED`; the API calls it `status` |
| `subject` | Required, at most 200 characters |
| `body` | Required, at most 10,000 characters, plain text (render it as text, never HTML) |
| `audience` | `SELECTED` or `TENANT` |
| `users` | `SELECTED`: `[{userId, readStatus, readAt}]`, each recipient's own read state (`readAt` is stored as `null` until read). `TENANT`: always `[]` |
| `attachment` | `null`, or `{attachmentId, fileName, contentType, sizeBytes, checksumSha256, storageProvider, storageKey, uploadedAt, uploadedByDocsId}` |
| `createdByRole` | `ADMIN` or `SUPER_ADMIN` |

**`notification_receipts`** holds one document per member who has read a `TENANT` notification: `{notificationId, tenantId, userId, readAt}`. A missing receipt means unread. Only broadcasts have receipts; a `SELECTED` notification keeps its read states in `users`.

**Indexes** are created by `MongoIndexInitializer`:

| Index | Keys | Serves |
|---|---|---|
| `notification_tenant_audience_time_idx` | `tenantId, recordState, audience, createdAt desc` | Inbox (broadcasts) and admin lists |
| `notification_recipient_time_idx` | `tenantId, users.userId, recordState, createdAt desc` | Inbox (selected) |
| `notification_creator_time_idx` | `tenantId, createdByDocsId, createdAt desc` | Admin list `createdBy=` filter |
| `notification_receipt_uniq` (unique) | `notificationId, userId` | One receipt per member |
| `notification_receipt_user_idx` | `tenantId, userId` | A member's receipts for the inbox |

### Who receives what

- **`SELECTED`.** The request sends `userIds`:
  - Duplicates are removed, and at most `normaone.notifications.max-recipients` (1000) are allowed.
  - Every id must be an `INVITED` or `ACTIVE` member of the target tenant. If one is not, the whole request answers **400**, with the same wording whether the id does not exist or belongs to another tenant.
  - The backend writes `{userId, readStatus: false, readAt: null}` for each recipient. A `users` array, `tenantId` or `createdByRole` in the body is ignored.
- **`TENANT`.** The request sends no `userIds` (400 if it does). The notification reaches every member of that tenant whose user record was created **on or before** the notification.
  - Someone who joins later does not inherit older broadcasts. Membership starts at `user.createdAt`: the invitation for an invited user, onboarding for the owner. An administrator can still select a newcomer by id.
- **The tenant:**
  - a Tenant Admin's own, from their stored record;
  - for a Super Admin, the one in the path. It must exist (404), and sending requires it to be `ACTIVE` (409).

### Who may do what

| | Tenant Admin (ACTIVE ADMIN) | Super Admin | Member (ADMIN or USER) |
|---|---|---|---|
| Create | Own tenant | Any ACTIVE tenant | ✗ |
| List, view with read states | Own tenant, including the platform's notifications | Any tenant | ✗ |
| Edit, archive, change attachment | Notifications an ADMIN created (403 for a Super Admin's) | Any | ✗ |
| Inbox, view, download | Their own, as a member | ✗ (no tenant) | Their own |
| Read or unread | Own copy only | ✗ | Own copy only |

An id from another tenant, a notification the caller is not a recipient of, an archived one (for members) and a broadcast that predates the caller's membership all answer **404**. Attachment downloads run exactly the same check.

### Read state

- **`SELECTED`.** A single atomic update on the caller's own array element, matched by `userId`. It sets `readStatus: true, readAt: <server time>`, or `false, null` for unread. It matches only when the element is in the other state, so a repeated request changes nothing (the first `readAt` is kept).
- **`TENANT`.** "Read" upserts the caller's receipt; the unique index means one per member, even under concurrent requests. "Unread" deletes the caller's receipt only.
- **Never shared.** One member's action never touches another member's state. An administrator's edit rewrites `users` on the server from its current value, so read states written meanwhile are kept.
- **Detail views don't count as reads.** `GET /api/notifications/{id}` does not mark the notification read.

### Examples

```http
POST /api/tenant/notifications
Content-Type: application/json

{"subject":"Important Compliance Update","body":"Please review the updated compliance requirements.",
 "audience":"SELECTED","userIds":["6ace1b3421ad37f3253beb6c","6ace1b3421ad37f3253beb6d"]}
```

The response is 201:

```json
{ "id": "6b0f2c1e9d4a7b3c2e1f0a11", "tenantId": "6ace1b3421ad37f3253beb6b", "audience": "SELECTED", "status": "ACTIVE",
  "subject": "Important Compliance Update", "body": "Please review the updated compliance requirements.",
  "users": [ { "userId": "6ace1b3421ad37f3253beb6c", "readStatus": false, "readAt": null, "name": "Uma", "email": "uma@…" },
             { "userId": "6ace1b3421ad37f3253beb6d", "readStatus": false, "readAt": null, "name": "Luis", "email": "luis@…" } ],
  "recipientCount": 2, "readCount": 0, "createdBy": "6ace1b3421ad37f3253beb6a", "createdByRole": "ADMIN",
  "createdAt": "2026-10-14T10:00:00Z", "updatedAt": "2026-10-14T10:00:00Z" }
```

A Super Admin broadcasts to one tenant:

```http
POST /api/super-admin/tenants/6ace1b3421ad37f3253beb6b/notifications
Content-Type: application/json

{"subject":"Planned Maintenance","body":"The platform will be unavailable during scheduled maintenance.","audience":"TENANT"}
```

The response is 201 with `"users": []`, `"readCount": 0` and `"eligibleCount": <members it reaches>`.

To send with an attachment, use `multipart/form-data` with two parts: a `notification` part (the JSON above) and an `attachment` part (the file). The `notification` part may carry `Content-Type: application/json` or **no content type at all** — which is what `formData.append("notification", JSON.stringify(body))`, a Postman form-data text field and `curl -F` send. Before this was supported such requests were answered 415; they are now parsed and validated like a JSON body. A part that declares another type (for example `text/plain`) is still 415.

```bash
curl -X POST "$BASE/api/super-admin/tenants/$TENANT_ID/notifications" -H "Authorization: Bearer $TOKEN" \
  -F 'notification={"subject":"Policy","body":"Please read the attached policy.","audience":"SELECTED","userIds":["6ace…6c"]}' \
  -F 'attachment=@Policy.pdf'
```

Other calls:

- **Recipients.** `GET /api/tenant/notifications/recipients?search=ana` (or `/api/super-admin/tenants/{tenantId}/notifications/recipients`) returns `{content:[{id, name, email, role, status}], …}`: exactly the members a `SELECTED` notification accepts (`INVITED` or `ACTIVE`, in that tenant). It needs the same access as sending: an ACTIVE ADMIN of that tenant (or a Super Admin).
- **Edit.** `PATCH /api/tenant/notifications/{id}` with `{"subject":"…","body":"…","addUserIds":[…],"removeUserIds":[…]}`. Only the fields sent change. Added recipients start unread. Removing the last recipient answers 400 (archive instead), and `TENANT` notifications have no list to change.
- **Archive.** `PATCH /api/tenant/notifications/{id}/status` with `{"status":"ARCHIVED","reason":"Superseded"}`. The notification leaves every inbox and unread count and stays in the admin lists (`?status=ARCHIVED`); it cannot be edited while archived.
- **Restore.** The same route with `{"status":"ACTIVE","reason":"…"}` makes an archived notification ACTIVE again — back in its recipients' inboxes and unread counts, and editable — with its subject, body, audience, recipients, read states, receipts and attachment unchanged. Who may: whoever may archive it (a Tenant Admin: notifications an ADMIN sent; a Super Admin: any in the tenant named in the path); another tenant's notification is 404, and restoring needs an ACTIVE organization (409 otherwise). Audited as `NOTIFICATION_RESTORED`; restoring an ACTIVE notification changes nothing. Any status other than `ARCHIVED` or `ACTIVE` is 400. It is never deleted. `ACTIVE` answers 400, because archived notifications are not reactivated. Archiving twice changes nothing.
- **Inbox.** `GET /api/notifications?filter=UNREAD&page=0&size=20` returns `{content:[{id, subject, body, audience, readStatus, readAt, attachment, createdByRole, createdAt, updatedAt}], …}`. It shows the caller's own state only, never the recipient list.
- **Unread count.** `GET /api/notifications/unread-count` returns `{"unreadCount": 3}`.
- **Mark read.** `PATCH /api/notifications/{id}/read-status` with `{"read": true}` returns the inbox item with the caller's new state.

### Attachments

- **Accepted files:**
  - The type is decided from the **content**: PDF, PNG and JPEG by their signatures; DOCX and XLSX by their package contents (read from the ZIP directory without decompressing).
  - The file name's extension must match the content.
  - The client's MIME type is ignored, and the stored type is the detected one.
  - Maximum `normaone.attachments.max-size` (10 MB; larger answers 413). The allowed types are `normaone.attachments.allowed-types`.
  - A SHA-256 checksum is stored. This is a content check, not a malware scan.
- **Storage:**
  - Object key: `notifications/<tenantId>/<notificationId>/<attachmentId>`, built from ids only.
  - **LOCAL** (development): files are written under `normaone.attachments.local.directory`.
  - **S3** (production): the object is written to a private bucket with server-side encryption.
  - Responses never include the storage provider or key.
- **Download.** `GET …/{id}/attachment` runs the same visibility check as viewing the notification:
  - LOCAL answers with the file itself as a download (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`);
  - S3 answers **302** to a presigned URL that lives `normaone.attachments.s3.download-url-seconds` (60) and forces a download.
- **Lifecycle:**
  - The file is stored first. If the notification cannot be saved, the file is deleted again.
  - Replacing or removing an attachment deletes the old file only after the database no longer refers to it.
  - Archiving **keeps** the file, because administrators can still open archived notifications.
  - A failed delete is logged with the ids for manual removal. The request still succeeds.

### Configuration

| Property | Environment variable | Default | Production |
|---|---|---|---|
| `normaone.notifications.max-recipients` | `NORMAONE_NOTIFICATIONS_MAX_RECIPIENTS` | `1000` | |
| `normaone.attachments.storage` | `NORMAONE_ATTACHMENTS_STORAGE` | `LOCAL` | `S3` |
| `normaone.attachments.max-size` | `NORMAONE_ATTACHMENTS_MAX_SIZE` | `10MB` | also sets `spring.servlet.multipart.max-file-size` |
| `normaone.attachments.allowed-types` | `NORMAONE_ATTACHMENTS_ALLOWED_TYPES` | `PDF,PNG,JPEG,DOCX,XLSX` | |
| `normaone.attachments.local.directory` | `NORMAONE_ATTACHMENTS_DIR` | `~/.normaone/attachments` | (unused) |
| `normaone.attachments.s3.bucket` | `NORMAONE_ATTACHMENTS_S3_BUCKET` | — | **required**; startup fails without it when storage is S3 |
| `normaone.attachments.s3.region` | `NORMAONE_ATTACHMENTS_S3_REGION` | `aws.region` | |
| `normaone.attachments.s3.key-prefix` | `NORMAONE_ATTACHMENTS_S3_KEY_PREFIX` | empty | e.g. `prod/` |
| `normaone.attachments.s3.download-url-seconds` | `NORMAONE_ATTACHMENTS_DOWNLOAD_URL_SECONDS` | `60` | keep short |
| `spring.servlet.multipart.max-request-size` | `NORMAONE_MULTIPART_MAX_REQUEST_SIZE` | `11MB` | the file plus the JSON part |

**S3 setup (manual):**
- Create a private bucket: *Block all public access* on, no bucket policy granting public reads, default encryption on.
- Give the backend's credentials (default provider chain: environment, profile or instance role) `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/<prefix>notifications/*`. `GetObject` is what presigned downloads are signed with.
- No credentials go in configuration files.

**Audit.** `NOTIFICATION_CREATED` (audience, recipient count, attachment yes/no), `NOTIFICATION_UPDATED` (changed field names, recipients added/removed, attachment `ADDED`/`REPLACED`/`REMOVED` with type and size) and `NOTIFICATION_ARCHIVED` (audience, reason). Never the body, file names or contents. Reads are not audited; `readAt` records them.

### Limitations

1. **No delivery channel.** Notifications are pulled from the inbox. There is no email or push.
2. **Embedded recipients.** Recipients are embedded, up to 1,000 per notification by default, well within MongoDB's 16 MB document limit. For far larger audiences, move per-recipient state to a separate collection, as broadcast receipts already are.
3. **The inbox reads all of a member's receipts.** The inbox loads the member's broadcast receipt ids (bounded by the broadcasts they have read). Over years of heavy broadcasting, archive old notifications or add a receipt clean-up.
4. **Not atomic across file and database.** The attachment file and the notification are separate writes. Compensation deletes files after a failed save, but a crash between the two can leave a file no notification refers to. Archived notifications' files are kept until a purge job exists (none yet).
5. **Content checks only.** Attachments are checked by content type, not scanned for malware. Add a scanner (for example S3 Malware Protection) before trusting files from many admins.
6. **Legacy records.** User records without `createdAt` (none are written by this application) see every broadcast of their tenant.

---

## 11. Modules and module permissions

NormaOne is the portal; the **six application modules** are fixed and defined once, server-side, in `ModuleCatalog` (`model/modules`). There is no module collection and no module builder. Identifiers are the existing `ModuleApps` values (also used by `PlanDefinition.moduleApps`); `NORMAONE` is the portal itself, never assignable and with no permissions. Order and Spanish labels follow the portal's module list (`PrevenWork/frontend/src/layout/AppShell.tsx`).

| Order | Id | Name | Label (es) | Permissions | Requirements |
|---|---|---|---|---|---|
| 1 | `FACTURAFLOW` | FacturaFlow | Facturación y Cumplimiento | VIEW, CREATE, EDIT, APPROVE, EXPORT, MANAGE | documented (prototype, BRD *Facturas y Gastos*) |
| 2 | `JORNADAPULSE` | JornadaPulse | Registro de Jornada y Turnos | VIEW, CREATE, EDIT, APPROVE, EXPORT, MANAGE | documented (*Jornada y Ausencias*) |
| 3 | `DATOSPILOT` | DatosPilot | PRL y Coordinación de Evidencias | VIEW, CREATE, EDIT, APPROVE, EXPORT, MANAGE | documented (*PRL y Documentación*) |
| 4 | `PREVENWORK` | PrevenWork | Privacidad y Operaciones RGPD | VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT, MANAGE | documented (RGPD / LOPDGDD prototype) |
| 5 | `BUZONDESK` | BuzonDesk | Canal de Denuncias (Ley 2/2023) | VIEW, MANAGE | **provisional**: no requirements in this repository |
| 6 | `SAFEVOICE` | SafeVoice | Comunicaciones y Alertas Pyme | VIEW, MANAGE | **provisional**: no requirements in this repository |

Permission ids are `<MODULE>_<ACTION>` (`FACTURAFLOW_VIEW`, `PREVENWORK_DELETE`, …), each with a Spanish `label` and an English `description` (`GET /api/modules`). Only actions a module's requirements support exist: issued invoices are rectified and working-time records corrected, never deleted, so the only DELETE is PrevenWork's erasure under retention rules. How the prototypes' own permissions map onto these:

| Permission | Prototype permissions it covers |
|---|---|
| `FACTURAFLOW_VIEW` | `dashboard.view`, `customers.view`, `suppliers.view`, `invoices.view`, `invoices.view_drafts`, `expenses.view_all`, `fiscal.view`, `reports.view`, `handover.view` |
| `FACTURAFLOW_CREATE` | `invoices.edit_draft` (new drafts), `customers.manage`, `suppliers.manage`, `expenses.submit_own` |
| `FACTURAFLOW_EDIT` | `invoices.edit_draft`, `invoices.rectify_request`, `payments.record`, `payments.reverse`, `disputes.manage`, `reminders.send`, `expenses.manage_supplier`, `expenses.record_payment` |
| `FACTURAFLOW_APPROVE` | `invoices.approve`, `invoices.issue`, `invoices.deliver`, `expenses.review_team`, `expenses.review_all`, `fiscal.reconcile`, `handover.acknowledge` |
| `FACTURAFLOW_EXPORT` | `exports.create`, `handover.manage` |
| `FACTURAFLOW_MANAGE` | `settings.view`, `settings.company`, `settings.users`, `audit.view`, `fiscal.simulate` |
| `JORNADAPULSE_VIEW` | `time.view_*`, `absences.view_all`, `employees.view_*`, `policies.view`, `reports.*` (not `reports.export`), `anomalies.view_all`, `representative.view` |
| `JORNADAPULSE_CREATE` | `time.clock_own`, `corrections.request_own`, `absences.request_own`, `records.delete_request` |
| `JORNADAPULSE_EDIT` | `shifts.manage_*`, `employees.manage`, `corrections.propose` |
| `JORNADAPULSE_APPROVE` | `corrections.review_*`, `absences.review_*`, `anomalies.manage_*` |
| `JORNADAPULSE_EXPORT` | `reports.export` |
| `JORNADAPULSE_MANAGE` | `policies.manage`, `periods.close`, `settings.manage`, `audit.view` |
| `DATOSPILOT_VIEW` | `own.view`, `team.view`, `employees.view_all`, `worksites.view`, `requirements.view`, `evidence.view_all`, `risk.view`, `actions.view_all`, `cae.view`, `readiness.view_all`, `reports.view`, `representative.view` |
| `DATOSPILOT_CREATE` | `own.submit`, `evidence.upload`, `evidence.request`, `risk.register`, `requirements.draft` |
| `DATOSPILOT_EDIT` | `employees.manage`, `worksites.manage`, `requirements.assign`, `training.manage`, `ppe.manage`, `actions.manage`, `cae.manage`, `exceptions.manage`, `own.acknowledge`, `team.acknowledge_site` |
| `DATOSPILOT_APPROVE` | `requirements.approve_professional`, `evidence.review`, `risk.review`, `actions.review`, `readiness.decide`, `readiness.exception`, `changes.review` |
| `DATOSPILOT_EXPORT` | `reports.export` |
| `DATOSPILOT_MANAGE` | `requirements.manage`, `settings.manage`, `audit.view` |
| `PREVENWORK_VIEW` | `ropa.view`, `rights.view`, `incidents.view_summary`, `documents.view`, `suppliers.view`, `retention.view`, `tasks.view_*`, `reports.view` |
| `PREVENWORK_CREATE` / `PREVENWORK_EDIT` | `ropa.manage`, `rights.manage`, `incidents.manage`, `documents.manage`, `suppliers.manage`, `tasks.manage` |
| `PREVENWORK_DELETE` | `retention.erase` |
| `PREVENWORK_APPROVE` | `ropa.review`, `documents.approve`, `suppliers.review`, `rights.decide_extension`, `rights.decide_retention`, `incidents.decide_notification`, `incidents.close` |
| `PREVENWORK_EXPORT` | `reports.export_standard` |
| `PREVENWORK_MANAGE` | `retention.manage`, `settings.manage`, `audit.view` |

**Not covered on purpose** (restricted data needs its own permission when that module's backend is built): DatosPilot `health.view_conclusions`, `health.manage`, `requirements.approve_health`; PrevenWork `incidents.view_restricted`, `reports.export_unredacted`.

### Module access and effective permissions

Three fields on `users`, the lists stored as names (so an unknown value in any document grants nothing instead of failing to load):

| Field | Meaning |
|---|---|
| `moduleAccess` | Application modules assigned to the user. Missing or `[]`: none |
| `modulePermissions` | `ModulePermission` names granted inside the assigned modules. Missing or `[]`: none. A permission whose module is not assigned counts for nothing |
| `moduleAccessAssignedAt` | When the assignment was last made (at creation, by the backfill, or by an administrator). Missing: never assigned. Needed because the two lists are written as `[]` on every save, so an empty list alone cannot tell "never assigned" from "emptied on purpose" |

A module permission is **effective** only when all of these hold (`ModuleAccessService`):

1. the account acts as `ADMIN` or `USER` of an `ACTIVE` tenant (a Super Admin has no tenant and no module access);
2. the module is in `moduleAccess`;
3. the permission is in `modulePermissions`.

**The plan is not enforced (for now).** `normaone.modules.enforce-plan-entitlement` (`NORMAONE_MODULES_ENFORCE_PLAN_ENTITLEMENT`, default `false`) is the one switch, read only by `ModuleAccessService.entitledModules`. While it is `false`, every organization is entitled to all six modules, so on the seeded BASIC plan an active account can use every module assigned to it. Setting it to `true` restores the plan check as a fourth condition — the tenant's current subscription is `TRIAL` or `ACTIVE` and its plan's `moduleApps` lists the module — with no other code change. The plan is still reported, for information only (`inPlan`, `planModules`).

### Default assignment

**Every new tenant account gets all six modules**, persisted on its user record:

| Created by | Path | Role | Default module permissions |
|---|---|---|---|
| Self-service onboarding (the owner who registers the organization) | `POST /api/onboarding/tenant` | ADMIN | **every permission**, DELETE included |
| Super Admin, with a new organization | `POST /api/super-admin/tenants` (initial admin) | ADMIN | every permission except DELETE |
| Super Admin, into an existing organization | `POST /api/super-admin/admins` | ADMIN | every permission except DELETE |
| Tenant Admin | `POST /api/tenant/users`, `role: ADMIN` | ADMIN | every permission except DELETE, **within the inviter's own** |
| Tenant Admin | `POST /api/tenant/users`, `role: USER` (default) | USER | **VIEW** in each module, within the inviter's own |
| Super Admin | `POST /api/super-admin/super-admins`, bootstrap | SUPER_ADMIN | **none** — a platform account has no tenant modules |

The policy is written once, in `ModuleCatalog.defaultModulesFor` / `defaultPermissionsFor`, and published on `GET /api/modules` as each permission's `defaultFor` (the roles that receive it), so screens never hard-code it. Assigning a module never grants all of its permissions: DELETE (PrevenWork's erasure) is never a role default, and a USER gets no administrative permission. Legacy role names follow their canonical role.

**The owner is the exception** (`ModuleCatalog.ownerPermissions`): whoever registers the organization through self-service onboarding gets every permission of all six modules. An administrator grants only what they hold, so this is what lets the owner give any module permission — DELETE included — to the administrators and users they invite. **Invited accounts get what the inviter chooses**: the invite form sends `moduleAccess` and `modulePermissions` (any permissions the inviter holds), and without them the role defaults above apply. The first administrator of an organization a Super Admin creates is invited, so they get the ADMIN defaults; the Super Admin can grant more on `PUT /api/super-admin/admins/{id}/modules`.

A create request may instead name the assignment (`moduleAccess`, `modulePermissions`); it is validated exactly like a change (below) and, for a Tenant Admin, kept within their own permissions. `"moduleAccess": []` creates an account with no module. The stored lists are de-duplicated and kept in catalog order, so repeated values in a request are stored once; a retried creation answers 409 and creates no second record (unique email per tenant).

**A role change** (`PATCH /api/tenant/users/{id}` with `role`) resets the module permissions to the new role's defaults inside the modules already assigned (within the caller's own): a demoted administrator keeps no administrative module permission.

### Managing assignments

| Who | Read | Replace all | One module | Revoke one module |
|---|---|---|---|---|
| Super Admin → tenant administrators | `GET /api/super-admin/admins/{id}/modules` | `PUT …/modules` | `PUT …/modules/{moduleId}` | `DELETE …/modules/{moduleId}` |
| Tenant Admin → users of their own tenant | `GET /api/tenant/users/{id}/modules` | `PUT …/modules` | `PUT …/modules/{moduleId}` | `DELETE …/modules/{moduleId}` |

```http
PUT /api/tenant/users/6ace1b3421ad37f3253beb6c/modules/JORNADAPULSE
Content-Type: application/json

{"permissions":["JORNADAPULSE_VIEW","JORNADAPULSE_CREATE"]}
```

Every answer is the user's module view: `{userId, active, planEnforced, assignedAt, modules: [ {moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions} ×6 ], assignedModules, assignedPermissions, entitledModules, planModules, effectiveModules, effectivePermissions}`.

**Validation** (400, nothing written): `NORMAONE` or an unknown module, an unknown permission, or a permission that belongs to another module (`FACTURAFLOW` with `JORNADAPULSE_VIEW`). Module ids and permission ids are enums in the request DTOs, so nothing the client invents gets past Jackson.

**Scope** (403, nothing written): a Tenant Admin may add **or remove** only module permissions they hold themselves — nobody hands out (or strips) what a Super Admin withheld from them. Modules themselves grant nothing and may be assigned freely. A Tenant Admin never changes their own module access; another tenant's user answers 404; a USER has no tenant route (403). The Super Admin has no scope limit, and reaches only tenant administrators (a regular user's or a Super Admin's id answers 404 on the admin routes).

**Revocation** applies to the next request: authorization reads the stored record every time. Every change is audited as `USER_MODULE_ACCESS_CHANGED` with before/after modules and permissions.

### `GET /api/users/me`

Two flat lists, nothing more: `modules` is the ids of the modules the account can use **now**, in catalog order, and `modulePermissions` is every module permission the backend allows now (a permission id starts with its module's id). There is no general `permissions` field.

```json
{ "userId": "6ace1b3421ad37f3253beb6c", "accountType": "TENANT", "roles": ["USER"], "effectiveRole": "USER",
  "tenantId": "6ace1b3421ad37f3253beb6b", "organizationName": "Org alpha", "onboardingStatus": "COMPLETED", "…": "…",
  "modules": ["FACTURAFLOW", "JORNADAPULSE", "DATOSPILOT", "PREVENWORK", "BUZONDESK", "SAFEVOICE"],
  "modulePermissions": ["FACTURAFLOW_VIEW", "JORNADAPULSE_VIEW", "DATOSPILOT_VIEW", "PREVENWORK_VIEW", "BUZONDESK_VIEW", "SAFEVOICE_VIEW"] }
```

A module is listed when it is assigned, entitled and the account active. While plan entitlement is not enforced every module is entitled, so an active account lists every assigned module — on the seeded BASIC plan (`moduleApps: [NORMAONE]`) too. **Navigation shows these modules.** A suspended or deactivated account, or one whose organization is suspended, gets `modules: []` and `modulePermissions: []`; so does a Super Admin. The per-module detail (`assigned`, `entitled`, `available`, `inPlan`, stored and effective permissions per module) is on the administrators' module routes above, for screens that edit an assignment. **Visibility is not authorization**: module endpoints must call `ModuleAccessService.requireModulePermission(jwt, permission)`, which answers 403 otherwise.

### Existing accounts (backfill)

Accounts created before default assignment have no assignment, and keep none until one is made. A startup backfill gives them exactly what a new account of their role gets — every permission for an owner (an ADMIN whose Cognito account onboarded the tenant, `tenants.onboardedByCognitoSub`). It is **off by default**, because it grants permissions:

1. Back up the `users` collection.
2. Start the backend once with `NORMAONE_MODULES_BACKFILL_DEFAULTS=true` (`normaone.modules.backfill-defaults`).
3. Read the log line `Module access backfill: N candidate(s); default modules assigned to X administrator(s) and Y user(s); Z skipped.`
4. Unset the variable and restart.

It touches only tenant records with no `moduleAccessAssignedAt`, whose module lists are missing or empty, with no `USER_MODULE_ACCESS_CHANGED` audit event, holding ADMIN or USER (legacy names included) and no platform role. Super Admins, any customized assignment (however narrow) and accounts emptied on purpose are left exactly as they are. Each update is conditional on the record still having no marker, so a second run (or two instances) assigns nothing again; each assignment is audited with `source: BACKFILL`. Instead of the backfill, an administrator can assign modules user by user with the routes above.

---

## 12. Super Admin accounts

A Super Admin is a **platform account**: no `tenantId`, role `SUPER_ADMIN`. There are two ways to get one, and neither promotes an existing account:

1. **The first one** — `SuperAdminBootstrap` (section 6), from server configuration only. It is unchanged: it still refuses when any Super Admin already exists (unless `allow-additional=true`) and never promotes a tenant account.
2. **Every other one** — invited by an active Super Admin:

```http
POST /api/super-admin/super-admins
Content-Type: application/json

{"name":"Sara Ortega","email":"sara@normaone.example","phoneNumber":"+34 600 000 009"}
```

```json
{ "id": "6b10…", "name": "Sara Ortega", "email": "sara@normaone.example", "role": "SUPER_ADMIN", "status": "INVITED",
  "linked": false, "invitedAt": "2026-10-16T10:00:00Z",
  "invitation": { "delivery": "TEMPORARY_PASSWORD", "emailSent": true, "message": "An invitation email with a temporary password was sent to …" } }
```

**How it works.**
- The server writes a platform record (`INVITED`, no tenant, role `SUPER_ADMIN`). Any `role`, `roles`, `tenantId` or `permissions` in the body is ignored.
- Cognito `AdminCreateUser` then emails a temporary password; this backend never sees it.
- At the first sign-in (temporary password → `POST /api/auth/new-password` → `GET /api/users/me`), the invitation links to the Cognito identity and becomes `ACTIVE`. The response says `accountType: PLATFORM`, `onboardingStatus: PLATFORM_ACCOUNT`, `requiresTenantSetup: false`, `effectiveRole: SUPER_ADMIN`.
- **Post-login routing contract:** route on `GET /api/users/me` — `effectiveRole: SUPER_ADMIN` goes to the Super Admin dashboard. `requiresTenantSetup` in the *login* response is always `true` for backward compatibility and must not be used for routing. `POST /api/onboarding/tenant` answers 403 for a platform account.

**Refusals (nothing is written):**
- 409 — the email already has a platform account (a deactivated one is reactivated with `PATCH …/status`, never duplicated);
- 409 — the email belongs to an organization account that is live, or whose sign-in is linked (a tenant account is never made a Super Admin);
- 400 — invalid name or email;
- 502 — Cognito refused or could not be reached. The record is deleted again, so a retry is safe;
- 403 — the caller is not an active Super Admin (Tenant Admins, users, suspended Super Admins, accounts that have not onboarded); 401 — anonymous.

**Partial failures and recovery.** The MongoDB record is written first, then Cognito is called; if Cognito fails the record is deleted (compensation) and the API answers 502. If the process stops between the two writes, an `INVITED` platform record without an email may remain: deactivate it (`PATCH /api/super-admin/super-admins/{id}/status`) or resend (`POST …/resend-invitation`). If a record is removed by hand, the Cognito account stays; delete it in the Cognito console.

**Lifecycle.** `PATCH /api/super-admin/super-admins/{id}/status` with `{"status":"SUSPENDED","reason":"…"}` (or `DEACTIVATED`, or `ACTIVE`). A reason is required to suspend or deactivate; a pending invitation can only be deactivated (revoked); re-enabling a revoked invitation restores `INVITED`. **Removing a Super Admin's platform access is `DEACTIVATED`**: the record and its history stay, and Cognito signs the account out and disables it (section 14). A Super Admin can never change their own status, the last active Super Admin cannot be suspended or deactivated (409), and Super Admin status changes run one at a time under a platform-wide lock (`ResourceLockService`, key `super-admins`) that re-checks the acting Super Admin is still active — so two Super Admins removing each other at the same moment can never leave none (a removed actor's waiting request is refused with 403). If the lock is held for more than 10 seconds the request answers 409 "try again"; a lock left by a crashed instance expires after 30 seconds. Audited as `USER_INVITED`, `USER_INVITATION_RESENT`, `USER_STATUS_CHANGED` and `USER_LINKED`, with `role: SUPER_ADMIN`.

**Account directory.** `GET /api/super-admin/accounts?role=ADMIN&tenantId=…&status=ACTIVE&module=FACTURAFLOW&search=ana&page=0&size=20` lists every account across tenants and the platform, read only: `{id, name, email, role, status, linked, organization, moduleAccess, modulePermissions, invitedAt, activatedAt, deactivatedAt, statusReason, createdAt, updatedAt}`. `role` accepts legacy names (`TENANT_ADMIN` lists administrators). Never included: Cognito sub, phone number, tokens. The Tenant Admin's own `GET /api/tenant/users` is unchanged and tenant-scoped.

---

## 13. Plans and subscriptions

"Packages" are subscription plans (`plan_definitions`), assigned to organizations through `tenant_subscriptions`, with `subscription_history` as the append-only timeline. All of it is Super Admin only. **No payment is taken**: there is no billing integration.

**Plans are versioned and immutable once published** (as `PlanDefinition` already required):
- `POST /api/super-admin/plans` creates a **DRAFT**, never the default plan. Without `planVersion` the next version of `planCode` is used (codes are stored upper-case). `moduleApps` is de-duplicated and ordered: `NORMAONE` first, then the modules in catalog order.
- `PATCH /api/super-admin/plans/{id}`: a DRAFT can change anything. Any other plan changes only `name`, `description`, `publiclyAvailable`, `effectiveFrom`, `effectiveUntil`. Changing `billingCycle`, `trialDays`, `listPrice`, `currencyCode`, `maxEmployees`, `maxUsers`, `durationMonths` or `moduleApps` on a published plan is 409: create a new version. ARCHIVED plans cannot change.
- **Fields** beyond the original model: `maxUsers` — the user-seat limit (1–1,000,000; omitted = no limit; **enforced**, see "User seats" below); `durationMonths` — the committed term (1–120; omitted = rolling), which sets a new subscription's `currentPeriodEnd`. `currencyCode` must be a real ISO 4217 code (`ABC` is 400). Module ids outside `ModuleApps` are 400.
- `latestVersion: false` in a plan response marks a historical version (a newer version of the same code exists). Nothing deletes a plan; deactivating or archiving never touches the subscriptions on it or any history.
- `PATCH /api/super-admin/plans/{id}/status`: DRAFT → ACTIVE or ARCHIVED; ACTIVE ⇄ INACTIVE; ACTIVE or INACTIVE → ARCHIVED (final). The status decides only whether the plan can be assigned from now on; existing subscriptions keep their version.
- **The default plan stays available.** New organizations get the latest ACTIVE version of `normaone.packages.default-plan-code` (BASIC). Deactivating or archiving the last ACTIVE version of it is 409; activate a newer version first.

```http
POST /api/super-admin/plans
Content-Type: application/json

{"planCode":"PRO","name":"Professional","billingCycle":"MONTHLY","listPrice":49.90,"currencyCode":"EUR",
 "maxEmployees":50,"trialDays":0,"moduleApps":["NORMAONE","FACTURAFLOW","JORNADAPULSE"]}
```

**Changing an organization's plan** — `PUT /api/super-admin/tenants/{tenantId}/package` with `{"planId":"…","reason":"Upgrade requested"}`. The plan must be ACTIVE; the organization ACTIVE or SUSPENDED. In one MongoDB transaction where the deployment supports it (compensation otherwise):
1. the current subscription stops being current: `CANCELLED`, `cancelledAt`, `endedAt`, `cancellationReason: "Plan changed to PRO v1"` — only if it is still the current one, so a concurrent change gets 409;
2. a new current subscription is created from the plan (status `ACTIVE`, source `SUPER_ADMIN`, the plan's price, currency and billing cycle as the agreed snapshot);
3. a `PLAN_CHANGED` history entry records the previous and new plan ids, versions and statuses.

The answer is the new package (as `GET /api/super-admin/tenants/{id}/package`). Already on that plan: 409. Audited as `PACKAGE_CHANGED`. Plans: `PLAN_CREATED`, `PLAN_UPDATED`, `PLAN_STATUS_CHANGED`.

**Reading.** `GET /api/super-admin/plans?status=ACTIVE&planCode=PRO`; `GET /api/super-admin/plans/{id}` (with `currentSubscriptions`); `GET /api/super-admin/subscriptions?planId=…` (which organizations are on one plan version; also `planCode`, `status`); `GET /api/super-admin/tenants/{id}/package/history`.

### User seats (`maxUsers`, `SeatService`)

- **The limit** is the `maxUsers` of the plan version the organization's current subscription references (published versions are immutable). No `maxUsers`, or no current subscription, means no limit.
- **What takes a seat:** every account of the organization — administrators and users — that is `ACTIVE`, `INVITED` (a pending invitation reserves its seat) or `SUSPENDED` (temporarily blocked, still the organization's). `DEACTIVATED` accounts (removed users, revoked invitations) free their seat. Super Admins belong to no organization.
- **What needs a free seat:** `POST /api/tenant/users`, `POST /api/super-admin/admins`, and reactivating a `DEACTIVATED` account (`PATCH …/status` to `ACTIVE`, from either API). A full organization gets **409** *"The organization's plan allows N user seats and N are in use (active, suspended and invited accounts). Deactivate an account or move to a plan with more seats first."* — nothing is written and no Cognito invitation is sent. `SUSPENDED → ACTIVE` needs no new seat. The first administrator of a new organization always fits (`maxUsers` ≥ 1).
- **Concurrency:** the check and the write run under the organization's seat lock (`ResourceLockService`, key `seats:{tenantId}`, in the `resource_locks` collection; 10 s wait, 30 s lease), so simultaneous invitations cannot exceed the limit.
- **Downgrades** to a plan with fewer seats than are in use are allowed (nobody loses access); no seat is given out until enough accounts are deactivated.
- `GET /api/tenant/package` and `GET /api/super-admin/tenants/{id}/package` include `seats: {limit, used}`.

### Plan history (`plan_history`)

An append-only, platform-wide timeline of plan operations, written **together with each operation** (`PlanHistoryService.withEntry`): in one MongoDB transaction where the deployment supports it; on a standalone server the entry is written first and removed again if the operation fails, so there is never an operation without its entry or an entry for something that did not happen. Entries are never updated.

| `eventType` | Written when | Notable fields |
|---|---|---|
| `PLAN_CREATED` | a plan or version is created | `status: DRAFT` |
| `PLAN_UPDATED` | a plan's fields change | `changes: [{field, from, to}]` for every changed field |
| `PLAN_STATUS_CHANGED` | activated, deactivated, archived | `changes: [{field:"status", from, to}]`, `reason` |
| `TENANT_PLAN_CHANGED` | an organization moves to another plan (direct, or by an approved request) | `previousPlan*`, `plan*`, `referenceType: SUBSCRIPTION` + the new subscription id |
| `PLAN_CHANGE_REQUESTED` / `_APPROVED` / `_REJECTED` / `_CANCELLED` | the request workflow below | `correlationId` = the request id, `reason` (request reason or decision note) |

Every entry has `occurredAt`, `actorUserId`, `actorRole`, `tenantId` (tenant events), `status`, `referenceType`/`referenceId`. `GET /api/super-admin/plan-history` filters by `eventType`, `tenantId`, `actorUserId`, `planId` (as the plan or the previous plan) and an inclusive `from`/`to` (ISO-8601 instants; `to` before `from` is 400). `subscription_history` remains the per-subscription lifecycle and is still written for every subscription change. Renewals, cancellations and expiries are not recorded because no workflow performs them yet.

### Plan-change requests (Tenant Admin)

**Why requests.** There is no billing or payment integration (the billing models exist, but nothing creates invoices or takes payments), so a Tenant Admin never changes the plan directly: choosing a plan records a `PENDING` request, and a Super Admin approves it — which applies the plan through the same path as `PUT /api/super-admin/tenants/{id}/package` — or rejects it.

**Catalogue.** `GET /api/tenant/plans` lists every plan in the database (ACTIVE first, then by price), whatever its status or `publiclyAvailable` flag, as `{id, planCode, planVersion, name, description, status, listPrice, currencyCode, billingCycle, durationMonths, trialDays, maxEmployees, maxUsers, modules, current, selectable}` — no subscription counts, creators, default flag or sale window. `selectable` = ACTIVE and not the current plan. The current subscription with its start and term-end dates stays `GET /api/tenant/package`.

```http
POST /api/tenant/plan-change-requests
Content-Type: application/json

{"planId":"6b20…","reason":"We are growing past the seat limit"}
```

- The organization is the caller's own (from their record); there is no tenant field and one sent is ignored. Another organization's request answers 404.
- One open request (`PENDING`/`PROCESSING`) per organization (unique partial index): a second is 409; so are the current plan and a plan that is not ACTIVE. An unknown plan id is 404.
- Saved with the requester (id, name, email), the current and requested plans (id, code, version, name), the time and the reason; recorded in the plan history and audited (`PLAN_CHANGE_REQUESTED`, visible in the organization's audit log).
- `POST …/{id}/cancel` withdraws a PENDING request.
- **Approve** (`POST /api/super-admin/plan-change-requests/{id}/approve`, optional `note`): the request is claimed (`PROCESSING`) so two Super Admins cannot decide it at once, then the plan is applied. If that fails — the plan is no longer ACTIVE, the organization is not ACTIVE or SUSPENDED, it is already on the plan — the request returns to `PENDING`, nothing is recorded, and the answer is 409. Otherwise it becomes `APPROVED` with `appliedSubscriptionId`. An approval interrupted mid-way (still `PROCESSING` after 5 minutes) can be decided again.
- **Reject** (`…/reject`, `note` required): `REJECTED`; the organization keeps its plan and may ask again.

### Email notifications (outbox)

Once a request is saved — never before — the Super Admins are emailed every detail: the request (status, time in UTC, reason, id), the organization (name, id, subdomain, status, contact email), the requester (name, email, role, user id), and the current and requested plans with their terms (name, code and version, price and billing cycle, duration, seats, employees, modules, status), plus a link when `normaone.email.plan-change-review-url` is set. Recipients: `normaone.email.plan-change-recipients`, or every ACTIVE Super Admin's address when empty.

The email goes through an outbox (`email_outbox`, `EmailOutboxService`): written after the request, sent at once, and on failure retried with backoff (1, 2, 4… minutes, at most hourly) up to `normaone.email.max-attempts` (5), then `FAILED`. Each attempt claims the email first, so several instances never send it twice. **A retry only resends the email**: it never re-creates the request or re-applies a plan — a resubmitted request is refused by the one-open-request index (409), and a repeated approval by the request's claim (409), so a plan is applied at most once. An email failure never touches the saved request or its history. The request's `notification` shows `SENT`, `PENDING` or `FAILED` (attempts and the last error for Super Admins only).

**Configuration still required.** There was no email service in this application. Two providers are built in (`normaone.email.provider`):
- **`SES` (default)** — Amazon SES v2 `SendEmail` with the AWS default credentials, the same ones Cognito uses, in `aws.region` (or `NORMAONE_EMAIL_SES_REGION`). Set `NORMAONE_EMAIL_FROM` to an address (or domain) **verified in SES** in that region, and allow `ses:SendEmail` for the credentials. While the SES account is in the **sandbox**, every recipient (the Super Admins' addresses) must be verified as well, or SES refuses the email (it is then retried and shown as PENDING with SES's error).
- **`SMTP`** — `SPRING_MAIL_HOST` (and `SPRING_MAIL_PORT`, `SPRING_MAIL_USERNAME`, `SPRING_MAIL_PASSWORD` as the server needs) plus `NORMAONE_EMAIL_FROM`.

Until a sender is set, emails wait as `PENDING` with `lastError` saying delivery is not configured, and are sent by the retry once it is. Delivery to a real SES account or mail server has not been tested here.

### Plans and modules

Plan entitlement is **not enforced** at the moment (`normaone.modules.enforce-plan-entitlement=false`, section 11): a plan's `moduleApps` is reported as `inPlan` / `planModules` but neither grants nor withholds a module, and changing the plan changes no one's access. When enforcement is switched on, a plan's `moduleApps` is what the organization is *entitled* to; it still grants no user anything by itself (module access also needs the user's assignment and explicit module permissions), and only `TRIAL` and `ACTIVE` subscriptions entitle.

---

## 14. Removing access, safeguards and the organization audit log

### Removing a user or administrator (Tenant Admin)

`PATCH /api/tenant/users/{id}/status` with `{"status":"DEACTIVATED","reason":"…"}` removes access. It is a **soft removal**: the record, its audit trail and every reference to it stay, and it can be reactivated. The existing policy is kept as it was: an ADMIN of an ACTIVE tenant may deactivate users and other administrators of their own organization, never themselves, never a platform account, never another organization's user (404), and never the last active ADMIN (409; demoting the last one by role is refused the same way). A USER has no administration route (403).

### Removing an administrator (Super Admin)

`PATCH /api/super-admin/admins/{id}/status` with `DEACTIVATED` (or `SUSPENDED`). The organization itself is never touched. Removing the organization's **only active administrator** is refused with 409 unless the request says `"confirmNoActiveAdmin": true` (for example a compromised account); the organization's way back is then `POST /api/super-admin/admins`, which invites a replacement. The audit event records `leftWithoutActiveAdmin: true`.

### Cognito follows the status (`CognitoAccountAccessService`)

Authorization never depends on Cognito — every request re-reads the account and refuses anything not ACTIVE — but the identity provider is kept consistent:

| Change | Order | In Cognito |
|---|---|---|
| → SUSPENDED | record saved first (access ends at once), then Cognito | `AdminUserGlobalSignOut` (refresh tokens revoked) |
| → DEACTIVATED | record saved first, then Cognito | `AdminDisableUser` + `AdminUserGlobalSignOut` |
| → ACTIVE / INVITED again | Cognito first, then the record | `AdminEnableUser` if the account is disabled; if Cognito fails, 502 and nothing is saved |

A Cognito failure while removing access leaves access removed and is recorded as `details.identityProvider: FAILED` (also `DONE`, `NO_ACCOUNT`, `SKIPPED`). Already-issued access tokens stay cryptographically valid until they expire, but the backend refuses them because the account is no longer ACTIVE. Needs the IAM permissions `cognito-idp:AdminUserGlobalSignOut`, `AdminDisableUser`, `AdminEnableUser` and `AdminGetUser`; switch off with `normaone.identity.sync-account-status=false`. This applies to users, administrators and Super Admins alike.

### Organization audit log

`GET /api/tenant/audit-events` returns the caller's own organization's events, newest first: invitations, linking, status and role changes, module access changes, plan-change requests and plan changes, notifications. Filters: `action`, `actorUserId`, `targetId`, `targetType`, `from`, `to`, `page`, `size`. **There is no tenant parameter**: the tenant comes from the caller's record and is part of the MongoDB query (`AuditService.search`), so another organization's events and platform-only events (plan definitions, Super Admin accounts) are never read; a `tenantId` sent anyway is ignored. Audit details hold identifiers and non-sensitive values only — never passwords, tokens or Cognito secrets. The Super Admin's `GET /api/super-admin/audit-events` takes the same date and target-type filters.


---

## 15. Email-notification preferences

Each account has `emailNotificationsEnabled` on its user record. **Not set means enabled** — every existing account, and every new one until it is changed: email is opt-out. The preference never affects in-app notifications.

| Who | Route | May change |
|---|---|---|
| Any active account (SUPER_ADMIN, ADMIN, USER) | `GET`/`PUT /api/users/me/email-preference` | their **own** preference only — the route has no user id, and an id in the body is ignored |
| An ACTIVE ADMIN of an ACTIVE organization | `GET`/`PUT /api/tenant/users/{userId}/email-preference` | the **USER** accounts of their own organization. Another organization's user: **404** (the lookup is filtered by the admin's tenant). Another administrator, a platform account, or their own account through this route: **403** — administrators set their own preference |
| A Super Admin | — | no tenant account's preference |

`PUT` takes `{"enabled": true|false}` (400 without it) and answers `{userId, name, email, role, emailNotificationsEnabled, explicit, emailDeliveryAvailable}` — `explicit: false` means the default applies; `emailDeliveryAvailable: false` means no email provider is configured yet. `GET /api/users/me` and the tenant user list also carry `emailNotificationsEnabled`. Every change is a single-field update, audited as `USER_EMAIL_PREFERENCE_CHANGED` (`by: SELF` or `ADMIN`).

**Delivery follows each recipient's preference:**
- *Plan-change emails* go to the active Super Admins (or `normaone.email.plan-change-recipients`) **except** accounts that turned email off; if nobody is left, no email is queued and the request is saved as usual.
- *Notification emails*: once email delivery is configured, each recipient with email on gets their own copy through the outbox (SELECTED: the listed recipients; TENANT: the INVITED and ACTIVE members); recipients who turned it off get none. **While email is not configured nothing is queued** — so enabling delivery later does not send every past notification — and the screens say "Coming Soon". The in-app notification is saved and delivered first and is never changed by email.
