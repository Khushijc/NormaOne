/**
 * The two contexts the screens read, and the hooks that read them.
 *
 * Kept out of ApiProvider.jsx on purpose. A file that exports a component AND other values
 * cannot be hot-reloaded by React Fast Refresh — editing the provider forced a full page
 * reload and lost whatever was on screen. Splitting them means ApiProvider.jsx exports only
 * its component, so an edit refreshes in place.
 *
 * WHY THERE ARE TWO. useApi() gives back only the things you DO — call, inspect, dismiss — and
 * that object keeps the same identity for the life of the app. useApiState() gives back what
 * changes: the activity log, the chosen environment, the open pop-up.
 *
 * They are split because mixing them is a trap with teeth. When one object carried both, a
 * screen that loaded itself in a useEffect depending on it re-ran after every call — and each
 * run made another call, because calling appends to the log, which changed the object. The
 * schools list did exactly that and hammered the backend until the tab was closed. Split like
 * this, a screen can depend on the whole of useApi() and nothing happens twice.
 */

import { createContext, useContext } from 'react';

/** What you can do. Stable — safe in any dependency array. */
export const ApiActionsContext = createContext(null);

/** What changes. Only for screens that display it. */
export const ApiStateContext = createContext(null);

export function useApi() {
  const value = useContext(ApiActionsContext);
  if (!value) throw new Error('useApi must be used inside ApiProvider');
  return value;
}

export function useApiState() {
  const value = useContext(ApiStateContext);
  if (!value) throw new Error('useApiState must be used inside ApiProvider');
  return value;
}
