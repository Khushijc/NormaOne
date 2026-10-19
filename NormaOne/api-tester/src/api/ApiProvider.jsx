/**
 * The one place the app talks to the backend.
 *
 * Screens call `call('tenant-get-user', { pathParams: { userId } })` and get the result back. The
 * console calls `send(draft)` with a request it built by hand. Everything else happens here: the
 * session goes with the request, the call is written into the activity log, and anything that
 * CHANGES something opens the details pop-up straight away — what was sent, what came back.
 *
 * Reads are silent. A GET runs when a page loads, and a pop-up on every page load would be
 * unusable; a list that fails says so in the page itself instead.
 *
 * THE SESSION IS A PAIR OF HttpOnly COOKIES THE BACKEND SETS AT LOGIN. This page never sees a token:
 * it lets the browser send the cookies, and asks the backend what they amount to —
 * GET /api/auth/session (signed in? until when?) and GET /api/users/me (who, which role, onboarded?).
 * That pair is `account`, re-read when the app loads, after login, logout and onboarding, and
 * whenever a screen asks. It is never decided from local state.
 *
 * AN EXPIRED SESSION IS RENEWED ONCE. When a screen's request gets 401 and the backend said a
 * refresh cookie is present, POST /api/auth/refresh runs and the request is retried; if that fails
 * too, the account is signed out. The console is exempt: a 401 there is usually the thing being
 * tested.
 *
 * The contexts and the hooks that read them are in apiContext.js — see the note there for why
 * there are two of them, and why this file must export nothing but its component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildRequest, sendRequest } from '../lib/httpClient.js';
import { newId, resolveAuth } from '../lib/request.js';
import { scrubRequest, store } from '../lib/store.js';
import { buildCall } from './buildCall.js';
import { ApiActionsContext, ApiStateContext } from './apiContext.js';

const SIGNED_OUT = { checked: true, session: { authenticated: false, refreshAvailable: false }, me: null, meResult: null };

export default function ApiProvider({ children }) {
  const [environments] = useState(() => store.loadEnvironments());
  const [environmentId] = useState(() => store.loadActiveEnvironmentId());
  const [log, setLog] = useState([]);
  const [inspecting, setInspecting] = useState(null);
  const [saved, setSaved] = useState(() => store.loadSaved());

  // { checked, session, me, meResult }. `checked` false until the first check answers, so screens
  // can wait rather than flash "not signed in" at a signed-in user.
  const [account, setAccount] = useState({ checked: false, session: null, me: null, meResult: null });
  // Bumped whenever the account is re-read, so screens that load themselves load again.
  const [accountVersion, setAccountVersion] = useState(0);

  const environment = useMemo(
    () => environments.find((one) => one.id === environmentId) || environments[0],
    [environments, environmentId],
  );

  // Read through refs inside call() and send(), so they keep one identity for the life of the
  // provider. A screen that loads itself depends on call(); a new call() would re-run its effect,
  // which would call again — the loop the reference's split contexts exist to stop.
  const environmentRef = useRef(environment);
  // oxlint-disable-next-line react/refs
  environmentRef.current = environment;
  const accountRef = useRef(account);
  // oxlint-disable-next-line react/refs
  accountRef.current = account;

  /** Puts a finished call in the log and, for a write, opens it. One shape for both paths. */
  const record = useCallback((result, details) => {
    const entry = {
      id: newId(),
      at: result.startedAtIso,
      method: result.request.method,
      path: result.request.path,
      url: result.request.url,
      status: result.status,
      ok: result.ok,
      durationMs: result.durationMs,
      sizeBytes: result.sizeBytes,
      environmentName: environmentRef.current?.name,
      authMode: result.request.authType,
      result,
      ...details,
    };
    setLog((was) => [entry, ...was].slice(0, 100));
    if (!details.quiet && result.request.method !== 'GET') setInspecting(entry);
    return entry;
  }, []);

  /** One catalogue call, logged. No retry. */
  const rawCall = useCallback(async (endpointId, options = {}) => {
    const { endpoint, prepared } = buildCall(endpointId, options, environmentRef.current);
    const result = await sendRequest(prepared, { timeoutMs: store.loadTimeout() });
    record(result, {
      endpointId,
      endpointName: endpoint.name,
      action: options.label || endpoint.name,
      module: endpoint.module,
      endpoint,
      quiet: options.quiet,
    });
    return result;
  }, [record]);

  /**
   * Asks the backend who this browser is: the session, renewed once if it has expired and a refresh
   * cookie exists, then the profile. Always settles the account, whatever fails.
   */
  const checkAccount = useCallback(async () => {
    let session = await rawCall('auth-session', { label: 'Session status', quiet: true });
    if (session.ok && !session.bodyJson?.authenticated && session.bodyJson?.refreshAvailable) {
      const renewed = await rawCall('auth-refresh', { label: 'Renew the session', quiet: true });
      if (renewed.ok) session = await rawCall('auth-session', { label: 'Session status', quiet: true });
    }
    if (!session.ok) {
      // The backend could not be asked. Not "signed out" — unknown — so screens show the real error.
      const next = { checked: true, session: null, me: null, meResult: session, error: session };
      setAccount(next);
      setAccountVersion((v) => v + 1);
      return next;
    }
    const info = session.bodyJson;
    if (!info?.authenticated) {
      const next = { ...SIGNED_OUT, session: info };
      setAccount(next);
      setAccountVersion((v) => v + 1);
      return next;
    }
    const me = await rawCall('me', { label: 'Who am I', quiet: true });
    const next = { checked: true, session: info, me: me.ok ? me.bodyJson : null, meResult: me };
    setAccount(next);
    setAccountVersion((v) => v + 1);
    return next;
  }, [rawCall]);

  // Synchronising with an external system — the backend's view of this browser's cookies — is what
  // an effect is for; the state it sets is that system's answer, after it arrives.
  useEffect(() => {
    store.purgeLegacyTokens();
    // oxlint-disable-next-line react/set-state-in-effect
    checkAccount();
  }, [checkAccount]);

  /**
   * A catalogue call as a screen makes it. A session request answered 401 while a refresh cookie
   * exists is renewed and retried once; if renewing fails the account is signed out.
   */
  const call = useCallback(
    async (endpointId, options = {}) => {
      const result = await rawCall(endpointId, options);
      const usesSession = result.request.authType === 'session' && !String(endpointId).startsWith('auth-');
      if (result.status !== 401 || !usesSession || !accountRef.current.session?.refreshAvailable) return result;

      const renewed = await rawCall('auth-refresh', { label: 'Renew the session', quiet: true });
      if (!renewed.ok) {
        setAccount(SIGNED_OUT);
        setAccountVersion((v) => v + 1);
        return result;
      }
      return rawCall(endpointId, { ...options, label: `${options.label || endpointId} (after renewing the session)` });
    },
    [rawCall],
  );

  /**
   * Sends a request the console built by hand. Nothing is added or taken away: what the console
   * shows as "will send" is what goes out, the session cookies included only if Auth says so.
   */
  const send = useCallback(
    async (draft, options = {}) => {
      const prepared = buildRequest({ ...draft, auth: resolveAuth(draft) }, environmentRef.current, {});
      const result = await sendRequest(prepared, { timeoutMs: store.loadTimeout() });
      record(result, {
        endpointId: draft.endpointId || null,
        endpointName: draft.name || null,
        action: options.label || draft.name || `${draft.method} ${draft.path}`,
        module: 'Console',
        draft: scrubRequest(draft),
        quiet: true,
      });
      return result;
    },
    [record],
  );

  /** POST /api/auth/logout: the backend revokes the refresh token and clears both cookies. */
  const logout = useCallback(async () => {
    const result = await rawCall('auth-logout', { label: 'Log out', quiet: true });
    setAccount(SIGNED_OUT);
    setAccountVersion((v) => v + 1);
    return result;
  }, [rawCall]);

  /** POST /api/auth/refresh on demand, then the account re-read. */
  const renewSession = useCallback(async () => {
    const result = await rawCall('auth-refresh', { label: 'Renew the session', quiet: true });
    await checkAccount();
    return result;
  }, [rawCall, checkAccount]);

  const clearLog = useCallback(() => setLog([]), []);

  const saveRequest = useCallback((request) => {
    setSaved((was) => {
      const clean = scrubRequest({ ...request, id: request.id || newId(), savedAt: new Date().toISOString() });
      const next = was.some((one) => one.id === clean.id)
        ? was.map((one) => (one.id === clean.id ? clean : one))
        : [clean, ...was];
      store.saveSaved(next);
      return next;
    });
  }, []);

  const deleteRequest = useCallback((id) => {
    setSaved((was) => {
      const next = was.filter((one) => one.id !== id);
      store.saveSaved(next);
      return next;
    });
  }, []);

  const importRequests = useCallback((requests) => {
    setSaved((was) => {
      const next = [...requests.map(scrubRequest), ...was];
      store.saveSaved(next);
      return next;
    });
  }, []);

  const actions = useMemo(
    () => ({ call, send, inspect: setInspecting, clearLog, checkAccount, logout, renewSession, saveRequest,
      deleteRequest, importRequests }),
    [call, send, clearLog, checkAccount, logout, renewSession, saveRequest, deleteRequest, importRequests],
  );

  const state = useMemo(
    () => ({ log, inspecting, environment, environments, account, accountVersion, saved }),
    [log, inspecting, environment, environments, account, accountVersion, saved],
  );

  return (
    <ApiActionsContext.Provider value={actions}>
      <ApiStateContext.Provider value={state}>{children}</ApiStateContext.Provider>
    </ApiActionsContext.Provider>
  );
}
