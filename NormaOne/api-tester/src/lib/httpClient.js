/**
 * Makes the real HTTP call and writes down everything that happened.
 *
 * This never pretends. If the call fails, the failure is what gets recorded — there is no
 * fallback to sample data anywhere in this file.
 */

import { applyVariables } from './variables.js';
import { DEFAULT_TIMEOUT_MS } from '../config/environments.js';

/** Puts the path parameters into the path, so /schools/{id} becomes /schools/abc123. */
export function buildPath(path, pathParams, variables) {
  let result = path;
  const filledParams = {};
  (pathParams || []).forEach((param) => {
    const { text } = applyVariables(param.value ?? '', variables);
    filledParams[param.name] = text;
    result = result.split(`{${param.name}}`).join(encodeURIComponent(text));
  });
  // Anything still written as {{name}} in the URL box is filled in too, so a path typed by
  // hand or pasted from the Postman collection works the same as a path parameter.
  return { path: applyVariables(result, variables).text, filledParams };
}

/** Adds the query parameters that are switched on. */
export function buildQueryString(queryParams, variables) {
  const parts = [];
  (queryParams || []).forEach((param) => {
    if (param.enabled === false || !param.key) return;
    const key = applyVariables(param.key, variables).text;
    const value = applyVariables(param.value ?? '', variables).text;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return parts.length ? `?${parts.join('&')}` : '';
}

/** The header the backend requires on cookie-authenticated writes and on /api/auth requests. */
export const CSRF_HEADER = 'X-Requested-With';

/** Works out the header that carries the credentials, if there are any. */
export function buildAuthHeader(auth) {
  if (!auth || auth.type === 'none') return null;
  if (auth.type === 'bearer') {
    if (!auth.token) return null;
    return { key: 'Authorization', value: `Bearer ${auth.token}` };
  }
  if (auth.type === 'basic') {
    if (!auth.username && !auth.password) return null;
    return { key: 'Authorization', value: `Basic ${btoa(`${auth.username}:${auth.password}`)}` };
  }
  if (auth.type === 'apiKey') {
    if (!auth.apiKeyName || !auth.apiKeyValue) return null;
    return { key: auth.apiKeyName, value: auth.apiKeyValue };
  }
  return null;
}

/** Hides most of a secret, so a screenshot of the tester does not leak a token. */
export function maskSecret(value) {
  if (!value) return value;
  if (value.length <= 12) return '••••••';
  return `${value.slice(0, 8)}…${value.slice(-4)} (${value.length} chars)`;
}

/**
 * Puts the whole request together without sending it. The request details panel shows exactly
 * this, so what you see is what goes on the wire.
 */
export function buildRequest(draft, environment, variables) {
  const { path: filledPath, filledParams } = buildPath(draft.path, draft.pathParams, variables);
  const query = buildQueryString(draft.queryParams, variables);
  const base = (environment?.baseUrl || '').replace(/\/+$/, '');
  const url = `${base}${filledPath}${query}`;

  const headers = {};
  (draft.headers || []).forEach((header) => {
    if (header.enabled === false || !header.key) return;
    headers[applyVariables(header.key, variables).text] = applyVariables(header.value ?? '', variables).text;
  });

  const authHeader = buildAuthHeader(draft.auth);
  if (authHeader) headers[authHeader.key] = authHeader.value;

  // Every request carries it: the backend refuses a cookie-authenticated (or credential) write
  // without it (CsrfHeaderFilter), and another site's page cannot add it. A header typed in the
  // request wins, so its absence can still be tested from the console.
  if (!Object.keys(headers).some((key) => key.toLowerCase() === CSRF_HEADER.toLowerCase())) {
    headers[CSRF_HEADER] = 'NormaOne';
  }

  const methodTakesBody = !['GET', 'HEAD'].includes(draft.method);
  const rawBody = methodTakesBody && draft.body && draft.body.trim() !== '' ? draft.body : null;
  const body = rawBody == null ? null : applyVariables(rawBody, variables).text;

  // Do not claim a JSON body when there is none. Some servers refuse an empty body sent with
  // a Content-Type, and it makes the request details misleading.
  if (body == null) delete headers['Content-Type'];

  return {
    method: draft.method,
    url,
    // The path on its own is handy on the proxy environment, where the full URL is the path.
    path: `${filledPath}${query}`,
    headers,
    body,
    pathParams: filledParams,
    authType: draft.auth?.type || 'none',
    // THE SESSION IS A COOKIE THE PAGE CANNOT READ, so "send the session" means "let the browser
    // attach its cookies". Every other auth choice leaves them out, so a typed token or "No auth" is
    // tested on its own rather than quietly falling back to the signed-in session.
    credentials: draft.auth?.type === 'session' ? 'same-origin' : 'omit',
  };
}

/**
 * Sends the request and gives back everything about it: what went out, what came back, how
 * long it took, and what went wrong if anything did.
 *
 * This never throws. A network failure, a timeout or a dead backend all come back as a normal
 * result with ok false and an error on it, because the tester shows them the same way it
 * shows a 409.
 */
export async function sendRequest(prepared, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const startedAtIso = new Date().toISOString();
  const startedAt = performance.now();

  let response = null;
  let responseText = '';
  let failure = null;

  try {
    response = await fetch(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
      signal: controller.signal,
      // Decided per request in buildRequest: the session cookies for "session" auth, none otherwise.
      // Same-origin only — the page talks to the backend through its own proxy.
      credentials: prepared.credentials || 'omit',
      redirect: 'follow',
    });
    responseText = await response.text();
  } catch (error) {
    if (timedOut) {
      failure = {
        kind: 'timeout',
        title: 'Timed out',
        message: `No answer within ${timeoutMs} ms. The backend may be starting up, or stuck on this request.`,
        hint: 'Spring Boot takes a while to start, and the first token check fetches Cognito\'s signing keys. Try again.',
      };
    } else if (error.name === 'AbortError') {
      failure = {
        kind: 'aborted',
        title: 'Cancelled',
        message: 'The request was cancelled before an answer came back.',
        hint: null,
      };
    } else {
      // fetch gives almost nothing away here on purpose, so say what it usually means.
      failure = {
        kind: 'network',
        title: 'Could not reach the backend',
        message: error.message || 'The request never got an answer.',
        hint:
          'Is the backend running?  cd NormaOne/backend && ./mvnw spring-boot:run  starts it on port 8881. ' +
          'Against an address other than this page\'s own, this can also be CORS: the backend has no CORS ' +
          'configuration, which is why the proxy environment exists.',
      };
    }
  } finally {
    clearTimeout(timer);
  }

  const durationMs = performance.now() - startedAt;
  const finishedAtIso = new Date().toISOString();

  if (failure) {
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
      durationMs,
      startedAtIso,
      finishedAtIso,
      timeoutMs,
      error: failure,
    };
  }

  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const contentType = response.headers.get('content-type') || '';

  /*
   * A dev server whose backend is not running answers 500, text/plain, with nothing in the
   * body — it never reached Spring at all. Reported as an ordinary 500 that reads "the backend
   * threw, check the server log", which sends people looking through logs that do not exist.
   * A real 500 from Spring always carries an ApiError body, so an empty one is this case.
   */
  const unreachable =
    response.status >= 500 &&
    responseText.trim() === '' &&
    !contentType.includes('json');

  let bodyJson = null;
  let jsonParseError = null;
  if (responseText.trim() !== '') {
    try {
      bodyJson = JSON.parse(responseText);
    } catch (error) {
      // Not every answer is JSON — a 404 from a static path is not. Say so rather than
      // showing an empty body panel.
      jsonParseError = error.message;
    }
  }

  return {
    ok: response.ok,
    request: prepared,
    status: response.status,
    statusText: response.statusText,
    headers,
    bodyText: responseText,
    bodyJson,
    jsonParseError,
    // Set only for the case above. The status is kept as it came, so the details panel can
    // still show what was really on the wire.
    error: unreachable
      ? {
          kind: 'backend-unreachable',
          title: 'The backend is not running',
          message:
            'The dev server could not reach it, so the request never got as far as the ' +
            'application. Nothing was read and nothing was changed.',
          hint: 'Start it with:  cd NormaOne/backend && ./mvnw spring-boot:run  — it listens on port 8881 (VITE_API_BASE_URL in .env.local if not).',
        }
      : null,
    // The real number of bytes, not the character count, so a response with accented text is
    // not reported as smaller than it is.
    sizeBytes: new Blob([responseText]).size,
    durationMs,
    startedAtIso,
    finishedAtIso,
    timeoutMs,
  };
}
