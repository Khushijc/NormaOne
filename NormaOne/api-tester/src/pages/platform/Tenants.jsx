import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, RefreshCw, Search } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken, Pager, Problem, StatusBadge } from '../../components/Screen.jsx'
import { filled, refusalOf } from '../../lib/forms.js'
import TenantFields from '../../components/TenantFields.jsx'
import { Button, Card, Empty, Field, Input, Modal } from '../../components/ui/Kit.jsx'
import { TENANT_STATUSES } from '../../config/enums.js'
import { detailPath } from '../../paths.js'

/**
 * Super admin › Tenants — the list and the create. The other four endpoints are on a tenant's own
 * page, at /platform-tenants/tenants/{tenantId}, where the tenant they act on is what is on screen.
 */
function tenantQuery({ search, status, page }) {
  return { search: search.trim() || undefined, status: status || undefined, page, size: 20 }
}

export default function Tenants() {
  const [filters, setFilters] = useState({ search: '', status: '', page: 0 })
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const query = tenantQuery(filters)
  const read = useRead('sa-list-tenants', { query, label: 'List tenants' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const rows = read.data?.content ?? []
  const path = (id) => detailPath('platform', 'tenants', 'tenants', id)

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Tenants</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} on the platform` : 'Every tenant on the platform'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
        <Button look="primary" icon={Plus} onClick={() => setCreating(true)}>Create a tenant</Button>
      </div>

      <Card>
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <span className="search search-sm">
            <Search size={15} className="search-icon" aria-hidden="true" />
            <input
              className="search-input"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value, page: 0 })}
              placeholder="Search name or subdomain"
              aria-label="Search tenants"
            />
          </span>
          <div className="segmented" role="tablist" aria-label="Status">
            {['', ...TENANT_STATUSES].map((one) => (
              <button
                key={one || 'all'}
                type="button"
                role="tab"
                className="segmented-item"
                data-active={filters.status === one || undefined}
                onClick={() => setFilters({ ...filters, status: one, page: 0 })}
              >
                {one || 'All'}
              </button>
            ))}
          </div>
          <span className="toolbar-spacer" />
          <EndpointTag id="sa-list-tenants" name="The list, as filtered" query={query} />
        </div>

        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : !rows.length ? (
          <Empty title={read.loading ? 'Reading the tenants…' : 'No tenant matches'} description={read.loading ? null : 'Change the filter or the search.'} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Subdomain</th>
                    <th>Status</th>
                    <th>Package</th>
                    <th className="num">Users</th>
                    <th>Country</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>{tenant.tenantName}</td>
                      <td className="mono">{tenant.subdomain}</td>
                      <td><StatusBadge status={tenant.status} /></td>
                      <td>{tenant.packageCode || '—'}</td>
                      <td className="num">{tenant.userCount ?? '—'}</td>
                      <td>{tenant.countryCode}</td>
                      <td className="muted">{tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : '—'}</td>
                      <td><Link className="btn" to={path(tenant.id)}>Open <ChevronRight size={13} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager data={read.data} onPage={(page) => setFilters({ ...filters, page })} />
          </>
        )}
      </Card>

      <CreateTenant
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(tenant) => { setCreating(false); navigate(path(tenant.id), { state: { invitation: tenant.adminInvitation } }) }}
      />
    </div>
  )
}

const BLANK = {
  organizationName: '', subdomain: '', countryCode: 'ES', defaultLocale: '', defaultTimeZone: '',
  accountHolderName: '', emailAddress: '', phoneNumber: '', addressLine: '', city: '', postalCode: '', logoUrl: '',
}
const BLANK_ADMIN = { name: '', email: '', phoneNumber: '' }

/**
 * POST /api/super-admin/tenants. Unlike onboarding, the administrator is somebody else, named in
 * `initialAdmin`, and starts INVITED — Cognito emails them a temporary password, and they link at their first sign-in.
 */
function CreateTenant({ open, onClose, onCreated }) {
  const { call } = useApi()
  const [form, setForm] = useState(BLANK)
  const [admin, setAdmin] = useState(BLANK_ADMIN)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)

  const body = { ...filled(form), initialAdmin: filled(admin) }
  // The backend names nested fields "initialAdmin.email"; the bare "initialAdmin" (missing
  // altogether) is shown above the three fields instead.
  const adminErrors = Object.fromEntries(Object.entries(refusal.fields)
    .filter(([key]) => key.startsWith('initialAdmin.'))
    .map(([key, value]) => [key.slice('initialAdmin.'.length), value]))

  const submit = async () => {
    setBusy(true)
    const result = await call('sa-create-tenant', { label: 'Create a tenant', body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) {
      setForm(BLANK)
      setAdmin(BLANK_ADMIN)
      onCreated(result.bodyJson)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      preview={body}
      title="Create a tenant"
      description="ACTIVE on BASIC. The administrator below is INVITED: Cognito emails them a temporary password, and they become ACTIVE at their first sign-in."
      endpoint={<EndpointTag id="sa-create-tenant" name="Create" look="primary" />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button look="primary" busy={busy} onClick={submit}>Create</Button>
        </>
      }
    >
      <div className="stack">
        {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
        <TenantFields form={form} onChange={setForm} errors={refusal.fields} mode="create" />
        <div className="field-split">Initial administrator — required</div>
        {refusal.fields.initialAdmin ? <p className="field-error">{refusal.fields.initialAdmin}</p> : null}
        <div className="field-grid">
          <Field label="Name" required error={adminErrors.name}>
            <Input value={admin.name} error={adminErrors.name} onChange={(event) => setAdmin({ ...admin, name: event.target.value })} />
          </Field>
          <Field label="Email" required error={adminErrors.email}>
            <Input type="email" value={admin.email} error={adminErrors.email} onChange={(event) => setAdmin({ ...admin, email: event.target.value })} />
          </Field>
          <Field label="Phone" error={adminErrors.phoneNumber}>
            <Input value={admin.phoneNumber} error={adminErrors.phoneNumber} onChange={(event) => setAdmin({ ...admin, phoneNumber: event.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
