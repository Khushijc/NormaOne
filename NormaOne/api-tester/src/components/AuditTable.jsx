import { Pager, Problem } from './Screen.jsx'
import { Badge, Empty } from './ui/Kit.jsx'
import { when } from '../lib/forms.js'

/**
 * A page of audit events (AuditEventResponse), as both audit screens show it: the platform-wide
 * trail and a Tenant Admin's own organization. `showTenant` adds the organization column.
 */
export function AuditTable({ read, onPage, showTenant }) {
  if (read.result && !read.result.ok) return <Problem result={read.result} onRetry={read.reload} />
  const rows = read.data?.content ?? []
  if (!rows.length) {
    return <Empty title={read.loading ? 'Reading the trail…' : 'No event matches'} description={read.loading ? null : 'Change the filters.'} />
  }
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              {showTenant ? <th>Organization</th> : null}
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => (
              <tr key={event.id}>
                <td className="muted">{when(event.occurredAt)}</td>
                <td><Badge tone="brand">{event.action}</Badge></td>
                <td><span className="muted">{event.actorRole}</span> <span className="mono">{event.actorUserId}</span></td>
                <td><span className="muted">{event.targetType}</span> <span className="mono">{event.targetId}</span></td>
                {showTenant ? <td className="mono muted">{event.tenantId || '—'}</td> : null}
                <td className="mono audit-details">
                  {Object.entries(event.details || {}).map(([key, value]) => `${key}=${value}`).join(' · ') || '—'}
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

/**
 * The date range of an audit or history filter. A `datetime-local` value is the browser's local
 * time; it is sent as an ISO-8601 instant (what the backend's from/to take).
 */
export function DateRange({ from, to, onChange }) {
  return (
    <>
      <label className="check muted">
        From <input type="datetime-local" className="input" value={from} onChange={(event) => onChange({ from: event.target.value, to })} aria-label="From" />
      </label>
      <label className="check muted">
        To <input type="datetime-local" className="input" value={to} onChange={(event) => onChange({ from, to: event.target.value })} aria-label="To" />
      </label>
    </>
  )
}
