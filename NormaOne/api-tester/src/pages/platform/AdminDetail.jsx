import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { InvitationNotice, ResendInvitation } from '../../components/Invitation.jsx'
import { ModuleAccessEditor } from '../../components/ModuleParts.jsx'
import { NoToken, Problem, Raw } from '../../components/Screen.jsx'
import { StatusChange, UserFacts } from '../../components/UserParts.jsx'
import { Button, Card, Empty, Field, Input } from '../../components/ui/Kit.jsx'
import { refusalOf } from '../../lib/forms.js'
import { detailPath, screenPath } from '../../paths.js'

/**
 * Super admin › Administrators › one administrator — open, update the profile, change the status,
 * resend the invitation, and read and set their modules and module permissions.
 *
 * The id comes from the URL and the page reads the record itself. An id that is a regular user's or
 * a Super Admin's answers 404 on every one of these: the administrator routes do not reach them.
 */
export default function AdminDetail() {
  const { adminId } = useParams()
  const { state: arrival } = useLocation()
  const read = useRead('sa-get-admin', { pathParams: { adminId }, label: 'Open an administrator' })
  const modules = useRead('sa-admin-modules', { pathParams: { adminId }, label: 'An administrator\'s modules' })
  const catalogue = useRead('modules-catalog', { label: 'Module catalogue' })
  const admin = read.data

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const reloadAll = () => { read.reload(); modules.reload() }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('platform', 'admins', 'admins')}><ChevronLeft size={13} /> Administrators</Link>
          <h1 className="page-title">{admin?.name || 'An administrator'}</h1>
          <p className="muted mono">{adminId}</p>
        </div>
        <span className="toolbar-spacer" />
        {admin?.organization?.id ? (
          <Link className="btn" to={detailPath('platform', 'tenants', 'tenants', admin.organization.id)}>Their organization</Link>
        ) : null}
        <Button icon={RefreshCw} busy={read.loading || modules.loading} onClick={reloadAll}>Refresh</Button>
      </div>

      <InvitationNotice info={arrival?.invitation} />

      {admin?.status === 'INVITED' ? (
        <Card title="Invitation" description="Pending: the account has not set its permanent password yet.">
          <ResendInvitation endpointId="sa-resend-admin-invitation" pathParams={{ adminId }} onDone={read.reload} />
        </Card>
      ) : null}

      <Card title="The administrator" action={<EndpointTag id="sa-get-admin" name="Open" pathParams={{ adminId }} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : admin ? (
          <div className="stack">
            <UserFacts user={admin} />
            <Raw data={admin} />
          </div>
        ) : <Empty title="Reading the administrator…" />}
      </Card>

      {admin ? (
        <>
          <Card title="Profile" description="PUT replaces the profile whole: a phone number left empty is cleared.">
            <EditProfile key={admin.updatedAt} admin={admin} onDone={read.reload} />
          </Card>
          <Card title="Status" description="Removing access is DEACTIVATED: the record, its history and the organization are kept, and Cognito disables the account. An organization's only active administrator is removed only with the explicit acknowledgement below.">
            <StatusChange key={admin.status} user={admin} endpointId="sa-admin-status" pathParams={{ adminId }} onDone={read.reload} lastAdminOption />
          </Card>
          <Card
            title="Modules"
            description="The application modules assigned to this administrator and the permissions inside each — the only permissions there are. The administrator can grant their organization's users only the module permissions assigned here; they cannot change their own. Administering their organization follows from the ADMIN role."
            action={<EndpointTag id="sa-admin-modules" name="Read" pathParams={{ adminId }} />}
          >
            <ModuleAccessEditor
              read={modules}
              catalogue={catalogue.data}
              pathParams={{ adminId }}
              endpoints={{ setAll: 'sa-set-admin-modules', setOne: 'sa-set-admin-module', revokeOne: 'sa-revoke-admin-module' }}
            />
          </Card>
        </>
      ) : null}
    </div>
  )
}

function EditProfile({ admin, onDone }) {
  const { call } = useApi()
  const [form, setForm] = useState({ name: admin.name ?? '', phoneNumber: admin.phoneNumber ?? '' })
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const pathParams = { adminId: admin.id }
  const body = form.phoneNumber.trim() ? form : { name: form.name }
  const unchanged = form.name === (admin.name ?? '') && form.phoneNumber === (admin.phoneNumber ?? '')

  const submit = async () => {
    setBusy(true)
    const result = await call('sa-update-admin', { label: 'Update an administrator', pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onDone()
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <div className="field-grid">
        <Field label="Name" required error={refusal.fields.name}>
          <Input value={form.name} error={refusal.fields.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Phone" error={refusal.fields.phoneNumber}>
          <Input value={form.phoneNumber} error={refusal.fields.phoneNumber} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} />
        </Field>
      </div>
      <div className="toolbar">
        <Button look="primary" busy={busy} disabled={unchanged} onClick={submit}>Save profile</Button>
        <EndpointTag id="sa-update-admin" name="Update" look="primary" pathParams={pathParams} />
        <span className="muted mono">{JSON.stringify(body)}</span>
      </div>
    </div>
  )
}

