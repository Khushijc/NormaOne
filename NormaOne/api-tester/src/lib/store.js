/**
 * What survives a page refresh, kept in this browser.
 *
 * Nothing here leaves the machine, and every read copes with the value being missing or damaged —
 * a broken entry should never stop the app from loading.
 *
 * NO CREDENTIAL IS EVER WRITTEN HERE. The session lives in HttpOnly cookies the backend sets and
 * this page cannot read; passwords stay in a form's state while it is open. localStorage holds only
 * settings, saved requests and the console draft — scrubbed of Authorization headers and typed
 * tokens before they are written, so exporting a collection cannot leak one.
 */

import { DEFAULT_ENVIRONMENTS, DEFAULT_TIMEOUT_MS } from '../config/environments.js'

const PREFIX = 'normaone.tester.'
const KEYS = {
  activeEnvironment: `${PREFIX}activeEnvironment`,
  timeout: `${PREFIX}timeout`,
  saved: `${PREFIX}savedRequests`,
  draft: `${PREFIX}consoleDraft`,
}

function storage(kind) {
  try {
    return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage
  } catch {
    return null
  }
}

function read(key, fallback, kind = 'local') {
  try {
    const raw = storage(kind)?.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function write(key, value, kind = 'local') {
  try {
    storage(kind)?.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be full or switched off. Losing the saved copy is not worth an error on
    // screen, so carry on with what is in memory.
  }
}

/** A request with every credential taken out — for anything written to disk or exported. */
export function scrubRequest(request) {
  if (!request || typeof request !== 'object') return request
  const headers = (request.headers || []).filter((h) => String(h.key).trim().toLowerCase() !== 'authorization')
  const auth = request.auth?.type === 'bearer' ? { type: 'bearer', token: '' } : (request.auth || { type: 'session' })
  return { ...request, headers, auth }
}

export const store = {
  loadEnvironments() {
    return DEFAULT_ENVIRONMENTS
  },
  loadActiveEnvironmentId() {
    const saved = read(KEYS.activeEnvironment, null)
    const found = DEFAULT_ENVIRONMENTS.find((one) => one.id === saved)
    return found ? found.id : DEFAULT_ENVIRONMENTS[0].id
  },
  saveActiveEnvironmentId(id) {
    write(KEYS.activeEnvironment, id)
  },

  loadTimeout() {
    const value = read(KEYS.timeout, DEFAULT_TIMEOUT_MS)
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
  },
  saveTimeout(ms) {
    write(KEYS.timeout, ms)
  },

  /**
   * Earlier versions kept bearer tokens in sessionStorage. Removed on start, so a tab opened before
   * cookie sessions does not keep a credential lying around in script-readable storage.
   */
  purgeLegacyTokens() {
    for (const key of [`${PREFIX}tokens`, `${PREFIX}activeToken`]) {
      try {
        storage('session')?.removeItem(key)
      } catch {
        // Nothing stored, or storage switched off: either way nothing is left.
      }
    }
  },

  loadSaved() {
    const saved = read(KEYS.saved, [])
    return Array.isArray(saved) ? saved.filter((one) => one && typeof one === 'object' && one.id) : []
  },
  saveSaved(list) {
    write(KEYS.saved, list.map(scrubRequest))
  },

  loadDraft() {
    const draft = read(KEYS.draft, null)
    return draft && typeof draft === 'object' ? draft : null
  },
  saveDraft(draft) {
    write(KEYS.draft, scrubRequest(draft))
  },
}
