import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import { AuditTable, DateRange } from '../../components/AuditTable.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken } from '../../components/Screen.jsx'
import { Button, Card } from '../../components/ui/Kit.jsx'
import Select from '../../components/ui/Select.jsx'
import { TENANT_AUDIT_ACTIONS } from '../../config/enums.js'
import { isoOf } from '../../lib/forms.js'

/**
 * Tenant admin › Audit log — GET /api/tenant/audit-events: what happened in the caller's own
 * organization (invitations, status and role changes, module access, plan requests and changes).
 *
 * THERE IS NO ORGANIZATION FILTER, on purpose: the backend takes the tenant from the signed-in
 * administrator's record and puts it in the database query, so another organization's events are
 * never read — not hidden here after the fact.
 */
export default function TenantAudit() {
  const [filters, setFilters] = useState({ action: '', actorUserId: '', targetId: '', targetType: '', from: '', to: '', page: 0 })
  const query = {
    action: filters.action || undefined,
    actorUserId: filters.actorUserId.trim() || undefined,
    targetId: filters.targetId.trim() || undefined,
    targetType: filters.targetType.trim() || undefined,
    from: isoOf(filters.from),
    to: isoOf(filters.to),
    page: filters.page,
    size: 20,
  }
  const read = useRead('tenant-audit-events', { query, label: 'My organization\'s audit log' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="ADMIN" /></Card></div>
  }

  const set = (key) => (value) => setFilters({ ...filters, [key]: value, page: 0 })

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Audit log</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} events in your organization` : 'Your organization\'s administrative actions, newest first'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      <Card title="Events" description="Only your own organization: the backend sets the organization from your account.">
        <div className="toolbar" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          {['actorUserId', 'targetId', 'targetType'].map((key) => (
            <input
              key={key}
              className="input mono tenant-filter"
              value={filters[key]}
              onChange={(event) => set(key)(event.target.value)}
              placeholder={key}
              aria-label={key}
            />
          ))}
          <Select label="Action" value={filters.action} onChange={set('action')}
                  options={[{ value: '', label: 'Any action' }, ...TENANT_AUDIT_ACTIONS]} />
          <DateRange from={filters.from} to={filters.to} onChange={(range) => setFilters({ ...filters, ...range, page: 0 })} />
          <span className="toolbar-spacer" />
          <EndpointTag id="tenant-audit-events" name="The log, as filtered" query={query} />
        </div>
        <AuditTable read={read} onPage={(page) => setFilters({ ...filters, page })} />
      </Card>
    </div>
  )
}
