import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { ModuleEditor } from '../../components/ModuleParts.jsx'
import { defaultsFor } from '../../lib/modules.js'
import { NoToken } from '../../components/Screen.jsx'
import { UserFilters, UserTable } from '../../components/UserParts.jsx'
import { Button, Card, Field, Input, Modal } from '../../components/ui/Kit.jsx'
import { filled, refusalOf, userQuery } from '../../lib/forms.js'
import { detailPath } from '../../paths.js'

/**
 * Super admin › Administrators — the list and the invite. The other administrator endpoints are on
 * an administrator's own page.
 *
 * An administrator is a tenant ADMIN: always one organization's, never a platform account. So the
 * invite asks for the organization, and has no role to choose — the backend sets ADMIN and ignores a
 * role sent in the body. A tenant's page links here with ?tenantId= filled in.
 */
export default function Admins() {
  const [params] = useSearchParams()
  const [filters, setFilters] = useState({ search: '', status: '', role: '', tenantId: params.get('tenantId') || '', page: 0 })
  const [inviting, setInviting] = useState(false)
  const navigate = useNavigate()
  const query = userQuery(filters)
  const read = useRead('sa-list-admins', { query, label: 'List administrators' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const path = (id) => detailPath('platform', 'admins', 'admins', id)

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Administrators</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} match` : 'Tenant administrators across every organization'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
        <Button look="primary" icon={Plus} onClick={() => setInviting(true)}>Invite an administrator</Button>
      </div>

      <Card>
        <UserFilters filters={filters} onChange={setFilters} withTenant withRole={false} label="administrators" />
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <span className="toolbar-spacer" />
          <EndpointTag id="sa-list-admins" name="The list, as filtered" query={query} />
        </div>
        <UserTable read={read} showTenant noun="administrator" detailPath={path} onPage={(page) => setFilters({ ...filters, page })} />
      </Card>

      {inviting ? (
        <Invite
          defaultTenantId={filters.tenantId}
          onClose={() => setInviting(false)}
          onCreated={(admin) => { setInviting(false); navigate(path(admin.id), { state: { invitation: admin.invitation } }) }}
        />
      ) : null}
    </div>
  )
}

/**
 * POST /api/super-admin/admins. Mounted only while open, so it starts clean each time and reads the
 * module catalogue when it is actually needed. What an administrator may do in their organization
 * follows from the ADMIN role; the only permissions to choose are module permissions.
 */
function Invite({ defaultTenantId, onClose, onCreated }) {
  const { call } = useApi()
  const modules = useRead('modules-catalog', { label: 'Module catalogue' })
  const [form, setForm] = useState({ tenantId: defaultTenantId || '', name: '', email: '', phoneNumber: '' })
  // null: the default module assignment, which the backend applies when no module field is sent.
  const [assignment, setAssignment] = useState(null)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  const shownModules = assignment ?? defaultsFor(modules.data, 'ADMIN')
  const body = {
    ...filled(form),
    ...(assignment ? { moduleAccess: assignment.modules, modulePermissions: assignment.permissions } : {}),
  }

  const submit = async () => {
    setBusy(true)
    const result = await call('sa-create-admin', { label: 'Invite an administrator', body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onCreated(result.bodyJson)
  }

  return (
    <Modal
      open
      onClose={onClose}
      preview={body}
      title="Invite an administrator"
      description="An INVITED ADMIN in an ACTIVE organization. Cognito emails them a temporary password; at their first sign-in they choose a permanent one."
      endpoint={<EndpointTag id="sa-create-admin" name="Invite" look="primary" />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button look="primary" busy={busy} onClick={submit}>Invite</Button>
        </>
      }
    >
      <div className="stack">
        {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
        <div className="field-grid">
          <Field label="Organization id" required hint="The tenant's id — from Tenants." error={refusal.fields.tenantId} wide>
            <Input className="input mono" value={form.tenantId} error={refusal.fields.tenantId} onChange={set('tenantId')} />
          </Field>
          <Field label="Name" required error={refusal.fields.name}>
            <Input value={form.name} error={refusal.fields.name} onChange={set('name')} />
          </Field>
          <Field label="Email" required hint="The invitation and temporary password are emailed here." error={refusal.fields.email}>
            <Input type="email" value={form.email} error={refusal.fields.email} onChange={set('email')} />
          </Field>
          <Field label="Phone" error={refusal.fields.phoneNumber}>
            <Input value={form.phoneNumber} error={refusal.fields.phoneNumber} onChange={set('phoneNumber')} />
          </Field>
        </div>

        <div className="field-split">Modules and their permissions</div>
        <div className="toolbar">
          <span className="muted">
            {assignment
              ? 'Custom assignment — sent as moduleAccess and modulePermissions.'
              : 'Default: all six modules with the ADMIN defaults (every permission except DELETE). Nothing is sent; the backend assigns it.'}
          </span>
          <span className="toolbar-spacer" />
          {assignment ? <Button onClick={() => setAssignment(null)}>Back to the default</Button> : null}
          <EndpointTag id="modules-catalog" name="Module catalogue" />
        </div>
        {modules.result && !modules.result.ok ? <p className="banner" data-tone="bad">The module catalogue could not be read.</p> : (
          <ModuleEditor catalogue={modules.data} value={shownModules} onChange={setAssignment} />
        )}
      </div>
    </Modal>
  )
}
