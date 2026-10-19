import { useState } from 'react'
import { Ban, Save } from 'lucide-react'
import { useApi } from '../api/apiContext.js'
import EndpointTag from './EndpointTag.jsx'
import { Problem } from './Screen.jsx'
import { Badge, Button, Empty } from './ui/Kit.jsx'
import { refusalOf } from '../lib/forms.js'
import { assignmentOf, sameAssignment } from '../lib/modules.js'

/**
 * Module access, as the backend defines it: six application modules, each with its own permissions.
 *
 * NOTHING HERE IS THE SOURCE OF TRUTH. The modules, their permissions and the role defaults come from
 * GET /api/modules (`catalogue`); what a user has comes from the backend's module views. These parts
 * only show and edit, and the backend validates every change — it refuses a permission of another
 * module (400), one the signed-in administrator does not hold (403), and anything on their own account.
 *
 * A value is { modules: [moduleId], permissions: [permissionId] } (helpers in lib/modules.js).
 */

/**
 * Checkboxes, module by module: a module's own box assigns it, and its permissions are listed under it.
 * Unassigning a module drops its permissions; ticking a permission assigns its module. A permission
 * outside `scope` (when given) is shown but cannot be changed — the backend would refuse it.
 * `status` (optional) is the backend's per-module view, to mark the modules the account can use now.
 * Nothing here disables a module or a permission because of the organization's plan.
 * `moduleAction(module)` (optional) renders extra controls in a module's header.
 */
export function ModuleEditor({ catalogue, value, onChange, scope, status, disabled, moduleAction }) {
  if (!catalogue) return <p className="muted">Reading the module catalogue…</p>
  const inScope = (id) => !scope || scope.includes(id)
  const has = (list, id) => list.includes(id)

  const toggleModule = (module) => {
    if (has(value.modules, module.id)) {
      const own = module.permissions.map((permission) => permission.id)
      onChange({
        modules: value.modules.filter((id) => id !== module.id),
        permissions: value.permissions.filter((id) => !own.includes(id)),
      })
    } else {
      onChange({ ...value, modules: [...value.modules, module.id] })
    }
  }

  const togglePermission = (module, id) => {
    if (has(value.permissions, id)) {
      onChange({ ...value, permissions: value.permissions.filter((one) => one !== id) })
    } else {
      onChange({
        modules: has(value.modules, module.id) ? value.modules : [...value.modules, module.id],
        permissions: [...value.permissions, id],
      })
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <ScopeNotice catalogue={catalogue} scope={scope} />
      <div className="module-list">
        {catalogue.map((module) => {
          const assigned = has(value.modules, module.id)
          const view = status?.find((one) => one.moduleId === module.id)
          return (
            <section key={module.id} className="module-block" data-assigned={assigned || undefined}>
              <div className="module-head">
                <label className="check">
                  <input type="checkbox" checked={assigned} disabled={disabled} onChange={() => toggleModule(module)} />
                  <span className="feature-name">{module.name}</span>
                </label>
                <span className="muted">{module.label}</span>
                {!module.requirementsDocumented ? <Badge tone="warn" title="No requirements documented yet">provisional</Badge> : null}
                {view?.available ? <Badge tone="good">available</Badge> : null}
                <span className="toolbar-spacer" />
                {moduleAction ? moduleAction(module, assigned) : null}
              </div>
              <div className="module-perms divide">
                {module.permissions.map((permission) => {
                  const allowed = inScope(permission.id)
                  return (
                    <label
                      key={permission.id}
                      className="feature-row check"
                      data-disabled={!allowed || undefined}
                      title={allowed ? undefined : 'You do not hold this permission, so you cannot grant or remove it.'}
                    >
                      <input
                        type="checkbox"
                        checked={has(value.permissions, permission.id)}
                        disabled={disabled || !allowed}
                        onChange={() => togglePermission(module, permission.id)}
                      />
                      <span className="feature-main">
                        <span className="feature-name mono">{permission.id}</span>
                        <span className="feature-desc">{permission.label} — {permission.description}</span>
                      </span>
                      {permission.defaultFor?.length ? <span className="muted">default: {permission.defaultFor.join(', ')}</span> : null}
                    </label>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Why some permissions are locked: an administrator gives (or removes) only the module permissions
 * they hold themselves. Nothing is shown when nothing is locked.
 */
function ScopeNotice({ catalogue, scope }) {
  if (!scope) return null
  const all = catalogue.flatMap((module) => module.permissions.map((permission) => permission.id))
  const held = all.filter((id) => scope.includes(id)).length
  if (held === all.length) return null
  if (held === 0) {
    return (
      <p className="banner" data-tone="warn">
        You hold no module permission yourself, so you cannot give or remove any here: an administrator grants only the
        module permissions they hold. Your own modules must be assigned first — by a Super Admin (Super admin › Administrators ›
        your account › Modules), or by another administrator of your organization who holds them.
      </p>
    )
  }
  return (
    <p className="muted">
      You hold {held} of {all.length} module permissions. Only those can be given or removed here; the others are locked.
      A Super Admin can give you more.
    </p>
  )
}

/**
 * Read only: what /api/users/me reports — the ids of the modules the account can use now and one flat
 * list of its module permissions. Each permission is shown under its module (a permission id starts
 * with its module's id); names and labels come from the catalogue when it is given.
 */
export function ModuleSummary({ modules, permissions, catalogue, empty = 'No module is available.' }) {
  if (!modules?.length) return <p className="muted">{empty}</p>
  return (
    <div className="module-list">
      {modules.map((id) => {
        const module = catalogue?.find((one) => one.id === id)
        const own = (permissions ?? []).filter((permission) => permission.startsWith(`${id}_`))
        return (
          <section key={id} className="module-block" data-assigned>
            <div className="module-head">
              <span className="feature-name">{module?.name ?? id}</span>
              {module ? <span className="muted">{module.label}</span> : null}
              <span className="toolbar-spacer" />
              <Badge tone="good">available</Badge>
            </div>
            <div className="chip-row module-perms">
              {own.length
                ? own.map((permission) => <Badge key={permission} tone="brand">{permission}</Badge>)
                : <span className="muted">No permission in this module.</span>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/**
 * An account's module access with its editor, for an administrator: reads it (`read`, a useRead of
 * the GET), saves the whole assignment (PUT), saves or revokes one module (PUT / DELETE on the
 * module's own address), and reloads after every change so the screen shows what was stored.
 */
export function ModuleAccessEditor({ read, catalogue, endpoints, pathParams, scope, locked, lockedReason }) {
  const access = read.data
  if (read.result && !read.result.ok) return <Problem result={read.result} onRetry={read.reload} />
  if (!access || !catalogue) return <Empty title="Reading the module access…" />
  return (
    <EditAssignment
      key={JSON.stringify(assignmentOf(access))}
      access={access}
      catalogue={catalogue}
      endpoints={endpoints}
      pathParams={pathParams}
      scope={scope}
      locked={locked}
      lockedReason={lockedReason}
      onDone={read.reload}
    />
  )
}

function EditAssignment({ access, catalogue, endpoints, pathParams, scope, locked, lockedReason, onDone }) {
  const { call } = useApi()
  const stored = assignmentOf(access)
  const [value, setValue] = useState(stored)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(null)
  const unchanged = sameAssignment(value, stored)

  const run = async (key, endpointId, label, extra) => {
    setBusy(key)
    const result = await call(endpointId, { label, ...extra })
    setBusy(null)
    setRefusal(refusalOf(result))
    if (result.ok) onDone()
  }

  const saveAll = () => run('all', endpoints.setAll, 'Set module access', { pathParams, body: value })
  const saveOne = (module) => run(module.id, endpoints.setOne, `Set ${module.name}`, {
    pathParams: { ...pathParams, moduleId: module.id },
    body: { permissions: value.permissions.filter((id) => id.startsWith(`${module.id}_`)) },
  })
  const revokeOne = (module) => run(module.id, endpoints.revokeOne, `Revoke ${module.name}`, {
    pathParams: { ...pathParams, moduleId: module.id },
  })

  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="muted">
        {access.assignedAt ? `Last assigned ${new Date(access.assignedAt).toLocaleString()}.` : 'Never assigned.'}{' '}
        {!access.active
          ? 'The account cannot use modules now: it is not active, or its organization is not ACTIVE.'
          : access.assignedModules.length === 0
            ? 'No module is assigned to this account yet, so it has no module permission.'
            : `The account is active: ${access.effectiveModules.length} of ${access.assignedModules.length} assigned modules are available, with ${access.effectivePermissions.length} module permissions.`}
      </p>
      {!access.assignedAt && access.assignedModules.length === 0 ? (
        <p className="banner">
          This account was created before modules were assigned by default, and nobody has assigned any since.
          Tick the modules and permissions below and save to assign them.
        </p>
      ) : null}
      {locked ? <p className="banner" data-tone="warn">{lockedReason}</p> : null}
      {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
      <ModuleEditor
        catalogue={catalogue}
        value={value}
        onChange={setValue}
        scope={scope}
        status={access.modules}
        disabled={locked}
        moduleAction={(module, assigned) => (locked ? null : (
          <>
            <Button icon={Save} busy={busy === module.id} disabled={!assigned} onClick={() => saveOne(module)}>Save module</Button>
            <Button look="danger" icon={Ban} busy={busy === module.id} disabled={!stored.modules.includes(module.id)} onClick={() => revokeOne(module)}>
              Revoke
            </Button>
          </>
        ))}
      />
      {refusal.fields.modules || refusal.fields.permissions
        ? <p className="field-error">{refusal.fields.modules || refusal.fields.permissions}</p> : null}
      <div className="toolbar">
        <Button look="primary" busy={busy === 'all'} disabled={locked || unchanged} onClick={saveAll}>Save all modules</Button>
        <EndpointTag id={endpoints.setAll} name="Set all" look="primary" pathParams={pathParams} />
        <EndpointTag id={endpoints.setOne} name="Set one" pathParams={{ ...pathParams, moduleId: 'FACTURAFLOW' }} />
        <EndpointTag id={endpoints.revokeOne} name="Revoke one" pathParams={{ ...pathParams, moduleId: 'FACTURAFLOW' }} />
        {unchanged ? <span className="muted">No unsaved change.</span> : null}
      </div>
    </div>
  )
}
