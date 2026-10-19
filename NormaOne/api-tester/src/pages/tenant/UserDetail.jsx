import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useApi, useApiState } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import { EmailDeliveryNote, EmailPreferenceToggle } from '../../components/EmailPreference.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import { ModuleAccessEditor } from '../../components/ModuleParts.jsx'
import { scopeOf } from '../../lib/modules.js'
import { InvitationNotice, ResendInvitation } from '../../components/Invitation.jsx'
import { NoToken, Problem, Raw } from '../../components/Screen.jsx'
import { changed, refusalOf } from '../../lib/forms.js'
import { StatusChange, UserFacts } from '../../components/UserParts.jsx'
import { Button, Card, Empty, Field, Input } from '../../components/ui/Kit.jsx'
import Select from '../../components/ui/Select.jsx'
import { ASSIGNABLE_ROLES } from '../../config/enums.js'
import { screenPath } from '../../paths.js'

/**
 * Tenant admin › Users › one user — open, update, change status.
 *
 * The id comes from the URL, so the page reads the user itself rather than being handed a row from
 * the list: a link, a reload and the back button all land on the same, current record.
 *
 * Another tenant's user id answers 404, not 403 — the tenant API does not admit the record exists.
 * Your own id answers 403 on a role or status change. Both are worth trying, and both show here.
 */
export default function UserDetail() {
  const { userId } = useParams()
  const { state: arrival } = useLocation()
  const { account } = useApiState()
  const read = useRead('tenant-get-user', { pathParams: { userId }, label: 'Open a user' })
  const modules = useRead('tenant-user-modules', { pathParams: { userId }, label: 'A user\'s modules' })
  const catalogue = useRead('modules-catalog', { label: 'Module catalogue' })
  const user = read.data
  const yourself = Boolean(account.me?.userId) && account.me.userId === userId

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="an ADMIN of an ACTIVE tenant" /></Card></div>
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('tenant', 'users', 'users')}><ChevronLeft size={13} /> Users</Link>
          <h1 className="page-title">{user?.name || 'A user'}</h1>
          <p className="muted mono">{userId}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading || modules.loading} onClick={() => { read.reload(); modules.reload() }}>Refresh</Button>
      </div>

      <InvitationNotice info={arrival?.invitation} />

      {user?.status === 'INVITED' ? (
        <Card title="Invitation" description="Pending: the account has not set its permanent password yet.">
          <ResendInvitation endpointId="tenant-resend-invitation" pathParams={{ userId }} onDone={read.reload} />
        </Card>
      ) : null}

      <Card title="The user" action={<EndpointTag id="tenant-get-user" name="Open" pathParams={{ userId }} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : user ? (
          <div className="stack">
            <UserFacts user={user} />
            <Raw data={user} />
          </div>
        ) : <Empty title="Reading the user…" />}
      </Card>

      {user ? (
        <>
          <Card title="Update" description="Only the fields you change are sent. Your own role cannot be changed. A role change resets the module permissions to the new role's defaults.">
            <EditUser key={user.updatedAt} user={user} onDone={() => { read.reload(); modules.reload() }} />
          </Card>
          <Card
            title="Modules"
            description="The application modules assigned to this user and the permissions inside each. You can grant or remove only permissions you hold yourself; the backend checks every change."
            action={<EndpointTag id="tenant-user-modules" name="Read" pathParams={{ userId }} />}
          >
            <ModuleAccessEditor
              read={modules}
              catalogue={catalogue.data}
              pathParams={{ userId }}
              scope={scopeOf(account.me)}
              locked={yourself}
              lockedReason="This is your own account, and nobody changes their own module access. A Super Admin assigns it (Super admin › Administrators › your account › Modules), or another administrator of your organization within the permissions they hold."
              endpoints={{ setAll: 'tenant-set-user-modules', setOne: 'tenant-set-user-module', revokeOne: 'tenant-revoke-user-module' }}
            />
          </Card>
          <Card
            title={`Email notifications — ${user.name || user.email}`}
            description={user.effectiveRole === 'USER'
              ? `Whether ${user.name || user.email} receives notifications by email as well. Their in-app notifications are not affected.`
              : 'An administrator sets their own email preference, in their own profile; it is not managed here.'}
          >
            {user.effectiveRole === 'USER' ? <TeamEmailPreference user={user} onSaved={read.reload} /> : (
              <p className="muted" style={{ margin: 0 }}>{yourself ? 'This is your account: change it under Account › Profile.' : 'Not managed by other administrators.'}</p>
            )}
          </Card>
          <Card title="Status" description="Suspend or deactivate needs a reason. Not your own account.">
            <StatusChange
              key={user.status}
              user={user}
              endpointId="tenant-user-status"
              pathParams={{ userId }}
              onDone={read.reload}
            />
          </Card>
        </>
      ) : null}
    </div>
  )
}

function EditUser({ user, onDone }) {
  const { call } = useApi()
  const original = { name: user.name ?? '', phoneNumber: user.phoneNumber ?? '', role: user.effectiveRole === 'ADMIN' ? 'ADMIN' : 'USER' }
  const [form, setForm] = useState(original)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const body = changed(form, original)
  const pathParams = { userId: user.id }

  const submit = async () => {
    setBusy(true)
    const result = await call('tenant-update-user', { label: 'Update a user', pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onDone()
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <div className="field-grid">
        <Field label="Name" error={refusal.fields.name}>
          <Input value={form.name} error={refusal.fields.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Phone" error={refusal.fields.phoneNumber}>
          <Input value={form.phoneNumber} error={refusal.fields.phoneNumber} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} />
        </Field>
        <Field label="Role" error={refusal.fields.role}>
          <Select label="Role" value={form.role} onChange={(role) => setForm({ ...form, role })} options={ASSIGNABLE_ROLES} />
        </Field>
      </div>
      <div className="toolbar">
        <Button look="primary" busy={busy} disabled={!Object.keys(body).length} onClick={submit}>Save changes</Button>
        <EndpointTag id="tenant-update-user" name="Update" look="primary" pathParams={pathParams} />
        <span className="muted mono">{Object.keys(body).length ? JSON.stringify(body) : 'nothing changed'}</span>
      </div>
    </div>
  )
}

/** A USER's email-notification preference, as their administrator manages it (read from the backend). */
function TeamEmailPreference({ user, onSaved }) {
  const pathParams = { userId: user.id }
  const read = useRead('tenant-user-email-preference', { pathParams, label: 'A user\'s email preference' })
  const pref = read.data
  if (read.result && !read.result.ok) return <Problem result={read.result} onRetry={read.reload} />
  if (!pref) return <Empty title="Reading the preference…" />
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="toolbar">
        <EmailPreferenceToggle
          key={String(pref.emailNotificationsEnabled)}
          enabled={pref.emailNotificationsEnabled}
          endpointId="tenant-set-user-email-preference"
          pathParams={pathParams}
          who={user.name || user.email}
          onSaved={() => { read.reload(); onSaved?.() }}
        />
        <span className="toolbar-spacer" />
        <EndpointTag id="tenant-user-email-preference" name="Read" pathParams={pathParams} />
      </div>
      {!pref.explicit ? <p className="muted" style={{ margin: 0 }}>Never changed: email notifications are on by default.</p> : null}
      <EmailDeliveryNote />
    </div>
  )
}
