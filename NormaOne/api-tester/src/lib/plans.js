/**
 * Plan values as the plan screens build and show them. The backend validates everything sent
 * (ISO currency, seat and duration limits, module ids); these only shape the form and the JSON.
 */

export const money = (amount, currency) => (amount == null ? '—' : `${Number(amount).toFixed(2)} ${currency || ''}`.trim())

export const planLabel = (code, version) => (code ? `${code} v${version}` : '—')

/** What a published plan may still change in place (PlanAdminService). */
export const PUBLISHED_EDITABLE = ['name', 'description', 'publiclyAvailable']

/** An empty plan form, or one filled from a plan (a new version starts from the current terms). */
export function planForm(plan) {
  return {
    planCode: plan?.planCode ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    billingCycle: plan?.billingCycle ?? 'MONTHLY',
    listPrice: plan?.listPrice != null ? String(plan.listPrice) : '',
    currencyCode: plan?.currencyCode ?? 'EUR',
    durationMonths: plan?.durationMonths != null ? String(plan.durationMonths) : '',
    maxUsers: plan?.maxUsers != null ? String(plan.maxUsers) : '',
    maxEmployees: plan?.maxEmployees != null ? String(plan.maxEmployees) : '',
    trialDays: plan?.trialDays != null ? String(plan.trialDays) : '0',
    publiclyAvailable: plan?.publiclyAvailable ?? false,
    moduleApps: plan?.moduleApps ?? ['NORMAONE'],
  }
}

const number = (value) => (value === '' || value == null ? undefined : Number(value))

/**
 * The JSON a plan form sends. `only` limits it to some fields (what a published plan may still
 * change). Empty optional numbers are left out — the backend reads that as "no limit" or "rolling".
 */
export function planBody(form, { withCode = true, only } = {}) {
  const body = {
    ...(withCode ? { planCode: form.planCode.trim() } : {}),
    name: form.name.trim(),
    description: form.description,
    billingCycle: form.billingCycle,
    listPrice: number(form.listPrice),
    currencyCode: form.currencyCode.trim(),
    durationMonths: number(form.durationMonths),
    maxUsers: number(form.maxUsers),
    maxEmployees: number(form.maxEmployees),
    trialDays: number(form.trialDays),
    publiclyAvailable: form.publiclyAvailable,
    moduleApps: form.moduleApps,
  }
  const kept = only ? Object.fromEntries(Object.entries(body).filter(([key]) => only.includes(key))) : body
  return Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined))
}
