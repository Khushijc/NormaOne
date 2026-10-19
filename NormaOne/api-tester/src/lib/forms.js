/**
 * What every form does with a body before sending it and with a refusal after.
 *
 * In lib/ rather than beside the components that use them because a file that exports a component
 * and anything else cannot be fast-refreshed — editing it reloads the page and loses the form.
 */

/**
 * The fieldErrors of a 400, as { field: message } for the form beside them, plus whatever message
 * belongs to no field. Nested names ("initialAdmin.email") are kept as written.
 */
export function refusalOf(result) {
  if (!result || result.ok) return { fields: {}, message: null }
  const body = result.bodyJson
  const fields = body?.fieldErrors && typeof body.fieldErrors === 'object' ? body.fieldErrors : {}
  const message = Object.keys(fields).length ? null : body?.message || result.error?.message || `The server answered ${result.status}`
  return { fields, message }
}

/** Only the fields that changed, for a PATCH: sending the rest would rewrite them with themselves. */
export function changed(form, original) {
  return Object.fromEntries(Object.entries(form).filter(([key, value]) => {
    const before = original?.[key] ?? ''
    return String(value ?? '') !== String(before)
  }))
}

/** A form's values minus the blank ones: an empty optional must be left out, not sent as "". */
export function filled(form) {
  return Object.fromEntries(Object.entries(form).filter(([, value]) => String(value ?? '').trim() !== ''))
}

/** The filters a user list sends. A plain function, so the tag and the call build the same query. */
export function userQuery({ search, status, role, tenantId, page }) {
  return {
    search: search.trim() || undefined,
    status: status || undefined,
    role: role || undefined,
    tenantId: tenantId?.trim() || undefined,
    page,
    size: 20,
  }
}

/** A timestamp in the reader's own locale, or null so a Facts row shows its dash. */
export function when(iso) {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString()
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} kB`
}

/** A datetime-local value (the browser's local time) as an ISO-8601 instant, or undefined when empty or invalid. */
export function isoOf(local) {
  if (!local) return undefined
  const date = new Date(local)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
