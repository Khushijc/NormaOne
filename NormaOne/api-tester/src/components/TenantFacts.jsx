import { Facts, StatusBadge } from './Screen.jsx'
import { when } from '../lib/forms.js'

/** A TenantResponse as labelled values, for both the tenant admin's and the platform's view. */
export default function TenantFacts({ tenant: t }) {
  return (
    <Facts rows={[
      ['Status', <StatusBadge key="s" status={t.status} />],
      ['Subdomain', <span key="d" className="mono">{t.subdomain}</span>],
      ['Package', t.packageCode],
      ['Users', t.userCount],
      ['Country', t.countryCode],
      ['Language', t.defaultLocale],
      ['Time zone', t.defaultTimeZone],
      ['Account holder', t.accountHolderName],
      ['Email', t.emailAddress],
      ['Phone', t.phoneNumber],
      ['Address', [t.addressLine, t.postalCode, t.city].filter(Boolean).join(', '), true],
      ['Logo URL', t.logoUrl, true],
      ['Status reason', t.statusReason],
      ['Activated', when(t.activatedAt)],
      ['Suspended', when(t.suspendedAt)],
      ['Created', when(t.createdAt)],
      ['Updated', when(t.updatedAt)],
      ['Tenant id', <span key="i" className="mono">{t.id}</span>],
    ]} />
  )
}
