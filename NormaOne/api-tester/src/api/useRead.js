import { useCallback, useEffect, useState } from 'react'
import { findEndpoint } from '../config/endpoints.js'
import { useApi, useApiState } from './apiContext.js'

/**
 * A read that runs when the screen opens, and again when the account or the arguments change.
 *
 * The reference writes this out on every screen; with all of them reading on load it lives here
 * once. It keeps the reference's rule about identity: `load` depends on `call` (stable) and on plain
 * values, never on an object made during render — a fresh object would give `load` a new identity
 * every render, the effect would fire again, and the screen would call in a loop.
 *
 * NOT SIGNED IN, NO CALL. A protected read without a session can only answer 401, so the screen says
 * "not signed in" instead of firing it — the reference's "No school chosen". It waits until the
 * account has been checked, so a signed-in user never sees that panel flash. Provoking the 401 on
 * purpose is what the console's "No auth" is for.
 */
export function useRead(endpointId, { pathParams, query, label, skip } = {}) {
  const { call } = useApi()
  const { account, accountVersion } = useApiState()
  const endpoint = findEndpoint(endpointId)
  const needsSession = endpoint?.access !== 'public'
  const waiting = needsSession && !account.checked
  const signedOut = needsSession && account.checked && account.session?.authenticated === false

  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(!skip && !signedOut)

  // Serialised, so a caller passing a fresh object each render does not retrigger the effect.
  const params = JSON.stringify(pathParams || {})
  const search = JSON.stringify(query || {})

  const load = useCallback(async () => {
    setLoading(true)
    const answer = await call(endpointId, { pathParams: JSON.parse(params), query: JSON.parse(search), label })
    setLoading(false)
    setResult(answer)
    return answer
    // `accountVersion` is not read above and is not a mistake: it changes when the account is read
    // again — sign-in, sign-out, onboarding — which is exactly when the screen should reload.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [call, endpointId, params, search, label, accountVersion])

  useEffect(() => {
    if (skip || waiting || signedOut) {
      setLoading(waiting)
      return undefined
    }
    // Debounced a little, so typing in a search box is one call and not one per keystroke.
    const timer = setTimeout(load, search.includes('"search":"') ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, skip, waiting, signedOut, search])

  return {
    result,
    data: result?.ok ? result.bodyJson : null,
    loading,
    reload: load,
    // Kept under its old name so every screen's "no session" panel still reads it.
    missingToken: signedOut,
  }
}
