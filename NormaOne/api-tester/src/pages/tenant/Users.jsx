import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { useApi, useApiState } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import { EmailDeliveryNote, EmailPreferenceToggle } from '../../components/EmailPreference.jsx'
import EndpointTag from '../../components/EndpointTag.jsx'
import { ModuleEditor } from '../../components/ModuleParts.jsx'
import { defaultsFor, scopeOf } from '../../lib/modules.js'
import { NoToken } from '../../components/Screen.jsx'
import { UserFilters, UserTable } from '../../components/UserParts.jsx'
import { filled, refusalOf, userQuery } from '../../lib/forms.js'
import { Button, Card, Field, Input, Modal } from '../../components/ui/Kit.jsx'
import Select from '../../components/ui/Select.jsx'
import { ASSIGNABLE_ROLES } from '../../config/enums.js'
import { detailPath } from '../../paths.js'

/**
 * Tenant admin › Users — the list and the invite. The other three of the five endpoints are on a
 * user's own page, where the thing they act on is what you are looking at.
 *
 * Only the caller's own tenant is ever listed, and nothing on screen can change that: there is no
 * tenant parameter to send. Super admin › All users is the cross-tenant list.
 */
const FIRST = { search: '', status: '', role: '', page: 0 }

export default function Users() {
  const [filters, setFilters] = useState(FIRST)
  const [inviting, setInviting] = useState(false)
  const navigate = useNavigate()
  const query = userQuery(filters)
  const read = useRead('tenant-list-users', { query, label: 'List my users' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="an ADMIN of an ACTIVE tenant" /></Card></div>
  }

  const path = (id) => detailPath('tenant', 'users', 'users', id)

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} in this organization` : 'Everyone in the caller\'s organization'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
        <Button look="primary" icon={Plus} onClick={() => setInviting(true)}>Invite a user</Button>
      </div>

      <Card>
        <UserFilters filters={filters} onChange={setFilters} />
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <span className="toolbar-spacer" />
          <EndpointTag id="tenant-list-users" name="The list, as filtered" query={query} />
        </div>
        <UserTable
          read={read}
          detailPath={path}
          onPage={(page) => setFilters({ ...filters, page })}
          extraColumn={{
            header: 'Email notifications',
            // USER accounts only: an administrator sets their own preference in their own profile.
            cell: (user) => (user.effectiveRole === 'USER' ? (
              <EmailPreferenceToggle
                key={`${user.id}-${user.emailNotificationsEnabled}`}
                enabled={user.emailNotificationsEnabled}
                endpointId="tenant-set-user-email-preference"
                pathParams={{ userId: user.id }}
                who={user.name || user.email}
                compact
              />
            ) : <span className="muted" title="Administrators set their own preference">Own setting</span>),
          }}
        />
        <EmailDeliveryNote />
      </Card>

      <Invite
        open={inviting}
        onClose={() => setInviting(false)}
        onCreated={(user) => { setInviting(false); navigate(path(user.id), { state: { invitation: user.invitation } }) }}
      />
    </div>
  )
}

const NEW_USER = { name: '', email: '', phoneNumber: '', role: 'USER' }

/**
 * POST /api/tenant/users. The person becomes INVITED and the backend asks Cognito (AdminCreateUser)
 * to email them a temporary password; the response's `invitation` says what happened. They turn
 * ACTIVE at their first sign-in, after choosing a permanent password. If Cognito refuses, nothing
 * is saved (502).
 *
 * Only USER and ADMIN are offered because only those are accepted; sending SUPER_ADMIN (403) or
 * anything else (400) is a test for the console, where it can be typed.
 */
function Invite({ open, onClose, onCreated }) {
  const { call } = useApi()
  const { account } = useApiState()
  const modules = useRead('modules-catalog', { label: 'Module catalogue', skip: !open })
  const [form, setForm] = useState(NEW_USER)
  // null: the default module assignment for the chosen role, which the backend applies when no
  // module field is sent (capped there, as here, by what the signed-in administrator holds).
  const [assignment, setAssignment] = useState(null)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })
  const scope = scopeOf(account.me)
  const shownModules = assignment ?? defaultsFor(modules.data, form.role, scope)
  const body = {
    ...filled(form),
    ...(assignment ? { moduleAccess: assignment.modules, modulePermissions: assignment.permissions } : {}),
  }

  const submit = async () => {
    setBusy(true)
    const result = await call('tenant-create-user', { label: 'Invite a user', body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) {
      setForm(NEW_USER)
      setAssignment(null)
      onCreated(result.bodyJson)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      preview={body}
      title="Invite a user"
      description="Creates an INVITED user in this organization. Cognito emails them a temporary password; at their first sign-in they choose a permanent one."
      endpoint={<EndpointTag id="tenant-create-user" name="Invite" look="primary" />}
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
          <Field label="Name" required error={refusal.fields.name}>
            <Input value={form.name} error={refusal.fields.name} onChange={set('name')} />
          </Field>
          <Field label="Email" required hint="The invitation and temporary password are emailed here." error={refusal.fields.email}>
            <Input type="email" value={form.email} error={refusal.fields.email} onChange={set('email')} />
          </Field>
          <Field label="Phone" error={refusal.fields.phoneNumber}>
            <Input value={form.phoneNumber} error={refusal.fields.phoneNumber} onChange={set('phoneNumber')} />
          </Field>
          <Field label="Role" error={refusal.fields.role}>
            <Select label="Role" value={form.role} onChange={(role) => setForm({ ...form, role })} options={ASSIGNABLE_ROLES} />
          </Field>
        </div>

        <div className="field-split">Modules</div>
        <div className="toolbar">
          <span className="muted">
            {assignment
              ? 'Custom assignment — sent as moduleAccess and modulePermissions.'
              : `Default: all six modules with the ${form.role} defaults (${form.role === 'ADMIN' ? 'every permission except DELETE' : 'VIEW only'}), within what you hold. Nothing is sent; the backend assigns it. Tick or untick any permission you hold to choose instead.`}
          </span>
          <span className="toolbar-spacer" />
          {assignment ? <Button onClick={() => setAssignment(null)}>Back to the default</Button> : null}
          <EndpointTag id="modules-catalog" name="Module catalogue" />
        </div>
        {open ? <ModuleEditor catalogue={modules.data} value={shownModules} onChange={setAssignment} scope={scope} /> : null}
      </div>
    </Modal>
  )
}
