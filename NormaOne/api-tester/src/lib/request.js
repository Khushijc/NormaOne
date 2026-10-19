/**
 * A request as the console edits it, and everything that can be said about one before it is sent.
 *
 * THE SHAPE IS THE REFERENCE'S DRAFT — method, path, pathParams, queryParams, headers, body, auth —
 * because httpClient.buildRequest already turns exactly that into a fetch. The one addition is
 * `auth.type: 'session'`, meaning "the browser's HttpOnly session cookie" — the page never sees the
 * token, it only lets the browser send it. That
 * what makes a saved request reusable across the three accounts.
 *
 * Everything that can be wrong with a draft is caught here as a FRONTEND error and never sent:
 * a 400 from the backend should always mean the backend refused it, not that the page sent junk.
 */

import { checkJson } from './json.js'
import { applyVariables } from './variables.js'
import { PROXY_TARGET } from '../config/environments.js'

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** The {name} placeholders in a path, in order, once each. */
export function pathParamNames(path) {
  const names = []
  for (const match of String(path || '').matchAll(/\{([^{}/]+)\}/g)) {
    if (!names.includes(match[1])) names.push(match[1])
  }
  return names
}

/** The path's parameters, keeping any value already typed for a name that is still there. */
export function syncPathParams(path, existing = []) {
  return pathParamNames(path).map((name) => ({
    name,
    value: existing.find((one) => one.name === name)?.value ?? '',
  }))
}

/** An empty draft. `auth: session` so a new request goes as the signed-in account. */
export function blankDraft() {
  return {
    endpointId: null,
    name: '',
    method: 'GET',
    path: '/api/users/me',
    pathParams: [],
    queryParams: [],
    headers: [],
    body: '',
    auth: { type: 'session' },
  }
}

/**
 * A draft prefilled from the catalogue: its path, its documented query parameters (switched off
 * unless the backend has a default), its example body, and the right auth for its access rule.
 */
export function draftFromEndpoint(endpoint) {
  return {
    endpointId: endpoint.id,
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    pathParams: syncPathParams(endpoint.path),
    queryParams: endpoint.queryParams.map(({ key, value, enabled }) => ({ key, value, enabled })),
    headers: endpoint.bodyAllowed ? [{ key: 'Content-Type', value: 'application/json', enabled: true }] : [],
    body: endpoint.body || '',
    // Every endpoint with the session, the public ones too: a login sent without credentials would
    // succeed and store no cookie (the browser drops Set-Cookie on such a request), and the backend
    // ignores the session cookie on /api/auth/** anyway.
    auth: { type: 'session' },
  }
}

/**
 * What was typed in the URL box, as a path plus query rows.
 *
 * A full URL pointing at the configured backend is accepted and cut down to its path, because that
 * is what gets pasted from Postman or a log. One pointing anywhere else is refused: this page can
 * only reach the backend through its own proxy, and a request to another host would fail on CORS
 * in a way that looks like the backend's fault.
 */
export function splitUrl(input) {
  const text = String(input ?? '').trim()
  if (!text) return { error: 'The URL is empty.' }

  let rest = text
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let url
    try {
      url = new URL(text)
    } catch {
      return { error: `"${text}" is not a valid URL.` }
    }
    const allowed = [PROXY_TARGET, globalThis.location?.origin].filter(Boolean).map((one) => new URL(one).origin)
    if (!allowed.includes(url.origin)) {
      return {
        error: `${url.origin} is not the configured backend (${PROXY_TARGET}). Requests go through this page's proxy; `
          + 'change VITE_API_BASE_URL in .env.local to point it elsewhere.',
      }
    }
    rest = `${url.pathname}${url.search}`
  }

  if (!rest.startsWith('/')) return { error: 'The path must start with "/", for example /api/users/me.' }
  if (/\s/.test(rest)) return { error: 'The path contains a space. Encode it, or put the value in a query parameter.' }

  const [path, query = ''] = rest.split('?')
  const queryParams = query
    ? query.split('&').filter(Boolean).map((pair) => {
      const [key, value = ''] = pair.split('=')
      const decode = (s) => {
        try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s }
      }
      return { key: decode(key), value: decode(value), enabled: true }
    })
    : []
  return { path, queryParams }
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/**
 * Every reason this draft must not be sent, as `{ field, message }`. Empty means send it.
 *
 * The session cookie cannot be inspected from the page (it is HttpOnly), so a missing session is
 * reported by the backend's 401, not here. Only a typed token that is empty is caught. Was:
 * discovered as a 401.
 */
export function validateDraft(draft) {
  const problems = []
  if (!METHODS.includes(draft.method)) problems.push({ field: 'method', message: `${draft.method} is not a supported method.` })

  if (!String(draft.path || '').startsWith('/')) {
    problems.push({ field: 'url', message: 'The path must start with "/", for example /api/users/me.' })
  } else if (draft.path.includes('?')) {
    problems.push({ field: 'url', message: 'Put query parameters in the Params tab, not in the path.' })
  }

  draft.pathParams.forEach((param) => {
    if (!String(param.value ?? '').trim()) {
      problems.push({ field: 'pathParams', message: `Path parameter {${param.name}} has no value.` })
    }
  })

  draft.queryParams.forEach((param, index) => {
    if (param.enabled !== false && !String(param.key).trim() && String(param.value).trim()) {
      problems.push({ field: 'queryParams', message: `Query row ${index + 1} has a value but no name.` })
    }
  })

  draft.headers.forEach((header, index) => {
    if (header.enabled === false || !String(header.key).trim()) return
    if (!HEADER_NAME.test(header.key.trim())) {
      problems.push({ field: 'headers', message: `Header row ${index + 1}: "${header.key}" is not a valid header name.` })
    }
  })

  const sendsBody = !['GET', 'HEAD'].includes(draft.method) && String(draft.body || '').trim() !== ''
  const contentType = draft.headers.find((h) => h.enabled !== false && h.key.trim().toLowerCase() === 'content-type')
  const declaresJson = !contentType || /json/i.test(contentType.value)
  if (sendsBody && declaresJson) {
    // Placeholders are filled in before sending, so check the text as it will go out: an
    // unquoted {{$randomInt}} is not JSON as typed, but is once it becomes a number.
    const result = checkJson(applyVariables(draft.body, {}).text)
    if (!result.ok) {
      const where = result.error.line ? ` (line ${result.error.line}, column ${result.error.column})` : ''
      problems.push({ field: 'body', message: `The body is not valid JSON${where}: ${result.error.message}` })
    }
  }

  if (draft.auth?.type === 'bearer' && !String(draft.auth.token || '').trim()) {
    problems.push({ field: 'auth', message: 'Auth is "Bearer token" but no token is typed.' })
  }
  return problems
}

/**
 * The httpClient auth for a draft. 'active' is what requests saved before cookie sessions called the
 * session, so they keep working.
 */
export function resolveAuth(draft) {
  if (draft.auth?.type === 'bearer') return { type: 'bearer', token: String(draft.auth.token || '').trim() }
  if (draft.auth?.type === 'session' || draft.auth?.type === 'active') return { type: 'session' }
  return { type: 'none' }
}

/**
 * The catalogue entry a method and path belong to, or null. `{name}` in a template matches any one
 * segment, so `/api/tenant/users/6ad…` is recognised as "Open a user" — which lets the console say
 * who may call what is typed, and lets the history link a hand-made call to its endpoint.
 */
export function matchEndpoint(endpoints, method, path) {
  const segments = String(path || '').split('?')[0].split('/')
  return endpoints.find((endpoint) => {
    if (endpoint.method !== method) return false
    const template = endpoint.path.split('/')
    return template.length === segments.length
      && template.every((part, i) => /^\{[^}]+\}$/.test(part) ? segments[i] !== '' : part === segments[i])
  }) || null
}

/**
 * A logged call, back as an editable draft — for "Edit in console" and the history's "Open".
 * A call the console made kept its draft; one a screen made is rebuilt from what was sent, with
 * the session used again rather than any credential copied out of the log.
 */
export function draftFromLogEntry(entry) {
  if (entry.draft) return { ...entry.draft }
  const request = entry.result?.request
  const split = splitUrl(request?.path || entry.path || '/')
  const headers = Object.entries(request?.headers || {})
    .filter(([key]) => key.toLowerCase() !== 'authorization')
    .map(([key, value]) => ({ key, value, enabled: true }))
  return {
    endpointId: entry.endpointId || null,
    name: entry.action || '',
    method: request?.method || entry.method,
    path: split.path || '/',
    pathParams: [],
    queryParams: split.queryParams || [],
    headers,
    // A multipart body (a FormData) cannot be put back in the console; it opens without one.
    body: typeof request?.body === 'string' ? request.body : '',
    auth: { type: entry.authMode === 'session' ? 'session' : 'none' },
  }
}

/* -------------------------------------------------------------------- import and export */

export const EXPORT_FORMAT = 'normaone-api-tester/saved-requests'

/** The file a collection is exported as. Credentials were already scrubbed when they were saved. */
export function exportSaved(list) {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), requests: list }, null, 2)
}

/**
 * The requests in an exported file, or an error saying what is wrong with it. Each is given a new
 * id so importing the same file twice adds copies rather than silently overwriting.
 */
export function parseImport(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { error: `Not JSON: ${error.message}` }
  }
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.requests)) {
    return { error: `Not a saved-requests export: expected { "format": "${EXPORT_FORMAT}", "requests": [...] }.` }
  }
  const requests = []
  for (const [index, one] of data.requests.entries()) {
    if (!one || typeof one !== 'object' || !METHODS.includes(one.method) || typeof one.path !== 'string') {
      return { error: `Request ${index + 1} has no valid method and path.` }
    }
    requests.push({
      ...blankDraft(),
      ...one,
      pathParams: syncPathParams(one.path, Array.isArray(one.pathParams) ? one.pathParams : []),
      queryParams: Array.isArray(one.queryParams) ? one.queryParams : [],
      headers: Array.isArray(one.headers) ? one.headers : [],
      body: typeof one.body === 'string' ? one.body : '',
      id: newId(),
    })
  }
  return { requests }
}

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
