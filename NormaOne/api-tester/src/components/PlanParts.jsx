import { Fragment } from 'react'
import { Facts, Pager, Problem, StatusBadge } from './Screen.jsx'
import { Badge, Empty, Field, Input, TextArea } from './ui/Kit.jsx'
import Select from './ui/Select.jsx'
import { EmailComingSoon } from './ComingSoon.jsx'
import { BILLING_CYCLES, PLAN_MODULES } from '../config/enums.js'
import { EMAIL_DELIVERY_AVAILABLE } from '../config/features.js'
import { when } from '../lib/forms.js'
import { money, planLabel } from '../lib/plans.js'

/**
 * What the plan screens share: a plan's terms, the plan form, the plan history and a plan-change
 * request — all read from, and sent to, the backend as they are. No plan here is made up.
 */

/** The terms of a PlanResponse (Super Admin) or a TenantPlanResponse (Tenant Admin). */
export function PlanTerms({ plan, platform }) {
  const modules = plan.moduleApps ?? plan.modules ?? []
  return (
    <Facts rows={[
      ['Plan', `${plan.name} (${planLabel(plan.planCode, plan.planVersion)})`],
      ['Status', <span key="s"><StatusBadge status={plan.status} />{platform && plan.latestVersion === false ? <> <Badge tone="warn">historical version</Badge></> : null}</span>],
      ['Price', `${money(plan.listPrice, plan.currencyCode)} / ${plan.billingCycle?.toLowerCase() ?? '—'}`],
      ['Duration', plan.durationMonths ? `${plan.durationMonths} months` : 'rolling (until changed)'],
      ['User seats', plan.maxUsers ?? 'no limit'],
      ['Max employees', plan.maxEmployees],
      ['Trial days', plan.trialDays],
      ['Modules', modules.length ? modules.join(', ') : 'the portal only', true],
      platform ? ['Shown to Tenant Admins', plan.publiclyAvailable ? 'yes' : 'no'] : null,
      platform ? ['Default plan', plan.defaultPlan ? 'yes — new organizations get it' : 'no'] : null,
      platform ? ['Organizations on it now', plan.currentSubscriptions] : null,
      platform ? ['Sale window', [when(plan.effectiveFrom), when(plan.effectiveUntil)].filter(Boolean).join(' → ') || 'open'] : null,
      ['Description', plan.description, true],
      platform ? ['Created', when(plan.createdAt)] : null,
      platform ? ['Updated', when(plan.updatedAt)] : null,
      ['Plan id', <span key="i" className="mono">{plan.id}</span>],
    ]} />
  )
}

/** The plan form. `termsLocked` greys out the commercial terms of a published version. */
export function PlanFields({ form, onChange, refusal, codeLocked, termsLocked }) {
  const set = (key) => (event) => onChange({ ...form, [key]: event.target.value })
  const errors = refusal?.fields ?? {}
  const toggleModule = (id) => onChange({
    ...form,
    moduleApps: form.moduleApps.includes(id) ? form.moduleApps.filter((one) => one !== id) : [...form.moduleApps, id],
  })
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="field-grid">
        <Field label="Plan code" required hint="Letters, digits, _ and -. Stored upper case." error={errors.planCode}>
          <Input className="input mono" value={form.planCode} disabled={codeLocked} error={errors.planCode} onChange={set('planCode')} />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input value={form.name} error={errors.name} onChange={set('name')} />
        </Field>
        <Field label="Description" wide error={errors.description}>
          <TextArea rows={2} value={form.description} error={errors.description} onChange={set('description')} />
        </Field>
      </div>
      <div className="field-split">Terms {termsLocked ? '— fixed on a published version: create a new version to change them' : ''}</div>
      <div className="field-grid">
        <Field label="Price" required hint="Before taxes, 2 decimals; 0 for a free plan." error={errors.listPrice}>
          <Input type="number" min="0" step="0.01" value={form.listPrice} disabled={termsLocked} error={errors.listPrice} onChange={set('listPrice')} />
        </Field>
        <Field label="Currency" hint="ISO 4217, e.g. EUR." error={errors.currencyCode}>
          <Input className="input mono" maxLength={3} value={form.currencyCode} disabled={termsLocked} error={errors.currencyCode} onChange={set('currencyCode')} />
        </Field>
        <Field label="Billing cycle" required error={errors.billingCycle}>
          {termsLocked ? <Input value={form.billingCycle} disabled /> : (
            <Select label="Billing cycle" value={form.billingCycle} onChange={(billingCycle) => onChange({ ...form, billingCycle })} options={BILLING_CYCLES} />
          )}
        </Field>
        <Field label="Duration (months)" hint="Committed term, 1–120. Empty = rolling." error={errors.durationMonths}>
          <Input type="number" min="1" max="120" value={form.durationMonths} disabled={termsLocked} error={errors.durationMonths} onChange={set('durationMonths')} />
        </Field>
        <Field label="User seats" hint="Optional, stricter than Max employees. Empty = Max employees is the limit." error={errors.maxUsers}>
          <Input type="number" min="1" value={form.maxUsers} disabled={termsLocked} error={errors.maxUsers} onChange={set('maxUsers')} />
        </Field>
        <Field label="Max employees" required hint="Enforced: active, suspended and invited accounts count; the next invitation is refused with “Upgrade your plan”." error={errors.maxEmployees}>
          <Input type="number" min="1" value={form.maxEmployees} disabled={termsLocked} error={errors.maxEmployees} onChange={set('maxEmployees')} />
        </Field>
        <Field label="Trial days" error={errors.trialDays}>
          <Input type="number" min="0" value={form.trialDays} disabled={termsLocked} error={errors.trialDays} onChange={set('trialDays')} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={form.publiclyAvailable} onChange={(event) => onChange({ ...form, publiclyAvailable: event.target.checked })} />
        <span>Shown to Tenant Admins (offered in their plan catalogue while ACTIVE)</span>
      </label>
      <div className="field-split">Included modules {errors.moduleApps ? <span className="field-error">{errors.moduleApps}</span> : null}</div>
      <div className="chip-row">
        {PLAN_MODULES.map((id) => (
          <label key={id} className="check">
            <input type="checkbox" checked={form.moduleApps.includes(id)} disabled={termsLocked} onChange={() => toggleModule(id)} />
            <span className="mono">{id}</span>{id === 'NORMAONE' ? <span className="muted"> (the portal)</span> : null}
          </label>
        ))}
      </div>
    </div>
  )
}

/** A page of plan history entries (PlanHistoryResponse). */
export function HistoryTable({ read, onPage }) {
  if (read.result && !read.result.ok) return <Problem result={read.result} onRetry={read.reload} />
  const rows = read.data?.content ?? []
  if (!rows.length) {
    return <Empty title={read.loading ? 'Reading the history…' : 'No entry matches'} description={read.loading ? null : 'Change the filters.'} />
  }
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Plan</th>
              <th>Organization</th>
              <th>By</th>
              <th>Changes · reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{when(entry.occurredAt)}</td>
                <td>
                  <Badge tone="brand">{entry.eventType}</Badge>
                  {entry.status ? <> <StatusBadge status={entry.status} /></> : null}
                </td>
                <td className="mono">
                  {entry.previousPlanCode ? <>{planLabel(entry.previousPlanCode, entry.previousPlanVersion)} → </> : null}
                  {planLabel(entry.planCode, entry.planVersion)}
                </td>
                <td className="mono muted">{entry.tenantId || '—'}</td>
                <td><span className="muted">{entry.actorRole}</span> <span className="mono">{entry.actorUserId}</span></td>
                <td className="audit-details">
                  {(entry.changes ?? []).map((change) => (
                    <Fragment key={change.field}>
                      <span className="mono">{change.field}</span>: {change.from ?? '∅'} → {change.to ?? '∅'}<br />
                    </Fragment>
                  ))}
                  {entry.reason ? <span className="muted">{entry.reason}</span> : null}
                  {entry.correlationId ? <div className="muted mono">request {entry.correlationId}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager data={read.data} onPage={onPage} />
    </>
  )
}

/** A plan-change request (PlanChangeRequestResponse). */
export function RequestFacts({ request, platform }) {
  const plan = (ref) => (ref ? `${ref.name ?? ''} (${planLabel(ref.planCode, ref.planVersion)})`.trim() : '—')
  const mail = request.notification
  return (
    <Facts rows={[
      ['Status', <StatusBadge key="s" status={request.status} />],
      platform ? ['Organization', request.organization?.name
        ? <span key="o">{request.organization.name} <span className="mono muted">{request.organization.id}</span></span>
        : <span key="o" className="mono">{request.organization?.id}</span>] : null,
      ['From', plan(request.currentPlan)],
      ['To', plan(request.requestedPlan)],
      ['Requested by', `${request.requestedBy?.name ?? ''} <${request.requestedBy?.email ?? ''}>`],
      ['Requested', when(request.requestedAt)],
      ['Reason', request.reason, true],
      ['Decided', request.decidedAt ? `${when(request.decidedAt)} by ${request.decidedByRole ?? ''} ${request.decidedBy ?? ''}` : null],
      ['Decision note', request.decisionNote, true],
      ['Applied subscription', request.appliedSubscriptionId && <span key="a" className="mono">{request.appliedSubscriptionId}</span>],
      // Until email delivery is configured nothing is emailed: say so, rather than show the outbox's PENDING.
      !EMAIL_DELIVERY_AVAILABLE ? ['Super Admin email', <EmailComingSoon key="m" />]
        : ['Super Admin email', mail ? <span key="m"><StatusBadge status={mail.status} />{mail.sentAt ? ` ${when(mail.sentAt)}` : ''}</span> : 'not recorded'],
      EMAIL_DELIVERY_AVAILABLE && platform && mail?.attempts != null ? ['Email attempts', mail.attempts] : null,
      EMAIL_DELIVERY_AVAILABLE && platform && mail?.lastError ? ['Email last error', <span key="e" className="mono">{mail.lastError}</span>, true] : null,
      ['Request id', <span key="i" className="mono">{request.id}</span>],
    ]} />
  )
}
