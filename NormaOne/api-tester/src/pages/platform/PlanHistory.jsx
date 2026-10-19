import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import { DateRange } from '../../components/AuditTable.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import { HistoryTable } from '../../components/PlanParts.jsx'
import { NoToken } from '../../components/Screen.jsx'
import { Button, Card } from '../../components/ui/Kit.jsx'
import Select from '../../components/ui/Select.jsx'
import { PLAN_HISTORY_EVENTS } from '../../config/enums.js'
import { isoOf } from '../../lib/forms.js'

/**
 * Super admin › Plans › History — GET /api/super-admin/plan-history: every plan operation across the
 * platform, append-only. Plan events show each changed field with its old and new value; the entries
 * of one request (requested, approved, changed) share its id.
 */
export default function PlanHistory() {
  const [filters, setFilters] = useState({ eventType: '', tenantId: '', actorUserId: '', planId: '', from: '', to: '', page: 0 })
  const query = {
    eventType: filters.eventType || undefined,
    tenantId: filters.tenantId.trim() || undefined,
    actorUserId: filters.actorUserId.trim() || undefined,
    planId: filters.planId.trim() || undefined,
    from: isoOf(filters.from),
    to: isoOf(filters.to),
    page: filters.page,
    size: 20,
  }
  const read = useRead('sa-plan-history', { query, label: 'Plan history' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const set = (key) => (value) => setFilters({ ...filters, [key]: value, page: 0 })
  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Plan history</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} entries` : 'Every plan operation, newest first'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>
      <Card>
        <div className="toolbar" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <Select label="Event" value={filters.eventType} onChange={set('eventType')}
                  options={[{ value: '', label: 'Any event' }, ...PLAN_HISTORY_EVENTS]} />
          {['tenantId', 'actorUserId', 'planId'].map((key) => (
            <input key={key} className="input mono tenant-filter" value={filters[key]} placeholder={key} aria-label={key}
                   onChange={(event) => set(key)(event.target.value)} />
          ))}
          <DateRange from={filters.from} to={filters.to} onChange={(range) => setFilters({ ...filters, ...range, page: 0 })} />
          <span className="toolbar-spacer" />
          <EndpointTag id="sa-plan-history" name="The history, as filtered" query={query} />
        </div>
        <HistoryTable read={read} onPage={(page) => setFilters({ ...filters, page })} />
      </Card>
    </div>
  )
}
