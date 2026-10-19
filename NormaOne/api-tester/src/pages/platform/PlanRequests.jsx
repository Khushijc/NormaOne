import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken, Pager, Problem, StatusBadge } from '../../components/Screen.jsx'
import { Button, Card, Empty } from '../../components/ui/Kit.jsx'
import Select from '../../components/ui/Select.jsx'
import { PLAN_REQUEST_STATUSES } from '../../config/enums.js'
import { when } from '../../lib/forms.js'
import { planLabel } from '../../lib/plans.js'
import { detailPath } from '../../paths.js'

/**
 * Super admin › Plans › Requests — Tenant Admins' plan-change requests, PENDING first by default.
 * A request's own page approves (which applies the plan) or rejects it.
 */
export default function PlanRequests() {
  const [filters, setFilters] = useState({ status: 'PENDING', tenantId: '', page: 0 })
  const query = { status: filters.status || undefined, tenantId: filters.tenantId.trim() || undefined, page: filters.page, size: 20 }
  const read = useRead('sa-plan-requests', { query, label: 'Plan-change requests' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const rows = read.data?.content ?? []
  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Plan-change requests</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} match` : 'Requests from Tenant Admins'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>
      <Card title="Requests" description="Nothing is applied on request: there is no billing or payment integration, so a Super Admin decides.">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <Select label="Status" value={filters.status} onChange={(status) => setFilters({ ...filters, status, page: 0 })}
                  options={[{ value: '', label: 'Any status' }, ...PLAN_REQUEST_STATUSES]} />
          <input className="input mono tenant-filter" value={filters.tenantId} placeholder="tenantId" aria-label="Tenant id"
                 onChange={(event) => setFilters({ ...filters, tenantId: event.target.value, page: 0 })} />
          <span className="toolbar-spacer" />
          <EndpointTag id="sa-plan-requests" name="The list, as filtered" query={query} />
        </div>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : !rows.length ? (
          <Empty title={read.loading ? 'Reading the requests…' : 'No request matches'} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Requested</th><th>Organization</th><th>From → to</th><th>By</th><th>Status</th><th>Email</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((request) => (
                    <tr key={request.id}>
                      <td className="muted">{when(request.requestedAt)}</td>
                      <td>{request.organization?.name ?? '—'}</td>
                      <td className="mono">
                        {planLabel(request.currentPlan?.planCode, request.currentPlan?.planVersion)} → {planLabel(request.requestedPlan?.planCode, request.requestedPlan?.planVersion)}
                      </td>
                      <td className="mono">{request.requestedBy?.email}</td>
                      <td><StatusBadge status={request.status} /></td>
                      <td>{request.notification ? <StatusBadge status={request.notification.status} /> : '—'}</td>
                      <td><Link className="btn" to={detailPath('platform', 'plans', 'requests', request.id)}>Open <ChevronRight size={13} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager data={read.data} onPage={(page) => setFilters({ ...filters, page })} />
          </>
        )}
      </Card>
    </div>
  )
}
