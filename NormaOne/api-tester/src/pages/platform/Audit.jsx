import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import { AuditTable, DateRange } from '../../components/AuditTable.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken } from '../../components/Screen.jsx'
import { Button, Card } from '../../components/ui/Kit.jsx'
import Select from '../../components/ui/Select.jsx'
import { AUDIT_ACTIONS } from '../../config/enums.js'
import { isoOf } from '../../lib/forms.js'

/**
 * Super admin › Audit — GET /api/super-admin/audit-events, read only.
 *
 * Every administrative write the backend makes records one event: who (actor id and the role they
 * acted with), what (the action), on what (target type and id) and the non-sensitive details. The
 * filters are the ones the endpoint takes; a page linking here may fill in ?tenantId= or ?targetId=.
 */
export default function Audit() {
  const [params] = useSearchParams()
  const [filters, setFilters] = useState({
    tenantId: params.get('tenantId') || '', targetId: params.get('targetId') || '', actorUserId: '', targetType: '', action: '',
    from: '', to: '', page: 0,
  })
  const query = {
    tenantId: filters.tenantId.trim() || undefined,
    targetId: filters.targetId.trim() || undefined,
    actorUserId: filters.actorUserId.trim() || undefined,
    targetType: filters.targetType.trim() || undefined,
    action: filters.action || undefined,
    from: isoOf(filters.from),
    to: isoOf(filters.to),
    page: filters.page,
    size: 20,
  }
  const read = useRead('sa-audit-events', { query, label: 'Audit trail' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const set = (key) => (value) => setFilters({ ...filters, [key]: value, page: 0 })

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Audit trail</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} events` : 'Administrative actions across the platform, newest first'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      <Card>
        <div className="toolbar" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          {['tenantId', 'targetId', 'actorUserId', 'targetType'].map((key) => (
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
                  options={[{ value: '', label: 'Any action' }, ...AUDIT_ACTIONS]} />
          <DateRange from={filters.from} to={filters.to} onChange={(range) => setFilters({ ...filters, ...range, page: 0 })} />
          <span className="toolbar-spacer" />
          <EndpointTag id="sa-audit-events" name="The trail, as filtered" query={query} />
        </div>
        <AuditTable read={read} showTenant onPage={(page) => setFilters({ ...filters, page })} />
      </Card>
    </div>
  )
}
