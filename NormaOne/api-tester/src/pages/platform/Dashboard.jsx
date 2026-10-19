import { RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken, Problem, Raw } from '../../components/Screen.jsx'
import { Button, Card, Empty } from '../../components/ui/Kit.jsx'

/**
 * Super admin › Overview — GET /api/super-admin/dashboard.
 *
 * Counts, not charts: each map is a handful of name → number pairs, and every number here is
 * something to check against a list rather than a trend to watch. "Active" is ACTIVE; "inactive" is
 * SUSPENDED plus DEACTIVATED; an INVITED account is neither and shows only in the by-status table.
 */
export default function Dashboard() {
  const read = useRead('sa-dashboard', { label: 'Platform dashboard' })
  const d = read.data

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Platform dashboard</h1>
          <p className="muted">Every organization and account on the platform, counted by the database.</p>
        </div>
        <span className="toolbar-spacer" />
        <EndpointTag id="sa-dashboard" name="Dashboard" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      {read.result && !read.result.ok ? (
        <Card><Problem result={read.result} onRetry={read.reload} /></Card>
      ) : !d ? (
        <Card><Empty title="Reading the dashboard…" /></Card>
      ) : (
        <>
          <div className="stat-row stat-row-4">
            <Stat label="Organizations" value={d.totalOrganizations} />
            <Stat label="Administrators" value={d.totalAdmins} note={`${d.activeAdmins} active · ${d.inactiveAdmins} inactive`} />
            <Stat label="Users" value={d.totalUsers} note={`${d.activeUsers} active · ${d.inactiveUsers} inactive`} />
            <Stat label="Super Admins" value={d.totalSuperAdmins} />
          </div>
          <div className="grid-2">
            <CountCard title="Organizations by status" counts={d.organizationsByStatus} />
            <CountCard title="Administrators by status" counts={d.adminsByStatus} />
            <CountCard title="Users by status" counts={d.usersByStatus} />
            <CountCard title="Current subscriptions by plan" counts={d.currentSubscriptionsByPlan} />
          </div>
          <Raw data={d} />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, note }) {
  return (
    <section className="card stat">
      <p className="dl-term">{label}</p>
      <p className="stat-value">{value ?? '—'}</p>
      {note ? <p className="muted">{note}</p> : null}
    </section>
  )
}

function CountCard({ title, counts }) {
  const rows = Object.entries(counts || {})
  return (
    <Card title={title}>
      {rows.length ? (
        <table className="kv-table">
          <tbody>
            {rows.map(([name, count]) => (
              <tr key={name}><th>{name}</th><td className="num">{count}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">None.</p>}
    </Card>
  )
}
