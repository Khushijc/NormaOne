/**
 * Turns "do this action" into an actual HTTP request.
 *
 * Kept apart from ApiProvider so it can be exercised on its own — which token goes on which
 * request is easy to get wrong and impossible to see from the screen.
 */

import { findEndpoint } from '../config/endpoints.js';
import { buildRequest } from '../lib/httpClient.js';

/** Turns { status: 'ACTIVE', page: 0 } into the rows the request builder wants. */
export function toQueryRows(query) {
  const rows = [];
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((one) => {
        if (one !== undefined && one !== null && one !== '') {
          rows.push({ key, value: String(one), enabled: true });
        }
      });
      return;
    }
    rows.push({ key, value: String(value), enabled: true });
  });
  return rows;
}

/**
 * Builds the request for one action.
 *
 * `options` takes `pathParams`, `query` and `body`. EVERY CALL GOES WITH THE BROWSER'S COOKIES
 * (same-origin credentials), the public ones included, and for a reason that is easy to miss:
 * with credentials 'omit' the browser also IGNORES Set-Cookie on the answer, so a login sent that
 * way succeeds and stores nothing. Sending the session cookie to /api/auth/** costs nothing — the
 * backend ignores it there — and /session, /refresh and /logout need it. The page never handles a token.
 */
export function buildCall(endpointId, options = {}, environment) {
  const endpoint = findEndpoint(endpointId);
  if (!endpoint) throw new Error(`No endpoint called ${endpointId}`);

  // A file goes as multipart/form-data: `form` is a list of parts, built into a FormData here. No
  // Content-Type is set, so the browser writes the multipart boundary itself.
  if (options.form) return buildMultipartCall(endpoint, options, environment);

  const headers = [];
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });

  const auth = { type: 'session' };

  const draft = {
    method: endpoint.method,
    path: endpoint.path,
    pathParams: endpoint.pathParams.map((param) => ({
      ...param,
      value: options.pathParams?.[param.name] ?? '',
    })),
    queryParams: toQueryRows(options.query),
    headers,
    body: hasBody ? JSON.stringify(options.body, null, 2) : '',
    auth,
  };

  return { endpoint, prepared: buildRequest(draft, environment, {}) };
}

/**
 * The same request with a multipart body. `options.form` is a list of parts:
 *   { name, json }  — a JSON part (sent with Content-Type application/json, as @RequestPart reads it)
 *   { name, file }  — a File or Blob
 * The prepared request carries the FormData to send and `formParts`, a description of each part for
 * the request view, the history and the cURL copy — a FormData cannot be shown or replayed itself.
 */
function buildMultipartCall(endpoint, options, environment) {
  const draft = {
    method: endpoint.method,
    path: endpoint.path,
    pathParams: endpoint.pathParams.map((param) => ({ ...param, value: options.pathParams?.[param.name] ?? '' })),
    queryParams: toQueryRows(options.query),
    headers: [],
    body: '',
    auth: { type: 'session' },
  };
  const prepared = buildRequest(draft, environment, {});
  const data = new FormData();
  const formParts = [];
  options.form.forEach((part) => {
    if (part.file) {
      data.append(part.name, part.file, part.file.name || part.name);
      formParts.push({ name: part.name, kind: 'file', fileName: part.file.name || part.name, type: part.file.type || '', size: part.file.size });
    } else {
      const text = JSON.stringify(part.json, null, 2);
      data.append(part.name, new Blob([text], { type: 'application/json' }));
      formParts.push({ name: part.name, kind: 'json', text });
    }
  });
  return { endpoint, prepared: { ...prepared, body: data, formParts } };
}
