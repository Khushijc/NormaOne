import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { PlanFields } from '../../components/PlanParts.jsx'
import { NoToken, Pager, Problem, StatusBadge } from '../../components/Screen.jsx'
import { Badge, Button, Card, Empty, Modal } from '../../components/ui/Kit.jsx'
import Select from '../../components/ui/Select.jsx'
import { PLAN_STATUSES } from '../../config/enums.js'
import { refusalOf } from '../../lib/forms.js'
import { money, planBody, planForm, planLabel } from '../../lib/plans.js'
import { detailPath } from '../../paths.js'

/**
 * Super admin › Plans — every plan version, and creating one. A plan's own page edits it, changes its
 * status and lists the organizations on it.
 *
 * Plans are versioned: a new plan, or a new version of an existing code, starts as DRAFT, is edited
 * freely, and is activated when ready. A published version keeps its terms; changing them is a new
 * version. Nothing here deletes a plan — deactivating or archiving keeps every subscription on it.
 */
export default function Plans() {
  const [filters, setFilters] = useState({ status: '', planCode: '', page: 0 })
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const query = { status: filters.status || undefined, planCode: filters.planCode.trim() || undefined, page: filters.page, size: 20 }
  const read = useRead('sa-list-plans', { query, label: 'List plans' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const path = (id) => detailPath('platform', 'plans', 'plans', id)
  const rows = read.data?.content ?? []

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Plans</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} plan versions` : 'Plan definitions, every version'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
        <Button look="primary" icon={Plus} onClick={() => setCreating(true)}>Create a plan</Button>
      </div>

      <Card>
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <input className="input mono tenant-filter" value={filters.planCode} placeholder="planCode" aria-label="Plan code"
                 onChange={(event) => setFilters({ ...filters, planCode: event.target.value, page: 0 })} />
          <Select label="Status" value={filters.status} onChange={(status) => setFilters({ ...filters, status, page: 0 })}
                  options={[{ value: '', label: 'Any status' }, ...PLAN_STATUSES]} />
          <span className="toolbar-spacer" />
          <EndpointTag id="sa-list-plans" name="The list, as filtered" query={query} />
        </div>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : !rows.length ? (
          <Empty title={read.loading ? 'Reading the plans…' : 'No plan matches'} description={read.loading ? null : 'Change the filters, or create one.'} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Duration</th>
                    <th>Seats</th>
                    <th>Modules</th>
                    <th>Offered</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((plan) => (
                    <tr key={plan.id}>
                      <td className="mono">{planLabel(plan.planCode, plan.planVersion)}</td>
                      <td>{plan.name}{plan.defaultPlan ? <> <Badge tone="brand">default</Badge></> : null}</td>
                      <td>
                        <StatusBadge status={plan.status} />
                        {plan.latestVersion === false ? <> <Badge tone="warn" title="A newer version of this code exists">historical</Badge></> : null}
                      </td>
                      <td>{money(plan.listPrice, plan.currencyCode)} <span className="muted">/ {plan.billingCycle?.toLowerCase()}</span></td>
                      <td className="muted">{plan.durationMonths ? `${plan.durationMonths} mo` : 'rolling'}</td>
                      <td className="muted">{plan.maxUsers ?? '∞'}</td>
                      <td className="muted" title={plan.moduleApps?.join(', ')}>{(plan.moduleApps ?? []).filter((id) => id !== 'NORMAONE').length} of 6</td>
                      <td className="muted">{plan.publiclyAvailable ? 'yes' : 'no'}</td>
                      <td><Link className="btn" to={path(plan.id)}>Open <ChevronRight size={13} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager data={read.data} onPage={(page) => setFilters({ ...filters, page })} />
          </>
        )}
      </Card>

      {creating ? (
        <CreatePlan onClose={() => setCreating(false)} onCreated={(plan) => { setCreating(false); navigate(path(plan.id)) }} />
      ) : null}
    </div>
  )
}

/** POST /api/super-admin/plans — a new DRAFT; also used, prefilled, for a new version of a code. */
export function CreatePlan({ from, onClose, onCreated }) {
  const { call } = useApi()
  const [form, setForm] = useState(planForm(from))
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const body = planBody(form)

  const submit = async () => {
    setBusy(true)
    const result = await call('sa-create-plan', { label: from ? 'Create a new plan version' : 'Create a plan', body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onCreated(result.bodyJson)
  }

  return (
    <Modal
      open
      onClose={onClose}
      preview={body}
      title={from ? `New version of ${from.planCode}` : 'Create a plan'}
      description={from
        ? 'A new DRAFT version with these terms (the next version number). Activate it when ready; organizations on the old version keep it.'
        : 'Created as DRAFT: edit it freely, then activate it to make it assignable.'}
      endpoint={<EndpointTag id="sa-create-plan" name="Create" look="primary" />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button look="primary" busy={busy} onClick={submit}>{from ? 'Create the version' : 'Create the plan'}</Button>
        </>
      }
    >
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <PlanFields form={form} onChange={setForm} refusal={refusal} codeLocked={Boolean(from)} />
    </Modal>
  )
}
