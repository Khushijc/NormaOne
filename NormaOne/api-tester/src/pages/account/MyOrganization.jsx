import { RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { Facts, NoToken, Problem, Raw, StatusBadge } from '../../components/Screen.jsx'
import { Button, Card, Empty } from '../../components/ui/Kit.jsx'
import { LOCALES, TIME_ZONES } from '../../config/enums.js'
import { when } from '../../lib/forms.js'

/**
 * Account › My organization — GET /api/organization, read only. The tab is the USER's: an ADMIN has
 * Tenant admin › Organization (the sidebar hides this one from them, and OnboardingGate turns them away).
 *
 * There is nothing to choose: the endpoint takes no id, and the organization is the one on the
 * signed-in account's stored record. That is the whole of the isolation, and it is the backend's —
 * this page could send ?tenantId= and would still get its own organization back.
 *
 * Read only for everybody. Administrators edit nothing here either; the administrators' view, with
 * the user count and package, is Tenant admin › Organization.
 */
const label = (list, value) => list.find((one) => one.value === value)?.label ?? value

export default function MyOrganization() {
  const read = useRead('organization-own', { label: 'My organization' })
  const org = read.data

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="a member of an organization" /></Card></div>
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">{org?.name || 'My organization'}</h1>
          <p className="muted">{org ? `${org.subdomain} · read only` : 'The organization you belong to.'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      <Card title="Organization" action={<EndpointTag id="organization-own" name="My organization" />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : org ? (
          <div className="stack">
            {org.logoUrl ? <img className="org-logo" src={org.logoUrl} alt={`${org.name} logo`} /> : null}
            <Facts rows={[
              ['Status', <StatusBadge key="s" status={org.status} />],
              ['Subdomain', <span key="d" className="mono">{org.subdomain}</span>],
              ['Country', org.countryCode],
              ['Language', label(LOCALES, org.defaultLocale)],
              ['Time zone', label(TIME_ZONES, org.defaultTimeZone)],
              ['Account holder', org.accountHolderName],
              ['Email', org.emailAddress],
              ['Phone', org.phoneNumber],
              ['Address', [org.addressLine, org.city].filter(Boolean).join(', '), true],
              ['Postcode', org.postalCode],
              ['Created', when(org.createdAt)],
            ]} />
            <Raw data={org} />
          </div>
        ) : <Empty title="Reading the organization…" />}
      </Card>
    </div>
  )
}
