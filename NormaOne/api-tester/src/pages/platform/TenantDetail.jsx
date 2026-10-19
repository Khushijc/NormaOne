import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ChevronLeft, RefreshCw, ScrollText, ShieldCheck, Users } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import { InvitationNotice } from '../../components/Invitation.jsx'
import PackageFacts from '../../components/PackageFacts.jsx'
import { NoToken, Pager, Problem, Raw } from '../../components/Screen.jsx'
import { changed, refusalOf, when } from '../../lib/forms.js'
import TenantFacts from '../../components/TenantFacts.jsx'
import TenantFields from '../../components/TenantFields.jsx'
import { Button, Card, Empty, Field, TextArea } from '../../components/ui/Kit.jsx'
import { screenPath } from '../../paths.js'

/**
 * Super admin › Tenants › one tenant — open, update, change status, read its package.
 *
 * THE STATUS BUTTON DEPENDS ON THE STATUS. An ACTIVE tenant gets "Suspend", a SUSPENDED one gets
 * "Let it back in", and a PROVISIONING or DELETED one gets neither, because the backend answers
 * both with 409 there. Suspend asks for its reason first, because the backend requires one.
 *
 * The update sends only what changed. Subdomain, country and package are not on the form: no
 * endpoint changes them.
 */
export default function TenantDetail() {
  const { tenantId } = useParams()
  const { state: arrival } = useLocation()
  const read = useRead('sa-get-tenant', { pathParams: { tenantId }, label: 'Open a tenant' })
  const pack = useRead('sa-tenant-package', { pathParams: { tenantId }, label: 'A tenant\'s package' })
  const tenant = read.data

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const reloadAll = () => { read.reload(); pack.reload() }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('platform', 'tenants', 'tenants')}><ChevronLeft size={13} /> Tenants</Link>
          <h1 className="page-title">{tenant?.tenantName || 'A tenant'}</h1>
          <p className="muted mono">{tenant?.subdomain || tenantId}</p>
        </div>
        <span className="toolbar-spacer" />
        <Link className="btn" to={`${screenPath('platform', 'users', 'users')}?tenantId=${encodeURIComponent(tenantId)}`}>
          <Users size={13} /> Its users
        </Link>
        <Link className="btn" to={`${screenPath('platform', 'admins', 'admins')}?tenantId=${encodeURIComponent(tenantId)}`}>
          <ShieldCheck size={13} /> Its administrators
        </Link>
        <Link className="btn" to={`${screenPath('platform', 'audit', 'audit')}?tenantId=${encodeURIComponent(tenantId)}`}>
          <ScrollText size={13} /> Its audit trail
        </Link>
        <Button icon={RefreshCw} busy={read.loading || pack.loading} onClick={reloadAll}>Refresh</Button>
      </div>

      <InvitationNotice info={arrival?.invitation} />

      <Card title="The tenant" action={<EndpointTag id="sa-get-tenant" name="Open" pathParams={{ tenantId }} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : tenant ? (
          <div className="stack">
            <TenantFacts tenant={tenant} />
            <Raw data={tenant} />
          </div>
        ) : <Empty title="Reading the tenant…" />}
      </Card>

      {tenant ? (
        <>
          <Card title="Status" description="ACTIVE or SUSPENDED. A suspended tenant's users keep their records but lose their roles.">
            <TenantStatus key={tenant.status} tenant={tenant} onDone={reloadAll} />
          </Card>
          <Card title="Update" description="Partial: only the fields you change are sent.">
            <EditTenant key={tenant.updatedAt} tenant={tenant} onDone={read.reload} />
          </Card>
        </>
      ) : null}

      <Card title="Package" action={<EndpointTag id="sa-tenant-package" name="Package" pathParams={{ tenantId }} />}>
        {pack.result && !pack.result.ok ? <Problem result={pack.result} onRetry={pack.reload} /> : pack.data ? (
          <div className="stack">
            <PackageFacts pack={pack.data} />
            <Raw data={pack.data} />
          </div>
        ) : <Empty title="Reading the package…" />}
      </Card>

      {tenant ? (
        <Card title="Change the plan" description="Applies an ACTIVE plan now, without a request. Recorded in the subscription and plan histories. No payment is taken.">
          <ChangePlan tenantId={tenantId} currentPlanId={pack.data?.plan?.planId} onDone={reloadAll} />
        </Card>
      ) : null}

      <Card title="Subscription history" action={<EndpointTag id="sa-tenant-plan-history" name="History" pathParams={{ tenantId }} />}>
        <SubscriptionHistory tenantId={tenantId} />
      </Card>
    </div>
  )
}

function ChangePlan({ tenantId, currentPlanId, onDone }) {
  const { call } = useApi()
  const plans = useRead('sa-list-plans', { query: { status: 'ACTIVE', size: 100 }, label: 'Active plans' })
  const [planId, setPlanId] = useState('')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const options = (plans.data?.content ?? []).filter((plan) => plan.id !== currentPlanId)
  const chosen = options.find((plan) => plan.id === planId)
  const pathParams = { tenantId }
  const body = reason.trim() ? { planId, reason: reason.trim() } : { planId }

  const submit = async () => {
    setBusy(true)
    const result = await call('sa-change-tenant-plan', { label: 'Move an organization to a plan', pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    setConfirming(false)
    if (result.ok) {
      setPlanId('')
      setReason('')
      onDone()
    }
  }

  if (plans.result && !plans.result.ok) return <Problem result={plans.result} onRetry={plans.reload} />
  return (
    <div className="stack" style={{ gap: 12 }}>
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <div className="field-grid">
        <Field label="New plan" required hint="ACTIVE plans other than the current one.">
          <select className="input" value={planId} onChange={(event) => setPlanId(event.target.value)} aria-label="New plan">
            <option value="">Choose a plan…</option>
            {options.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name} ({plan.planCode} v{plan.planVersion}) — {plan.listPrice} {plan.currencyCode}</option>
            ))}
          </select>
        </Field>
        <Field label="Reason — optional" hint="≤500 characters.">
          <TextArea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
      <div className="toolbar">
        <Button look="primary" disabled={!planId} onClick={() => setConfirming(true)}>Change the plan</Button>
        <EndpointTag id="sa-change-tenant-plan" name="Change plan" look="primary" pathParams={pathParams} />
      </div>
      <ConfirmDialog
        open={confirming}
        title="Change this organization's plan?"
        message={chosen ? `It moves to ${chosen.name} (${chosen.planCode} v${chosen.planVersion}) now, and its current subscription is closed. No payment is taken.` : ''}
        confirmLabel="Change the plan"
        look="primary"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
        endpoint={<EndpointTag id="sa-change-tenant-plan" name="Change plan" pathParams={pathParams} />}
      />
    </div>
  )
}

function SubscriptionHistory({ tenantId }) {
  const [page, setPage] = useState(0)
  const read = useRead('sa-tenant-plan-history', { pathParams: { tenantId }, query: { page, size: 10 }, label: 'A tenant\'s subscription history' })
  if (read.result && !read.result.ok) return <Problem result={read.result} onRetry={read.reload} />
  const rows = read.data?.content ?? []
  if (!rows.length) return <Empty title={read.loading ? 'Reading the history…' : 'No history yet'} />
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>When</th><th>Event</th><th>Plan</th><th>Status</th><th>By</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{when(entry.eventDate)}</td>
                <td>{entry.eventType}</td>
                <td className="mono">{entry.previousPlanId ? `${entry.previousPlanId} v${entry.previousPlanVersion} → ` : ''}{entry.newPlanId} v{entry.newPlanVersion}</td>
                <td className="muted">{[entry.previousStatus, entry.newStatus].filter(Boolean).join(' → ')}</td>
                <td className="mono">{entry.performedBy}</td>
                <td className="muted">{entry.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager data={read.data} onPage={setPage} />
    </>
  )
}

function TenantStatus({ tenant, onDone }) {
  const { call } = useApi()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const pathParams = { tenantId: tenant.id }

  const target = tenant.status === 'ACTIVE' ? 'SUSPENDED' : tenant.status === 'SUSPENDED' ? 'ACTIVE' : null
  if (!target) {
    return <p className="muted">A {tenant.status} tenant cannot be activated or suspended here — the backend answers 409.</p>
  }
  const suspending = target === 'SUSPENDED'

  const submit = async () => {
    setBusy(true)
    const body = reason.trim() ? { status: target, reason: reason.trim() } : { status: target }
    const result = await call('sa-tenant-status', { label: suspending ? 'Suspend the tenant' : 'Let the tenant back in', pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onDone()
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <Field label={suspending ? 'Reason' : 'Reason — optional'} required={suspending} hint="≤500 characters." error={refusal.fields.reason}>
        <TextArea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
      </Field>
      <div className="toolbar">
        <Button look={suspending ? 'danger' : 'primary'} busy={busy} disabled={suspending && !reason.trim()} onClick={submit}>
          {suspending ? 'Suspend' : 'Let it back in'}
        </Button>
        <EndpointTag id="sa-tenant-status" name={suspending ? 'Suspend' : 'Activate'} look={suspending ? 'danger' : 'primary'} pathParams={pathParams} />
      </div>
    </div>
  )
}

function EditTenant({ tenant, onDone }) {
  const { call } = useApi()
  const original = {
    tenantName: tenant.tenantName ?? '', accountHolderName: tenant.accountHolderName ?? '',
    emailAddress: tenant.emailAddress ?? '', phoneNumber: tenant.phoneNumber ?? '',
    addressLine: tenant.addressLine ?? '', city: tenant.city ?? '', postalCode: tenant.postalCode ?? '',
    logoUrl: tenant.logoUrl ?? '', defaultLocale: tenant.defaultLocale ?? '', defaultTimeZone: tenant.defaultTimeZone ?? '',
  }
  const [form, setForm] = useState(original)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const body = changed(form, original)
  const pathParams = { tenantId: tenant.id }

  const submit = async () => {
    setBusy(true)
    const result = await call('sa-update-tenant', { label: 'Update a tenant', pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onDone()
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <TenantFields form={form} onChange={setForm} errors={refusal.fields} mode="edit" />
      <div className="toolbar">
        <Button look="primary" busy={busy} disabled={!Object.keys(body).length} onClick={submit}>Save changes</Button>
        <EndpointTag id="sa-update-tenant" name="Update" look="primary" pathParams={pathParams} />
        <span className="muted mono">{Object.keys(body).length ? JSON.stringify(body) : 'nothing changed'}</span>
      </div>
    </div>
  )
}
