# NormaOne Backend — API Reference

Every HTTP endpoint the NormaOne backend serves: **100 routes** in 10 areas, each with who may call it, what it does, what it accepts, what it returns and how it refuses.

Written from the source. Each entry was read out of its controller, request DTO, service and `SecurityConfig`, and this file was checked against every `@*Mapping` in `src/main/java/.../controllers` when it was generated (no route missing, none extra). For the role and permission model behind these rules, see [AUTH_RBAC_GUIDE.md](AUTH_RBAC_GUIDE.md).

## Contents

1. [Conventions](#conventions)
2. [Features at a glance](#features-at-a-glance)
3. [Endpoint index](#endpoint-index)
4. [Authentication](#authentication) (9)
5. [My account and onboarding](#my-account-and-onboarding) (7)
6. [Notification inbox (members)](#notification-inbox-members) (5)
7. [Tenant administration](#tenant-administration) (15)
8. [Tenant plans and plan-change requests](#tenant-plans-and-plan-change-requests) (6)
9. [Tenant notifications (sending)](#tenant-notifications-sending) (9)
10. [Super Admin — organizations, administrators, audit](#super-admin--organizations-administrators-audit) (22)
11. [Super Admin — platform accounts](#super-admin--platform-accounts) (5)
12. [Super Admin — plans, plan history, plan-change requests](#super-admin--plans-plan-history-plan-change-requests) (13)
13. [Super Admin — notifications to organizations](#super-admin--notifications-to-organizations) (9)

## Conventions

**Base URL.** `http://localhost:8881` locally (`server.port`). All paths start with `/api`. Request and response bodies are JSON (`Content-Type: application/json`) except the attachment uploads, which are `multipart/form-data`, and attachment downloads, which stream the file.

**Authentication.** Identity is Amazon Cognito. A call is authenticated in one of two ways:

- **Bearer token** — `Authorization: Bearer <Cognito ID or access token>`. For API clients and Postman.
- **Session cookies** — the browser flow. `POST /api/auth/login` (and the other sign-in endpoints) set `NORMAONE_SESSION` (the token, HttpOnly, SameSite=Strict) and `NORMAONE_REFRESH` (path `/api/auth`); `POST /api/auth/refresh` renews them and `POST /api/auth/logout` clears them and revokes the refresh token.

**CSRF header.** A `POST`, `PUT`, `PATCH` or `DELETE` that uses cookies (no `Authorization` header), and every state-changing call to `/api/auth/**`, must send `X-Requested-With` (any value). Bearer-token calls and reads are not checked.

**Identity is never taken from the request.** Role, tenant, organization and user are read from the caller's stored account (looked up by the token's Cognito `sub`), never from a body, query or header. A tenant-scoped read or write only ever touches the caller's own organization.

**Access levels** (applied by `SecurityConfig` before the controller runs, then re-checked by the service):

| Access | Who | Paths |
|---|---|---|
| Public | Anyone; no token needed (`GET /api/auth/session` reads the session cookie itself and always answers 200) | `/api/auth/**` |
| Any valid token | Any signed-in Cognito account, even before it has an organization | `/api/onboarding/**`, `/api/users/me` |
| Any active account | An ACTIVE `SUPER_ADMIN`, `ADMIN` or `USER` | `/api/users/me/email-preference`, `/api/modules` |
| Member | An ACTIVE `ADMIN` or `USER` of an ACTIVE organization (its own only) | `/api/organization`, `/api/notifications/**` |
| ADMIN | An ACTIVE tenant administrator of an ACTIVE organization | `/api/tenant/**` |
| SUPER_ADMIN | An ACTIVE platform account (it has no tenant) | `/api/super-admin/**` |

**Roles.** `SUPER_ADMIN` runs the platform; `ADMIN` runs one organization (the self-registered owner is its first `ADMIN`); `USER` is a regular employee. Account status is `INVITED`, `ACTIVE`, `SUSPENDED` or `DEACTIVATED`; an organization is `ACTIVE` or `SUSPENDED` (the enum also has `PROVISIONING` and `DELETED`, which no endpoint sets).

**Modules.** Six product modules — `SAFEVOICE`, `JORNADAPULSE`, `BUZONDESK`, `DATOSPILOT`, `FACTURAFLOW`, `PREVENWORK` — each with its own permissions (e.g. `FACTURAFLOW_VIEW`, `FACTURAFLOW_CREATE`); `GET /api/modules` lists them. `NORMAONE` is the portal itself and cannot be assigned. An administrator can only grant or remove permissions they hold themselves.

**Errors.** Every error has the same body:

```json
{
  "timestamp": "2026-10-21T09:30:00Z",
  "status": 409,
  "error": "Conflict",
  "message": "Employee limit reached: the BASIC plan allows 10 employees and 10 are already added (active, suspended and invited accounts). Upgrade your plan to add more employees.",
  "path": "/api/tenant/users",
  "fieldErrors": { "email": "must be a well-formed email address" }
}
```

`fieldErrors` appears only on validation failures (400). There is no machine-readable error code; read `status` and `message`. Common statuses: 400 validation, 401 no or bad token, 403 wrong role or scope, 404 not found or not visible to the caller (another tenant's records are reported as not found), 409 state conflict, 413 file too large, 429 too many attempts, 502 Cognito or storage failure.

**Paging.** List endpoints take `page` (0-based, default 0) and `size` (1–100, default 20) and return `{ content, page, size, totalElements, totalPages }`.

**Email.** Email delivery is built (an outbox with retries, SES or SMTP) but not configured yet, so it shows as *Coming Soon*: preferences and plan-change requests are saved, but nothing is emailed until `normaone.email.from` is set.

## Features at a glance

| Area | What works |
|---|---|
| Sign-up and sign-in | Cognito register, email verification, resend code, login with cookie session, permanent password for invited accounts (new-password challenge), refresh, logout, session check, password policy. |
| Onboarding | A self-registered owner creates their organization and becomes its first ADMIN with every module permission; the organization starts on the BASIC package. |
| My account | Profile (`/api/users/me`) with role, organization, module list and permissions; own email-notification preference. |
| Tenant administration | Organization profile; invite Admins and Users with chosen module permissions; list, view, edit, suspend, deactivate, reactivate and remove accounts with safeguards (never yourself, never the last active Admin); resend invitations; per-user module assignment; team email preferences; organization audit log. |
| Employee limit | Each plan's `maxEmployees` (or smaller `maxUsers`) is enforced: active, suspended and invited accounts count; the next invitation or reactivation is refused with "Upgrade your plan". |
| Plans (tenant) | Current package with seats used; catalogue of every ACTIVE public plan; request a plan change (one open request per organization), view and cancel requests. |
| Plans (Super Admin) | Create plans and new plan versions (DRAFT), edit them (a published version's terms are fixed: new terms are a new version), activate, deactivate or archive them (nothing deletes a plan); current subscriptions; append-only plan history; approve or reject plan-change requests (approval applies the plan); move any organization to a plan directly; subscription history per organization. No payment is taken. |
| Organizations (Super Admin) | List, view, create (with an invited first Admin), edit, suspend and reactivate organizations; manage their Admins (invite, edit, status, resend invitation, modules); list and view regular users; dashboard counts; cross-tenant account directory; platform audit log with filters. |
| Super Admins | Invite, list, view, remove and restore platform accounts (never yourself, never the last one; concurrency-safe); resend invitations. Cognito sign-out and disable on removal. |
| Notifications | Admins and Super Admins send notifications to the whole organization or chosen recipients, with one attachment (PDF/PNG/JPEG/DOCX/XLSX, ≤10 MB); edit, archive and restore; members read their inbox, mark read/unread, download attachments, see unread counts. |
| Audit | Every administrative change is recorded with action, time, actor and role, organization, target and details; readable per organization (Admin) or platform-wide (Super Admin). |

## Endpoint index

**Authentication**

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | [`/api/auth/register`](#post-apiauthregister) | public | Register |
| POST | [`/api/auth/verify-email`](#post-apiauthverify-email) | public | Verify email |
| POST | [`/api/auth/resend-code`](#post-apiauthresend-code) | public | Resend code |
| POST | [`/api/auth/login`](#post-apiauthlogin) | public | Login |
| POST | [`/api/auth/new-password`](#post-apiauthnew-password) | public | Set permanent password |
| GET | [`/api/auth/password-policy`](#get-apiauthpassword-policy) | public | Password policy |
| GET | [`/api/auth/session`](#get-apiauthsession) | public | Session status |
| POST | [`/api/auth/refresh`](#post-apiauthrefresh) | public | Refresh the session |
| POST | [`/api/auth/logout`](#post-apiauthlogout) | public | Log out |

**My account and onboarding**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | [`/api/users/me/email-preference`](#get-apiusersmeemail-preference) | active | My email preference |
| PUT | [`/api/users/me/email-preference`](#put-apiusersmeemail-preference) | active | Set my email preference |
| GET | [`/api/users/me`](#get-apiusersme) | token | Who am I |
| GET | [`/api/onboarding/status`](#get-apionboardingstatus) | token | Onboarding status |
| POST | [`/api/onboarding/tenant`](#post-apionboardingtenant) | token | Create my organization |
| GET | [`/api/organization`](#get-apiorganization) | member | My organization |
| GET | [`/api/modules`](#get-apimodules) | active | Module catalog |

**Notification inbox (members)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | [`/api/notifications`](#get-apinotifications) | member | My notifications |
| GET | [`/api/notifications/unread-count`](#get-apinotificationsunread-count) | member | Unread count |
| GET | [`/api/notifications/{notificationId}`](#get-apinotificationsnotificationid) | member | Open a notification |
| PATCH | [`/api/notifications/{notificationId}/read-status`](#patch-apinotificationsnotificationidread-status) | member | Mark read / unread |
| GET | [`/api/notifications/{notificationId}/attachment`](#get-apinotificationsnotificationidattachment) | member | Download the attachment |

**Tenant administration**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | [`/api/tenant`](#get-apitenant) | ADMIN | My organization |
| GET | [`/api/tenant/package`](#get-apitenantpackage) | ADMIN | My package |
| GET | [`/api/tenant/audit-events`](#get-apitenantaudit-events) | ADMIN | My organization's audit log |
| GET | [`/api/tenant/users`](#get-apitenantusers) | ADMIN | List my users |
| POST | [`/api/tenant/users`](#post-apitenantusers) | ADMIN | Invite a user |
| GET | [`/api/tenant/users/{userId}`](#get-apitenantusersuserid) | ADMIN | Open a user |
| PATCH | [`/api/tenant/users/{userId}`](#patch-apitenantusersuserid) | ADMIN | Update a user |
| PATCH | [`/api/tenant/users/{userId}/status`](#patch-apitenantusersuseridstatus) | ADMIN | Change a user's status |
| GET | [`/api/tenant/users/{userId}/email-preference`](#get-apitenantusersuseridemail-preference) | ADMIN | A user's email preference |
| PUT | [`/api/tenant/users/{userId}/email-preference`](#put-apitenantusersuseridemail-preference) | ADMIN | Set a user's email preference |
| POST | [`/api/tenant/users/{userId}/resend-invitation`](#post-apitenantusersuseridresend-invitation) | ADMIN | Resend an invitation |
| GET | [`/api/tenant/users/{userId}/modules`](#get-apitenantusersuseridmodules) | ADMIN | A user's modules |
| PUT | [`/api/tenant/users/{userId}/modules`](#put-apitenantusersuseridmodules) | ADMIN | Set a user's modules |
| PUT | [`/api/tenant/users/{userId}/modules/{moduleId}`](#put-apitenantusersuseridmodulesmoduleid) | ADMIN | Set one module |
| DELETE | [`/api/tenant/users/{userId}/modules/{moduleId}`](#delete-apitenantusersuseridmodulesmoduleid) | ADMIN | Revoke one module |

**Tenant plans and plan-change requests**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | [`/api/tenant/plans`](#get-apitenantplans) | ADMIN | Plan catalogue |
| GET | [`/api/tenant/plans/{planId}`](#get-apitenantplansplanid) | ADMIN | One plan |
| POST | [`/api/tenant/plan-change-requests`](#post-apitenantplan-change-requests) | ADMIN | Request a plan change |
| GET | [`/api/tenant/plan-change-requests`](#get-apitenantplan-change-requests) | ADMIN | My plan-change requests |
| GET | [`/api/tenant/plan-change-requests/{requestId}`](#get-apitenantplan-change-requestsrequestid) | ADMIN | One plan-change request |
| POST | [`/api/tenant/plan-change-requests/{requestId}/cancel`](#post-apitenantplan-change-requestsrequestidcancel) | ADMIN | Cancel a plan-change request |

**Tenant notifications (sending)**

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | [`/api/tenant/notifications`](#post-apitenantnotifications) | ADMIN | Send a notification |
| GET | [`/api/tenant/notifications`](#get-apitenantnotifications) | ADMIN | List notifications |
| GET | [`/api/tenant/notifications/{notificationId}`](#get-apitenantnotificationsnotificationid) | ADMIN | Open a notification |
| PATCH | [`/api/tenant/notifications/{notificationId}`](#patch-apitenantnotificationsnotificationid) | ADMIN | Edit a notification |
| PATCH | [`/api/tenant/notifications/{notificationId}/status`](#patch-apitenantnotificationsnotificationidstatus) | ADMIN | Archive or restore a notification |
| PUT | [`/api/tenant/notifications/{notificationId}/attachment`](#put-apitenantnotificationsnotificationidattachment) | ADMIN | Replace the attachment |
| DELETE | [`/api/tenant/notifications/{notificationId}/attachment`](#delete-apitenantnotificationsnotificationidattachment) | ADMIN | Remove the attachment |
| GET | [`/api/tenant/notifications/{notificationId}/attachment`](#get-apitenantnotificationsnotificationidattachment) | ADMIN | Download the attachment |
| GET | [`/api/tenant/notifications/recipients`](#get-apitenantnotificationsrecipients) | ADMIN | Recipient options |

**Super Admin — organizations, administrators, audit**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | [`/api/super-admin/dashboard`](#get-apisuper-admindashboard) | SUPER_ADMIN | Platform dashboard |
| GET | [`/api/super-admin/tenants`](#get-apisuper-admintenants) | SUPER_ADMIN | List tenants |
| POST | [`/api/super-admin/tenants`](#post-apisuper-admintenants) | SUPER_ADMIN | Create a tenant |
| GET | [`/api/super-admin/tenants/{tenantId}`](#get-apisuper-admintenantstenantid) | SUPER_ADMIN | Open a tenant |
| PATCH | [`/api/super-admin/tenants/{tenantId}`](#patch-apisuper-admintenantstenantid) | SUPER_ADMIN | Update a tenant |
| PATCH | [`/api/super-admin/tenants/{tenantId}/status`](#patch-apisuper-admintenantstenantidstatus) | SUPER_ADMIN | Change a tenant's status |
| GET | [`/api/super-admin/tenants/{tenantId}/package`](#get-apisuper-admintenantstenantidpackage) | SUPER_ADMIN | A tenant's package |
| GET | [`/api/super-admin/admins`](#get-apisuper-adminadmins) | SUPER_ADMIN | List administrators |
| POST | [`/api/super-admin/admins`](#post-apisuper-adminadmins) | SUPER_ADMIN | Invite an administrator |
| GET | [`/api/super-admin/admins/{adminId}`](#get-apisuper-adminadminsadminid) | SUPER_ADMIN | Open an administrator |
| PUT | [`/api/super-admin/admins/{adminId}`](#put-apisuper-adminadminsadminid) | SUPER_ADMIN | Update an administrator |
| PATCH | [`/api/super-admin/admins/{adminId}/status`](#patch-apisuper-adminadminsadminidstatus) | SUPER_ADMIN | Change an administrator's status |
| POST | [`/api/super-admin/admins/{adminId}/resend-invitation`](#post-apisuper-adminadminsadminidresend-invitation) | SUPER_ADMIN | Resend an administrator's invitation |
| GET | [`/api/super-admin/admins/{adminId}/modules`](#get-apisuper-adminadminsadminidmodules) | SUPER_ADMIN | An administrator's modules |
| PUT | [`/api/super-admin/admins/{adminId}/modules`](#put-apisuper-adminadminsadminidmodules) | SUPER_ADMIN | Set an administrator's modules |
| PUT | [`/api/super-admin/admins/{adminId}/modules/{moduleId}`](#put-apisuper-adminadminsadminidmodulesmoduleid) | SUPER_ADMIN | Set one administrator module |
| DELETE | [`/api/super-admin/admins/{adminId}/modules/{moduleId}`](#delete-apisuper-adminadminsadminidmodulesmoduleid) | SUPER_ADMIN | Revoke one administrator module |
| GET | [`/api/super-admin/users`](#get-apisuper-adminusers) | SUPER_ADMIN | List users |
| GET | [`/api/super-admin/users/{userId}`](#get-apisuper-adminusersuserid) | SUPER_ADMIN | Open a user |
| GET | [`/api/super-admin/audit-events`](#get-apisuper-adminaudit-events) | SUPER_ADMIN | Audit trail |
| GET | [`/api/super-admin/summary`](#get-apisuper-adminsummary) | SUPER_ADMIN | Platform dashboard (alias) |
| GET | [`/api/super-admin/accounts`](#get-apisuper-adminaccounts) | SUPER_ADMIN | Account directory |

**Super Admin — platform accounts**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | [`/api/super-admin/super-admins`](#get-apisuper-adminsuper-admins) | SUPER_ADMIN | List Super Admins |
| POST | [`/api/super-admin/super-admins`](#post-apisuper-adminsuper-admins) | SUPER_ADMIN | Add a Super Admin |
| GET | [`/api/super-admin/super-admins/{superAdminId}`](#get-apisuper-adminsuper-adminssuperadminid) | SUPER_ADMIN | Open a Super Admin |
| PATCH | [`/api/super-admin/super-admins/{superAdminId}/status`](#patch-apisuper-adminsuper-adminssuperadminidstatus) | SUPER_ADMIN | Remove or restore a Super Admin |
| POST | [`/api/super-admin/super-admins/{superAdminId}/resend-invitation`](#post-apisuper-adminsuper-adminssuperadminidresend-invitation) | SUPER_ADMIN | Resend a Super Admin invitation |

**Super Admin — plans, plan history, plan-change requests**

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | [`/api/super-admin/plans`](#get-apisuper-adminplans) | SUPER_ADMIN | List plans |
| POST | [`/api/super-admin/plans`](#post-apisuper-adminplans) | SUPER_ADMIN | Create a plan |
| GET | [`/api/super-admin/plans/{planId}`](#get-apisuper-adminplansplanid) | SUPER_ADMIN | Open a plan |
| PATCH | [`/api/super-admin/plans/{planId}`](#patch-apisuper-adminplansplanid) | SUPER_ADMIN | Edit a plan |
| PATCH | [`/api/super-admin/plans/{planId}/status`](#patch-apisuper-adminplansplanidstatus) | SUPER_ADMIN | Activate or deactivate a plan |
| GET | [`/api/super-admin/subscriptions`](#get-apisuper-adminsubscriptions) | SUPER_ADMIN | Current subscriptions |
| PUT | [`/api/super-admin/tenants/{tenantId}/package`](#put-apisuper-admintenantstenantidpackage) | SUPER_ADMIN | Move an organization to a plan |
| GET | [`/api/super-admin/tenants/{tenantId}/package/history`](#get-apisuper-admintenantstenantidpackagehistory) | SUPER_ADMIN | An organization's subscription history |
| GET | [`/api/super-admin/plan-history`](#get-apisuper-adminplan-history) | SUPER_ADMIN | Plan history |
| GET | [`/api/super-admin/plan-change-requests`](#get-apisuper-adminplan-change-requests) | SUPER_ADMIN | Plan-change requests |
| GET | [`/api/super-admin/plan-change-requests/{requestId}`](#get-apisuper-adminplan-change-requestsrequestid) | SUPER_ADMIN | Open a plan-change request |
| POST | [`/api/super-admin/plan-change-requests/{requestId}/approve`](#post-apisuper-adminplan-change-requestsrequestidapprove) | SUPER_ADMIN | Approve a plan-change request |
| POST | [`/api/super-admin/plan-change-requests/{requestId}/reject`](#post-apisuper-adminplan-change-requestsrequestidreject) | SUPER_ADMIN | Reject a plan-change request |

**Super Admin — notifications to organizations**

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | [`/api/super-admin/tenants/{tenantId}/notifications`](#post-apisuper-admintenantstenantidnotifications) | SUPER_ADMIN | Send a notification |
| GET | [`/api/super-admin/tenants/{tenantId}/notifications`](#get-apisuper-admintenantstenantidnotifications) | SUPER_ADMIN | List notifications |
| GET | [`/api/super-admin/tenants/{tenantId}/notifications/{notificationId}`](#get-apisuper-admintenantstenantidnotificationsnotificationid) | SUPER_ADMIN | Open a notification |
| PATCH | [`/api/super-admin/tenants/{tenantId}/notifications/{notificationId}`](#patch-apisuper-admintenantstenantidnotificationsnotificationid) | SUPER_ADMIN | Edit a notification |
| PATCH | [`/api/super-admin/tenants/{tenantId}/notifications/{notificationId}/status`](#patch-apisuper-admintenantstenantidnotificationsnotificationidstatus) | SUPER_ADMIN | Archive or restore a notification |
| PUT | [`/api/super-admin/tenants/{tenantId}/notifications/{notificationId}/attachment`](#put-apisuper-admintenantstenantidnotificationsnotificationidattachment) | SUPER_ADMIN | Replace the attachment |
| DELETE | [`/api/super-admin/tenants/{tenantId}/notifications/{notificationId}/attachment`](#delete-apisuper-admintenantstenantidnotificationsnotificationidattachment) | SUPER_ADMIN | Remove the attachment |
| GET | [`/api/super-admin/tenants/{tenantId}/notifications/{notificationId}/attachment`](#get-apisuper-admintenantstenantidnotificationsnotificationidattachment) | SUPER_ADMIN | Download the attachment |
| GET | [`/api/super-admin/tenants/{tenantId}/notifications/recipients`](#get-apisuper-admintenantstenantidnotificationsrecipients) | SUPER_ADMIN | Recipient options for a tenant |

## Authentication

Controller: `AuthController`

### POST /api/auth/register

**Register** — Public

Starts a Cognito sign-up. Cognito emails a verification code. No user record is written yet.

**Request body**

Required: `name`, `email`, `password`

Fields: name ≤100 · email ≤254 · password 8–256 (and Cognito's own password policy)

```json
{
  "name": "Ana Admin",
  "email": "ana@example.com",
  "password": "ChangeMe123!"
}
```

**Success:** `202`

**Response fields**

- `message`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | Cognito rejects the password (InvalidPassword) — its message says which rule. |
| 409 | An account with this email already exists. |
| 429 | Too many attempts. |

### POST /api/auth/verify-email

**Verify email** — Public

Confirms the emailed code. With a password it also signs in, setting the session cookies like Login.

**Request body**

Required: `email`, `code`

Fields: email ≤254 · code ≤20 · password optional, 8–256

```json
{
  "email": "ana@example.com",
  "code": "123456"
}
```

**Success:** `200`

**Response fields**

- `message`, `verified`
- — or, with password: tokenType "Cookie", expiresAt, requiresTenantSetup (+ Set-Cookie)

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | Wrong code (CodeMismatch) or an expired one (ExpiredCode). |
| 404 | No Cognito user has this email. |
| 409 | The account is already verified. |
| 429 | Too many attempts. |

### POST /api/auth/resend-code

**Resend code** — Public

Sends a new verification code.

**Request body**

Required: `email`

Fields: email ≤254

```json
{
  "email": "ana@example.com"
}
```

**Success:** `200`

**Response fields**

- `message`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 404 | No Cognito user has this email. |
| 409 | The account is already confirmed. |
| 429 | Too many attempts. |

### POST /api/auth/login

**Login** — Public

Cognito USER_PASSWORD_AUTH through the backend. Sets the session as HttpOnly cookies; the body carries no token.

**Request body**

Required: `email`, `password`

Fields: email · password ≤256

```json
{
  "email": "ana@example.com",
  "password": "ChangeMe123!"
}
```

**Success:** `200`

**Response fields**

- tokenType: "Cookie"
- `expiresAt`
- requiresTenantSetup (always true: read GET /api/users/me instead)
- or, for an invited account's temporary password: challenge "NEW_PASSWORD_REQUIRED", no session, the HttpOnly NORMAONE_CHALLENGE cookie — continue with POST /api/auth/new-password
- Set-Cookie: NORMAONE_SESSION (ID token, HttpOnly, SameSite=Strict, Path=/api)
- Set-Cookie: NORMAONE_REFRESH (HttpOnly, Path=/api/auth)

> The tokens go into HttpOnly cookies the page cannot read. A non-browser client sends X-Token-Delivery: body to receive accessToken, idToken and refreshToken in the body instead (and no cookies), then uses Authorization: Bearer <idToken>. Every /api/auth request needs X-Requested-With (CSRF); this app adds it.

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | USER_PASSWORD_AUTH is not enabled on the Cognito app client. |
| 401 | Wrong email or password, or an expired temporary password (the message says to ask for the invitation again). |
| 403 | The email is not verified yet. |
| 404 | No Cognito user has this email. |
| 429 | Too many attempts. |

### POST /api/auth/new-password

**Set permanent password** — Public

Completes an invited account's first login: answers Cognito's NEW_PASSWORD_REQUIRED challenge and only then sets the session cookies.

**Request body**

Required: `email`, `newPassword`

Fields: email · newPassword 8–256 and the user pool's policy · session only for a non-browser client (the browser's challenge is the HttpOnly NORMAONE_CHALLENGE cookie)

```json
{
  "email": "uma@example.com",
  "newPassword": "Permanent#Pass456"
}
```

**Success:** `200`

**Response fields**

- tokenType: "Cookie"
- `expiresAt`
- Set-Cookie: NORMAONE_SESSION, NORMAONE_REFRESH; NORMAONE_CHALLENGE cleared

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | Cognito's password policy refuses the new password — its own message says which rule. |
| 401 | No challenge in progress, or it expired (3 minutes by default): sign in again with the temporary password. |
| 403 | The X-Requested-With header is missing (CSRF). |

### GET /api/auth/password-policy

**Password policy** — Public

The user pool's password rules, for the set-password page. source COGNITO when the backend may describe the pool, DEFAULT otherwise.

**Success:** `200`

**Response fields**

- `minimumLength`, `requireUppercase`, `requireLowercase`, `requireNumbers`, `requireSymbols`, `temporaryPasswordValidityDays`, `source`

### GET /api/auth/session

**Session status** — Public

Whether the browser's session cookie holds a valid token, for whom, until when — never the token itself. Always 200.

**Success:** `200`

**Response fields**

- `authenticated`, `email`, `tokenUse`, `expiresAt`, `refreshAvailable`
- reason (NO_SESSION · INVALID_OR_EXPIRED)

> Reads the HttpOnly cookies on the server. This app sends it with the session, unlike the other auth endpoints.

### POST /api/auth/refresh

**Refresh the session** — Public

A new session cookie from the refresh cookie (Cognito REFRESH_TOKEN_AUTH). On failure both cookies are cleared.

**Success:** `200`

**Response fields**

- authenticated: true
- `tokenUse`, `expiresAt`, `refreshAvailable`
- Set-Cookie: NORMAONE_SESSION

**Errors**

| Status | When |
|---|---|
| 401 | No refresh cookie, or Cognito says it expired or was revoked. The cookies are cleared: sign in again. |
| 403 | The X-Requested-With header is missing (CSRF). |

### POST /api/auth/logout

**Log out** — Public

Revokes the refresh token at Cognito (best effort) and clears both cookies. Safe when already signed out.

**Success:** `200`

**Response fields**

- authenticated: false
- reason: LOGGED_OUT
- Set-Cookie: both cookies with Max-Age=0

**Errors**

| Status | When |
|---|---|
| 403 | The X-Requested-With header is missing (CSRF). |

## My account and onboarding

Controller: `UserController, OnboardingController`

### GET /api/users/me/email-preference

**My email preference** — Any active account (SUPER_ADMIN, ADMIN or USER)

Whether the caller receives email notifications. Never set = enabled (the default). Any active account: SUPER_ADMIN, ADMIN or USER.

**Success:** `200`

**Response fields**

- `userId`, `name`, `email`, `role`, `emailNotificationsEnabled`
- explicit (false = the default, enabled)
- emailDeliveryAvailable (false while email is Coming Soon: saved, nothing is emailed)

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The account is not active, or its organization is not ACTIVE. |

### PUT /api/users/me/email-preference

**Set my email preference** — Any active account (SUPER_ADMIN, ADMIN or USER)

Turns the caller's own email notifications on or off. There is no user id: it is always the caller's own account. In-app notifications are not affected.

**Request body**

Required: `enabled`

Fields: enabled true · false

```json
{
  "enabled": false
}
```

**Success:** `200`

**Response fields**

- `userId`, `name`, `email`, `role`, `emailNotificationsEnabled`
- explicit (false = the default, enabled)
- emailDeliveryAvailable (false while email is Coming Soon: saved, nothing is emailed)

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The account is not active, or its organization is not ACTIVE. |

### GET /api/users/me

**Who am I** — Any valid token

The caller's own profile, onboarding state, effective role and module access. Links a pending invitation on first call.

**Success:** `200`

**Response fields**

- `userId`, `cognitoSub`, `name`, `email`, `phoneNumber`, `status`, `roles`, `tenantId`, `organizationName`, `subdomain`, `requiresTenantSetup`, `createdAt`, `onboardingStatus`, `accountType`, `effectiveRole`, `tenantStatus`
- modules: [moduleId] (usable now)
- modulePermissions: [permissionId]

> Before onboarding there is no user record: the answer is onboardingStatus NOT_STARTED with requiresTenantSetup true, not a 404. modules is just the ids of the modules the account can use now (assigned and the account active — the plan does not block a module while plan entitlement is not enforced), e.g. ["FACTURAFLOW", "JORNADAPULSE"]: navigation shows these. modulePermissions is every module permission the backend allows now. The per-module detail is on the administrators' module routes. There is no separate general permission list. A Super Admin has no modules.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |

### GET /api/onboarding/status

**Onboarding status** — Any valid token

Whether the caller still has to create an organization, and what they are once they have.

**Success:** `200`

**Response fields**

- `onboardingCompleted`, `onboardingStatus`, `requiresTenantSetup`, `accountType`, `userStatus`, `role`, `tenantId`, `tenantStatus`, `packageCode`, `subscriptionStatus`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |

### POST /api/onboarding/tenant

**Create my organization** — Any valid token

Creates the tenant, makes the caller its ADMIN and assigns the BASIC package. Idempotent for the same subdomain.

**Request body**

Required: `organizationName`, `subdomain`, `countryCode`

Fields: organizationName ≤100 · subdomain 2–50, lowercase letters, digits, inner hyphens · countryCode enum · defaultLocale / defaultTimeZone enums, defaulted from the country when absent · the rest optional

```json
{
  "organizationName": "Demo Spain SL",
  "subdomain": "demo",
  "countryCode": "ES",
  "defaultLocale": "ES_ES",
  "defaultTimeZone": "EUROPE_MADRID",
  "accountHolderName": "Ana Admin",
  "emailAddress": "ana@example.com",
  "phoneNumber": "+34 600 000 000",
  "addressLine": "Calle Mayor 10",
  "city": "Madrid",
  "postalCode": "28013"
}
```

**Success:** `201`

**Response fields**

- `tenantId`, `organizationName`, `subdomain`, `status`, `countryCode`, `defaultLocale`, `defaultTimeZone`, `userId`, `userName`, `userEmail`, `userRoles`, `createdAt`, `packageCode`, `subscriptionId`, `subscriptionStatus`
- …

> The administrator is always the caller, from the token. There is no initialAdmin field here — that is the Super Admin's create.

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The ID token says email_verified is false, or the caller is a platform account. |
| 409 | The caller already belongs to an organization with a different subdomain. |
| 409 | The subdomain is taken, or this organization's onboarding is still in progress. |
| 503 | The default package (BASIC) is not available. |

### GET /api/organization

**My organization** — A member of an organization (ADMIN or USER)

The caller's own organization, read only. Takes no id: the organization comes from the caller's stored user record, so no URL, query or body can name another one.

**Success:** `200`

**Response fields**

- `id`, `name`, `subdomain`, `countryCode`, `defaultLocale`, `defaultTimeZone`, `accountHolderName`, `emailAddress`, `phoneNumber`, `addressLine`, `city`, `postalCode`, `logoUrl`, `status`, `createdAt`

> Less than the administrators' GET /api/tenant: no user count, package or status history.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | Not a member of an organization: a Super Admin, an account not onboarded, or one whose organization is not ACTIVE. |

### GET /api/modules

**Module catalog** — Any active account (SUPER_ADMIN, ADMIN or USER)

The six application modules and the permissions defined for each, with the roles that get each permission by default.

**Success:** `200`

**Response fields**

- [ { id, order, name, label, description, requirementsDocumented, permissions: [ { id, module, action, label, description, defaultFor } ] } ]

> Static and the same for everybody: what one account may use is in GET /api/users/me.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The account has no active role (not onboarded, inactive, or its organization is not ACTIVE). |

## Notification inbox (members)

Controller: `NotificationController`

### GET /api/notifications

**My notifications** — A member of an organization (ADMIN or USER)

The caller's inbox, newest first: SELECTED ones naming them, and their tenant's broadcasts created on or after they joined. Only the caller's own read state; never the recipient list.

**Query parameters**

| Name | Description |
|---|---|
| `filter` | ALL (default) · UNREAD · READ — by the caller's own read state. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, subject, body, audience, readStatus, readAt, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ADMIN or USER of an ACTIVE tenant (a Super Admin has no inbox). |
| 400 | A bad filter, page or size. |

### GET /api/notifications/unread-count

**Unread count** — A member of an organization (ADMIN or USER)

How many of the caller's ACTIVE notifications they have not read. Same visibility rules as the inbox.

**Success:** `200`

**Response fields**

- `unreadCount`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ADMIN or USER of an ACTIVE tenant (a Super Admin has no inbox). |

### GET /api/notifications/{notificationId}

**Open a notification** — A member of an organization (ADMIN or USER)

One visible notification. Opening it does NOT mark it read.

**Path parameters**

- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- `id`, `subject`, `body`, `audience`, `readStatus`, `readAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- `createdByRole`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ADMIN or USER of an ACTIVE tenant (a Super Admin has no inbox). |
| 404 | Not visible to the caller: another tenant's, not a recipient, archived, or a broadcast from before they joined. |

### PATCH /api/notifications/{notificationId}/read-status

**Mark read / unread** — A member of an organization (ADMIN or USER)

The caller's own copy only: their element of users (SELECTED) or their receipt (TENANT). The server sets readAt; a repeat changes nothing.

**Path parameters**

- `notificationId` — The notification document id.

**Request body**

Required: `read`

Fields: read true or false. A userId or readAt in the body is ignored.

```json
{
  "read": true
}
```

**Success:** `200`

**Response fields**

- `id`, `subject`, `body`, `audience`, `readStatus`, `readAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- `createdByRole`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ADMIN or USER of an ACTIVE tenant (a Super Admin has no inbox). |
| 404 | Not visible to the caller: another tenant's, not a recipient, archived, or a broadcast from before they joined. |

### GET /api/notifications/{notificationId}/attachment

**Download the attachment** — A member of an organization (ADMIN or USER)

The file, as a download (Content-Disposition: attachment). With S3 storage: 302 to a 60-second presigned URL. Same visibility check as opening the notification.

**Path parameters**

- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- the file's bytes — or 302 Location (S3)

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ADMIN or USER of an ACTIVE tenant (a Super Admin has no inbox). |
| 404 | Not visible to the caller: another tenant's, not a recipient, archived, or a broadcast from before they joined. |
| 404 | The notification has no attachment. |

## Tenant administration

Controller: `TenantController`

### GET /api/tenant

**My organization** — ADMIN of an active tenant

The caller's own tenant, with its user count and package.

**Success:** `200`

**Response fields**

- `id`, `tenantName`, `accountHolderName`, `subdomain`, `logoUrl`, `phoneNumber`, `emailAddress`, `defaultLocale`, `defaultTimeZone`, `addressLine`, `city`, `postalCode`, `countryCode`, `status`, `activatedAt`, `suspendedAt`, `statusReason`, `createdAt`, `updatedAt`, `packageCode`, `userCount`, `packageInfo`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |

### GET /api/tenant/package

**My package** — ADMIN of an active tenant

The caller's tenant's current subscription and plan.

**Success:** `200`

**Response fields**

- `tenantId`, `subscriptionId`, `status`, `assignmentSource`, `startDate`, `currentPeriodStart`, `currentPeriodEnd`, `agreedPrice`, `currencyCode`, `billingCycle`, `assignedAt`
- plan { planId, planCode, planVersion, name, description, status, defaultPlan, listPrice, currencyCode, billingCycle, trialDays, maxEmployees, maxUsers, durationMonths, moduleApps }
- seats { limit (null = no limit), used } — package reads only

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | The tenant has no current package. |

### GET /api/tenant/audit-events

**My organization's audit log** — ADMIN of an active tenant

Read only. The audit trail of the caller's own organization, newest first. The tenant filter comes from the caller's record and is part of the database query: there is no tenantId parameter, and one sent is ignored.

**Query parameters**

| Name | Description |
|---|---|
| `action` | An AuditAction, e.g. USER_INVITED, USER_MODULE_ACCESS_CHANGED, PLAN_CHANGE_REQUESTED. |
| `actorUserId` | Who did it. |
| `targetId` | One user, subscription or request id. |
| `targetType` | USER, TENANT, PLAN, SUBSCRIPTION, PLAN_CHANGE_REQUEST, NOTIFICATION. |
| `from` | ISO-8601 instant, inclusive. |
| `to` | ISO-8601 instant, inclusive. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, action, occurredAt, actorUserId, actorRole, tenantId, … } ]
- `page`, `size`, `totalElements`, `totalPages`

> Platform-only events (plan definitions, Super Admin accounts) carry no tenant and never appear here.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | An unknown action, a bad date, to before from, or a bad page or size. |

### GET /api/tenant/users

**List my users** — ADMIN of an active tenant

Users of the caller's tenant only. Search matches name or email.

**Query parameters**

| Name | Description |
|---|---|
| `search` | Name or email, ≤100. |
| `status` | INVITED · ACTIVE · SUSPENDED · DEACTIVATED |
| `role` | SUPER_ADMIN · ADMIN · USER (legacy values fold in) |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, tenantId, name, email, phoneNumber, status, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | A bad status, role, page or size. |

### POST /api/tenant/users

**Invite a user** — ADMIN of an active tenant

An INVITED user in the caller's tenant. Cognito emails them a temporary password; their first sign-in must set a permanent one, and the record turns ACTIVE at their first signed-in request.

**Request body**

Required: `name`, `email`

Fields: name ≤100 · email ≤254 · phoneNumber ≤30 · role USER (default) or ADMIN · moduleAccess, modulePermissions optional — when both are absent all six modules are assigned with the role's defaults (USER: VIEW; ADMIN: all but DELETE), never more than the caller holds

```json
{
  "name": "Uma User",
  "email": "uma@example.com",
  "role": "USER"
}
```

**Success:** `201`

**Response fields**

- `id`, `tenantId`, `name`, `email`, `phoneNumber`, `status`, `roles`, `effectiveRole`, `linked`, `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`, `moduleAccess`, `modulePermissions`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | NORMAONE or an unknown module, an unknown permission, or a permission of another module (the message names it). |
| 400 | role is anything but USER or ADMIN. |
| 403 | role is SUPER_ADMIN, or a module permission the caller does not hold. |
| 409 | A user with this email already exists in the organization. |
| 409 | Employee limit reached: the plan's maxEmployees (or its smaller maxUsers) is taken by active, suspended or invited accounts — "Upgrade your plan to add more employees." BASIC allows 10. |

### GET /api/tenant/users/{userId}

**Open a user** — ADMIN of an active tenant

One user of the caller's tenant. Another tenant's user answers 404, not 403.

**Path parameters**

- `userId` — The user document id.

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `name`, `email`, `phoneNumber`, `status`, `roles`, `effectiveRole`, `linked`, `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`, `moduleAccess`, `modulePermissions`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such user in this tenant. |

### PATCH /api/tenant/users/{userId}

**Update a user** — ADMIN of an active tenant

Partial: name, phoneNumber, role. Only the fields sent change.

**Path parameters**

- `userId` — The user document id.

**Request body**

Fields: name 1–100 · phoneNumber ≤30 · role USER or ADMIN

```json
{
  "role": "ADMIN"
}
```

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `name`, `email`, `phoneNumber`, `status`, `roles`, `effectiveRole`, `linked`, `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`, `moduleAccess`, `modulePermissions`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 403 | Changing your own role, assigning SUPER_ADMIN, or touching a platform account. |
| 404 | No such user in this tenant. |
| 409 | Demoting the last active ADMIN. |

### PATCH /api/tenant/users/{userId}/status

**Change a user's status** — ADMIN of an active tenant

ACTIVE, SUSPENDED or DEACTIVATED (removal is DEACTIVATED: the record and its history are kept). A reason is required to suspend or deactivate. Cognito follows: signed out on SUSPENDED, signed out and disabled on DEACTIVATED, re-enabled first on reactivation.

**Path parameters**

- `userId` — The user document id.

**Request body**

Required: `status`

Fields: status ACTIVE · SUSPENDED · DEACTIVATED · reason ≤500

```json
{
  "status": "SUSPENDED",
  "reason": "On leave"
}
```

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `name`, `email`, `phoneNumber`, `status`, `roles`, `effectiveRole`, `linked`, `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`, `moduleAccess`, `modulePermissions`

> An administrator is removed only by another administrator, and the organization always keeps one active ADMIN. The audit event records what Cognito did (details.identityProvider: DONE, FAILED, NO_ACCOUNT or SKIPPED).

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | No reason when suspending or deactivating, or status INVITED. |
| 403 | Changing your own status, or a platform account. |
| 404 | No such user in this tenant. |
| 409 | Already in that status; activating an invitation; suspending an invitation; or removing the last active ADMIN. |
| 409 | Reactivating a DEACTIVATED account while every user seat of the plan is taken. |
| 502 | Reactivating: Cognito could not re-enable the account. Nothing was changed. |

### GET /api/tenant/users/{userId}/email-preference

**A user's email preference** — ADMIN of an active tenant

Whether a USER of the caller's own organization receives email notifications.

**Path parameters**

- `userId` — A USER account of your organization.

**Success:** `200`

**Response fields**

- `userId`, `name`, `email`, `role`, `emailNotificationsEnabled`
- explicit (false = the default, enabled)
- emailDeliveryAvailable (false while email is Coming Soon: saved, nothing is emailed)

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 403 | The account is an administrator, a platform account, or your own — administrators set their own preference under My email preference. |
| 404 | No such user in your organization (another organization's user is 404 too). |

### PUT /api/tenant/users/{userId}/email-preference

**Set a user's email preference** — ADMIN of an active tenant

Turns a USER's email notifications on or off — USER accounts of the caller's own organization only. In-app notifications are not affected.

**Path parameters**

- `userId` — A USER account of your organization.

**Request body**

Required: `enabled`

Fields: enabled true · false. An organization id in the body is ignored.

```json
{
  "enabled": false
}
```

**Success:** `200`

**Response fields**

- `userId`, `name`, `email`, `role`, `emailNotificationsEnabled`
- explicit (false = the default, enabled)
- emailDeliveryAvailable (false while email is Coming Soon: saved, nothing is emailed)

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 403 | The account is an administrator, a platform account, or your own — administrators set their own preference under My email preference. |
| 404 | No such user in your organization. |

### POST /api/tenant/users/{userId}/resend-invitation

**Resend an invitation** — ADMIN of an active tenant

Cognito emails the pending user a new temporary password — also the fix for an expired one.

**Path parameters**

- `userId` — The user document id.

**Success:** `200`

**Response fields**

- …the user
- invitation { delivery, emailSent, message }

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such user in this tenant. |
| 409 | The user is not INVITED, already has a Cognito password of their own, or temporary-password invitations are off. |
| 502 | Cognito refused to resend it. |

### GET /api/tenant/users/{userId}/modules

**A user's modules** — ADMIN of an active tenant

All six modules for one user of the caller's tenant: assigned or not, and the permissions in each.

**Path parameters**

- `userId` — The user document id.

**Success:** `200`

**Response fields**

- `userId`, `active`, `planEnforced`, `assignedAt`
- modules: [ { moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions } ] (all six)
- `assignedModules`, `assignedPermissions`, `entitledModules`, `planModules`, `effectiveModules`, `effectivePermissions`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such user in this tenant. |

### PUT /api/tenant/users/{userId}/modules

**Set a user's modules** — ADMIN of an active tenant

Replaces the whole assignment. Every permission added or removed must be one the caller holds.

**Path parameters**

- `userId` — The user document id.

**Request body**

Required: `modules`, `permissions`

Fields: modules: list of the six module ids ([] = none) · permissions: module permissions, each inside an assigned module

```json
{
  "modules": ["FACTURAFLOW", "JORNADAPULSE"],
  "permissions": ["FACTURAFLOW_VIEW", "JORNADAPULSE_VIEW", "JORNADAPULSE_CREATE"]
}
```

**Success:** `200`

**Response fields**

- `userId`, `active`, `planEnforced`, `assignedAt`
- modules: [ { moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions } ] (all six)
- `assignedModules`, `assignedPermissions`, `entitledModules`, `planModules`, `effectiveModules`, `effectivePermissions`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | NORMAONE or an unknown module, an unknown permission, or a permission of another module (the message names it). |
| 403 | Your own account, a platform account, or a permission you do not hold. |
| 404 | No such user in this tenant. |

### PUT /api/tenant/users/{userId}/modules/{moduleId}

**Set one module** — ADMIN of an active tenant

Assigns one module with exactly these permissions; the user's other modules are not touched.

**Path parameters**

- `userId` — The user document id.
- `moduleId` — FACTURAFLOW · JORNADAPULSE · DATOSPILOT · PREVENWORK · BUZONDESK · SAFEVOICE

**Request body**

Required: `permissions`

Fields: permissions: that module's permissions only ([] keeps the module with none)

```json
{
  "permissions": ["JORNADAPULSE_VIEW", "JORNADAPULSE_CREATE"]
}
```

**Success:** `200`

**Response fields**

- `userId`, `active`, `planEnforced`, `assignedAt`
- modules: [ { moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions } ] (all six)
- `assignedModules`, `assignedPermissions`, `entitledModules`, `planModules`, `effectiveModules`, `effectivePermissions`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | NORMAONE or an unknown module, an unknown permission, or a permission of another module (the message names it). |
| 403 | Your own account, a platform account, or a permission you do not hold. |
| 404 | No such user in this tenant. |

### DELETE /api/tenant/users/{userId}/modules/{moduleId}

**Revoke one module** — ADMIN of an active tenant

Removes the module and every permission in it. Applies to the user's next request.

**Path parameters**

- `userId` — The user document id.
- `moduleId` — One of the six module ids.

**Success:** `200`

**Response fields**

- `userId`, `active`, `planEnforced`, `assignedAt`
- modules: [ { moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions } ] (all six)
- `assignedModules`, `assignedPermissions`, `entitledModules`, `planModules`, `effectiveModules`, `effectivePermissions`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | NORMAONE or an unknown module, an unknown permission, or a permission of another module (the message names it). |
| 403 | Your own account, or the module holds a permission you do not (you cannot remove what you were not given). |
| 404 | No such user in this tenant. |

## Tenant plans and plan-change requests

Controller: `TenantPlanController`

### GET /api/tenant/plans

**Plan catalogue** — ADMIN of an active tenant

Every plan in the database, ACTIVE ones first, then cheapest first. Only an ACTIVE plan other than the current one can be requested (selectable); the others are listed with their status.

**Success:** `200`

**Response fields**

- [ { id, planCode, planVersion, name, description, status, listPrice, currencyCode, billingCycle, durationMonths, trialDays, maxEmployees, maxUsers, modules (application modules), current, selectable } ]

> No platform data: no subscription counts, creators or sale windows. selectable is true for an ACTIVE plan that is not the current one. The organization's own subscription and its dates are My package.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |

### GET /api/tenant/plans/{planId}

**One plan** — ADMIN of an active tenant

One plan, as a Tenant Admin sees it.

**Path parameters**

- `planId` — The plan document id (one version of a plan code).

**Success:** `200`

**Response fields**

- `id`, `planCode`, `planVersion`, `name`, `description`, `status`, `listPrice`, `currencyCode`, `billingCycle`, `durationMonths`, `trialDays`, `maxEmployees`, `maxUsers`
- modules (application modules)
- `current`, `selectable`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such plan. |

### POST /api/tenant/plan-change-requests

**Request a plan change** — ADMIN of an active tenant

Asks for this organization to move to another plan. Nothing changes until a Super Admin approves it — there is no billing or payment integration, so no change is applied on request. The Super Admins see it under Change requests. Email Notifications — Coming Soon: the backend queues a Super Admin email in its outbox, but no sender is configured, so nothing is sent yet.

**Request body**

Required: `planId`

Fields: planId (an ACTIVE plan from the catalogue) · reason ≤500. There is no tenant field: a tenantId sent is ignored.

```json
{
  "planId": "<planId>",
  "reason": "We are growing past the seat limit"
}
```

**Success:** `201`

**Response fields**

- `id`
- organization { id, name, subdomain, status }
- `status`
- requestedBy { userId, name, email }
- `requestedAt`, `reason`
- currentPlan { planId, planCode, planVersion, name }
- requestedPlan { planId, planCode, planVersion, name }
- `decidedBy`, `decidedByRole`, `decidedAt`, `decisionNote`, `appliedSubscriptionId`
- notification { status, sentAt — and for a Super Admin: attempts, lastAttemptAt, lastError }

> notification.status is the queued Super Admin email's honest state: PENDING while email delivery is not configured (Coming Soon); once it is, SENT, PENDING (waiting for a retry) or FAILED. Email never affects the saved request.

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such plan. |
| 409 | The plan is not ACTIVE, the organization is already on it, or it already has an open request. |

### GET /api/tenant/plan-change-requests

**My plan-change requests** — ADMIN of an active tenant

This organization's requests, newest first.

**Query parameters**

| Name | Description |
|---|---|
| `status` | PENDING, PROCESSING, APPROVED, REJECTED or CANCELLED. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, organization { id, name, subdomain, status }, status, requestedBy { userId, name, email }, requestedAt, reason, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |

### GET /api/tenant/plan-change-requests/{requestId}

**One plan-change request** — ADMIN of an active tenant

One of this organization's requests, with the decision once there is one.

**Path parameters**

- `requestId` — The plan-change request id.

**Success:** `200`

**Response fields**

- `id`
- organization { id, name, subdomain, status }
- `status`
- requestedBy { userId, name, email }
- `requestedAt`, `reason`
- currentPlan { planId, planCode, planVersion, name }
- requestedPlan { planId, planCode, planVersion, name }
- `decidedBy`, `decidedByRole`, `decidedAt`, `decisionNote`, `appliedSubscriptionId`
- notification { status, sentAt — and for a Super Admin: attempts, lastAttemptAt, lastError }

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such request in this organization (another organization's is 404 too). |

### POST /api/tenant/plan-change-requests/{requestId}/cancel

**Cancel a plan-change request** — ADMIN of an active tenant

Withdraws a PENDING request of this organization. No body.

**Path parameters**

- `requestId` — The plan-change request id.

**Success:** `200`

**Response fields**

- `id`
- organization { id, name, subdomain, status }
- `status`
- requestedBy { userId, name, email }
- `requestedAt`, `reason`
- currentPlan { planId, planCode, planVersion, name }
- requestedPlan { planId, planCode, planVersion, name }
- `decidedBy`, `decidedByRole`, `decidedAt`, `decisionNote`, `appliedSubscriptionId`
- notification { status, sentAt — and for a Super Admin: attempts, lastAttemptAt, lastError }

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such request in this organization. |
| 409 | It is no longer PENDING. |

## Tenant notifications (sending)

Controller: `TenantNotificationController`

### POST /api/tenant/notifications

**Send a notification** — ADMIN of an active tenant

To the caller's own tenant (from their record; a tenantId in the body is ignored). SELECTED: userIds must all be INVITED or ACTIVE members of the tenant (one that is not refuses the whole request, without saying whether it exists elsewhere). TENANT: no userIds; every member who joined on or before it. Never platform-wide.

**Request body**

Required: `subject`, `body`, `audience`

Fields: subject ≤200 · body ≤10000 (plain text) · audience SELECTED or TENANT · userIds (SELECTED only, ≤1000, duplicates removed)

```json
{
  "subject": "Important Compliance Update",
  "body": "Please review the updated compliance requirements.",
  "audience": "SELECTED",
  "userIds": ["<userId>"]
}
```

**Success:** `201`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

> With an attachment the same endpoint takes multipart/form-data: a "notification" part (this JSON, Content-Type application/json) and an "attachment" file part. The notification screens send it that way; the console sends JSON only. A users array, tenantId or createdByRole in the body is ignored.

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | SELECTED without userIds, TENANT with userIds, an id that is not an eligible member of this tenant, or more than 1000 recipients. |
| 400 | Empty file, content that is not PDF/PNG/JPEG/DOCX/XLSX, or a file name whose extension does not match the content. |
| 413 | The file is larger than 10 MB (normaone.attachments.max-size). |
| 409 | The organization is not ACTIVE. |
| 502 | The attachment storage (local disk or S3) failed. Nothing was saved. |

### GET /api/tenant/notifications

**List notifications** — ADMIN of an active tenant

The tenant's notifications, ACTIVE and ARCHIVED, newest first, with recipient and read counts (no recipient lists).

**Query parameters**

| Name | Description |
|---|---|
| `status` | ACTIVE · ARCHIVED |
| `audience` | SELECTED · TENANT |
| `createdBy` | A creator's user id. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, tenantId, subject, body, audience, status, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | A bad status, audience, page or size. |

### GET /api/tenant/notifications/{notificationId}

**Open a notification** — ADMIN of an active tenant

One notification with every recipient's read state (SELECTED) or the read and eligible counts (TENANT).

**Path parameters**

- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such notification in this tenant. |

### PATCH /api/tenant/notifications/{notificationId}

**Edit a notification** — ADMIN of an active tenant

Only the fields sent change. Recipients (SELECTED only) are added unread and removed on the server, so everyone else keeps their read state. The audience never changes.

**Path parameters**

- `notificationId` — The notification document id.

**Request body**

Fields: subject ≤200 · body ≤10000 · addUserIds · removeUserIds

```json
{
  "subject": "Important Compliance Update (revised)"
}
```

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | Nothing to change, a blank subject or body, recipients on a TENANT notification, removing someone who is not a recipient or the last one, or an id that is not an eligible member. |
| 403 | A Super Admin sent it: only a Super Admin changes it. |
| 404 | No such notification in this tenant. |
| 409 | It is archived, the organization is not ACTIVE, or it changed meanwhile. |

### PATCH /api/tenant/notifications/{notificationId}/status

**Archive or restore a notification** — ADMIN of an active tenant

ARCHIVED: it leaves every inbox and unread count and cannot be edited, but stays in the admin lists and is never deleted. ACTIVE: restores an archived one exactly as it was (content, audience, recipients, read states), back in the inboxes — the organization must be ACTIVE. Repeating either changes nothing. Audited as NOTIFICATION_ARCHIVED / NOTIFICATION_RESTORED.

**Path parameters**

- `notificationId` — The notification document id.

**Request body**

Required: `status`

Fields: status ARCHIVED (archive) · ACTIVE (restore) · reason ≤500 (to the audit trail)

```json
{
  "status": "ARCHIVED",
  "reason": "Superseded"
}
```

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | A status other than ARCHIVED or ACTIVE. |
| 403 | A Super Admin sent it (archive and restore alike). |
| 404 | No such notification in this tenant. |
| 409 | Restoring while the organization is not ACTIVE. |

### PUT /api/tenant/notifications/{notificationId}/attachment

**Replace the attachment** — ADMIN of an active tenant

multipart/form-data with an "attachment" file part. Adds or replaces it; the old file is deleted once nothing refers to it.

**Path parameters**

- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

> Multipart only — send it from the notification's page, which builds the form. The console cannot attach a file.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 400 | Empty file, content that is not PDF/PNG/JPEG/DOCX/XLSX, or a file name whose extension does not match the content. |
| 413 | The file is larger than 10 MB (normaone.attachments.max-size). |
| 400 | No "attachment" part. |
| 403 | A Super Admin sent it. |
| 404 | No such notification in this tenant. |
| 409 | It is archived. |
| 415 | Not multipart/form-data. |
| 502 | The attachment storage (local disk or S3) failed. Nothing was saved. |

### DELETE /api/tenant/notifications/{notificationId}/attachment

**Remove the attachment** — ADMIN of an active tenant

Removes the attachment and deletes its file. Without one, nothing changes.

**Path parameters**

- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 403 | A Super Admin sent it. |
| 404 | No such notification in this tenant. |
| 409 | It is archived. |

### GET /api/tenant/notifications/{notificationId}/attachment

**Download the attachment** — ADMIN of an active tenant

The file as a download, ACTIVE or ARCHIVED. With S3 storage: 302 to a 60-second presigned URL.

**Path parameters**

- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- the file's bytes — or 302 Location (S3)

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant (a USER, a Super Admin, an inactive account, or a suspended organization). |
| 404 | No such notification in this tenant, or it has no attachment. |

### GET /api/tenant/notifications/recipients

**Recipient options** — ADMIN of an active tenant

Members of the caller's own organization who can be chosen as notification recipients (INVITED or ACTIVE). The organization comes from the caller's stored record, never from the request.

**Query parameters**

| Name | Description |
|---|---|
| `search` | Name or email, ≤100 characters. |
| `page` | 0-based page index (default 0). |
| `size` | 1 to 100 (default 20). |

**Success:** `200`

**Response fields**

- content: [ { id, name, email, role, status } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 400 | A parameter fails validation, or an enum value is unknown. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The caller is not an ACTIVE ADMIN of an ACTIVE tenant. |

## Super Admin — organizations, administrators, audit

Controller: `SuperAdminController`

### GET /api/super-admin/dashboard

**Platform dashboard** — SUPER_ADMIN

Organizations, administrators and regular users by status, Super Admins, and subscriptions by plan — each a database aggregation.

**Success:** `200`

**Response fields**

- `totalOrganizations`, `organizationsByStatus`, `totalAdmins`, `activeAdmins`, `inactiveAdmins`, `adminsByStatus`, `totalUsers`, `activeUsers`, `inactiveUsers`, `usersByStatus`, `totalSuperAdmins`, `currentSubscriptionsByPlan`

> Active is ACTIVE; inactive is SUSPENDED plus DEACTIVATED; INVITED is neither. /api/super-admin/summary is an alias of the same read.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |

### GET /api/super-admin/tenants

**List tenants** — SUPER_ADMIN

Every tenant. Search matches name or subdomain.

**Query parameters**

| Name | Description |
|---|---|
| `search` | Name or subdomain, ≤100. |
| `status` | PROVISIONING · ACTIVE · SUSPENDED · DELETED |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, tenantName, accountHolderName, subdomain, logoUrl, phoneNumber, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | A bad status, page or size. |

### POST /api/super-admin/tenants

**Create a tenant** — SUPER_ADMIN

A tenant on BASIC with an INVITED administrator, whom Cognito emails a temporary password. If that email cannot be sent, the tenant is discarded (502).

**Request body**

Required: `organizationName`, `subdomain`, `countryCode`, `initialAdmin.name`, `initialAdmin.email`

Fields: as onboarding, plus initialAdmin { name ≤100, email ≤254, phoneNumber ≤30 }

```json
{
  "organizationName": "Beta Iberia SL",
  "subdomain": "beta",
  "countryCode": "ES",
  "defaultLocale": "ES_ES",
  "defaultTimeZone": "EUROPE_MADRID",
  "initialAdmin": {
    "name": "Bea Admin",
    "email": "bea@example.com"
  }
}
```

**Success:** `201`

**Response fields**

- `id`, `tenantName`, `accountHolderName`, `subdomain`, `logoUrl`, `phoneNumber`, `emailAddress`, `defaultLocale`, `defaultTimeZone`, `addressLine`, `city`, `postalCode`, `countryCode`, `status`, `activatedAt`, `suspendedAt`, `statusReason`, `createdAt`, `updatedAt`, `packageCode`, `userCount`, `packageInfo`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 409 | The subdomain is taken. |
| 503 | The default package (BASIC) is not available. |

### GET /api/super-admin/tenants/{tenantId}

**Open a tenant** — SUPER_ADMIN

One tenant, with user count and package.

**Path parameters**

- `tenantId` — The tenant document id.

**Success:** `200`

**Response fields**

- `id`, `tenantName`, `accountHolderName`, `subdomain`, `logoUrl`, `phoneNumber`, `emailAddress`, `defaultLocale`, `defaultTimeZone`, `addressLine`, `city`, `postalCode`, `countryCode`, `status`, `activatedAt`, `suspendedAt`, `statusReason`, `createdAt`, `updatedAt`, `packageCode`, `userCount`, `packageInfo`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such tenant. |

### PATCH /api/super-admin/tenants/{tenantId}

**Update a tenant** — SUPER_ADMIN

Partial: only the fields sent change. Subdomain, status and package are not editable here.

**Path parameters**

- `tenantId` — The tenant document id.

**Request body**

Fields: tenantName 1–100 · accountHolderName 1–100 · emailAddress · phoneNumber ≤30 · addressLine ≤255 · city ≤100 · postalCode ≤20 · logoUrl ≤500 · defaultLocale · defaultTimeZone

```json
{
  "tenantName": "Acme Global",
  "city": "Valencia"
}
```

**Success:** `200`

**Response fields**

- `id`, `tenantName`, `accountHolderName`, `subdomain`, `logoUrl`, `phoneNumber`, `emailAddress`, `defaultLocale`, `defaultTimeZone`, `addressLine`, `city`, `postalCode`, `countryCode`, `status`, `activatedAt`, `suspendedAt`, `statusReason`, `createdAt`, `updatedAt`, `packageCode`, `userCount`, `packageInfo`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | tenantName or accountHolderName sent blank. |
| 404 | No such tenant. |

### PATCH /api/super-admin/tenants/{tenantId}/status

**Change a tenant's status** — SUPER_ADMIN

ACTIVE or SUSPENDED. Suspending needs a reason; its users lose their roles until it is ACTIVE again.

**Path parameters**

- `tenantId` — The tenant document id.

**Request body**

Required: `status`

Fields: status ACTIVE · SUSPENDED · reason ≤500 (required to suspend)

```json
{
  "status": "SUSPENDED",
  "reason": "Review"
}
```

**Success:** `200`

**Response fields**

- `id`, `tenantName`, `accountHolderName`, `subdomain`, `logoUrl`, `phoneNumber`, `emailAddress`, `defaultLocale`, `defaultTimeZone`, `addressLine`, `city`, `postalCode`, `countryCode`, `status`, `activatedAt`, `suspendedAt`, `statusReason`, `createdAt`, `updatedAt`, `packageCode`, `userCount`, `packageInfo`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | Any status but ACTIVE or SUSPENDED, or suspending without a reason. |
| 404 | No such tenant. |
| 409 | Already in that status, or a PROVISIONING / DELETED tenant. |

### GET /api/super-admin/tenants/{tenantId}/package

**A tenant's package** — SUPER_ADMIN

The tenant's current subscription and plan.

**Path parameters**

- `tenantId` — The tenant document id.

**Success:** `200`

**Response fields**

- `tenantId`, `subscriptionId`, `status`, `assignmentSource`, `startDate`, `currentPeriodStart`, `currentPeriodEnd`, `agreedPrice`, `currencyCode`, `billingCycle`, `assignedAt`
- plan { planId, planCode, planVersion, name, description, status, defaultPlan, listPrice, currencyCode, billingCycle, trialDays, maxEmployees, maxUsers, durationMonths, moduleApps }
- seats { limit (null = no limit), used } — package reads only

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such tenant, or it has no current package. |

### GET /api/super-admin/admins

**List administrators** — SUPER_ADMIN

Tenant administrators (role ADMIN) across every organization, with their permissions and organization.

**Query parameters**

| Name | Description |
|---|---|
| `search` | Name or email, ≤100. |
| `tenantId` | One organization only. |
| `status` | INVITED · ACTIVE · SUSPENDED · DEACTIVATED |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, name, email, phoneNumber, role, status, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | A bad status, page or size. |

### POST /api/super-admin/admins

**Invite an administrator** — SUPER_ADMIN

An INVITED ADMIN in an existing, ACTIVE organization. Cognito creates the account and emails a temporary password; the first sign-in sets a permanent one.

**Request body**

Required: `tenantId`, `name`, `email`

Fields: tenantId ≤64 · name ≤100 · email ≤254 · phoneNumber ≤30. No role field: always ADMIN. moduleAccess, modulePermissions optional — when both are absent all six modules are assigned with the ADMIN defaults (every permission but DELETE).

```json
{
  "tenantId": "<tenantId>",
  "name": "Nora Admin",
  "email": "nora@example.com"
}
```

**Success:** `201`

**Response fields**

- `id`, `name`, `email`, `phoneNumber`, `role`, `status`, `linked`
- organization { id, name, subdomain, status }
- `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`, `moduleAccess`, `modulePermissions`

> A role or roles field — SUPER_ADMIN included — is ignored like any unknown field; the account is created as ADMIN.

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No organization has that tenantId. |
| 409 | The organization is not ACTIVE (an invitation into it could never be linked). |
| 409 | The email already has a record in that organization, or is a live account in another one or on the platform. |
| 409 | Employee limit reached: the plan's maxEmployees (or its smaller maxUsers) is taken by active, suspended or invited accounts — "Upgrade your plan to add more employees." BASIC allows 10. |

### GET /api/super-admin/admins/{adminId}

**Open an administrator** — SUPER_ADMIN

One administrator. A regular user's or a Super Admin's id answers 404 here.

**Path parameters**

- `adminId` — The administrator's user document id.

**Success:** `200`

**Response fields**

- `id`, `name`, `email`, `phoneNumber`, `role`, `status`, `linked`
- organization { id, name, subdomain, status }
- `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`, `moduleAccess`, `modulePermissions`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | Not an administrator, or no such id. |

### PUT /api/super-admin/admins/{adminId}

**Update an administrator** — SUPER_ADMIN

Replaces the editable profile: name and phone number. Email, organization, role and permissions are not reachable from here.

**Path parameters**

- `adminId` — The administrator's user document id.

**Request body**

Required: `name`

Fields: name ≤100 · phoneNumber ≤30 (absent or blank clears it)

```json
{
  "name": "Nora Admin-Ruiz",
  "phoneNumber": "+34 600 000 001"
}
```

**Success:** `200`

**Response fields**

- `id`, `name`, `email`, `phoneNumber`, `role`, `status`, `linked`
- organization { id, name, subdomain, status }
- `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`, `moduleAccess`, `modulePermissions`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | Not an administrator, or no such id. |

### PATCH /api/super-admin/admins/{adminId}/status

**Change an administrator's status** — SUPER_ADMIN

ACTIVE, SUSPENDED or DEACTIVATED, through the same lifecycle as every account. Nothing is deleted and the organization is untouched; Cognito signs the account out (and disables it on DEACTIVATED).

**Path parameters**

- `adminId` — The administrator's user document id.

**Request body**

Required: `status`

Fields: status ACTIVE · SUSPENDED · DEACTIVATED · reason ≤500 (required to suspend or deactivate) · confirmNoActiveAdmin: true to remove the organization's only active ADMIN

```json
{
  "status": "SUSPENDED",
  "reason": "Security review"
}
```

**Success:** `200`

**Response fields**

- `id`, `name`, `email`, `phoneNumber`, `role`, `status`, `linked`
- organization { id, name, subdomain, status }
- `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`, `moduleAccess`, `modulePermissions`

> After removing an organization's only active administrator, invite a replacement (Invite an administrator): that is its way back.

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | No reason when suspending or deactivating, or status INVITED. |
| 404 | Not an administrator — a regular user or a Super Admin cannot be changed here. |
| 409 | Already in that status; activating an invitation; suspending an invitation; or the organization's only active administrator without confirmNoActiveAdmin: true. |
| 409 | Reactivating a DEACTIVATED administrator while every user seat of the organization's plan is taken. |
| 502 | Reactivating: Cognito could not re-enable the account. Nothing was changed. |

### POST /api/super-admin/admins/{adminId}/resend-invitation

**Resend an administrator's invitation** — SUPER_ADMIN

Cognito emails the pending administrator a new temporary password.

**Path parameters**

- `adminId` — The administrator's user document id.

**Success:** `200`

**Response fields**

- …the administrator
- invitation { delivery, emailSent, message }

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | Not an administrator, or no such id. |
| 409 | Not INVITED, already has a Cognito password, or temporary-password invitations are off. |
| 502 | Cognito refused to resend it. |

### GET /api/super-admin/admins/{adminId}/modules

**An administrator's modules** — SUPER_ADMIN

All six modules for one administrator: assigned or not, and the permissions in each.

**Path parameters**

- `adminId` — The administrator's user document id.

**Success:** `200`

**Response fields**

- `userId`, `active`, `planEnforced`, `assignedAt`
- modules: [ { moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions } ] (all six)
- `assignedModules`, `assignedPermissions`, `entitledModules`, `planModules`, `effectiveModules`, `effectivePermissions`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | Not an administrator, or no such id. |

### PUT /api/super-admin/admins/{adminId}/modules

**Set an administrator's modules** — SUPER_ADMIN

Replaces the whole assignment. The Super Admin is not limited to permissions of their own.

**Path parameters**

- `adminId` — The administrator's user document id.

**Request body**

Required: `modules`, `permissions`

Fields: modules: list of the six module ids ([] = none) · permissions: module permissions, each inside an assigned module

```json
{
  "modules": ["FACTURAFLOW", "PREVENWORK"],
  "permissions": ["FACTURAFLOW_VIEW", "PREVENWORK_VIEW", "PREVENWORK_DELETE"]
}
```

**Success:** `200`

**Response fields**

- `userId`, `active`, `planEnforced`, `assignedAt`
- modules: [ { moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions } ] (all six)
- `assignedModules`, `assignedPermissions`, `entitledModules`, `planModules`, `effectiveModules`, `effectivePermissions`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | NORMAONE or an unknown module, an unknown permission, or a permission of another module (the message names it). |
| 404 | Not an administrator, or no such id. |

### PUT /api/super-admin/admins/{adminId}/modules/{moduleId}

**Set one administrator module** — SUPER_ADMIN

Assigns one module with exactly these permissions; the administrator's other modules are kept.

**Path parameters**

- `adminId` — The administrator's user document id.
- `moduleId` — One of the six module ids.

**Request body**

Required: `permissions`

Fields: permissions: that module's permissions only

```json
{
  "permissions": ["PREVENWORK_VIEW", "PREVENWORK_DELETE"]
}
```

**Success:** `200`

**Response fields**

- `userId`, `active`, `planEnforced`, `assignedAt`
- modules: [ { moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions } ] (all six)
- `assignedModules`, `assignedPermissions`, `entitledModules`, `planModules`, `effectiveModules`, `effectivePermissions`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | NORMAONE or an unknown module, an unknown permission, or a permission of another module (the message names it). |
| 404 | Not an administrator, or no such id. |

### DELETE /api/super-admin/admins/{adminId}/modules/{moduleId}

**Revoke one administrator module** — SUPER_ADMIN

Removes the module and every permission in it from the administrator.

**Path parameters**

- `adminId` — The administrator's user document id.
- `moduleId` — One of the six module ids.

**Success:** `200`

**Response fields**

- `userId`, `active`, `planEnforced`, `assignedAt`
- modules: [ { moduleId, moduleName, label, order, assigned, entitled, available, inPlan, permissions, effectivePermissions } ] (all six)
- `assignedModules`, `assignedPermissions`, `entitledModules`, `planModules`, `effectiveModules`, `effectivePermissions`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | NORMAONE or an unknown module, an unknown permission, or a permission of another module (the message names it). |
| 404 | Not an administrator, or no such id. |

### GET /api/super-admin/users

**List users** — SUPER_ADMIN

Read only. Regular users (role USER) across every organization — administrators and Super Admins are not in it.

**Query parameters**

| Name | Description |
|---|---|
| `search` | Name or email, ≤100. |
| `tenantId` | One organization only. |
| `status` | INVITED · ACTIVE · SUSPENDED · DEACTIVATED |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, name, email, role, status, linked, … } ]
- `page`, `size`, `totalElements`, `totalPages`

> There is no Super Admin route that creates, edits, deletes or changes the status of a regular user: other methods on /users answer 405, and /users/{id}/status answers 404.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | A bad status, page or size. |

### GET /api/super-admin/users/{userId}

**Open a user** — SUPER_ADMIN

Read only. One regular user with their organization; no phone number and no Cognito sub.

**Path parameters**

- `userId` — The user document id.

**Success:** `200`

**Response fields**

- `id`, `name`, `email`, `role`, `status`, `linked`
- organization { id, name, subdomain, status }
- `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | Not a regular user (administrators are under /admins), or no such id. |

### GET /api/super-admin/audit-events

**Audit trail** — SUPER_ADMIN

Read only. Administrative actions, newest first.

**Query parameters**

| Name | Description |
|---|---|
| `tenantId` | One organization. |
| `targetId` | One user, tenant or subscription id. |
| `actorUserId` | Who did it. |
| `action` | An AuditAction, e.g. USER_INVITED, PLAN_CHANGE_REQUESTED. |
| `targetType` | USER, TENANT, PLAN, SUBSCRIPTION, PLAN_CHANGE_REQUEST, NOTIFICATION. |
| `from` | ISO-8601 instant, inclusive. |
| `to` | ISO-8601 instant, inclusive. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, action, occurredAt, actorUserId, actorRole, tenantId, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | An unknown action, a bad date, to before from, or a bad page or size. |

### GET /api/super-admin/summary

**Platform dashboard (alias)** — SUPER_ADMIN

The earlier name of GET /api/super-admin/dashboard, kept so existing clients work. Same handler, same response.

**Success:** `200`

**Response fields**

- Same as GET /api/super-admin/dashboard

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |

### GET /api/super-admin/accounts

**Account directory** — SUPER_ADMIN

Read-only directory of every account across all tenants and the platform (Super Admins, Admins and Users), with filters. Never returns the Cognito sub or a regular user's phone number.

**Query parameters**

| Name | Description |
|---|---|
| `search` | Name or email, ≤100 characters. |
| `role` | SUPER_ADMIN, ADMIN or USER. |
| `tenantId` | Only accounts of this organization (≤64). |
| `status` | INVITED, ACTIVE, SUSPENDED or DEACTIVATED. |
| `module` | Only accounts assigned this module (NORMAONE is refused with 400). |
| `page` | 0-based page index (default 0). |
| `size` | 1 to 100 (default 20). |

**Success:** `200`

**Response fields**

- content: [ { id, name, email, role, status, linked, organization { id, name, subdomain, status }, moduleAccess, modulePermissions, invitedAt, activatedAt, deactivatedAt, statusReason, createdAt, updatedAt } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 400 | A parameter fails validation, or an enum value is unknown. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |

## Super Admin — platform accounts

Controller: `SuperAdminController`

### GET /api/super-admin/super-admins

**List Super Admins** — SUPER_ADMIN

Platform accounts, newest first.

**Query parameters**

| Name | Description |
|---|---|
| `search` | Name or email. |
| `status` | A UserStatus. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, name, email, role, status, linked, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |

### POST /api/super-admin/super-admins

**Add a Super Admin** — SUPER_ADMIN

Invites a new platform account: Cognito creates it and emails a temporary password (never returned here). An existing account is never promoted.

**Request body**

Required: `name`, `email`

Fields: name ≤100 · email ≤254

```json
{
  "name": "Sara Platform",
  "email": "sara@example.com"
}
```

**Success:** `201`

**Response fields**

- `id`, `name`, `email`, `role`, `status`, `linked`, `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`
- invitation { delivery, emailSent, message } (create and resend only — never a password)

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 409 | The email already has a platform account, or belongs to an organization's account. |
| 502 | Cognito refused or could not be reached. Nothing was saved. |

### GET /api/super-admin/super-admins/{superAdminId}

**Open a Super Admin** — SUPER_ADMIN

One platform account.

**Path parameters**

- `superAdminId` — The Super Admin's user document id.

**Success:** `200`

**Response fields**

- `id`, `name`, `email`, `role`, `status`, `linked`, `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`
- invitation { delivery, emailSent, message } (create and resend only — never a password)

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | Not a Super Admin. |

### PATCH /api/super-admin/super-admins/{superAdminId}/status

**Remove or restore a Super Admin** — SUPER_ADMIN

Removing platform access is DEACTIVATED (the record and its history are kept; Cognito signs the account out and disables it); ACTIVE restores it (Cognito re-enabled first). Never yourself, and never the last active Super Admin.

**Path parameters**

- `superAdminId` — The Super Admin's user document id.

**Request body**

Required: `status`

Fields: status ACTIVE · SUSPENDED · DEACTIVATED · reason ≤500 (required to suspend or deactivate)

```json
{
  "status": "DEACTIVATED",
  "reason": "Left the company"
}
```

**Success:** `200`

**Response fields**

- `id`, `name`, `email`, `role`, `status`, `linked`, `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`
- invitation { delivery, emailSent, message } (create and resend only — never a password)

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 403 | Your own account. |
| 404 | Not a Super Admin. |
| 409 | Already in that status, or the platform would be left without an active Super Admin. |
| 502 | Restoring: Cognito could not re-enable the account. Nothing was changed. |

### POST /api/super-admin/super-admins/{superAdminId}/resend-invitation

**Resend a Super Admin invitation** — SUPER_ADMIN

A new temporary password for an INVITED Super Admin (emailed by Cognito). No body.

**Path parameters**

- `superAdminId` — The Super Admin's user document id.

**Success:** `200`

**Response fields**

- `id`, `name`, `email`, `role`, `status`, `linked`, `invitedAt`, `activatedAt`, `deactivatedAt`, `statusReason`, `createdAt`, `updatedAt`
- invitation { delivery, emailSent, message } (create and resend only — never a password)

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | Not a Super Admin. |
| 409 | Not INVITED. |

## Super Admin — plans, plan history, plan-change requests

Controller: `SuperAdminPlanController`

### GET /api/super-admin/plans

**List plans** — SUPER_ADMIN

Every plan version, by code then newest version first.

**Query parameters**

| Name | Description |
|---|---|
| `status` | DRAFT, ACTIVE, INACTIVE or ARCHIVED. |
| `planCode` | One plan code (any case). |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, planCode, planVersion, name, description, status, … } ]
- `page`, `size`, `totalElements`, `totalPages`

> latestVersion false marks a historical version: a newer version of the same code exists.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |

### POST /api/super-admin/plans

**Create a plan** — SUPER_ADMIN

Creates a DRAFT plan, or a new DRAFT version of an existing code (planVersion omitted = the next one). Recorded in the plan history.

**Request body**

Required: `planCode`, `name`, `billingCycle`, `listPrice`, `maxEmployees`

Fields: planCode ≤50 [A-Za-z0-9_-] · planVersion optional (next one) · name ≤100 · description ≤1000 · billingCycle MONTHLY · QUARTERLY · YEARLY · listPrice ≥0, 2 decimals · currencyCode ISO 4217 (EUR) · maxEmployees >0 · maxUsers 1–1000000 (seat limit; omit = none) · durationMonths 1–120 (omit = rolling) · trialDays ≥0 · publiclyAvailable (shown to Tenant Admins) · effectiveFrom/Until · moduleApps NORMAONE and the six modules

```json
{
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
}
```

**Success:** `201`

**Response fields**

- `id`, `planCode`, `planVersion`, `name`, `description`, `status`, `defaultPlan`, `billingCycle`, `publiclyAvailable`, `effectiveFrom`, `effectiveUntil`, `trialDays`, `listPrice`, `currencyCode`, `maxEmployees`, `maxUsers`, `durationMonths`, `moduleApps`
- currentSubscriptions (one plan only)
- `latestVersion`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | Not an ISO 4217 currency, an unknown module, or effectiveUntil not after effectiveFrom. |
| 409 | That code and version already exist. |

### GET /api/super-admin/plans/{planId}

**Open a plan** — SUPER_ADMIN

One plan version, with how many organizations are on it now.

**Path parameters**

- `planId` — The plan document id (one version of a plan code).

**Success:** `200`

**Response fields**

- `id`, `planCode`, `planVersion`, `name`, `description`, `status`, `defaultPlan`, `billingCycle`, `publiclyAvailable`, `effectiveFrom`, `effectiveUntil`, `trialDays`, `listPrice`, `currencyCode`, `maxEmployees`, `maxUsers`, `durationMonths`, `moduleApps`
- currentSubscriptions (one plan only)
- `latestVersion`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such plan. |

### PATCH /api/super-admin/plans/{planId}

**Edit a plan** — SUPER_ADMIN

A DRAFT changes anything. A published version changes only name, description, publiclyAvailable and the sale window: new terms (price, currency, cycle, duration, seats, trial, employees, modules) are a new version. Each changed field is recorded in the plan history with its previous and new value.

**Path parameters**

- `planId` — The plan document id (one version of a plan code).

**Request body**

Fields: Any field of Create a plan except planCode and planVersion; only the ones sent change.

```json
{
  "name": "Professional",
  "description": "For growing teams"
}
```

**Success:** `200`

**Response fields**

- `id`, `planCode`, `planVersion`, `name`, `description`, `status`, `defaultPlan`, `billingCycle`, `publiclyAvailable`, `effectiveFrom`, `effectiveUntil`, `trialDays`, `listPrice`, `currencyCode`, `maxEmployees`, `maxUsers`, `durationMonths`, `moduleApps`
- currentSubscriptions (one plan only)
- `latestVersion`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such plan. |
| 409 | Archived, or a term of a published version (the message names the fields). |

### PATCH /api/super-admin/plans/{planId}/status

**Activate or deactivate a plan** — SUPER_ADMIN

DRAFT → ACTIVE or ARCHIVED; ACTIVE ⇄ INACTIVE; ACTIVE or INACTIVE → ARCHIVED (final). Status decides only whether the plan can be assigned from now on: organizations on it and every history entry stay. Nothing deletes a plan.

**Path parameters**

- `planId` — The plan document id (one version of a plan code).

**Request body**

Required: `status`

Fields: status ACTIVE · INACTIVE · ARCHIVED · reason ≤500

```json
{
  "status": "INACTIVE",
  "reason": "Replaced by version 2"
}
```

**Success:** `200`

**Response fields**

- `id`, `planCode`, `planVersion`, `name`, `description`, `status`, `defaultPlan`, `billingCycle`, `publiclyAvailable`, `effectiveFrom`, `effectiveUntil`, `trialDays`, `listPrice`, `currencyCode`, `maxEmployees`, `maxUsers`, `durationMonths`, `moduleApps`
- currentSubscriptions (one plan only)
- `latestVersion`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such plan. |
| 409 | Not an allowed move, or the last ACTIVE version of the default plan. |

### GET /api/super-admin/subscriptions

**Current subscriptions** — SUPER_ADMIN

Every organization's current subscription, newest first — with planId, which organizations are on one plan version.

**Query parameters**

| Name | Description |
|---|---|
| `planId` | One plan version. |
| `planCode` | Every version of a code. |
| `status` | A SubscriptionStatus. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { organization { id, name, subdomain, status }, subscription { …My package… }, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |

### PUT /api/super-admin/tenants/{tenantId}/package

**Move an organization to a plan** — SUPER_ADMIN

Applies an ACTIVE plan to an organization directly (no request needed). Recorded in the subscription and plan histories. No payment is taken.

**Path parameters**

- `tenantId` — The organization (tenant) id.

**Request body**

Required: `planId`

Fields: planId · reason ≤500

```json
{
  "planId": "<planId>",
  "reason": "Upgrade agreed with sales"
}
```

**Success:** `200`

**Response fields**

- `tenantId`, `subscriptionId`, `status`, `assignmentSource`, `startDate`, `currentPeriodStart`, `currentPeriodEnd`, `agreedPrice`, `currencyCode`, `billingCycle`, `assignedAt`
- plan { planId, planCode, planVersion, name, description, status, defaultPlan, listPrice, currencyCode, billingCycle, trialDays, maxEmployees, maxUsers, durationMonths, moduleApps }
- seats { limit (null = no limit), used } — package reads only

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such tenant or plan. |
| 409 | The plan is not ACTIVE, the organization is not ACTIVE or SUSPENDED, or it is already on that plan. |

### GET /api/super-admin/tenants/{tenantId}/package/history

**An organization's subscription history** — SUPER_ADMIN

The organization's subscription lifecycle, newest first (SubscriptionHistory).

**Path parameters**

- `tenantId` — The organization (tenant) id.

**Query parameters**

| Name | Description |
|---|---|
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, tenantId, subscriptionId, eventType, eventDate, previousPlanId, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such tenant. |

### GET /api/super-admin/plan-history

**Plan history** — SUPER_ADMIN

Every plan operation across the platform, newest first: plans created, updated (field by field), activated or deactivated, and organizations' plan requests, decisions and changes. Append-only.

**Query parameters**

| Name | Description |
|---|---|
| `eventType` | A PlanHistoryEventType. |
| `tenantId` | One organization. |
| `actorUserId` | Who did it. |
| `planId` | One plan version (as the plan or as the previous plan). |
| `from` | ISO-8601 instant, inclusive. |
| `to` | ISO-8601 instant, inclusive. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, eventType, occurredAt, tenantId, planId, planCode, … } ]
- `page`, `size`, `totalElements`, `totalPages`

> The entries of one request (requested, approved, changed) share its id as correlationId.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 400 | A bad date, or to before from. |

### GET /api/super-admin/plan-change-requests

**Plan-change requests** — SUPER_ADMIN

Every organization's requests, newest first.

**Query parameters**

| Name | Description |
|---|---|
| `status` | PENDING, PROCESSING, APPROVED, REJECTED or CANCELLED. |
| `tenantId` | One organization. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, organization { id, name, subdomain, status }, status, requestedBy { userId, name, email }, requestedAt, reason, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |

### GET /api/super-admin/plan-change-requests/{requestId}

**Open a plan-change request** — SUPER_ADMIN

One request, with the Super Admin email's delivery attempts and last error.

**Path parameters**

- `requestId` — The plan-change request id.

**Success:** `200`

**Response fields**

- `id`
- organization { id, name, subdomain, status }
- `status`
- requestedBy { userId, name, email }
- `requestedAt`, `reason`
- currentPlan { planId, planCode, planVersion, name }
- requestedPlan { planId, planCode, planVersion, name }
- `decidedBy`, `decidedByRole`, `decidedAt`, `decisionNote`, `appliedSubscriptionId`
- notification { status, sentAt — and for a Super Admin: attempts, lastAttemptAt, lastError }

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such request. |

### POST /api/super-admin/plan-change-requests/{requestId}/approve

**Approve a plan-change request** — SUPER_ADMIN

Approves a PENDING request and applies the plan (as Move an organization to a plan). If it cannot be applied, the request stays PENDING and nothing changes.

**Path parameters**

- `requestId` — The plan-change request id.

**Request body**

Fields: note ≤500 (optional)

```json
{
  "note": "Approved after the sales call"
}
```

**Success:** `200`

**Response fields**

- `id`
- organization { id, name, subdomain, status }
- `status`
- requestedBy { userId, name, email }
- `requestedAt`, `reason`
- currentPlan { planId, planCode, planVersion, name }
- requestedPlan { planId, planCode, planVersion, name }
- `decidedBy`, `decidedByRole`, `decidedAt`, `decisionNote`, `appliedSubscriptionId`
- notification { status, sentAt — and for a Super Admin: attempts, lastAttemptAt, lastError }

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such request. |
| 409 | No longer PENDING; the plan is not ACTIVE; the organization is not ACTIVE or SUSPENDED or already on it. |

### POST /api/super-admin/plan-change-requests/{requestId}/reject

**Reject a plan-change request** — SUPER_ADMIN

Rejects a PENDING request; the organization keeps its plan and may ask again.

**Path parameters**

- `requestId` — The plan-change request id.

**Request body**

Required: `note`

Fields: note ≤500 (required)

```json
{
  "note": "Please contact sales first"
}
```

**Success:** `200`

**Response fields**

- `id`
- organization { id, name, subdomain, status }
- `status`
- requestedBy { userId, name, email }
- `requestedAt`, `reason`
- currentPlan { planId, planCode, planVersion, name }
- requestedPlan { planId, planCode, planVersion, name }
- `decidedBy`, `decidedByRole`, `decidedAt`, `decisionNote`, `appliedSubscriptionId`
- notification { status, sentAt — and for a Super Admin: attempts, lastAttemptAt, lastError }

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | No note. |
| 404 | No such request. |
| 409 | No longer PENDING. |

## Super Admin — notifications to organizations

Controller: `SuperAdminNotificationController`

### POST /api/super-admin/tenants/{tenantId}/notifications

**Send a notification** — SUPER_ADMIN

To the tenant in the path, which must exist (404) and be ACTIVE (409). SELECTED: userIds must all be INVITED or ACTIVE members of the tenant (one that is not refuses the whole request, without saying whether it exists elsewhere). TENANT: no userIds; every member who joined on or before it. Never platform-wide.

**Path parameters**

- `tenantId` — The organization (tenant) id.

**Request body**

Required: `subject`, `body`, `audience`

Fields: subject ≤200 · body ≤10000 (plain text) · audience SELECTED or TENANT · userIds (SELECTED only, ≤1000, duplicates removed)

```json
{
  "subject": "Important Compliance Update",
  "body": "Please review the updated compliance requirements.",
  "audience": "SELECTED",
  "userIds": ["<userId>"]
}
```

**Success:** `201`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

> With an attachment the same endpoint takes multipart/form-data: a "notification" part (this JSON, Content-Type application/json) and an "attachment" file part. The notification screens send it that way; the console sends JSON only. A users array, tenantId or createdByRole in the body is ignored.

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such organization. |
| 400 | SELECTED without userIds, TENANT with userIds, an id that is not an eligible member of this tenant, or more than 1000 recipients. |
| 400 | Empty file, content that is not PDF/PNG/JPEG/DOCX/XLSX, or a file name whose extension does not match the content. |
| 413 | The file is larger than 10 MB (normaone.attachments.max-size). |
| 409 | The organization is not ACTIVE. |
| 502 | The attachment storage (local disk or S3) failed. Nothing was saved. |

### GET /api/super-admin/tenants/{tenantId}/notifications

**List notifications** — SUPER_ADMIN

The tenant's notifications, ACTIVE and ARCHIVED, newest first, with recipient and read counts (no recipient lists).

**Path parameters**

- `tenantId` — The organization (tenant) id.

**Query parameters**

| Name | Description |
|---|---|
| `status` | ACTIVE · ARCHIVED |
| `audience` | SELECTED · TENANT |
| `createdBy` | A creator's user id. |
| `page` | 0-based page index. |
| `size` | 1 to 100. |

**Success:** `200`

**Response fields**

- content: [ { id, tenantId, subject, body, audience, status, … } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such organization. |
| 400 | A bad status, audience, page or size. |

### GET /api/super-admin/tenants/{tenantId}/notifications/{notificationId}

**Open a notification** — SUPER_ADMIN

One notification with every recipient's read state (SELECTED) or the read and eligible counts (TENANT).

**Path parameters**

- `tenantId` — The organization (tenant) id.
- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such notification in this tenant. |

### PATCH /api/super-admin/tenants/{tenantId}/notifications/{notificationId}

**Edit a notification** — SUPER_ADMIN

Only the fields sent change. Recipients (SELECTED only) are added unread and removed on the server, so everyone else keeps their read state. The audience never changes.

**Path parameters**

- `tenantId` — The organization (tenant) id.
- `notificationId` — The notification document id.

**Request body**

Fields: subject ≤200 · body ≤10000 · addUserIds · removeUserIds

```json
{
  "subject": "Important Compliance Update (revised)"
}
```

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | Nothing to change, a blank subject or body, recipients on a TENANT notification, removing someone who is not a recipient or the last one, or an id that is not an eligible member. |
| 404 | No such notification in this tenant. |
| 409 | It is archived, the organization is not ACTIVE, or it changed meanwhile. |

### PATCH /api/super-admin/tenants/{tenantId}/notifications/{notificationId}/status

**Archive or restore a notification** — SUPER_ADMIN

ARCHIVED: it leaves every inbox and unread count and cannot be edited, but stays in the admin lists and is never deleted. ACTIVE: restores an archived one exactly as it was (content, audience, recipients, read states), back in the inboxes — the organization must be ACTIVE. Repeating either changes nothing. Audited as NOTIFICATION_ARCHIVED / NOTIFICATION_RESTORED.

**Path parameters**

- `tenantId` — The organization (tenant) id.
- `notificationId` — The notification document id.

**Request body**

Required: `status`

Fields: status ARCHIVED (archive) · ACTIVE (restore) · reason ≤500 (to the audit trail)

```json
{
  "status": "ARCHIVED",
  "reason": "Superseded"
}
```

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 400 | A field fails validation — fieldErrors names it. |
| 400 | An enum field has a value the backend does not have; the message lists the allowed ones. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | A status other than ARCHIVED or ACTIVE. |
| 404 | No such notification in this tenant. |
| 409 | Restoring while the organization is not ACTIVE. |

### PUT /api/super-admin/tenants/{tenantId}/notifications/{notificationId}/attachment

**Replace the attachment** — SUPER_ADMIN

multipart/form-data with an "attachment" file part. Adds or replaces it; the old file is deleted once nothing refers to it.

**Path parameters**

- `tenantId` — The organization (tenant) id.
- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

> Multipart only — send it from the notification's page, which builds the form. The console cannot attach a file.

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 400 | Empty file, content that is not PDF/PNG/JPEG/DOCX/XLSX, or a file name whose extension does not match the content. |
| 413 | The file is larger than 10 MB (normaone.attachments.max-size). |
| 400 | No "attachment" part. |
| 404 | No such notification in this tenant. |
| 409 | It is archived. |
| 415 | Not multipart/form-data. |
| 502 | The attachment storage (local disk or S3) failed. Nothing was saved. |

### DELETE /api/super-admin/tenants/{tenantId}/notifications/{notificationId}/attachment

**Remove the attachment** — SUPER_ADMIN

Removes the attachment and deletes its file. Without one, nothing changes.

**Path parameters**

- `tenantId` — The organization (tenant) id.
- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- `id`, `tenantId`, `subject`, `body`, `audience`, `status`, `archivedAt`
- attachment { attachmentId, fileName, contentType, sizeBytes, checksumSha256, uploadedAt }
- users [ { userId, readStatus, readAt, name, email } ] — one notification only
- `recipientCount`, `readCount`
- eligibleCount (TENANT)
- `createdBy`, `createdByRole`, `updatedBy`, `createdAt`, `updatedAt`

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such notification in this tenant. |
| 409 | It is archived. |

### GET /api/super-admin/tenants/{tenantId}/notifications/{notificationId}/attachment

**Download the attachment** — SUPER_ADMIN

The file as a download, ACTIVE or ARCHIVED. With S3 storage: 302 to a 60-second presigned URL.

**Path parameters**

- `tenantId` — The organization (tenant) id.
- `notificationId` — The notification document id.

**Success:** `200`

**Response fields**

- the file's bytes — or 302 Location (S3)

**Errors**

| Status | When |
|---|---|
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such notification in this tenant, or it has no attachment. |

### GET /api/super-admin/tenants/{tenantId}/notifications/recipients

**Recipient options for a tenant** — SUPER_ADMIN

Members of the organization in the path who can be chosen as notification recipients (INVITED or ACTIVE).

**Path parameters**

- `tenantId` — The organization (tenant) id.

**Query parameters**

| Name | Description |
|---|---|
| `search` | Name or email, ≤100 characters. |
| `page` | 0-based page index (default 0). |
| `size` | 1 to 100 (default 20). |

**Success:** `200`

**Response fields**

- content: [ { id, name, email, role, status } ]
- `page`, `size`, `totalElements`, `totalPages`

**Errors**

| Status | When |
|---|---|
| 400 | A parameter fails validation, or an enum value is unknown. |
| 401 | No token, or the token is invalid, expired, or issued for another app client. |
| 403 | The token is valid but the caller is not SUPER_ADMIN. |
| 404 | No such organization. |

---

Generated on 2026-10-21 from the controller-verified endpoint catalogue (`api-tester/src/config/endpoints.js`) plus the four routes it does not list yet (`GET /api/super-admin/accounts`, `GET /api/super-admin/summary`, and the two notification `/recipients` reads). When a controller changes, update its catalogue entry and regenerate.
