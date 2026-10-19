import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken } from '../../components/Screen.jsx'
import { UserFilters, UserTable } from '../../components/UserParts.jsx'
import { Button, Card, Field, Input, Modal } from '../../components/ui/Kit.jsx'
import { refusalOf, userQuery } from '../../lib/forms.js'
import { detailPath } from '../../paths.js'

/**
 * Super admin › Super Admins — the platform accounts, and adding one. Adding is an invitation:
 * Cognito creates the account and emails a temporary password (never shown here); an existing
 * account, of an organization or the platform, is never promoted.
 */
export default function SuperAdmins() {
  const [filters, setFilters] = useState({ search: '', status: '', role: '', tenantId: '', page: 0 })
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const query = userQuery(filters)
  const read = useRead('sa-list-super-admins', { query, label: 'List Super Admins' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  const path = (id) => detailPath('platform', 'super-admins', 'super-admins', id)
  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Super Admins</h1>
          <p className="muted">{read.data ? `${read.data.totalElements} match` : 'Platform accounts'}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
        <Button look="primary" icon={Plus} onClick={() => setAdding(true)}>Add a Super Admin</Button>
      </div>
      <Card title="Accounts" description="The platform always keeps one active Super Admin, and nobody removes their own access.">
        <UserFilters filters={filters} onChange={setFilters} withRole={false} label="Super Admins" />
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <span className="toolbar-spacer" />
          <EndpointTag id="sa-list-super-admins" name="The list, as filtered" query={query} />
        </div>
        <UserTable read={read} noun="Super Admin" detailPath={path} onPage={(page) => setFilters({ ...filters, page })} />
      </Card>
      {adding ? (
        <AddSuperAdmin onClose={() => setAdding(false)}
                       onCreated={(created) => { setAdding(false); navigate(path(created.id), { state: { invitation: created.invitation } }) }} />
      ) : null}
    </div>
  )
}

function AddSuperAdmin({ onClose, onCreated }) {
  const { call } = useApi()
  const [form, setForm] = useState({ name: '', email: '' })
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const body = { name: form.name.trim(), email: form.email.trim() }

  const submit = async () => {
    setBusy(true)
    const result = await call('sa-create-super-admin', { label: 'Add a Super Admin', body })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onCreated(result.bodyJson)
  }

  return (
    <Modal
      open
      onClose={onClose}
      preview={body}
      title="Add a Super Admin"
      description="A new platform account with full platform access. Cognito emails a temporary password; at the first sign-in they choose a permanent one."
      endpoint={<EndpointTag id="sa-create-super-admin" name="Add" look="primary" />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button look="primary" busy={busy} disabled={!body.name || !body.email} onClick={submit}>Send the invitation</Button>
        </>
      }
    >
      <div className="stack">
        {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
        <div className="field-grid">
          <Field label="Name" required error={refusal.fields.name}>
            <Input value={form.name} error={refusal.fields.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Email" required hint="Must not belong to any existing account." error={refusal.fields.email}>
            <Input type="email" value={form.email} error={refusal.fields.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
