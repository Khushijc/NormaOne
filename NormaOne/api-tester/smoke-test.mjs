/**
 * Renders every route headlessly and checks the parts that break silently.
 *
 *     npm test
 *
 * The reference tester's approach: bundle with rolldown (Vite already ships it, so nothing to
 * install), render each address through StaticRouter, and check for the words that prove the right
 * screen answered. renderToString runs no effects, so this is first paint only — which is the
 * moment a broken screen throws — and nothing is sent to the backend.
 *
 * Beyond the routes it checks the rules that are easy to break without noticing: which requests
 * carry the token, what the console refuses to send, what gets scrubbed before saving, and that
 * every catalogue endpoint can be reached from some screen.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { rolldown } from 'rolldown'

/* ------------------------------------------------------------------ browser stand-ins */

const storageOf = () => {
  const memory = new Map()
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
    clear: () => memory.clear(),
    dump: () => [...memory.entries()],
  }
}
globalThis.localStorage = storageOf()
globalThis.sessionStorage = storageOf()

const bundle = await rolldown({
  input: 'smoke-entry.js',
  external: ['react', /^react\//, 'react-dom', /^react-dom\//, 'lucide-react', 'react-router', 'react-router-dom'],
  plugins: [{ name: 'ignore-css', load: (id) => (id.endsWith('.css') ? { code: 'export default {}' } : null) }],
})
const { output } = await bundle.generate({ format: 'esm' })
const tmp = new URL('./.smoke-bundle.mjs', import.meta.url)
writeFileSync(tmp, output[0].code)
const lib = await import(tmp.href)
rmSync(tmp)
const { App, ApiProvider } = lib

/* ------------------------------------------------------------------ harness */

let failures = 0
let passes = 0
function check(name, ok, detail = '') {
  if (ok) {
    passes += 1
  } else {
    failures += 1
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}

const at = (path) => renderToString(
  React.createElement(ApiProvider, null,
    React.createElement(StaticRouter, { location: path }, React.createElement(App))))

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const fakeJwt = (claims) => `${b64url({ alg: 'RS256', kid: 'test' })}.${b64url(claims)}.signature`
const inOneHour = Math.floor(Date.now() / 1000) + 3600
const ID_TOKEN = fakeJwt({ sub: 'sub-1', token_use: 'id', email: 'ana@example.com', email_verified: true, aud: 'client', exp: inOneHour })
const EXPIRED = fakeJwt({ sub: 'sub-1', token_use: 'access', client_id: 'client', exp: 1000 })

/* ------------------------------------------------------------------ 1. every route renders */

// First paint, before the account check answers: protected screens show their own loading state
// (never a "not signed in" flash), and the sign-in screen shows exactly one form — Register.
const ROUTES = [
  ['/account-auth/auth', ['Sign up &amp; sign in', '1. Register', 'Verify email', 'Login', '/api/auth/register', 'Account']],
  ['/account-me/profile', ['Profile &amp; status', 'Onboarding', 'Reading the profile']],
  ['/account-me/onboarding', ['Create my organization', 'Account holder']],
  ['/account-auth/set-password', ['Sign in with your temporary password first']],
  ['/account-organization/overview', ['My organization', 'Reading the organization']],
  ['/account-notifications/inbox', ['Notifications', 'Reading your notifications', 'ALL', 'UNREAD', 'READ']],
  ['/account-notifications/inbox/6b0f2c1e9d4a7b3c2e1f0a11', ['Notifications', 'Reading the notification']],
  ['/tenant-notifications/notifications', ['Notifications', 'Reading the notifications', 'Send a notification']],
  ['/tenant-notifications/notifications/6b0f2c1e9d4a7b3c2e1f0a11', ['A notification', 'Reading the notification']],
  ['/platform-notifications/notifications', ['Notifications', 'Choose an organization']],
  ['/platform-notifications/notifications/6b0f2c1e9d4a7b3c2e1f0a11', ['Which organization?']],
  ['/platform-notifications/notifications/6b0f2c1e9d4a7b3c2e1f0a11?tenant=6ace1b3421ad37f3253beb6b', ['Reading the notification', 'organization 6ace1b3421ad37f3253beb6b']],
  ['/tenant-organization/overview', ['Tenant admin', 'Organization', 'Reading the organization']],
  ['/tenant-users/users', ['Tenant admin', 'Users', 'Reading the users']],
  ['/tenant-users/users/6ace1b3421ad37f3253beb6c', ['Reading the user']],
  ['/platform-overview/dashboard', ['Super admin', 'Dashboard', 'Reading the dashboard']],
  ['/platform-admins/admins', ['Administrators', 'Reading the administrators']],
  ['/platform-admins/admins/6ace1b3421ad37f3253beb6c', ['Reading the administrator']],
  ['/platform-audit/audit', ['Audit trail', 'Reading the trail', 'From', 'To']],
  ['/platform-super-admins/super-admins', ['Super Admins', 'Add a Super Admin', 'Reading the Super Admins']],
  ['/platform-super-admins/super-admins/6ace1b3421ad37f3253beb6d', ['Reading the account']],
  ['/platform-plans/plans', ['Plans', 'Create a plan', 'Reading the plans']],
  ['/platform-plans/plans/6ace1b3421ad37f3253beb6e', ['Reading the plan']],
  ['/platform-plans/requests', ['Plan-change requests', 'Reading the requests', 'no billing or payment integration']],
  ['/platform-plans/requests/6ace1b3421ad37f3253beb6f', ['Reading the request']],
  ['/platform-plans/history', ['Plan history', 'Reading the history']],
  ['/tenant-plans/plans', ['Available plans', 'Current subscription', 'Reading the plans']],
  ['/tenant-audit/audit', ['Audit log', 'Reading the trail', 'Only your own organization']],
  ['/platform-tenants/tenants', ['Tenants', 'Reading the tenants']],
  ['/platform-tenants/tenants/6ace1b3421ad37f3253beb6b', ['Reading the tenant']],
  ['/platform-users/users', ['Users (read only)', 'Reading the users']],
  ['/platform-users/users/6ace1b3421ad37f3253beb6c', ['Reading the user']],
  ['/workbench-console/console', ['Request console', 'Send', '/api/users/me', 'Start from an endpoint']],
  ['/workbench-endpoints/endpoints', ['Endpoint reference', 'Open in console']],
  ['/workbench-saved/saved', ['Saved requests', 'Nothing saved yet']],
  ['/workbench-history/history', ['History', 'No calls yet']],
  ['/no-such-screen', ['Page not found']],
]

for (const [path, words] of ROUTES) {
  let html = ''
  try {
    html = at(path)
  } catch (error) {
    check(`renders ${path}`, false, error.stack)
    continue
  }
  check(`renders ${path}`, html.length > 0)
  check(`${path} is not caught by the error boundary`, !html.includes('This screen failed'))
  for (const word of words) check(`${path} shows "${word}"`, html.includes(word), `missing "${word}"`)
}

// Every route the router knows is in the list above, so a new screen cannot go untested.
for (const route of lib.ROUTES) {
  const pattern = new RegExp(`^${route.path.replace(/:[^/]+/g, '[^/]+')}$`)
  check(`route ${route.path} has a smoke check`, ROUTES.some(([path]) => pattern.test(path)))
}

// The Super Admin catalogue holds no regular-user mutation, because the backend has none.
for (const endpoint of lib.ALL_ENDPOINTS.filter((one) => one.path.startsWith('/api/super-admin/users'))) {
  check(`${endpoint.id} is read only`, endpoint.method === 'GET', `${endpoint.method} ${endpoint.path}`)
}

// No screen address may start with /api: the dev server would proxy it to Spring.
for (const route of lib.ROUTES) check(`${route.path} is outside the proxy`, !/^\/api($|\/)/.test(route.path))

// The endpoint reference lists every endpoint's path.
const reference = at('/workbench-endpoints/endpoints')
for (const endpoint of lib.ALL_ENDPOINTS) {
  check(`reference lists ${endpoint.id}`, reference.includes(endpoint.path.replace(/\{/g, '{')), endpoint.path)
}

/* ------------------------------------------------------------------ 2. one form, gates, landing */

{
  const html = at('/account-auth/auth')
  check('the sign-in screen shows one form at a time', (html.match(/<form/g) || []).length === 1)
  check('the first step is Register', html.includes('1. Register') && !html.includes('Verification code') && !html.includes('3. Login</h2>'))
  check('the top bar names the session, not a token', html.includes('Session') && !html.includes('Paste a token'))
}

// The onboarding gate, rendered with the account the provider would have read from /api/users/me.
{
  const gate = (path, me, checked = true) => renderToString(
    React.createElement(lib.ApiStateContext.Provider, {
      value: { account: { checked, session: { authenticated: Boolean(me) }, me } },
    }, React.createElement(StaticRouter, { location: path },
      React.createElement(lib.OnboardingGate, null, React.createElement('p', null, 'SCREEN')))))
  const pending = { requiresTenantSetup: true, onboardingStatus: 'NOT_STARTED' }
  const done = { requiresTenantSetup: false, onboardingStatus: 'COMPLETED', effectiveRole: 'ADMIN' }
  check('unfinished onboarding is kept off tenant screens', !gate('/tenant-users/users', pending).includes('SCREEN'))
  check('unfinished onboarding is kept off platform screens', !gate('/platform-overview/dashboard', pending).includes('SCREEN'))
  check('the onboarding screen itself is never gated (no loop)', gate('/account-me/onboarding', pending).includes('SCREEN'))
  check('the workbench stays open', gate('/workbench-console/console', pending).includes('SCREEN'))
  check('a completed account passes', gate('/tenant-users/users', done).includes('SCREEN'))
  check('nothing is redirected before the account is checked', gate('/tenant-users/users', pending, false).includes('SCREEN'))
  check('a signed-out visitor is not redirected (the screen says sign in)', gate('/tenant-users/users', null).includes('SCREEN'))

  // Role gating: a screen for another role is not rendered at all. The backend refuses the calls
  // anyway; this only keeps a page of 403s off the screen.
  const user = { requiresTenantSetup: false, onboardingStatus: 'COMPLETED', effectiveRole: 'USER' }
  const superAdmin = { requiresTenantSetup: false, onboardingStatus: 'PLATFORM_ACCOUNT', effectiveRole: 'SUPER_ADMIN' }
  const blocked = (html) => !html.includes('SCREEN') && html.includes('Not available to your role')
  check('an ADMIN is kept off platform screens', blocked(gate('/platform-overview/dashboard', done)))
  check('a USER is kept off tenant admin screens', blocked(gate('/tenant-users/users', user)))
  check('a USER is kept off platform screens', blocked(gate('/platform-admins/admins', user)))
  check('a SUPER_ADMIN is kept off tenant admin screens', blocked(gate('/tenant-organization/overview', superAdmin)))
  check('a SUPER_ADMIN reaches platform screens', gate('/platform-overview/dashboard', superAdmin).includes('SCREEN'))
  check('a USER reaches their own organization', gate('/account-organization/overview', user).includes('SCREEN'))
  // Notifications: an inbox for both tenant roles, none for the platform account.
  check('a USER reaches their inbox', gate('/account-notifications/inbox', user).includes('SCREEN'))
  check('an ADMIN reaches their inbox', gate('/account-notifications/inbox', done).includes('SCREEN'))
  check('a SUPER_ADMIN has no inbox', blocked(gate('/account-notifications/inbox', superAdmin)) && gate('/account-notifications/inbox', superAdmin).includes('ADMIN or USER'))
  check('an ADMIN manages the tenant\'s notifications', gate('/tenant-notifications/notifications', done).includes('SCREEN'))
  check('a USER is kept off notification management', blocked(gate('/tenant-notifications/notifications', user)))
  check('a SUPER_ADMIN reaches platform notifications', gate('/platform-notifications/notifications', superAdmin).includes('SCREEN'))
  // My organization is the USER's tab: an ADMIN has Tenant admin › Organization, a SUPER_ADMIN none.
  check('an ADMIN is kept off My organization', blocked(gate('/account-organization/overview', done)))
  check('…and pointed to Tenant admin › Organization', gate('/account-organization/overview', done).includes('Tenant admin › Organization'))
  check('a SUPER_ADMIN is kept off My organization', blocked(gate('/account-organization/overview', superAdmin)))
  check('My organization is open while signed out (the screen says sign in)', gate('/account-organization/overview', null).includes('SCREEN'))
  check('the rest of the account surface stays open to an ADMIN', gate('/account-me/profile', done).includes('SCREEN'))
  check('set-password is never gated', gate('/account-auth/set-password', null).includes('SCREEN') && gate('/account-auth/set-password', pending).includes('SCREEN'))
  check('surfaceAllowed is unknown when signed out', lib.surfaceAllowed('platform', null) === null)
}

{
  const land = lib.landingFor
  check('requiresTenantSetup lands on onboarding', land({ requiresTenantSetup: true }) === '/account-me/onboarding')
  check('a PROVISIONING tenant (IN_PROGRESS) lands on onboarding', land({ requiresTenantSetup: false, onboardingStatus: 'IN_PROGRESS' }) === '/account-me/onboarding')
  check('an ADMIN lands on the organization', land({ onboardingStatus: 'COMPLETED', effectiveRole: 'ADMIN' }) === '/tenant-organization/overview')
  check('a SUPER_ADMIN lands on the platform dashboard', land({ onboardingStatus: 'PLATFORM_ACCOUNT', effectiveRole: 'SUPER_ADMIN' }) === '/platform-overview/dashboard')
  check('a platform Super Admin with requiresTenantSetup false lands on platform overview', land({ accountType: 'PLATFORM', onboardingStatus: 'PLATFORM_ACCOUNT', requiresTenantSetup: false, effectiveRole: 'SUPER_ADMIN' }) === '/platform-overview/dashboard')
  check('a platform account never lands on onboarding even if requiresTenantSetup is passed', land({ accountType: 'PLATFORM', requiresTenantSetup: true, effectiveRole: 'SUPER_ADMIN' }) === '/platform-overview/dashboard')
  check('needsOnboarding is false for platform accounts', lib.needsOnboarding({ accountType: 'PLATFORM', requiresTenantSetup: false }) === false)
  check('needsOnboarding is false for PLATFORM_ACCOUNT status', lib.needsOnboarding({ onboardingStatus: 'PLATFORM_ACCOUNT' }) === false)
  check('needsOnboarding is false for SUPER_ADMIN role', lib.needsOnboarding({ effectiveRole: 'SUPER_ADMIN' }) === false)
  check('needsOnboarding is true for Tenant Admin with incomplete setup', lib.needsOnboarding({ requiresTenantSetup: true, onboardingStatus: 'NOT_STARTED', effectiveRole: 'ADMIN' }) === true)
  check('needsOnboarding is false for Tenant Admin with completed setup', lib.needsOnboarding({ requiresTenantSetup: false, onboardingStatus: 'COMPLETED', effectiveRole: 'ADMIN' }) === false)
  check('a USER lands on their profile', land({ onboardingStatus: 'COMPLETED', effectiveRole: 'USER' }) === '/account-me/profile')
  check('an account without a role lands on its profile', land({ onboardingStatus: 'COMPLETED' }) === '/account-me/profile')
  check('no profile lands on sign-in', land(null) === '/account-auth/auth')
}

// Nothing the app rendered wrote a token, or anything token-shaped, to either storage.
{
  const everything = [localStorage, sessionStorage].flatMap((one) => one.dump())
  check('no storage key mentions a token', !everything.some(([key]) => /token/i.test(key)), JSON.stringify(everything.map(([key]) => key)))
  check('no stored value looks like a JWT', !everything.some(([, value]) => /eyJ[\w-]+\.[\w-]+\./.test(value)))
}

/* ------------------------------------------------------------------ 3. catalogue and navigation */

const badgeTotal = lib.MODULE_LINKS.reduce((sum, link) => sum + (link.endpoints ?? 0), 0)
check('sidebar badges add up to the catalogue', badgeTotal === lib.LIVE_COUNT, `badges ${badgeTotal}, catalogue ${lib.LIVE_COUNT}`)
check('the catalogue has its 96 endpoints', lib.LIVE_COUNT === 96, `found ${lib.LIVE_COUNT}`)
check('set-password has an address', lib.SET_PASSWORD_PATH === '/account-auth/set-password')
{
  // Hidden: reached only from a login that answered NEW_PASSWORD_REQUIRED, so no tab leads to it.
  const html = at('/account-auth/auth')
  check('set-password has no tab in the navbar', !html.includes('href="/account-auth/set-password"'))
  check('the login step mentions the temporary password', readFileSync('src/pages/account/Auth.jsx', 'utf8').includes('temporary password from the invitation email'))
}
check('endpoint ids are unique', new Set(lib.ALL_ENDPOINTS.map((one) => one.id)).size === lib.LIVE_COUNT)

// Every endpoint is reachable from a screen: its id appears in quotes somewhere under src/pages
// or src/components (EndpointTag, call(), useRead()). An endpoint no screen names can only be sent
// from the console, which is a gap worth knowing about.
const sources = []
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
  const path = join(dir, entry.name)
  if (entry.isDirectory()) walk(path)
  else if (/\.jsx?$/.test(entry.name)) sources.push(readFileSync(path, 'utf8'))
})
walk('src/pages')
walk('src/components')
const allSource = sources.join('\n')
for (const endpoint of lib.ALL_ENDPOINTS) {
  check(`a screen calls ${endpoint.id}`, allSource.includes(`'${endpoint.id}'`) || allSource.includes(`"${endpoint.id}"`))
}

/* ------------------------------------------------------------------ 4. what each request carries */

const env = { baseUrl: '' }
{
  const pub = lib.buildCall('login', { body: { email: 'a@b.c', password: 'x' } }, env).prepared
  // 'omit' would make the browser drop the Set-Cookie the login answers with.
  check('login goes with same-origin credentials, so its cookies are stored', pub.credentials === 'same-origin')
  check('no request ever carries an Authorization header from the page', !pub.headers.Authorization)
  check('login carries the CSRF header', pub.headers['X-Requested-With'] === 'NormaOne')
  const prot = lib.buildCall('tenant-get-user', { pathParams: { userId: 'u 1' } }, env).prepared
  check('a protected endpoint goes with the session cookies', prot.credentials === 'same-origin' && !prot.headers.Authorization)
  check('path parameters are encoded', prot.url === '/api/tenant/users/u%201', prot.url)
  for (const id of ['auth-session', 'auth-refresh', 'auth-logout']) {
    check(`${id} goes with the session cookies`, lib.buildCall(id, {}, env).prepared.credentials === 'same-origin')
  }
  const list = lib.buildCall('sa-list-users', { query: { status: 'ACTIVE', search: '', page: 0 } }, env).prepared
  check('empty query values are left out', list.url === '/api/super-admin/users?status=ACTIVE&page=0', list.url)
  check('a GET sends no Content-Type', !list.headers['Content-Type'])

  // A notification with an attachment: multipart/form-data with a JSON part and a file part.
  const file = new File(['%PDF-1.4'], 'policy.pdf', { type: 'application/pdf' })
  const multipart = lib.buildCall('sa-notif-create', { pathParams: { tenantId: 't1' },
    form: [{ name: 'notification', json: { subject: 's', body: 'b', audience: 'TENANT' } }, { name: 'attachment', file }] }, env).prepared
  check('an attachment goes as FormData', multipart.body instanceof FormData && multipart.body.get('attachment') instanceof Blob)
  check('the JSON part is sent as application/json', multipart.body.get('notification').type === 'application/json')
  check('multipart lets the browser write its own Content-Type (with the boundary)', !Object.keys(multipart.headers).some((key) => key.toLowerCase() === 'content-type'))
  check('multipart still carries the CSRF header and the session', multipart.headers['X-Requested-With'] === 'NormaOne' && multipart.credentials === 'same-origin')
  check('multipart fills the tenant into the path', multipart.url === '/api/super-admin/tenants/t1/notifications', multipart.url)
  check('the request view can describe each part', multipart.formParts.length === 2 && multipart.formParts[1].fileName === 'policy.pdf' && multipart.formParts[0].text.includes('TENANT'))
  const curl = lib.toCurl(multipart, 'http://localhost:8881')
  check('cURL copies multipart as -F parts', curl.includes('-F') && curl.includes('attachment=@policy.pdf') && !curl.includes('--data-raw'), curl)

  // The console's three choices: the session, nothing, or a typed token without the session.
  const draft = { method: 'GET', path: '/api/users/me', pathParams: [], queryParams: [], headers: [], body: '' }
  const as = (auth) => lib.buildRequest({ ...draft, auth: lib.resolveAuth({ auth }) }, env, {})
  check('console "Session" sends the cookies', as({ type: 'session' }).credentials === 'same-origin')
  check('a request saved before cookie sessions ("active") still means the session', as({ type: 'active' }).credentials === 'same-origin')
  check('console "No auth" sends nothing', as({ type: 'none' }).credentials === 'omit' && !as({ type: 'none' }).headers.Authorization)
  const typed = as({ type: 'bearer', token: ID_TOKEN })
  check('a typed token goes alone, without the cookies', typed.credentials === 'omit' && typed.headers.Authorization === `Bearer ${ID_TOKEN}`)
  check('a CSRF header typed blank stays blank, so its absence can be tested',
    lib.buildRequest({ ...draft, headers: [{ key: 'X-Requested-With', value: '', enabled: true }], auth: { type: 'session' } }, env, {})
      .headers['X-Requested-With'] === '')
}

/* ------------------------------------------------------------------ 5. JSON and tokens */

{
  const bad = lib.checkJson('{\n  "a": 1,\n}')
  check('invalid JSON is reported', !bad.ok)
  check('invalid JSON names the line', bad.error?.line === 3, JSON.stringify(bad.error))
  check('empty text is "no body"', lib.checkJson('  ').ok && lib.checkJson('').empty)
}
{
  const id = lib.describeToken(`Bearer ${ID_TOKEN}`)
  check('an ID token is recognised, Bearer prefix and all', id.valid && id.kind === 'id' && id.email === 'ana@example.com' && !id.expired)
  check('an expired token is flagged', lib.describeToken(EXPIRED).expired === true)
  check('a refresh token (5 parts) is explained', /refresh token/.test(lib.describeToken('a.b.c.d.e').problem))
  check('junk is not a JWT', lib.describeToken('hello').valid === false)
}

/* ------------------------------------------------------------------ 6. what the console refuses */

{
  const endpoint = lib.ALL_ENDPOINTS.find((one) => one.id === 'tenant-user-status')
  const draft = lib.draftFromEndpoint(endpoint)
  const problems = lib.validateDraft(draft)
  check('an empty path parameter is refused', problems.some((one) => one.field === 'pathParams'), JSON.stringify(problems))

  const filled = { ...draft, pathParams: [{ name: 'userId', value: 'u1' }] }
  check('a complete draft passes', lib.validateDraft(filled).length === 0,
    JSON.stringify(lib.validateDraft(filled)))
  check('broken JSON is refused', lib.validateDraft({ ...filled, body: '{ "status": ' }).some((one) => one.field === 'body'))
  check('an unquoted placeholder is not reported as broken JSON',
    lib.validateDraft({ ...filled, body: '{ "n": {{$randomInt}} }' }).length === 0)
  check('a session draft needs nothing typed', lib.validateDraft({ ...filled, auth: { type: 'session' } }).length === 0)
  check('an empty typed token is refused', lib.validateDraft({ ...filled, auth: { type: 'bearer', token: ' ' } }).some((one) => one.field === 'auth'))
  check('a GET body is not validated', lib.validateDraft({ ...filled, method: 'GET', body: '{' }).length === 0)
  check('a bad header name is refused', lib.validateDraft({ ...filled, headers: [{ key: 'X Bad', value: '1', enabled: true }] })
    .some((one) => one.field === 'headers'))

  check('a console login keeps its cookies (session credentials)', lib.draftFromEndpoint(lib.ALL_ENDPOINTS.find((one) => one.id === 'login')).auth.type === 'session')
}
{
  const local = lib.splitUrl('http://localhost:8881/api/tenant/users?status=ACTIVE&search=ana%20b')
  check('a full backend URL is cut to its path', local.path === '/api/tenant/users', JSON.stringify(local))
  check('its query becomes rows', local.queryParams?.length === 2 && local.queryParams[1].value === 'ana b', JSON.stringify(local.queryParams))
  check('another host is refused', Boolean(lib.splitUrl('https://example.com/api/users/me').error))
  check('a path without "/" is refused', Boolean(lib.splitUrl('api/users/me').error))
}
{
  const match = lib.matchEndpoint(lib.ALL_ENDPOINTS, 'PATCH', '/api/tenant/users/abc/status')
  check('a typed path is matched to its endpoint', match?.id === 'tenant-user-status', match?.id)
  check('a wrong method matches nothing', lib.matchEndpoint(lib.ALL_ENDPOINTS, 'DELETE', '/api/tenant/users/abc') === null)
}

/* ------------------------------------------------------------------ 7. nothing secret is kept */

{
  const dirty = {
    id: 'x', method: 'GET', path: '/api/users/me', pathParams: [], queryParams: [],
    headers: [{ key: 'Authorization', value: `Bearer ${ID_TOKEN}`, enabled: true }, { key: 'X-Trace', value: '1', enabled: true }],
    auth: { type: 'bearer', token: ID_TOKEN }, body: '',
  }
  const clean = lib.scrubRequest(dirty)
  check('saving drops the Authorization header', !clean.headers.some((h) => h.key === 'Authorization') && clean.headers.length === 1)
  check('saving drops a typed token', clean.auth.token === '')
  check('an export holds no token', !lib.exportSaved([clean]).includes(ID_TOKEN))

  const back = lib.parseImport(lib.exportSaved([clean]))
  check('an export imports back', back.requests?.length === 1 && back.requests[0].id !== 'x', JSON.stringify(back))
  check('a foreign file is refused', Boolean(lib.parseImport('{"item": []}').error))

  const curl = lib.toCurl({ method: 'GET', url: '/api/users/me', headers: { Authorization: `Bearer ${ID_TOKEN}` }, body: null }, 'http://localhost:8881')
  check('cURL carries $TOKEN, not the token', curl.includes('Bearer $TOKEN') && !curl.includes(ID_TOKEN), curl)
}

/* ------------------------------------------------------------------ 8. outcomes */

{
  const of = (status, extra = {}) => lib.outcomeOf({ status, ...extra })?.kind
  check('2xx is success', of(201) === 'success')
  check('401 and 403 are auth', of(401) === 'auth' && of(403) === 'auth')
  check('409 is a client error', of(409) === 'client')
  check('500 is a server error', of(500) === 'server')
  check('no status is network', of(null, { error: { kind: 'network' } }) === 'network')
  check('a refusal before sending is frontend', of(null, { error: { kind: 'frontend' } }) === 'frontend')
}

/* ------------------------------------------------------------------ 9. account workflows & landing */

{
  // 1. Super Admin: Platform overview, never onboarding
  const superAdminMe = {
    accountType: 'PLATFORM',
    onboardingStatus: 'PLATFORM_ACCOUNT',
    requiresTenantSetup: false,
    effectiveRole: 'SUPER_ADMIN',
  }
  check('Super Admin does not need onboarding', !lib.needsOnboarding(superAdminMe))
  check('Super Admin lands on platform dashboard', lib.landingFor(superAdminMe) === '/platform-overview/dashboard')
  const saAcc = { checked: true, session: { authenticated: true }, me: superAdminMe }
  check('Super Admin is allowed on platform surface', lib.surfaceAllowed('platform', saAcc) === true)
  check('Super Admin is not allowed on tenant surface', lib.surfaceAllowed('tenant', saAcc) === false)

  // 2. Tenant Admin (Incomplete Setup) -> Onboarding
  const tenantAdminIncomplete = {
    accountType: 'TENANT',
    onboardingStatus: 'NOT_STARTED',
    requiresTenantSetup: true,
    effectiveRole: null,
  }
  check('Unonboarded tenant admin needs onboarding', lib.needsOnboarding(tenantAdminIncomplete))
  check('Unonboarded tenant admin lands on onboarding page', lib.landingFor(tenantAdminIncomplete) === '/account-me/onboarding')

  // 3. Tenant Admin (Completed Setup) -> Organization Overview
  const tenantAdminComplete = {
    accountType: 'TENANT',
    onboardingStatus: 'COMPLETED',
    requiresTenantSetup: false,
    effectiveRole: 'ADMIN',
  }
  check('Completed tenant admin does not need onboarding', !lib.needsOnboarding(tenantAdminComplete))
  check('Completed tenant admin lands on organization overview', lib.landingFor(tenantAdminComplete) === '/tenant-organization/overview')
  const adminAcc = { checked: true, session: { authenticated: true }, me: tenantAdminComplete }
  check('Tenant Admin is allowed on tenant surface', lib.surfaceAllowed('tenant', adminAcc) === true)
  check('Tenant Admin is not allowed on platform surface', lib.surfaceAllowed('platform', adminAcc) === false)

  // 4. Invited User -> Own Profile
  const invitedUser = {
    accountType: 'TENANT',
    onboardingStatus: 'COMPLETED',
    requiresTenantSetup: false,
    effectiveRole: 'USER',
  }
  check('Invited user does not need onboarding', !lib.needsOnboarding(invitedUser))
  check('Invited user lands on profile page', lib.landingFor(invitedUser) === '/account-me/profile')
  const userAcc = { checked: true, session: { authenticated: true }, me: invitedUser }
  check('Invited user is not allowed on platform surface', lib.surfaceAllowed('platform', userAcc) === false)
  check('Invited user is not allowed on tenant surface', lib.surfaceAllowed('tenant', userAcc) === false)

  // 5. Password challenge path
  check('Password change challenge routes to set-password path', lib.SET_PASSWORD_PATH === '/account-auth/set-password')
}

/* ------------------------------------------------------------------ 6. module access */

// A catalogue shaped like GET /api/modules: the defaults come from it, never from this app.
{
  const perm = (module, action, defaultFor) => ({ id: `${module}_${action}`, module, action, label: action, description: action, defaultFor })
  const SIX = ['FACTURAFLOW', 'JORNADAPULSE', 'DATOSPILOT', 'PREVENWORK', 'BUZONDESK', 'SAFEVOICE']
  const catalogue = SIX.map((id, index) => ({
    id, order: index + 1, name: id, label: `${id} label`, description: id, requirementsDocumented: index < 4,
    permissions: [perm(id, 'VIEW', ['ADMIN', 'USER']), perm(id, 'MANAGE', ['ADMIN']), ...(id === 'PREVENWORK' ? [perm(id, 'DELETE', [])] : [])],
  }))
  const forUser = lib.defaultsFor(catalogue, 'USER')
  check('a new user is shown all six modules', JSON.stringify(forUser.modules) === JSON.stringify(SIX))
  check('a new user is shown VIEW only', forUser.permissions.every((id) => id.endsWith('_VIEW')) && forUser.permissions.length === 6)
  const forAdmin = lib.defaultsFor(catalogue, 'ADMIN')
  check('a new administrator gets no DELETE by default', !forAdmin.permissions.includes('PREVENWORK_DELETE') && forAdmin.permissions.length === 12)
  const scoped = lib.defaultsFor(catalogue, 'ADMIN', ['FACTURAFLOW_VIEW', 'FACTURAFLOW_MANAGE'])
  check('defaults stay within the granting administrator\'s scope', JSON.stringify(scoped.permissions) === '["FACTURAFLOW_VIEW","FACTURAFLOW_MANAGE"]')
  check('scope is read from /api/users/me modulePermissions', JSON.stringify(lib.scopeOf({ modules: ['A', 'B'], modulePermissions: ['A_VIEW', 'B_VIEW'] })) === '["A_VIEW","B_VIEW"]')
  check('a Super Admin (no modules) has no scope to grant', lib.scopeOf({ modules: [], modulePermissions: [] }).length === 0 && lib.scopeOf(null).length === 0)
  check('assignments compare regardless of order', lib.sameAssignment({ modules: ['B', 'A'], permissions: [] }, { modules: ['A', 'B'], permissions: [] }))
  check('a stored assignment is read from the backend view', lib.assignmentOf({ assignedModules: ['A'], assignedPermissions: ['A_VIEW'] }).modules[0] === 'A')

  const editor = renderToString(React.createElement(lib.ModuleEditor, {
    catalogue, value: forUser, onChange: () => {}, scope: ['FACTURAFLOW_VIEW', 'JORNADAPULSE_VIEW'],
  }))
  check('the editor lists the six modules', SIX.every((id) => editor.includes(`${id} label`)))
  check('the editor shows permissions under their module', editor.includes('PREVENWORK_DELETE') && editor.includes('SAFEVOICE_MANAGE'))
  check('the editor ticks the defaults', (editor.match(/checked=""/g) || []).length === 12)
  check('permissions outside the scope cannot be ticked', editor.includes('You do not hold this permission'))
  check('provisional modules are marked', editor.includes('provisional'))
  check('the editor says how many permissions the administrator holds', editor.includes('You hold <!-- -->2<!-- --> of <!-- -->13'))
  const lockedEditor = renderToString(React.createElement(lib.ModuleEditor, { catalogue, value: forUser, onChange: () => {}, scope: [] }))
  check('an administrator holding nothing is told why everything is locked', lockedEditor.includes('You hold no module permission yourself'))
  const ownerEditor = renderToString(React.createElement(lib.ModuleEditor, {
    catalogue, value: forUser, onChange: () => {}, scope: catalogue.flatMap((module) => module.permissions.map((permission) => permission.id)),
  }))
  check('an owner holding every permission can give any of them', !ownerEditor.includes('disabled=""') && !ownerEditor.includes('You hold'))

  // /api/users/me: module ids and one flat permission list.
  const summary = renderToString(React.createElement(lib.ModuleSummary, {
    modules: ['FACTURAFLOW', 'DATOSPILOT'],
    permissions: ['FACTURAFLOW_VIEW', 'FACTURAFLOW_MANAGE', 'DATOSPILOT_VIEW'],
    catalogue: catalogue.map((module) => ({ ...module, name: module.id === 'FACTURAFLOW' ? 'FacturaFlow' : module.name })),
  }))
  check('the summary shows only the modules it is given (from /api/users/me)', summary.includes('FacturaFlow') && !summary.includes('JORNADAPULSE'))
  check('the summary names a module from the catalogue', summary.includes('FacturaFlow') && summary.includes('FACTURAFLOW label'))
  check('the summary puts each permission under its own module',
    summary.indexOf('FACTURAFLOW_MANAGE') < summary.indexOf('DATOSPILOT label') && summary.indexOf('DATOSPILOT_VIEW') > summary.indexOf('DATOSPILOT label'))
  check('a listed module is shown available, never blocked by the plan', summary.includes('>available<') && !summary.includes('plan'))
  check('the summary works without the catalogue (ids only)',
    renderToString(React.createElement(lib.ModuleSummary, { modules: ['SAFEVOICE'], permissions: [] })).includes('SAFEVOICE'))
  const editorWithStatus = renderToString(React.createElement(lib.ModuleEditor, {
    catalogue, value: forUser, onChange: () => {},
    status: SIX.map((id) => ({ moduleId: id, assigned: true, entitled: true, available: true, inPlan: false })),
  }))
  check('the editor marks available modules and never mentions the plan', editorWithStatus.includes('available') && !editorWithStatus.includes('plan'))
  check('the editor disables nothing because of the plan', !editorWithStatus.includes('disabled=""'))
}

// The former general permissions (ORGANIZATION_VIEW, USERS_MANAGE, …) are gone from every screen.
{
  const screenSources = []
  const collect = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collect(path)
    else if (/\.jsx?$/.test(entry.name)) screenSources.push([path, readFileSync(path, 'utf8')])
  })
  collect('src')
  for (const word of ['ORGANIZATION_VIEW', 'PACKAGE_VIEW', 'USERS_VIEW', 'USERS_MANAGE', 'NOTIFICATIONS_MANAGE', 'PermissionPicker',
    'customPermissions', 'sa-admin-permissions', 'sa-set-admin-permissions', "'sa-permissions'", 'not in the plan']) {
    const found = screenSources.filter(([, source]) => source.includes(word)).map(([path]) => path)
    check(`no screen refers to ${word}`, found.length === 0, found.join(', '))
  }
  check('no endpoint carries a general permission', lib.ALL_ENDPOINTS.every((one) => !('permission' in one)))
  check('no endpoint reaches a /permissions route', lib.ALL_ENDPOINTS.every((one) => !one.path.endsWith('/permissions')))
  check('no modules says so', renderToString(React.createElement(lib.ModuleSummary, { modules: [] })).includes('No module is available'))
}

// Plans, plan-change requests, plan history and audit: built from the backend's answers, never made up.
{
  const form = lib.planForm(null)
  check('a new plan form starts with the portal module and EUR', form.moduleApps.join() === 'NORMAONE' && form.currencyCode === 'EUR')
  const body = lib.planBody({ ...form, planCode: ' pro ', name: ' Pro ', listPrice: '49.9', maxEmployees: '10' })
  check('a plan body trims the code and name and sends numbers', body.planCode === 'pro' && body.name === 'Pro' && body.listPrice === 49.9 && body.maxEmployees === 10)
  check('empty seat limit and duration are left out (no limit, rolling)', !('maxUsers' in body) && !('durationMonths' in body))
  const published = lib.planBody(lib.planForm({ planCode: 'PRO', name: 'Pro', listPrice: 10, maxEmployees: 5, moduleApps: ['NORMAONE'] }),
    { withCode: false, only: lib.PUBLISHED_EDITABLE })
  check('a published plan sends only what it may still change', Object.keys(published).every((key) => lib.PUBLISHED_EDITABLE.includes(key)))
  check('money shows two decimals and the currency', lib.money(49.9, 'EUR') === '49.90 EUR' && lib.money(null) === '—')
  check('a plan label is code and version', lib.planLabel('PRO', 2) === 'PRO v2')
  check('a local date becomes an ISO instant; empty or invalid is not sent', lib.isoOf('2026-10-01T10:00')?.endsWith('Z') && lib.isoOf('') === undefined && lib.isoOf('x') === undefined)
  check('plan and request statuses have colours', ['DRAFT', 'INACTIVE', 'PENDING', 'APPROVED', 'REJECTED', 'SENT', 'FAILED'].every((s) => lib.STATUS_TONE[s]))
  check('the tenant audit filter offers no platform-only action', !lib.TENANT_AUDIT_ACTIONS.includes('PLAN_CREATED') && lib.TENANT_AUDIT_ACTIONS.includes('PLAN_CHANGE_REQUESTED'))

  const terms = renderToString(React.createElement(lib.PlanTerms, { plan: {
    id: 'p1', planCode: 'PRO', planVersion: 1, name: 'Pro', status: 'INACTIVE', listPrice: 49.9, currencyCode: 'EUR', billingCycle: 'MONTHLY',
    durationMonths: 12, maxUsers: null, maxEmployees: 50, trialDays: 0, modules: ['FACTURAFLOW'], current: true, selectable: false,
  } }))
  check('a tenant sees the terms, seats and duration of a plan', terms.includes('49.90 EUR') && terms.includes('12 months') && terms.includes('no limit'))
  check('a tenant does not see platform-only plan data', !terms.includes('Organizations on it now') && !terms.includes('Default plan'))

  const request = { id: 'r1', status: 'PENDING', requestedAt: '2026-10-19T10:00:00Z', organization: { id: 't1', name: 'Org alpha' },
    requestedBy: { name: 'Ana', email: 'ana@a.test' }, currentPlan: { planCode: 'BASIC', planVersion: 1, name: 'Basic' },
    requestedPlan: { planCode: 'PRO', planVersion: 1, name: 'Pro' }, notification: { status: 'PENDING', attempts: 2, lastError: 'SMTP down' } }
  const forTenant = renderToString(React.createElement(lib.RequestFacts, { request: { ...request, notification: { status: 'PENDING' } } }))
  const forPlatform = renderToString(React.createElement(lib.RequestFacts, { request, platform: true }))
  check('a request shows both plans and who asked', forTenant.includes('BASIC v1') && forTenant.includes('PRO v1') && forTenant.includes('ana@a.test'))
  // Email delivery is not configured (config/features.js): no delivery status, a Coming Soon badge instead.
  check('email delivery is marked Coming Soon until it is configured', lib.EMAIL_DELIVERY_AVAILABLE === false)
  check('a request shows Email Notifications — Coming Soon, for both roles',
    forTenant.includes('Email Notifications') && forTenant.includes('Coming Soon') && forPlatform.includes('Coming Soon'))
  check('no email delivery status or error is shown while email is not available',
    !forPlatform.includes('SMTP down') && !forPlatform.includes('Email attempts') && !forTenant.includes('>PENDING<</span> ') && !forPlatform.includes('SENT'))
  const notificationSource = readFileSync('src/components/NotificationParts.jsx', 'utf8')
  check('the notification form says email is coming soon and in-app continues',
    notificationSource.includes('Email notifications are coming soon. Recipients will continue to receive in-app notifications.')
    && notificationSource.includes('<ComingSoon />'))
  const tenantPlansSource = readFileSync('src/pages/tenant/Plans.jsx', 'utf8')
  const requestsSource = readFileSync('src/pages/platform/PlanRequests.jsx', 'utf8')
  check('the plan screens show Coming Soon instead of an email status', tenantPlansSource.includes('<EmailComingSoon />') && requestsSource.includes('<ComingSoon />'))
  check('a plan request is never blocked on email', !/disabled=\{[^}]*EMAIL_DELIVERY_AVAILABLE/.test(tenantPlansSource))

  const history = renderToString(React.createElement(lib.HistoryTable, { read: { data: { content: [{
    id: 'h1', eventType: 'PLAN_UPDATED', occurredAt: '2026-10-19T10:00:00Z', planCode: 'PRO', planVersion: 1, actorRole: 'SUPER_ADMIN',
    actorUserId: 'u1', changes: [{ field: 'listPrice', from: '49.90', to: '59.00' }],
  }], page: 0, totalPages: 1, totalElements: 1 } }, onPage: () => {} }))
  check('the plan history shows each change with its old and new value', history.includes('listPrice') && history.includes('49.90') && history.includes('59.00'))

  const confirm = renderToString(React.createElement(lib.ConfirmDialog, {
    open: true, title: 'Remove access?', message: 'They can no longer sign in.', confirmLabel: 'Remove access', onConfirm: () => {}, onCancel: () => {},
  }))
  check('a destructive action asks first, with a cancel', confirm.includes('Remove access?') && confirm.includes('Cancel') && confirm.includes('Remove access'))
  check('a closed confirmation renders nothing', renderToString(React.createElement(lib.ConfirmDialog, { open: false, onConfirm: () => {}, onCancel: () => {} })) === '')

  const full = renderToString(React.createElement(lib.PackageFacts, { pack: { status: 'ACTIVE', plan: { maxUsers: 3 }, seats: { limit: 3, used: 3 } } }))
  check('a full seat limit says so with the package', full.includes('3 of 3') && full.includes('full'))
  const open = renderToString(React.createElement(lib.PackageFacts, { pack: { status: 'ACTIVE', plan: {}, seats: { limit: null, used: 7 } } }))
  check('a plan without a seat limit says so', open.includes('7 (no limit)'))

  // Email-notification preferences: a switch that shows the stored value; own vs team routes.
  const withApi = (element) => renderToString(React.createElement(lib.ApiActionsContext.Provider, { value: { call: async () => ({ ok: false }) } }, element))
  const off = withApi(React.createElement(lib.EmailPreferenceToggle, { enabled: false, endpointId: 'me-set-email-preference', who: 'your account', compact: true }))
  const on = withApi(React.createElement(lib.EmailPreferenceToggle, { enabled: true, endpointId: 'tenant-set-user-email-preference', pathParams: { userId: 'u1' }, who: 'Uma', compact: true }))
  check('the email switch shows the stored value', off.includes('aria-checked="false"') && off.includes('Disabled') && on.includes('aria-checked="true"') && on.includes('Enabled'))
  check('the email switch says whose preference it is', on.includes('Email notifications for Uma') && off.includes('Email notifications for your account'))
  check('while email is Coming Soon the preference says it is saved for later', renderToString(React.createElement(lib.EmailDeliveryNote)).includes('Coming Soon'))
  const ownPut = lib.ALL_ENDPOINTS.find((one) => one.id === 'me-set-email-preference')
  const teamPut = lib.ALL_ENDPOINTS.find((one) => one.id === 'tenant-set-user-email-preference')
  check('the own preference route takes no user id', ownPut && !ownPut.path.includes('{') && ownPut.method === 'PUT')
  check('the team preference route is the Tenant Admin\'s, for one user of the own organization', teamPut && teamPut.access === 'ADMIN' && teamPut.path === '/api/tenant/users/{userId}/email-preference')
  const toggleSource = readFileSync('src/components/EmailPreference.jsx', 'utf8')
  check('the switch moves only after a successful save', toggleSource.includes('if (result.ok && typeof result.bodyJson?.emailNotificationsEnabled === \'boolean\')'))
  const usersSource = readFileSync('src/pages/tenant/Users.jsx', 'utf8')
  check('the team list offers the switch for USER accounts only', usersSource.includes("user.effectiveRole === 'USER'") && usersSource.includes('Own setting'))

  // Archived notifications can be restored (confirmed), and module screens explain what a Super Admin must do.
  const notificationParts = readFileSync('src/components/NotificationParts.jsx', 'utf8')
  check('an archived notification offers Restore behind a confirmation', notificationParts.includes('function RestoreNotification')
    && notificationParts.includes("status: 'ACTIVE'") && notificationParts.includes('title="Restore this notification?"'))
  check('a Tenant Admin is told a platform notification is restored by a Super Admin only', notificationParts.includes('only a Super Admin can restore it'))
  check('the archive endpoint documents restore', lib.ALL_ENDPOINTS.filter((one) => one.id.endsWith('notif-status') && one.id !== 'notif-read-status')
    .every((one) => one.fields.includes('ACTIVE (restore)')))
  const moduleParts = readFileSync('src/components/ModuleParts.jsx', 'utf8')
  check('a never-assigned account is explained, not shown as "0 of 0"', moduleParts.includes('No module is assigned to this account yet')
    && moduleParts.includes('created before modules were assigned by default'))
  check('an administrator holding nothing is told a Super Admin assigns theirs', moduleParts.includes('Super admin › Administrators ›'))

  // Nothing on the plan screens is hard-coded sample data.
  const planScreens = ['src/pages/tenant/Plans.jsx', 'src/pages/platform/Plans.jsx', 'src/pages/platform/PlanDetail.jsx',
    'src/pages/platform/PlanRequests.jsx', 'src/pages/platform/PlanHistory.jsx', 'src/pages/platform/SuperAdmins.jsx']
    .map((path) => readFileSync(path, 'utf8'))
  check('no plan screen holds sample plans or fake responses', planScreens.every((source) => !/sample|mock|fake|lorem/i.test(source)))
  const tenantPlans = readFileSync('src/pages/tenant/Plans.jsx', 'utf8')
  check('a tenant\'s plan change is a request, never a claimed payment', tenantPlans.includes('tenant-plan-request') && !/payment (succeeded|successful|completed)/i.test(tenantPlans))
  check('the tenant audit screen sends no tenantId', !readFileSync('src/pages/tenant/Audit.jsx', 'utf8').includes('tenantId'))
  check('the tenant plan request sends no tenantId', !tenantPlans.includes('tenantId'))
}

console.log(`${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
