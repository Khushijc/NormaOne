import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import { EmailComingSoon } from '../../components/ComingSoon.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import PackageFacts from '../../components/PackageFacts.jsx'
import { PlanTerms, RequestFacts } from '../../components/PlanParts.jsx'
import { NoToken, Pager, Problem, Raw, StatusBadge } from '../../components/Screen.jsx'
import { Badge, Button, Card, Empty, Field, Modal, TextArea } from '../../components/ui/Kit.jsx'
import { EMAIL_DELIVERY_AVAILABLE } from '../../config/features.js'
import { refusalOf, when } from '../../lib/forms.js'
import { money, planLabel } from '../../lib/plans.js'

/**
 * Tenant admin › Plans & subscription — the organization's current subscription, the plans it can
 * choose from, and plan-change requests.
 *
 * A CHANGE IS A REQUEST. There is no billing or payment integration, so choosing a plan records a
 * PENDING request for a Super Admin to approve (which applies it) or reject; nothing here claims a
 * payment or an immediate change. The organization is always the signed-in administrator's own.
 */
export default function TenantPlans() {
  const pack = useRead('tenant-package', { label: 'My package' })
  const plans = useRead('tenant-plans', { label: 'Plan catalogue' })
  const [page, setPage] = useState(0)
  const requests = useRead('tenant-plan-requests', { query: { page, size: 10 }, label: 'My plan-change requests' })
  const [choosing, setChoosing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [openedRequest, setOpenedRequest] = useState(null)
  const [justSent, setJustSent] = useState(null)

  if (plans.missingToken) {
    return <div className="page stack"><Card><NoToken needs="ADMIN" /></Card></div>
  }

  const openRequest = (requests.data?.content ?? []).find((one) => one.status === 'PENDING' || one.status === 'PROCESSING')
  const reloadAll = () => { pack.reload(); plans.reload(); requests.reload() }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Plans &amp; subscription</h1>
          <p className="muted">Your organization&apos;s plan, and the plans you can ask for.</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={pack.loading || plans.loading || requests.loading} onClick={reloadAll}>Refresh</Button>
      </div>

      {justSent ? (
        <div className="banner" data-tone="good">
          <span>
            Request sent for {justSent.requestedPlan?.name}: it is PENDING until a Super Admin approves it here in the application. No payment has been taken.
            {EMAIL_DELIVERY_AVAILABLE && justSent.notification ? ` Super Admin email: ${justSent.notification.status}.` : ''}
          </span>
          {!EMAIL_DELIVERY_AVAILABLE ? <><span className="toolbar-spacer" /><EmailComingSoon /></> : null}
        </div>
      ) : null}

      {openRequest ? (
        <OpenRequest request={openRequest} onDone={() => { setJustSent(null); reloadAll() }} />
      ) : null}

      <Card title="Current subscription" action={<EndpointTag id="tenant-package" name="My package" />}>
        {pack.result && !pack.result.ok ? <Problem result={pack.result} onRetry={pack.reload} /> : pack.data ? (
          <PackageFacts pack={pack.data} />
        ) : <Empty title="Reading the subscription…" />}
      </Card>

      <Card
        title="Available plans"
        description={`Every plan on the platform. Only ACTIVE plans can be requested; your current plan is outlined. ${EMAIL_DELIVERY_AVAILABLE
          ? 'Requesting one emails the Super Admins.' : 'A Super Admin reviews your request in the application; you follow its status under Requests.'}`}
        action={<>{!EMAIL_DELIVERY_AVAILABLE ? <EmailComingSoon /> : null}<EndpointTag id="tenant-plans" name="Catalogue" /></>}
      >
        {plans.result && !plans.result.ok ? <Problem result={plans.result} onRetry={plans.reload} /> : !plans.data ? (
          <Empty title="Reading the plans…" />
        ) : !plans.data.length ? (
          <Empty title="No plan is offered to your organization right now" />
        ) : (
          <div className="plan-grid">
            {plans.data.map((plan) => (
              <PlanCard key={plan.id} plan={plan} blocked={Boolean(openRequest)}
                        onChoose={() => setChoosing(plan)} onView={() => setViewing(plan.id)} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Requests" action={<EndpointTag id="tenant-plan-requests" name="My requests" />}>
        {requests.result && !requests.result.ok ? <Problem result={requests.result} onRetry={requests.reload} /> : !(requests.data?.content ?? []).length ? (
          <Empty title={requests.loading ? 'Reading the requests…' : 'No request yet'} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Requested</th><th>From → to</th><th>By</th><th>Status</th><th>Decision</th><th /></tr></thead>
                <tbody>
                  {requests.data.content.map((request) => (
                    <tr key={request.id}>
                      <td className="muted">{when(request.requestedAt)}</td>
                      <td className="mono">{planLabel(request.currentPlan?.planCode, request.currentPlan?.planVersion)} → {planLabel(request.requestedPlan?.planCode, request.requestedPlan?.planVersion)}</td>
                      <td className="mono">{request.requestedBy?.email}</td>
                      <td><StatusBadge status={request.status} /></td>
                      <td className="muted">{request.decisionNote || (request.decidedAt ? when(request.decidedAt) : '—')}</td>
                      <td><Button onClick={() => setOpenedRequest(request.id)}>Details</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager data={requests.data} onPage={setPage} />
          </>
        )}
      </Card>

      {choosing ? (
        <RequestPlan plan={choosing} current={pack.data?.plan}
                     onClose={() => setChoosing(null)}
                     onSent={(created) => { setChoosing(null); setJustSent(created); reloadAll() }} />
      ) : null}
      {viewing ? <PlanModal planId={viewing} onClose={() => setViewing(null)} /> : null}
      {openedRequest ? <RequestModal requestId={openedRequest} onClose={() => setOpenedRequest(null)} /> : null}
    </div>
  )
}

function PlanCard({ plan, blocked, onChoose, onView }) {
  return (
    <div className="plan-card" data-current={plan.current ? 'true' : 'false'}>
      <div className="toolbar">
        <strong>{plan.name}</strong>
        <span className="toolbar-spacer" />
        {plan.current ? <Badge tone="brand">current</Badge> : null}
        {plan.status !== 'ACTIVE' ? <StatusBadge status={plan.status} /> : null}
      </div>
      <div className="plan-card-price">{money(plan.listPrice, plan.currencyCode)} <small>/ {plan.billingCycle?.toLowerCase()}</small></div>
      {plan.description ? <p className="muted" style={{ margin: 0 }}>{plan.description}</p> : null}
      <ul className="plan-card-terms">
        <li>Duration: {plan.durationMonths ? `${plan.durationMonths} months` : 'rolling'}</li>
        <li>User seats: {plan.maxUsers ?? 'no limit'}</li>
        <li>Employees: up to {plan.maxEmployees}</li>
        {plan.trialDays ? <li>Trial: {plan.trialDays} days</li> : null}
      </ul>
      <div className="chip-row">
        {plan.modules?.length ? plan.modules.map((id) => <Badge key={id}>{id}</Badge>) : <span className="muted">The portal only</span>}
      </div>
      <div className="plan-card-foot">
        <Button onClick={onView}>Details</Button>
        {plan.selectable ? (
          <Button look="primary" disabled={blocked} title={blocked ? 'Your organization already has an open request.' : undefined} onClick={onChoose}>
            Request this plan
          </Button>
        ) : plan.current && plan.status !== 'ACTIVE' ? (
          <span className="muted">No longer offered — kept for your current subscription.</span>
        ) : !plan.current ? (
          <span className="muted">Cannot be requested while {plan.status}.</span>
        ) : null}
      </div>
    </div>
  )
}

function RequestPlan({ plan, current, onClose, onSent }) {
  const { call } = useApi()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const body = reason.trim() ? { planId: plan.id, reason: reason.trim() } : { planId: plan.id }

  const submit = async () => {
    setBusy(true)
    const result = await call('tenant-plan-request', { label: 'Request a plan change', body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onSent(result.bodyJson)
  }

  return (
    <ConfirmDialog
      open
      title={`Request ${plan.name}?`}
      message={`From ${current?.name ?? 'your current plan'} to ${plan.name} (${money(plan.listPrice, plan.currencyCode)} / ${plan.billingCycle?.toLowerCase()}). `
        + 'A Super Admin reviews the request; your plan changes only when it is approved. No payment is taken here.'}
      confirmLabel="Send the request"
      look="primary"
      busy={busy}
      error={refusal.message}
      onCancel={onClose}
      onConfirm={submit}
      endpoint={<EndpointTag id="tenant-plan-request" name="Request" look="primary" />}
    >
      <Field label="Reason — optional" hint="≤500 characters. The Super Admins see it." error={refusal.fields.reason}>
        <TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <p className="muted mono">{JSON.stringify(body)}</p>
    </ConfirmDialog>
  )
}

function OpenRequest({ request, onDone }) {
  const { call } = useApi()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const pathParams = { requestId: request.id }

  const cancel = async () => {
    setBusy(true)
    const result = await call('tenant-plan-request-cancel', { label: 'Cancel a plan-change request', pathParams })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) {
      setConfirming(false)
      onDone()
    }
  }

  return (
    <div className="banner" data-tone="warn">
      <span>
        Open request: {request.currentPlan?.name ?? 'current plan'} → <strong>{request.requestedPlan?.name}</strong>, {request.status} since {when(request.requestedAt)}.
        {' '}A new request can be made once this one is decided or cancelled.
      </span>
      <span className="toolbar-spacer" />
      {request.status === 'PENDING' ? <Button look="danger" onClick={() => setConfirming(true)}>Cancel the request</Button> : null}
      <ConfirmDialog
        open={confirming}
        title="Cancel this request?"
        message="It is withdrawn and the Super Admins no longer decide it. Your plan does not change."
        confirmLabel="Cancel the request"
        busy={busy}
        error={refusal.message}
        onCancel={() => setConfirming(false)}
        onConfirm={cancel}
        endpoint={<EndpointTag id="tenant-plan-request-cancel" name="Cancel" look="danger" pathParams={pathParams} />}
      />
    </div>
  )
}

function PlanModal({ planId, onClose }) {
  const read = useRead('tenant-plan', { pathParams: { planId }, label: 'One plan' })
  return (
    <Modal open onClose={onClose} title={read.data?.name ?? 'Plan'} endpoint={<EndpointTag id="tenant-plan" name="One plan" pathParams={{ planId }} />}>
      {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : read.data ? (
        <div className="stack"><PlanTerms plan={read.data} /><Raw data={read.data} /></div>
      ) : <Empty title="Reading the plan…" />}
    </Modal>
  )
}

function RequestModal({ requestId, onClose }) {
  const read = useRead('tenant-plan-request-get', { pathParams: { requestId }, label: 'One plan-change request' })
  return (
    <Modal open onClose={onClose} title="Plan-change request"
           endpoint={<EndpointTag id="tenant-plan-request-get" name="One request" pathParams={{ requestId }} />}>
      {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : read.data ? (
        <div className="stack"><RequestFacts request={read.data} /><Raw data={read.data} /></div>
      ) : <Empty title="Reading the request…" />}
    </Modal>
  )
}
