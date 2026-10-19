import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, CopyPlus, RefreshCw } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import { HistoryTable, PlanFields, PlanTerms } from '../../components/PlanParts.jsx'
import { NoToken, Pager, Problem, Raw, StatusBadge } from '../../components/Screen.jsx'
import { Button, Card, Empty, Field, TextArea } from '../../components/ui/Kit.jsx'
import { PLAN_STATUS_MOVES } from '../../config/enums.js'
import { refusalOf, when } from '../../lib/forms.js'
import { PUBLISHED_EDITABLE, planBody, planForm } from '../../lib/plans.js'
import { detailPath, screenPath } from '../../paths.js'
import { CreatePlan } from './Plans.jsx'

/**
 * Super admin › Plans › one plan version — its terms, editing (all of a DRAFT; only the display
 * metadata of a published version), status changes with confirmation, a new version, the
 * organizations on it now, and its history.
 */
export default function PlanDetail() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const read = useRead('sa-get-plan', { pathParams: { planId }, label: 'Open a plan' })
  const [subsPage, setSubsPage] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const subscriptions = useRead('sa-subscriptions', { query: { planId, page: subsPage, size: 10 }, label: 'Organizations on this plan' })
  const history = useRead('sa-plan-history', { query: { planId, page: historyPage, size: 10 }, label: 'This plan\'s history' })
  const [versioning, setVersioning] = useState(false)
  const plan = read.data

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const reloadAll = () => { read.reload(); subscriptions.reload(); history.reload() }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('platform', 'plans', 'plans')}><ChevronLeft size={13} /> Plans</Link>
          <h1 className="page-title">{plan?.name || 'A plan'}</h1>
          <p className="muted mono">{planId}</p>
        </div>
        <span className="toolbar-spacer" />
        {plan && plan.status !== 'ARCHIVED' ? <Button icon={CopyPlus} onClick={() => setVersioning(true)}>New version</Button> : null}
        <Button icon={RefreshCw} busy={read.loading} onClick={reloadAll}>Refresh</Button>
      </div>

      <Card title="The plan" action={<EndpointTag id="sa-get-plan" name="Open" pathParams={{ planId }} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : plan ? (
          <div className="stack">
            <PlanTerms plan={plan} platform />
            <Raw data={plan} />
          </div>
        ) : <Empty title="Reading the plan…" />}
      </Card>

      {plan ? (
        <>
          <Card title="Status" description="Status decides only whether the plan can be assigned from now on. Organizations on it keep it, and its history stays.">
            <PlanStatus key={plan.status} plan={plan} onDone={reloadAll} />
          </Card>
          {plan.status !== 'ARCHIVED' ? (
            <Card
              title="Edit"
              description={plan.status === 'DRAFT'
                ? 'A draft changes freely. Every changed field is recorded in the plan history with its old and new value.'
                : 'A published version changes only its name, description and whether Tenant Admins see it. For new terms, create a new version.'}
            >
              <EditPlan key={plan.updatedAt} plan={plan} onDone={reloadAll} />
            </Card>
          ) : null}
          <Card title="Organizations on this plan" action={<EndpointTag id="sa-subscriptions" name="Subscriptions" query={{ planId }} />}>
            <Subscribers read={subscriptions} onPage={setSubsPage} />
          </Card>
          <Card title="History of this plan" action={<EndpointTag id="sa-plan-history" name="History" query={{ planId }} />}>
            <HistoryTable read={history} onPage={setHistoryPage} />
          </Card>
        </>
      ) : null}

      {versioning ? (
        <CreatePlan from={plan} onClose={() => setVersioning(false)}
                    onCreated={(created) => { setVersioning(false); navigate(detailPath('platform', 'plans', 'plans', created.id)) }} />
      ) : null}
    </div>
  )
}

function PlanStatus({ plan, onDone }) {
  const { call } = useApi()
  const moves = PLAN_STATUS_MOVES[plan.status] ?? []
  const [target, setTarget] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const pathParams = { planId: plan.id }
  const body = reason.trim() ? { status: target, reason: reason.trim() } : { status: target }

  const send = async () => {
    setBusy(true)
    const result = await call('sa-plan-status', { label: `Make the plan ${target}`, pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) {
      setTarget(null)
      onDone()
    }
  }

  if (!moves.length) return <p className="muted">Archived: final. The plan stays readable, with its subscriptions and history.</p>
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="toolbar">
        <span className="muted">Now <StatusBadge status={plan.status} /></span>
        {moves.map((status) => (
          <Button key={status} look={status === 'ACTIVE' ? 'primary' : 'danger'} onClick={() => { setTarget(status); setRefusal({ fields: {}, message: null }) }}>
            {status === 'ACTIVE' ? 'Activate' : status === 'INACTIVE' ? 'Deactivate' : 'Archive'}
          </Button>
        ))}
        <span className="toolbar-spacer" />
        <EndpointTag id="sa-plan-status" name="Change status" pathParams={pathParams} />
      </div>
      <ConfirmDialog
        open={Boolean(target)}
        title={target === 'ACTIVE' ? 'Activate this plan?' : target === 'INACTIVE' ? 'Deactivate this plan?' : 'Archive this plan?'}
        message={target === 'ACTIVE'
          ? 'It becomes assignable, and Tenant Admins see it if it is offered to them.'
          : `It can no longer be assigned${target === 'ARCHIVED' ? ', ever again (archiving is final)' : ''}. The ${plan.currentSubscriptions ?? 0} organization(s) on it keep it, and nothing is deleted.`}
        confirmLabel={target === 'ACTIVE' ? 'Activate' : target === 'INACTIVE' ? 'Deactivate' : 'Archive'}
        look={target === 'ACTIVE' ? 'primary' : 'danger'}
        busy={busy}
        error={refusal.message}
        onCancel={() => setTarget(null)}
        onConfirm={send}
        endpoint={<EndpointTag id="sa-plan-status" name="Change status" pathParams={pathParams} />}
      >
        <Field label="Reason — optional" hint="≤500 characters. Recorded in the plan history.">
          <TextArea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  )
}

function EditPlan({ plan, onDone }) {
  const { call } = useApi()
  const draft = plan.status === 'DRAFT'
  const initial = planForm(plan)
  const [form, setForm] = useState(initial)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const pathParams = { planId: plan.id }
  // Only the fields that changed, and on a published version only those it may still change.
  const full = planBody(form, { withCode: false, only: draft ? undefined : PUBLISHED_EDITABLE })
  const before = planBody(initial, { withCode: false })
  const body = Object.fromEntries(Object.entries(full).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])))
  const unchanged = Object.keys(body).length === 0

  const submit = async () => {
    setBusy(true)
    const result = await call('sa-update-plan', { label: 'Edit a plan', pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onDone()
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <PlanFields form={form} onChange={setForm} refusal={refusal} codeLocked termsLocked={!draft} />
      <div className="toolbar">
        <Button look="primary" busy={busy} disabled={unchanged} onClick={submit}>Save changes</Button>
        <EndpointTag id="sa-update-plan" name="Edit" look="primary" pathParams={pathParams} />
        <span className="muted mono">{unchanged ? 'No change.' : JSON.stringify(body)}</span>
      </div>
    </div>
  )
}

function Subscribers({ read, onPage }) {
  if (read.result && !read.result.ok) return <Problem result={read.result} onRetry={read.reload} />
  const rows = read.data?.content ?? []
  if (!rows.length) return <Empty title={read.loading ? 'Reading…' : 'No organization is on this plan version now'} />
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Organization</th><th>Subscription</th><th>Since</th><th>Term ends</th><th /></tr></thead>
          <tbody>
            {rows.map(({ organization, subscription }) => (
              <tr key={subscription.subscriptionId}>
                <td>{organization?.name ?? '—'} <span className="mono muted">{organization?.id}</span></td>
                <td><StatusBadge status={subscription.status} /></td>
                <td className="muted">{when(subscription.startDate)}</td>
                <td className="muted">{subscription.currentPeriodEnd ? when(subscription.currentPeriodEnd) : 'rolling'}</td>
                <td>{organization?.id ? <Link className="btn" to={detailPath('platform', 'tenants', 'tenants', organization.id)}>Open</Link> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager data={read.data} onPage={onPage} />
    </>
  )
}
