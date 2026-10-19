import { RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import PackageFacts from '../../components/PackageFacts.jsx'
import TenantFacts from '../../components/TenantFacts.jsx'
import { NoToken, Problem, Raw } from '../../components/Screen.jsx'
import { Button, Card, Empty } from '../../components/ui/Kit.jsx'

/**
 * Tenant admin › Organization — GET /api/tenant and GET /api/tenant/package.
 *
 * NO TENANT ID ANYWHERE, and that is the point of this surface: the tenant is the one on the
 * caller's stored user record, so an ADMIN cannot name another tenant even by accident. The
 * platform's view of the same tenant (Super admin › Tenants) names it in the URL instead.
 *
 * A tenant user, an un-onboarded account or a suspended tenant all get 403 here, and the panel
 * says so — switching the top bar to the "Tenant user" slot is the quickest way to see it.
 */
export default function Organization() {
  const tenant = useRead('tenant-own', { label: 'My organization' })
  const pack = useRead('tenant-package', { label: 'My package' })

  if (tenant.missingToken) {
    return <div className="page stack"><Card><NoToken needs="an ADMIN of an ACTIVE tenant" /></Card></div>
  }

  const t = tenant.data

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">{t?.tenantName || 'My organization'}</h1>
          <p className="muted">{t ? `${t.subdomain} · ${t.userCount ?? '?'} users` : 'As the backend sees the signed-in session.'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={tenant.loading || pack.loading} onClick={() => { tenant.reload(); pack.reload() }}>Refresh</Button>
      </div>

      <Card title="Organization" action={<EndpointTag id="tenant-own" name="My organization" />}>
        {tenant.result && !tenant.result.ok ? <Problem result={tenant.result} onRetry={tenant.reload} /> : t ? (
          <div className="stack">
            <TenantFacts tenant={t} />
            <Raw data={t} />
          </div>
        ) : <Empty title="Reading the organization…" />}
      </Card>

      <Card title="Package" action={<EndpointTag id="tenant-package" name="My package" />}>
        {pack.result && !pack.result.ok ? <Problem result={pack.result} onRetry={pack.reload} /> : pack.data ? (
          <div className="stack">
            <PackageFacts pack={pack.data} />
            <Raw data={pack.data} />
          </div>
        ) : <Empty title="Reading the package…" />}
      </Card>
    </div>
  )
}
