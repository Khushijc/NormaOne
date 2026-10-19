/**
 * What a result means, in one word and one sentence.
 *
 * THREE DIFFERENT KINDS OF "IT FAILED", kept apart because they send you to different places:
 *
 *   frontend   never sent — the page refused it (bad JSON, empty path parameter, no token).
 *   network    sent, no HTTP answer — backend down, proxy could not connect, timeout.
 *   backend    an HTTP status came back. The backend decided; read its message.
 *
 * Within backend answers, 401 and 403 are split from other 4xx: they are about WHO is calling, not
 * WHAT was sent, and the fix is in the top bar rather than in the request.
 */

import { describeToken } from './jwt.js'

export function outcomeOf(result) {
  if (!result) return null
  if (result.error?.kind === 'frontend') return { kind: 'frontend', tone: 'bad', label: 'Not sent' }
  if (!result.status || result.error?.kind === 'backend-unreachable') {
    return { kind: 'network', tone: 'bad', label: result.error?.title || 'No reply' }
  }
  const s = result.status
  if (s >= 200 && s < 300) return { kind: 'success', tone: 'good', label: 'Success' }
  if (s >= 300 && s < 400) return { kind: 'redirect', tone: 'warn', label: 'Redirect' }
  if (s === 401 || s === 403) return { kind: 'auth', tone: 'warn', label: s === 401 ? 'Not authenticated' : 'Forbidden' }
  if (s >= 400 && s < 500) return { kind: 'client', tone: 'bad', label: 'Client error' }
  return { kind: 'server', tone: 'bad', label: 'Server error' }
}

/**
 * The likeliest reason for a status on THIS backend, read from its SecurityConfig and handlers.
 * Shown under the body; the body's own `message` stays the authority.
 */
export function hintFor(result) {
  if (!result?.status) return null
  const sentAuth = result.request?.headers?.Authorization || result.request?.headers?.authorization
  switch (result.status) {
    case 400:
      return result.bodyJson?.fieldErrors
        ? 'Validation failed — fieldErrors names each field.'
        : 'The backend refused the request as sent: a bad field value, a missing reason, or an invalid transition.'
    case 401: {
      if (result.request?.authType === 'session') {
        return 'The session cookie was missing, expired or rejected. Renew the session from the top bar, or sign in again.'
      }
      if (!sentAuth) return 'No credentials were sent: neither the session cookies nor an Authorization header. Set Auth to "Session" to send the session.'
      const info = describeToken(sentAuth)
      if (info.valid && info.expired) return 'The token sent had expired. Sign in again to get a fresh one.'
      if (!info.valid) return `The Authorization header does not hold a JWT: ${info.problem}`
      return 'The backend rejected the token: wrong Cognito user pool, wrong app client, a bad signature, or a token type it does not accept.'
    }
    case 403:
      return 'The session was accepted but the account may not do this: missing role, not ACTIVE, tenant not ACTIVE, not onboarded — or a rule such as changing your own role. Sign in as another account to compare.'
    case 404:
      return 'Unknown path or record. Tenant APIs also answer 404 for another tenant\'s record, so they do not reveal it exists.'
    case 405:
      return 'That path exists but not with this method.'
    case 409:
      return 'Conflicts with the current state: a duplicate, already in that status, or the last active admin.'
    case 422:
      return 'Unprocessable entity. NormaOne does not currently answer 422, so this came from somewhere unexpected.'
    case 429:
      return 'Cognito throttled the request. Wait a few minutes.'
    case 503:
      return 'The default package (BASIC) is not available. Check plan_definitions in MongoDB.'
    default:
      if (result.status >= 500) return 'The backend threw. Its log has the stack trace; the body has no details on purpose.'
      return null
  }
}

/** A result for a request the page refused to send, shaped like a real one. */
export function frontendRefusal(prepared, problems) {
  const now = new Date().toISOString()
  return {
    ok: false,
    request: prepared,
    status: null,
    statusText: null,
    headers: {},
    bodyText: '',
    bodyJson: null,
    jsonParseError: null,
    sizeBytes: 0,
    durationMs: 0,
    startedAtIso: now,
    finishedAtIso: now,
    timeoutMs: 0,
    error: {
      kind: 'frontend',
      title: 'Not sent',
      message: problems.map((one) => one.message).join('\n'),
      hint: 'Nothing left this page. Fix the request and send again.',
    },
  }
}
