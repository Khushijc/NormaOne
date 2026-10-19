/**
 * Reads the claims out of a Cognito token so the screen can say what it is holding.
 *
 * READ, NEVER TRUSTED. Nothing here checks a signature — the browser has no business doing that,
 * and the backend does it on every request. This exists so the top bar can say "ID token for
 * ana@example.com, expires in 41 min" instead of showing an opaque string, and so a 401 caused by
 * an expired token is explained before anybody goes looking through server logs.
 *
 * It never throws: a pasted value that is not a JWT comes back as `{ valid: false, problem }`.
 */

function base64UrlDecode(segment) {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  // Claims can hold non-ASCII names, so decode the bytes as UTF-8 rather than as Latin-1.
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Strips a leading "Bearer " and surrounding whitespace, which is how tokens usually get pasted. */
export function cleanToken(raw) {
  return String(raw ?? '').trim().replace(/^Bearer\s+/i, '').trim()
}

/**
 * The token's claims and what they mean for this API.
 *
 * `kind` is Cognito's `token_use`: "id" or "access". The backend accepts both
 * (CognitoTokenValidator); anything else — a refresh token, which is not a JWT at all — fails.
 */
export function describeToken(raw, now = Date.now()) {
  const token = cleanToken(raw)
  if (!token) return { valid: false, problem: 'Empty.' }

  const parts = token.split('.')
  if (parts.length !== 3) {
    return {
      valid: false,
      problem: parts.length === 5
        ? 'This is an encrypted token (5 parts). A Cognito refresh token looks like this and is not accepted as a Bearer token.'
        : 'Not a JWT: expected three dot-separated parts.',
    }
  }

  let claims
  try {
    claims = JSON.parse(base64UrlDecode(parts[1]))
  } catch {
    return { valid: false, problem: 'The middle part does not decode to JSON.' }
  }
  if (!claims || typeof claims !== 'object') return { valid: false, problem: 'The claims are not an object.' }

  const expiresAt = Number.isFinite(claims.exp) ? claims.exp * 1000 : null
  const kind = claims.token_use === 'id' || claims.token_use === 'access' ? claims.token_use : null

  return {
    valid: true,
    kind,
    claims,
    subject: claims.sub ?? null,
    email: claims.email ?? claims.username ?? null,
    emailVerified: claims.email_verified ?? null,
    groups: Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [],
    expiresAt,
    expired: expiresAt != null && expiresAt <= now,
    secondsLeft: expiresAt == null ? null : Math.round((expiresAt - now) / 1000),
  }
}

/** "41 min", "2 h 5 min", "expired 3 min ago" — short enough for the top bar. */
export function describeExpiry(info, now = Date.now()) {
  if (!info?.valid || info.expiresAt == null) return 'no expiry claim'
  const seconds = Math.round((info.expiresAt - now) / 1000)
  const span = (s) => {
    const abs = Math.abs(s)
    if (abs < 60) return `${abs} s`
    const minutes = Math.floor(abs / 60)
    if (minutes < 60) return `${minutes} min`
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
  }
  return seconds <= 0 ? `expired ${span(seconds)} ago` : `expires in ${span(seconds)}`
}
