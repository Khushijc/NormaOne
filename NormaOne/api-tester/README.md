# NormaOne API tester

The environment for exercising the NormaOne backend by hand. It is a replica of
`orbit-sphere-new-api/new-api-tester`: the same shell, theme, navigation model, API layer and
response pop-up, pointed at NormaOne's 61 endpoints. That project is not touched by anything here.

```bash
cd NormaOne/api-tester && npm install
npm run dev     # http://localhost:1500 — needs the backend on 8881
npm test        # renders every route headlessly, plus unit checks
npm run lint
npm run build
```

Start the backend first (`cd NormaOne/backend && ./mvnw spring-boot:run`, port 8881).

## How it reaches the backend

**Through the Vite proxy, always.** The page calls its own origin, and `vite.config.js` forwards
`^/api($|/)` to `VITE_API_BASE_URL` (default `http://localhost:8881`; override in `.env.local`, see
`.env.example`). That address is read in one place, and the top bar shows it.

**No CORS change to the backend.** NormaOne has no CORS configuration, and adding one only so a test
tool can call it would widen what every browser origin may do. The proxy makes the call
same-origin, which also lets the page read every response header (`WWW-Authenticate` on a 401).
The reference's "Development (direct)" environment is not copied for that reason: it could only
ever fail.

## Authentication

The session is a pair of **HttpOnly cookies the backend sets** at login: `NORMAONE_SESSION` (the Cognito ID token, path `/api`) and `NORMAONE_REFRESH` (path `/api/auth`). Between a temporary-password login and the new password there is a third, `NORMAONE_CHALLENGE` (path `/api/auth`, 3 minutes), which opens nothing but that step. See section **Browser sessions** in `backend/docs/AUTH_RBAC_GUIDE.md`. This page never sees a token and stores none: no `localStorage`, no `sessionStorage`. An old token left by an earlier version is removed on load.

- **Sign up & in** is one guided sequence, one form at a time: **1. Register → 2. Verify email → 3. Login**.
  - Register opens Verify on `202`.
  - Verify opens Login on success. A wrong code stays on the step with the backend's message, and "Resend code" belongs to this step.
  - Name, email and password are kept in memory while moving back and forth, so "Back" never empties a form.
- **Invited accounts** do not register. Their invitation email carries a temporary password. Logging in with it answers `challenge: NEW_PASSWORD_REQUIRED` and no session, and the app opens **Set password** (`/account-auth/set-password`):
  - the email travels in navigation state, never in the URL, and a reload or bookmark of that page says to sign in again;
  - the rules come from `GET /api/auth/password-policy` and tick off as they are met, with a show/hide toggle and a confirmation field;
  - nothing is sent until the password meets every rule and both fields match, and one click sends one request;
  - `POST /api/auth/new-password` opens the session, then the app reads `/api/users/me` and goes on as after any login. A 401 there (the 3-minute challenge expired) offers to sign in again.
- **Invitation feedback.** Inviting a user or an administrator, or creating a tenant, opens the new record with the backend's own `invitation` message (temporary password emailed, existing account, or self registration). While a record is `INVITED`, its page has **Resend invitation**. No password is ever shown or stored.
- **After login** the app asks the backend who signed in: `GET /api/auth/session`, then `GET /api/users/me`. It goes where that answer says:
  - onboarding while `requiresTenantSetup` (or `onboardingStatus` is `IN_PROGRESS`);
  - otherwise the dashboard: SUPER_ADMIN → platform dashboard, ADMIN → organization, USER → profile.
  - The same check runs on every page load, so a reload keeps a valid session and nothing is decided from local state (`src/lib/landing.js`).
- **Screens follow the role.** The sidebar shows Tenant admin to an ADMIN, Super admin to a SUPER_ADMIN, and My organization to a USER only. An address typed for another role shows *Not available to your role* instead of a page of 403s. The backend decides either way.
- **Onboarding is mandatory.** While `/api/users/me` says it is unfinished, any tenant or platform address redirects to onboarding (`OnboardingGate`). The onboarding screen itself is never gated, so there is no loop. The workbench stays open, and the backend refuses what the account may not do either way. The form prefills `accountHolderName` from the profile's `name`; it stays editable.
- **The Session control** in the top bar shows the signed-in email, role, onboarding state and when the session ends. It has Renew (`POST /api/auth/refresh`), Recheck and Sign out (`POST /api/auth/logout`, which clears the cookies). It never shows a token.
- **An expired session** is renewed once with the refresh cookie when a screen's request gets 401. If that fails, the app is signed out. The console is exempt, because there a 401 is usually what is being tested.
- **Requests.** Every request is same-origin through the proxy and carries `X-Requested-With`, which the backend requires on cookie and auth writes (CSRF). Every catalogue call sends the cookies, the public ones included: with `credentials: 'omit'` the browser would also drop the login's `Set-Cookie`.
- **Console auth** has three choices:
  - **Session** — the cookies;
  - **No auth** — no cookies and no header, for provoking a 401;
  - **Bearer token** — typed for one request, sent without the cookies, never saved. Get one from a non-browser login with `X-Token-Delivery: body`.

  Testing another role means signing out and in as that account.

## Screens

Navigation is the reference's three levels — side panel section, module, body navbar — and its
sections are NormaOne's access bands from SecurityConfig.

| Section | Module | Endpoints |
|---|---|---|
| Account (public / any token) | Sign up & in | register → verify-email (+ resend-code) → login, one step at a time; session, refresh, logout in the top bar · Set password (no tab, reached from a temporary-password login): password-policy, new-password |
| | Me | users/me, onboarding/status, onboarding/tenant |
| | My organization | organization (read only; the tab is shown to USER accounts, since an ADMIN has Tenant admin › Organization) |
| | Notifications | the member's inbox (ADMIN or USER): list with ALL / UNREAD / READ, unread count · on a notification's page: open (not marked read), mark read or unread, download the attachment |
| Tenant admin (ADMIN) | Organization | tenant, tenant/package |
| | Users | list, invite · on a user's page: open, update, status, resend invitation |
| | Notifications | list, send (JSON, or multipart with an attachment) · on a notification's page: open with read states, edit and recipients, archive, replace / remove / download the attachment |
| Super admin (SUPER_ADMIN) | Overview | dashboard |
| | Tenants | list, create · on a tenant's page: open, update, status, package |
| | Administrators | list, invite, permission list · on an administrator's page: open, update, status, read and set permissions, resend invitation |
| | Users | **read only:** list · on a user's page: open |
| | Audit | the audit trail, filterable |
| | Notifications | the same eight, in the organization chosen on the page (kept in the address as `?tenant=`) |
| Workbench | Console, Endpoints, Saved, History | any |

As in the reference: every control carries an **EndpointTag** naming the request it sends; writes
open the **response pop-up** by themselves; reads stay quiet and show their own problem panel; a
detail page reads its record from the id in the URL. Protected screens without a session say
so instead of firing a call that can only 401 (the reference's "No school chosen").

**Workbench** is what the reference's README kept three primitives for but never built:

- **Console** — method, URL, path parameters (from `{name}` in the path), query parameters and
  headers (switchable rows), auth (top bar / none / typed bearer), JSON body with line numbers,
  live validation and Format. Requests the page can tell are broken are refused as **"Not sent"**
  (frontend) — invalid JSON with its line and column, an empty path parameter, no token — so a 400
  always means the backend refused it. The response view separates frontend, network and backend
  failures, and shows status, time, size, body (JSON or text, empty-safe), headers, the request as
  sent, and copy buttons for URL, cURL (token written as `$TOKEN`) and body. Ctrl+Enter sends.
- **Endpoints** — every endpoint with access rule, fields, example body, response fields and every
  refusal the service throws; "Open in console" prefills a request from it.
- **Saved** — requests saved from the console (localStorage), with open, duplicate, delete, and
  JSON import/export.
- **History** — every call this tab made (in memory, last 100), filterable by outcome, viewable and
  reopenable in the console.

## Layout

```
src/
  api/            ApiProvider (call, send, account session, log), apiContext, buildCall, useRead
  config/         endpoints.js (the 61, hand-written from the source), enums.js, environments.js
  lib/            httpClient (from the reference), request, json, jwt, outcome, store, forms,
                  clipboard, variables (from the reference)
  components/     Layout, Sidebar, Topbar, ModuleNav, EndpointTag, ResponseModal, ScreenBoundary,
                  ui/Kit, ui/Select, ui/Segmented (from the reference) · SessionControl, OnboardingGate, Invitation, ResponseView,
                  KeyValueEditor, JsonEditor, Screen, TenantFields, TenantFacts, PackageFacts, UserParts
  pages/          account/, tenant/, platform/, workbench/, NotFound
  styles/         tokens, base, layout (from the reference) · components (reference minus its
                  Orbit-only sections) · workbench (what this app adds)
```

`config/endpoints.js` is **written by hand**, unlike the reference's generated file: NormaOne's
Postman collection only covers the happy path. Each entry was read from the controller, request DTO,
service and SecurityConfig. `npm test` asserts the count (61), that the sidebar badges add up to
it, and that every endpoint is called from some screen.

## Not here, and why

- **Health check.** The backend has no health endpoint (`HealthController` was deleted and there is
  no actuator), so none is shown. `GET /api/users/me` answering 401 with no token is the cheapest
  "the backend is up" signal, and the top bar's Check button uses it.
- **Request tabs.** The reference has none; the console keeps one draft, saved across reloads.
- **Token refresh.** The backend has no refresh endpoint, so an expired token means signing in again.
- **Environment picker.** One environment exists; see `src/config/environments.js`.
