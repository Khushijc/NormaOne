/**
 * Module access values, as the module screens build and compare them. A value is
 * { modules: [moduleId], permissions: [permissionId] }. The catalogue (GET /api/modules) is the only
 * source of the modules, their permissions and the role defaults — nothing here hard-codes them.
 */

/** The default assignment of a new account of `role`: all six modules, the role's default permissions, within `scope`. */
export function defaultsFor(catalogue, role, scope) {
  const modules = (catalogue ?? []).map((module) => module.id)
  const permissions = (catalogue ?? []).flatMap((module) => module.permissions)
    .filter((permission) => permission.defaultFor?.includes(role))
    .filter((permission) => !scope || scope.includes(permission.id))
    .map((permission) => permission.id)
  return { modules, permissions }
}

/** The module permissions the signed-in account holds (/api/users/me modulePermissions) — the scope a Tenant Admin grants within. */
export function scopeOf(me) {
  return me?.modulePermissions ?? []
}

const normalised = (value) => ({ modules: [...(value?.modules ?? [])].sort(), permissions: [...(value?.permissions ?? [])].sort() })

/** The same value, whatever order it was built in: for "has it changed?" checks. */
export const sameAssignment = (a, b) => JSON.stringify(normalised(a)) === JSON.stringify(normalised(b))

/** The stored assignment of a backend module view (GET …/modules). */
export const assignmentOf = (access) => ({ modules: access?.assignedModules ?? [], permissions: access?.assignedPermissions ?? [] })
