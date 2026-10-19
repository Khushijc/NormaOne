import { Facts, StatusBadge } from './Screen.jsx'
import { when } from '../lib/forms.js'

/** A TenantPackageResponse — the subscription, then the plan it is on. */
export default function PackageFacts({ pack }) {
  const plan = pack.plan || {}
  const price = (amount, currency) => (amount == null ? null : `${amount} ${currency || ''}`.trim())
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Facts rows={[
        ['Plan', plan.name ? `${plan.name} (${plan.planCode} v${plan.planVersion})` : plan.planCode],
        ['Subscription', <StatusBadge key="s" status={pack.status} />],
        ['Assigned by', pack.assignmentSource],
        ['Agreed price', price(pack.agreedPrice, pack.currencyCode)],
        ['Billing cycle', pack.billingCycle],
        ['Assigned', when(pack.assignedAt)],
        ['Start', when(pack.startDate)],
        ['Current period', [when(pack.currentPeriodStart), when(pack.currentPeriodEnd)].filter(Boolean).join(' → ') || null],
        ['Term ends', pack.currentPeriodEnd ? when(pack.currentPeriodEnd) : 'rolling — runs until the plan is changed'],
        ['Subscription id', pack.subscriptionId && <span key="i" className="mono">{pack.subscriptionId}</span>],
      ]} />
      <div className="field-split">The plan</div>
      <Facts rows={[
        ['List price', price(plan.listPrice, plan.currencyCode)],
        ['Max employees', plan.maxEmployees],
        ['User seats', plan.maxUsers ?? 'no limit'],
        ['Duration', plan.durationMonths ? `${plan.durationMonths} months` : 'rolling'],
        ['Trial days', plan.trialDays],
        ['Modules', plan.moduleApps?.join(', ')],
        ['Plan status', <StatusBadge key="p" status={plan.status} />],
        ['Default plan', plan.defaultPlan == null ? null : plan.defaultPlan ? 'yes' : 'no'],
        ['Description', plan.description, true],
      ]} />
    </div>
  )
}
