import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { useApi } from '../api/apiContext.js'
import { ROLE_FILTERS, USER_STATUSES } from '../config/enums.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import EndpointTag from './EndpointTag.jsx'
import { Facts, Pager, Problem, StatusBadge } from './Screen.jsx'
import { refusalOf, when } from '../lib/forms.js'
import { Badge, Button, Empty, Field, TextArea } from './ui/Kit.jsx'
import Select from './ui/Select.jsx'

/**
 * What the tenant admin's and the super admin's account screens share. Three response types pass
 * through here — the tenant's UserResponse (effectiveRole, tenantId), and the platform's
 * AdminResponse and PlatformUserResponse (role, organization) — so each reader takes whichever the
 * record has rather than one screen per shape.
 */

export function UserFilters({ filters, onChange, withTenant, withRole = true, label = 'users' }) {
  const set = (key) => (value) => onChange({ ...filters, [key]: value, page: 0 })
  return (
    <div className="toolbar" style={{ marginBottom: 14 }}>
      <span className="search search-sm">
        <Search size={15} className="search-icon" aria-hidden="true" />
        <input
          className="search-input"
          value={filters.search}
          onChange={(event) => set('search')(event.target.value)}
          placeholder="Search name or email"
          aria-label={`Search ${label}`}
        />
      </span>
      {withTenant ? (
        <input
          className="input mono tenant-filter"
          value={filters.tenantId}
          onChange={(event) => set('tenantId')(event.target.value)}
          placeholder="tenantId"
          aria-label="Tenant id"
        />
      ) : null}
      <Select label="Status" value={filters.status} onChange={set('status')}
              options={[{ value: '', label: 'Any status' }, ...USER_STATUSES]} />
      {withRole ? (
        <Select label="Role" value={filters.role} onChange={set('role')}
                options={[{ value: '', label: 'Any role' }, ...ROLE_FILTERS]} />
      ) : null}
    </div>
  )
}

/** A page of users, each opening at its own address. */
export function UserTable({ read, detailPath, showTenant, onPage, noun = 'user' }) {
  if (read.result && !read.result.ok) return <Problem result={read.result} onRetry={read.reload} />
  const rows = read.data?.content ?? []
  if (!rows.length) {
    return <Empty title={read.loading ? `Reading the ${noun}s…` : `No ${noun} matches`} description={read.loading ? null : 'Change the filters or the search.'} />
  }
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Linked</th>
              <th>Modules</th>
              {showTenant ? <th>Organization</th> : null}
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id}>
                <td>{user.name || '—'}</td>
                <td className="mono">{user.email}</td>
                <td>{roleOf(user) ? <Badge tone="brand">{roleOf(user)}</Badge> : '—'}</td>
                <td><StatusBadge status={user.status} /></td>
                <td className="muted">{user.linked ? 'yes' : 'not yet'}</td>
                <td className="muted" title={user.moduleAccess?.join(', ')}>{user.moduleAccess ? `${user.moduleAccess.length} of 6` : '—'}</td>
                {showTenant ? <td>{organizationOf(user)}</td> : null}
                <td className="muted">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</td>
                <td>
                  <Link className="btn" to={detailPath(user.id)}>Open <ChevronRight size={13} /></Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager data={read.data} onPage={onPage} />
    </>
  )
}

/** The role, whichever response it came from. */
function roleOf(user) {
  return user.effectiveRole ?? user.role ?? null
}

/** "Org alpha · alpha" from a platform response, or the bare tenant id from a tenant one. */
function organizationOf(user) {
  const org = user.organization
  if (org?.name) return <>{org.name} <span className="mono muted">{org.subdomain}</span></>
  const id = org?.id ?? user.tenantId
  return id ? <span className="mono muted">{id}</span> : <span className="muted">platform</span>
}

/** An account as labelled values. */
export function UserFacts({ user }) {
  return (
    <Facts rows={[
      ['Role', roleOf(user) ? <Badge key="r" tone="brand">{roleOf(user)}</Badge> : '—'],
      ['Status', <StatusBadge key="s" status={user.status} />],
      ['Linked to Cognito', user.linked ? 'yes' : 'not yet — invitation pending'],
      ['Email', <span key="e" className="mono">{user.email}</span>],
      ['Phone', user.phoneNumber],
      ['Stored roles', user.roles?.join(', ')],
      ['Organization', user.organization || user.tenantId ? <span key="t">{organizationOf(user)}</span> : 'none (platform account)'],
      user.moduleAccess ? ['Modules', user.moduleAccess.length ? user.moduleAccess.join(', ') : 'none', true] : null,
      user.modulePermissions ? ['Module permissions', user.modulePermissions.length ? user.modulePermissions.join(', ') : 'none', true] : null,
      ['Status reason', user.statusReason],
      ['Invited', when(user.invitedAt)],
      ['Activated', when(user.activatedAt)],
      ['Deactivated', when(user.deactivatedAt)],
      ['Created', when(user.createdAt)],
      ['Updated', when(user.updatedAt)],
      ['User id', <span key="i" className="mono">{user.id}</span>],
    ]} />
  )
}

/**
 * The status change, which both admin APIs take as { status, reason }.
 *
 * Only the moves the user's current status allows are offered — an INVITED user cannot be made
 * ACTIVE (that happens at their first sign-in) or SUSPENDED (deactivate revokes an invitation) —
 * because offering them would be buttons whose only outcome is 409. The reason is asked for
 * before sending where the backend requires one, rather than letting it answer 400.
 *
 * Suspending or deactivating (removing access) is confirmed first. `lastAdminOption` (the Super
 * Admin's administrator route only) adds the explicit acknowledgement the backend needs to remove an
 * organization's only active administrator (confirmNoActiveAdmin).
 */
export function StatusChange({ user, endpointId, pathParams, onDone, lastAdminOption }) {
  const { call } = useApi()
  const targets = user.status === 'INVITED'
    ? ['DEACTIVATED']
    : ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].filter((one) => one !== user.status)
  const [status, setStatus] = useState(targets[0])
  const [reason, setReason] = useState('')
  const [noActiveAdmin, setNoActiveAdmin] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })

  const needsReason = status === 'SUSPENDED' || status === 'DEACTIVATED'
  const look = status === 'ACTIVE' ? 'primary' : 'danger'
  const body = {
    status,
    ...(reason.trim() ? { reason: reason.trim() } : {}),
    ...(lastAdminOption && needsReason && noActiveAdmin ? { confirmNoActiveAdmin: true } : {}),
  }

  const submit = async () => {
    setBusy(true)
    const result = await call(endpointId, { label: `Make the user ${status}`, pathParams, body })
    setBusy(false)
    setRefusal(refusalOf(result))
    setConfirming(false)
    if (result.ok) {
      setReason('')
      setNoActiveAdmin(false)
      onDone?.()
    }
  }

  if (!targets.length) return <p className="muted">No status change is available.</p>

  return (
    <div className="stack" style={{ gap: 12 }}>
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <div className="field-grid">
        <Field label="New status" required error={refusal.fields.status}>
          <Select label="New status" value={status} onChange={setStatus} options={targets} />
        </Field>
        <Field
          label={needsReason ? 'Reason' : 'Reason — optional'}
          required={needsReason}
          hint="≤500 characters. Stored as statusReason."
          error={refusal.fields.reason}
        >
          <TextArea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
        </Field>
      </div>
      {lastAdminOption && needsReason ? (
        <label className="check">
          <input type="checkbox" checked={noActiveAdmin} onChange={(event) => setNoActiveAdmin(event.target.checked)} />
          <span>If this is the organization&apos;s only active administrator, remove them anyway (e.g. a compromised account) — then invite a replacement.</span>
        </label>
      ) : null}
      <div className="toolbar">
        <Button look={look} busy={busy} disabled={needsReason && !reason.trim()} onClick={() => (needsReason ? setConfirming(true) : submit())}>
          Make {status}
        </Button>
        <EndpointTag id={endpointId} name="Change status" look={look} pathParams={pathParams} />
        {needsReason && !reason.trim() ? <span className="muted">A reason is required to {status === 'SUSPENDED' ? 'suspend' : 'deactivate'}.</span> : null}
      </div>
      <ConfirmDialog
        open={confirming}
        title={status === 'DEACTIVATED' ? `Remove ${user.name || user.email}'s access?` : `Suspend ${user.name || user.email}?`}
        message={status === 'DEACTIVATED'
          ? 'Deactivated: they can no longer sign in or use the application. Their Cognito account is signed out and disabled. The record and its history are kept, and they can be reactivated.'
          : 'Suspended: they are signed out and refused until reactivated. Nothing is deleted.'}
        confirmLabel={status === 'DEACTIVATED' ? 'Remove access' : 'Suspend'}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
        endpoint={<EndpointTag id={endpointId} name="Change status" look="danger" pathParams={pathParams} />}
      >
        <p className="muted mono">{JSON.stringify(body)}</p>
      </ConfirmDialog>
    </div>
  )
}
