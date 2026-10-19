import { useSearchParams } from 'react-router-dom'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NotificationList } from '../../components/NotificationParts.jsx'
import { platformNotificationScope } from '../../components/notificationScopes.js'
import { NoToken, Problem } from '../../components/Screen.jsx'
import { Card, Empty } from '../../components/ui/Kit.jsx'
import Select from '../../components/ui/Select.jsx'

/**
 * Super admin › Notifications — always inside one organization, chosen here. There is no
 * platform-wide notification: an empty recipient list on a TENANT notification means everyone in
 * THIS organization. The choice is kept in the address (?tenant=), so it survives a reload.
 */
export default function Notifications() {
  const [params, setParams] = useSearchParams()
  const tenantId = params.get('tenant') || ''
  const tenants = useRead('sa-list-tenants', { query: { page: 0, size: 100 }, label: 'Organizations to notify' })

  if (tenants.missingToken) {
    return <div className="page stack"><Card><NoToken needs="a SUPER_ADMIN" /></Card></div>
  }

  const options = (tenants.data?.content ?? []).map((tenant) => ({
    value: tenant.id,
    label: `${tenant.tenantName} (${tenant.subdomain}) · ${tenant.status}`,
  }))

  return (
    <div className="page stack">
      <div className="page-head">
        <h1 className="page-title">Notifications</h1>
        <p className="muted">Messages from the platform to the members of one organization.</p>
      </div>

      <Card title="Organization" action={<EndpointTag id="sa-list-tenants" name="Organizations" query={{ page: 0, size: 100 }} />}>
        {tenants.result && !tenants.result.ok ? <Problem result={tenants.result} onRetry={tenants.reload} /> : (
          <Select
            label="Organization"
            value={tenantId}
            onChange={(value) => setParams(value ? { tenant: value } : {})}
            options={[{ value: '', label: tenants.loading ? 'Reading the organizations…' : 'Choose an organization' }, ...options]}
          />
        )}
      </Card>

      <Card>
        {tenantId
          ? <NotificationList key={tenantId} scope={platformNotificationScope(tenantId)} />
          : <Empty title="Choose an organization" description="Every notification belongs to one organization; pick it above." />}
      </Card>
    </div>
  )
}
