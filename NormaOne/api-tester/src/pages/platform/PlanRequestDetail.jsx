import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronLeft, RefreshCw, X } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import { RequestFacts } from '../../components/PlanParts.jsx'
import { NoToken, Problem, Raw } from '../../components/Screen.jsx'
import { Button, Card, Empty, Field, TextArea } from '../../components/ui/Kit.jsx'
import { refusalOf } from '../../lib/forms.js'
import { planLabel } from '../../lib/plans.js'
import { detailPath, screenPath } from '../../paths.js'

/**
 * Super admin › Plans › Requests › one request — read it, and approve (applies the plan to the
 * organization) or reject (a note is required), each after a confirmation.
 */
export default function PlanRequestDetail() {
  const { requestId } = useParams()
  const read = useRead('sa-plan-request-get', { pathParams: { requestId }, label: 'Open a plan-change request' })
  const request = read.data

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('platform', 'plans', 'requests')}><ChevronLeft size={13} /> Requests</Link>
          <h1 className="page-title">{request ? `${request.organization?.name ?? 'An organization'} → ${request.requestedPlan?.name ?? ''}` : 'A plan-change request'}</h1>
          <p className="muted mono">{requestId}</p>
        </div>
        <span className="toolbar-spacer" />
        {request?.organization?.id ? <Link className="btn" to={detailPath('platform', 'tenants', 'tenants', request.organization.id)}>The organization</Link> : null}
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      <Card title="The request" action={<EndpointTag id="sa-plan-request-get" name="Open" pathParams={{ requestId }} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : request ? (
          <div className="stack">
            <RequestFacts request={request} platform />
            <Raw data={request} />
          </div>
        ) : <Empty title="Reading the request…" />}
      </Card>

      {request && (request.status === 'PENDING' || request.status === 'PROCESSING') ? (
        <Card title="Decision" description="Approving applies the requested plan now (no payment is taken). Rejecting keeps the current plan; the organization may ask again.">
          <Decide request={request} onDone={read.reload} />
        </Card>
      ) : null}
    </div>
  )
}

function Decide({ request, onDone }) {
  const { call } = useApi()
  const [mode, setMode] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const pathParams = { requestId: request.id }
  const endpointId = mode === 'reject' ? 'sa-plan-request-reject' : 'sa-plan-request-approve'
  const body = note.trim() ? { note: note.trim() } : {}

  const send = async () => {
    setBusy(true)
    const result = await call(endpointId, { label: mode === 'reject' ? 'Reject a plan-change request' : 'Approve a plan-change request', pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) {
      setMode(null)
      onDone()
    }
  }

  const open = (next) => { setMode(next); setNote(''); setRefusal({ fields: {}, message: null }) }
  const target = `${request.requestedPlan?.name ?? ''} (${planLabel(request.requestedPlan?.planCode, request.requestedPlan?.planVersion)})`

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="toolbar">
        <Button look="primary" icon={Check} onClick={() => open('approve')}>Approve and apply</Button>
        <Button look="danger" icon={X} onClick={() => open('reject')}>Reject</Button>
        <span className="toolbar-spacer" />
        <EndpointTag id="sa-plan-request-approve" name="Approve" look="primary" pathParams={pathParams} />
        <EndpointTag id="sa-plan-request-reject" name="Reject" look="danger" pathParams={pathParams} />
      </div>
      <ConfirmDialog
        open={Boolean(mode)}
        title={mode === 'reject' ? 'Reject this request?' : 'Approve and apply this plan?'}
        message={mode === 'reject'
          ? `${request.organization?.name ?? 'The organization'} stays on its current plan.`
          : `${request.organization?.name ?? 'The organization'} moves to ${target} now. No payment is taken.`}
        confirmLabel={mode === 'reject' ? 'Reject' : 'Approve and apply'}
        look={mode === 'reject' ? 'danger' : 'primary'}
        busy={busy}
        disabled={mode === 'reject' && !note.trim()}
        error={refusal.message}
        onCancel={() => setMode(null)}
        onConfirm={send}
        endpoint={<EndpointTag id={endpointId} name={mode === 'reject' ? 'Reject' : 'Approve'} pathParams={pathParams} />}
      >
        <Field label={mode === 'reject' ? 'Note' : 'Note — optional'} required={mode === 'reject'}
               hint="≤500 characters. The Tenant Admin sees it; it is recorded in the plan history." error={refusal.fields.note}>
          <TextArea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  )
}
