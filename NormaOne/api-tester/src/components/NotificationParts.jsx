import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, ChevronRight, Download, Paperclip, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import { useApi, useApiState } from '../api/apiContext.js'
import { buildCall } from '../api/buildCall.js'
import { useRead } from '../api/useRead.js'
import { formatBytes, refusalOf, when } from '../lib/forms.js'
import EndpointTag from './EndpointTag.jsx'
import { Facts, Pager, Problem, Raw, StatusBadge } from './Screen.jsx'
import { Badge, Button, Card, Empty, Field, Input, Modal, TextArea } from './ui/Kit.jsx'
import Select from './ui/Select.jsx'

/**
 * What the Tenant Admin's and the Super Admin's notification screens share. They call the same eight
 * endpoints under two prefixes — /api/tenant/notifications (the caller's own tenant) and
 * /api/super-admin/tenants/{tenantId}/notifications — so every piece takes a `scope`:
 *
 *   { ids: { create, list, get, update, status, attachment-put, attachment-delete, attachment-get },
 *     pathParams: {} | { tenantId }, platform: boolean, detailPath(id), memberSources: [{ endpointId, query }] }
 *
 * (built in notificationScopes.js).
 *
 * Nothing here decides who may do what. A Tenant Admin can try to edit a Super Admin's
 * notification, a USER id from another tenant can be typed in, and the backend's refusal is shown.
 */

const id = (scope, action) => scope.ids[action]

const AUDIENCE_OPTIONS = [
  { value: 'SELECTED', label: 'Selected members' },
  { value: 'TENANT', label: 'Everyone in the organization' },
]

/** File types the backend accepts — it checks the content, not this list. */
const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx'

export function AudienceBadge({ audience }) {
  if (!audience) return null
  return <Badge tone="brand" title={audience}>{audience === 'TENANT' ? 'Everyone' : 'Selected'}</Badge>
}

export function ReadBadge({ read }) {
  return <Badge tone={read ? 'good' : 'warn'}>{read ? 'Read' : 'Unread'}</Badge>
}

/** The body exactly as written: plain text, never HTML. */
export function NotificationBody({ subject, body }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 className="notification-subject">{subject}</h3>
      <p className="notification-body">{body}</p>
    </div>
  )
}

/**
 * The attachment as a download link. A plain link, not a fetch: the browser sends the session cookie
 * and saves the file (local storage) or follows the 302 to S3's presigned URL — a fetch could do
 * neither. So the download does not appear in History.
 */
export function AttachmentDownload({ attachment, endpointId, pathParams }) {
  const { environment } = useApiState()
  if (!attachment) return <p className="muted">No attachment.</p>
  const href = buildCall(endpointId, { pathParams }, environment).prepared.url
  return (
    <div className="toolbar" style={{ gap: 10 }}>
      <a className="btn" href={href} download={attachment.fileName}>
        <Download size={13} /> {attachment.fileName}
      </a>
      <span className="muted">{attachment.contentType} · {formatBytes(attachment.sizeBytes)}</span>
      <span className="toolbar-spacer" />
      <EndpointTag id={endpointId} name="Download" pathParams={pathParams} />
    </div>
  )
}

// ==================== members to choose from ====================

const ELIGIBLE = ['INVITED', 'ACTIVE']

/**
 * Checkboxes for the tenant's members, plus a box for ids typed by hand (another tenant's, a made-up
 * one) to see the backend refuse them. Reads at most two lists — the Super Admin's members are split
 * across /users and /admins. Only INVITED and ACTIVE members can be chosen, as the backend requires.
 */
export function RecipientPicker({ scope, value, onChange, exclude = [] }) {
  const [search, setSearch] = useState('')
  const [typed, setTyped] = useState('')
  const [first, second] = scope.memberSources
  const query = (source) => ({ ...source.query, search: search.trim() || undefined, page: 0, size: 100 })
  const one = useRead(first.endpointId, { query: query(first), label: 'Members to notify' })
  const two = useRead(second?.endpointId ?? first.endpointId, { query: second ? query(second) : query(first), label: 'Members to notify', skip: !second })
  const people = [...(one.data?.content ?? []), ...(second ? two.data?.content ?? [] : [])]
    .filter((person, index, all) => all.findIndex((other) => other.id === person.id) === index)
    .filter((person) => !exclude.includes(person.id))
  const chosen = new Set(value)
  const toggle = (personId) => onChange(chosen.has(personId) ? value.filter((one) => one !== personId) : [...value, personId])
  const addTyped = () => {
    const ids = typed.split(/[\s,]+/).map((one) => one.trim()).filter(Boolean)
    onChange([...new Set([...value, ...ids])])
    setTyped('')
  }
  const failed = [one, second ? two : null].find((read) => read?.result && !read.result.ok)

  return (
    <div className="stack" style={{ gap: 10 }}>
      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search members by name or email"
             aria-label="Search members" />
      {failed ? <Problem result={failed.result} onRetry={failed.reload} /> : (
        <div className="recipient-list" role="group" aria-label="Members">
          {people.length ? people.map((person) => {
            const eligible = ELIGIBLE.includes(person.status)
            return (
              <label key={person.id} className="feature-row check" data-disabled={eligible ? undefined : 'true'}>
                <input type="checkbox" checked={chosen.has(person.id)} disabled={!eligible && !chosen.has(person.id)}
                       onChange={() => toggle(person.id)} />
                <span className="feature-main">
                  <span className="feature-name">{person.name || person.email}</span>
                  <span className="feature-desc">{person.email} · {person.effectiveRole ?? person.role ?? '—'} · {person.status}
                    {eligible ? '' : ' — cannot receive notifications'}</span>
                </span>
              </label>
            )
          }) : <p className="muted">{one.loading ? 'Reading the members…' : 'No member matches.'}</p>}
        </div>
      )}
      <div className="toolbar" style={{ gap: 8 }}>
        <Input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Or type user ids, comma separated"
               aria-label="User ids" className="input mono" />
        <Button icon={Plus} onClick={addTyped} disabled={!typed.trim()}>Add ids</Button>
      </div>
      <p className="muted">{value.length ? `${value.length} chosen: ` : 'Nobody chosen yet.'}
        {value.length ? <span className="mono">{value.join(', ')}</span> : null}</p>
    </div>
  )
}

// ==================== compose ====================

const NEW_NOTIFICATION = { subject: '', body: '', audience: 'SELECTED' }

/**
 * POST …/notifications. JSON without a file; multipart/form-data with one — a "notification" JSON
 * part and an "attachment" file part, the shape the backend's @RequestPart reads.
 */
export function ComposeNotification({ scope, open, onClose, onCreated }) {
  const { call } = useApi()
  const [form, setForm] = useState(NEW_NOTIFICATION)
  const [userIds, setUserIds] = useState([])
  const [file, setFile] = useState(null)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })
  const body = { ...form, ...(form.audience === 'SELECTED' ? { userIds } : {}) }

  const submit = async () => {
    setBusy(true)
    const options = file
      ? { form: [{ name: 'notification', json: body }, { name: 'attachment', file }] }
      : { body }
    const result = await call(id(scope, 'create'), { ...options, pathParams: scope.pathParams, label: 'Send a notification' })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) {
      setForm(NEW_NOTIFICATION)
      setUserIds([])
      setFile(null)
      onCreated(result.bodyJson)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      preview={file ? { ...body, '(attachment)': `${file.name}, ${formatBytes(file.size)} — sent as multipart` } : body}
      title="Send a notification"
      description={scope.platform
        ? 'To members of the organization chosen above — never platform-wide.'
        : 'To members of your organization. Selected members, or everyone who is a member when it is sent.'}
      endpoint={<EndpointTag id={id(scope, 'create')} name="Send" look="primary" pathParams={scope.pathParams} />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button look="primary" busy={busy} onClick={submit}>Send</Button>
        </>
      }
    >
      <div className="stack">
        {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
        <Field label="Subject" required hint="At most 200 characters." error={refusal.fields.subject}>
          <Input value={form.subject} maxLength={200} error={refusal.fields.subject} onChange={set('subject')} />
        </Field>
        <Field label="Message" required hint="Plain text, at most 10,000 characters." error={refusal.fields.body}>
          <TextArea value={form.body} rows={5} error={refusal.fields.body} onChange={set('body')} />
        </Field>
        <Field label="Audience" error={refusal.fields.audience}>
          <Select label="Audience" value={form.audience} onChange={(audience) => setForm({ ...form, audience })} options={AUDIENCE_OPTIONS} />
        </Field>
        {form.audience === 'SELECTED' ? (
          <Field label="Recipients" required hint="Each must be an INVITED or ACTIVE member of this organization.">
            <RecipientPicker scope={scope} value={userIds} onChange={setUserIds} />
          </Field>
        ) : (
          <p className="banner">Everyone who is a member of this organization now. People who join later do not receive it.</p>
        )}
        <Field label="Attachment" hint="Optional. PDF, PNG, JPEG, DOCX or XLSX, up to 10 MB — the backend checks the content.">
          <input className="input" type="file" accept={ATTACHMENT_ACCEPT} aria-label="Attachment"
                 onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </Field>
      </div>
    </Modal>
  )
}

// ==================== the list ====================

const FIRST = { status: '', audience: '', page: 0 }

export function NotificationList({ scope }) {
  const navigate = useNavigate()
  const [filters, setFilters] = useState(FIRST)
  const [composing, setComposing] = useState(false)
  const query = { status: filters.status || undefined, audience: filters.audience || undefined, page: filters.page, size: 20 }
  const read = useRead(id(scope, 'list'), { pathParams: scope.pathParams, query, label: 'List notifications' })
  const set = (key) => (value) => setFilters({ ...filters, [key]: value, page: 0 })
  const rows = read.data?.content ?? []

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <Select label="Status filter" value={filters.status} onChange={set('status')}
                options={[{ value: '', label: 'Active and archived' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} />
        <Select label="Audience filter" value={filters.audience} onChange={set('audience')}
                options={[{ value: '', label: 'Any audience' }, ...AUDIENCE_OPTIONS]} />
        <span className="toolbar-spacer" />
        <EndpointTag id={id(scope, 'list')} name="The list, as filtered" pathParams={scope.pathParams} query={query} />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
        <Button look="primary" icon={Plus} onClick={() => setComposing(true)}>Send a notification</Button>
      </div>

      {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : rows.length ? (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Audience</th>
                  <th>Status</th>
                  <th className="num">Read</th>
                  <th>From</th>
                  <th>Sent</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id}>
                    <td>
                      {n.attachment ? <Paperclip size={12} aria-label="Has an attachment" /> : null} {n.subject}
                    </td>
                    <td><AudienceBadge audience={n.audience} /></td>
                    <td><StatusBadge status={n.status} /></td>
                    <td className="num">{n.audience === 'TENANT' ? n.readCount : `${n.readCount} / ${n.recipientCount}`}</td>
                    <td><Badge tone={n.createdByRole === 'SUPER_ADMIN' ? 'warn' : undefined}>{n.createdByRole}</Badge></td>
                    <td className="muted">{when(n.createdAt)}</td>
                    <td><Link className="btn" to={scope.detailPath(n.id)}>Open <ChevronRight size={13} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager data={read.data} onPage={(page) => setFilters({ ...filters, page })} />
        </>
      ) : (
        <Empty title={read.loading ? 'Reading the notifications…' : 'No notifications'}
               description={read.loading ? null : 'Send one, or change the filters.'} />
      )}

      <ComposeNotification
        scope={scope}
        open={composing}
        onClose={() => setComposing(false)}
        onCreated={(created) => { setComposing(false); navigate(scope.detailPath(created.id)) }}
      />
    </>
  )
}

// ==================== one notification ====================

/** Everything an administrator can do with one notification. */
export function NotificationManager({ scope, notificationId }) {
  const pathParams = { ...scope.pathParams, notificationId }
  const read = useRead(id(scope, 'get'), { pathParams, label: 'Open a notification' })
  const n = read.data
  const fromPlatform = n?.createdByRole === 'SUPER_ADMIN' && !scope.platform

  return (
    <div className="stack">
      <Card title="The notification" action={<EndpointTag id={id(scope, 'get')} name="Open" pathParams={pathParams} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : n ? (
          <div className="stack">
            {fromPlatform ? (
              <p className="banner" data-tone="warn">Sent by the platform (Super Admin). You can read it here; the backend refuses any change you try (403).</p>
            ) : null}
            {n.status === 'ARCHIVED' ? <p className="banner" data-tone="warn">Archived: no member sees it any more, and it cannot be changed.</p> : null}
            <NotificationBody subject={n.subject} body={n.body} />
            <Facts rows={[
              ['Status', <StatusBadge key="s" status={n.status} />],
              ['Audience', <AudienceBadge key="a" audience={n.audience} />],
              n.audience === 'TENANT'
                ? ['Read by', `${n.readCount} of ${n.eligibleCount} members it reaches`]
                : ['Read by', `${n.readCount} of ${n.recipientCount} recipients`],
              ['Sent by', <span key="c"><Badge>{n.createdByRole}</Badge> <span className="mono">{n.createdBy}</span></span>],
              ['Sent', when(n.createdAt)],
              ['Updated', when(n.updatedAt)],
              ['Archived', when(n.archivedAt)],
              ['Notification id', <span key="i" className="mono">{n.id}</span>],
            ]} />
            <Raw data={n} />
          </div>
        ) : <Empty title="Reading the notification…" />}
      </Card>

      {n ? (
        <>
          {n.audience === 'SELECTED' ? (
            <Card title="Recipients" description="Each recipient's own read state. Tick to remove; add more below. Everyone else keeps their state.">
              <Recipients scope={scope} notification={n} pathParams={pathParams} onDone={read.reload} />
            </Card>
          ) : (
            <Card title="Recipients" description="Everyone in the organization who joined on or before it was sent. Each member's read state is their own receipt.">
              <p className="muted">{n.readCount} of {n.eligibleCount} have read it.</p>
            </Card>
          )}
          <Card title="Edit" description="Only the fields you change are sent.">
            <EditNotification key={n.updatedAt} scope={scope} notification={n} pathParams={pathParams} onDone={read.reload} />
          </Card>
          <Card title="Attachment">
            <AttachmentManager scope={scope} notification={n} pathParams={pathParams} onDone={read.reload} />
          </Card>
          <Card title="Archive" description="Removes it from every inbox and unread count. It stays here, and is never deleted or reactivated.">
            <ArchiveNotification scope={scope} notification={n} pathParams={pathParams} onDone={read.reload} />
          </Card>
        </>
      ) : null}
    </div>
  )
}

function Recipients({ scope, notification, pathParams, onDone }) {
  const { call } = useApi()
  const [remove, setRemove] = useState([])
  const [add, setAdd] = useState([])
  const [refusal, setRefusal] = useState(null)
  const [busy, setBusy] = useState(false)
  const users = notification.users ?? []
  const toggle = (userId) => setRemove(remove.includes(userId) ? remove.filter((one) => one !== userId) : [...remove, userId])

  const save = async () => {
    setBusy(true)
    const body = { ...(add.length ? { addUserIds: add } : {}), ...(remove.length ? { removeUserIds: remove } : {}) }
    const result = await call(id(scope, 'update'), { pathParams, body, label: 'Change recipients' })
    setBusy(false)
    setRefusal(refusalOf(result).message)
    if (result.ok) {
      setAdd([])
      setRemove([])
      onDone()
    }
  }

  return (
    <div className="stack">
      {refusal ? <p className="banner" data-tone="bad">{refusal}</p> : null}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr><th>Remove</th><th>Name</th><th>Email</th><th>Read</th><th>Read at</th><th>User id</th></tr>
          </thead>
          <tbody>
            {users.map((r) => (
              <tr key={r.userId}>
                <td><input type="checkbox" aria-label={`Remove ${r.name || r.userId}`} checked={remove.includes(r.userId)} onChange={() => toggle(r.userId)} /></td>
                <td>{r.name || '—'}</td>
                <td className="mono">{r.email || '—'}</td>
                <td><ReadBadge read={r.readStatus} /></td>
                <td className="muted">{when(r.readAt) || '—'}</td>
                <td className="mono">{r.userId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="raw">
        <summary>Add recipients</summary>
        <div style={{ marginTop: 10 }}>
          <RecipientPicker scope={scope} value={add} onChange={setAdd} exclude={users.map((r) => r.userId)} />
        </div>
      </details>
      <div className="toolbar">
        <span className="toolbar-spacer" />
        <EndpointTag id={id(scope, 'update')} name="Edit" pathParams={pathParams} />
        <Button look="primary" icon={Save} busy={busy} disabled={!add.length && !remove.length} onClick={save}>
          Save recipients{add.length || remove.length ? ` (+${add.length} / −${remove.length})` : ''}
        </Button>
      </div>
    </div>
  )
}

function EditNotification({ scope, notification, pathParams, onDone }) {
  const { call } = useApi()
  const [form, setForm] = useState({ subject: notification.subject, body: notification.body })
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const body = Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== notification[key]))
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  const save = async () => {
    setBusy(true)
    const result = await call(id(scope, 'update'), { pathParams, body, label: 'Edit a notification' })
    setBusy(false)
    setRefusal(refusalOf(result))
    if (result.ok) onDone()
  }

  return (
    <div className="stack">
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <Field label="Subject" error={refusal.fields.subject}>
        <Input value={form.subject} maxLength={200} error={refusal.fields.subject} onChange={set('subject')} />
      </Field>
      <Field label="Message" error={refusal.fields.body}>
        <TextArea value={form.body} rows={5} error={refusal.fields.body} onChange={set('body')} />
      </Field>
      <div className="toolbar">
        <span className="toolbar-spacer" />
        <EndpointTag id={id(scope, 'update')} name="Edit" pathParams={pathParams} />
        <Button look="primary" icon={Save} busy={busy} disabled={!Object.keys(body).length} onClick={save}>Save changes</Button>
      </div>
    </div>
  )
}

function AttachmentManager({ scope, notification, pathParams, onDone }) {
  const { call } = useApi()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(null)
  const [refusal, setRefusal] = useState(null)

  const run = async (which, options, label) => {
    setBusy(which)
    const result = await call(id(scope, which), { pathParams, label, ...options })
    setBusy(null)
    setRefusal(refusalOf(result).message)
    if (result.ok) {
      setFile(null)
      onDone()
    }
  }

  return (
    <div className="stack">
      {refusal ? <p className="banner" data-tone="bad">{refusal}</p> : null}
      <AttachmentDownload attachment={notification.attachment} endpointId={id(scope, 'attachment-get')} pathParams={pathParams} />
      <div className="toolbar" style={{ gap: 8 }}>
        <input className="input" type="file" accept={ATTACHMENT_ACCEPT} aria-label="New attachment"
               onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <Button icon={Upload} busy={busy === 'attachment-put'} disabled={!file}
                onClick={() => run('attachment-put', { form: [{ name: 'attachment', file }] }, 'Replace the attachment')}>
          {notification.attachment ? 'Replace' : 'Attach'}
        </Button>
        <Button icon={Trash2} busy={busy === 'attachment-delete'} disabled={!notification.attachment}
                onClick={() => run('attachment-delete', {}, 'Remove the attachment')}>Remove</Button>
        <span className="toolbar-spacer" />
        <EndpointTag id={id(scope, 'attachment-put')} name="Replace" pathParams={pathParams} />
        <EndpointTag id={id(scope, 'attachment-delete')} name="Remove" pathParams={pathParams} />
      </div>
    </div>
  )
}

function ArchiveNotification({ scope, notification, pathParams, onDone }) {
  const { call } = useApi()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const archive = async () => {
    setBusy(true)
    const body = { status: 'ARCHIVED', ...(reason.trim() ? { reason: reason.trim() } : {}) }
    const result = await call(id(scope, 'status'), { pathParams, body, label: 'Archive a notification' })
    setBusy(false)
    if (result.ok) onDone()
  }

  return (
    <div className="stack">
      <Field label="Reason" hint="Optional; goes to the audit trail.">
        <Input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="toolbar">
        <span className="toolbar-spacer" />
        <EndpointTag id={id(scope, 'status')} name="Archive" pathParams={pathParams} />
        <Button icon={Archive} busy={busy} onClick={archive}>
          {notification.status === 'ARCHIVED' ? 'Archive again (no change)' : 'Archive'}
        </Button>
      </div>
    </div>
  )
}
