/**
 * Memberships of the active company (read-only in the prototype: identities and mandates are
 * managed by the shared portal platform, PLT-02). Access is time-bound: an expired or revoked
 * membership has no permissions at all. The permission matrix is built from ROLES only.
 */
import { Check, Minus } from 'lucide-react';
import { isMembershipActive, ROLE_ORDER, ROLES, type Permission } from '../../domain/permissions';
import type { Tone } from '../../domain/status';
import { diffDays, formatDate } from '../../domain/time';
import type { Membership, RoleId } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { useCtx } from '../../store/hooks';
import { Badge, Callout, Card, DateText, EmptyState } from '../../components/ui';
import { EmployeeLink } from '../../components/bits';

/** Plain-language description of each permission code defined in domain/permissions. */
const PERMISSION_LABEL: Record<Permission, string> = {
  'time.clock_own': tKey('Registrar su propia jornada y pausas'),
  'time.view_own': tKey('Consultar sus propios registros'),
  'corrections.request_own': tKey('Solicitar correcciones de sus registros'),
  'absences.request_own': tKey('Solicitar sus propias ausencias'),
  'reports.own': tKey('Informes de sus propios registros'),
  'time.view_team': tKey('Ver los registros de su equipo'),
  'corrections.review_team': tKey('Revisar correcciones de su equipo'),
  'absences.review_team': tKey('Revisar ausencias de su equipo'),
  'anomalies.manage_team': tKey('Revisar incidencias de su equipo'),
  'shifts.manage_team': tKey('Planificar turnos de su equipo'),
  'employees.view_team': tKey('Ver las fichas de su equipo'),
  'reports.team': tKey('Informes de su equipo'),
  'time.view_all': tKey('Ver los registros de toda la empresa'),
  'corrections.review_all': tKey('Revisar correcciones de toda la empresa'),
  'corrections.propose': tKey('Proponer correcciones en nombre de la empresa'),
  'absences.view_all': tKey('Ver las ausencias de toda la empresa'),
  'absences.review_all': tKey('Revisar ausencias de toda la empresa'),
  'absences.view_sensitive': tKey('Ver la categoría de ausencias sensibles'),
  'anomalies.view_all': tKey('Ver las incidencias de toda la empresa'),
  'anomalies.manage_all': tKey('Revisar incidencias de toda la empresa'),
  'shifts.manage_all': tKey('Planificar turnos de toda la empresa'),
  'employees.view_all': tKey('Ver las fichas de toda la plantilla'),
  'employees.manage': tKey('Dar de alta, modificar y desactivar empleados'),
  'policies.view': tKey('Consultar políticas, convenios y calendarios'),
  'policies.manage': tKey('Modificar políticas, convenios, calendarios y tipos de ausencia'),
  'reports.all': tKey('Informes de toda la empresa'),
  'reports.export': tKey('Generar exportaciones'),
  'periods.close': tKey('Cerrar y reabrir periodos'),
  'audit.view': tKey('Consultar la auditoría de la empresa'),
  'settings.manage': tKey('Modificar la configuración y el protocolo de registro'),
  'records.delete_request': tKey('Solicitar la eliminación de registros (sujeta al plazo de conservación)'),
  'representative.view': tKey('Consultar registros como representación (datos minimizados)'),
};

type AccessState = 'active' | 'expired' | 'revoked' | 'future';

const ACCESS_STATE: Record<AccessState, { label: string; tone: Tone }> = {
  active: { label: tKey('Vigente'), tone: 'success' },
  expired: { label: tKey('Caducado'), tone: 'danger' },
  revoked: { label: tKey('Revocado'), tone: 'danger' },
  future: { label: tKey('Aún no vigente'), tone: 'info' },
};

function accessState(m: Membership, today: string): AccessState {
  if (m.status === 'revoked') return 'revoked';
  if (isMembershipActive(m, today)) return 'active';
  return m.validFrom && today < m.validFrom ? 'future' : 'expired';
}

export function AccessTab() {
  const ctx = useCtx();
  const members = ctx.db.memberships
    .filter((m) => m.companyId === ctx.company.id)
    .map((m) => ({ m, user: ctx.db.users.find((u) => u.id === m.userId), state: accessState(m, ctx.today) }))
    .sort((a, b) => Number(a.state !== 'active') - Number(b.state !== 'active') || (a.user?.name ?? '').localeCompare(b.user?.name ?? '', 'es'));
  const inactive = members.filter((x) => x.state !== 'active');
  const termed = members.filter((x) => Object.keys(x.m.roleValidUntil ?? {}).length > 0 || x.m.validUntil);
  const permissions = [...new Set(ROLE_ORDER.flatMap((r) => ROLES[r].permissions))];

  return (
    <div className="stack">
      <Callout tone="info" title={t('Accesos temporales y de solo lectura en el prototipo')}>
        {t('Las cuentas y los mandatos se gestionan en la plataforma común del portal. Aquí se consultan: quién accede, con qué roles y hasta cuándo. Un acceso caducado o revocado no tiene ningún permiso, y el intento de acceso queda en la auditoría.')}
      </Callout>

      {(inactive.length > 0 || termed.length > 0) && (
        <div className="grid-2">
          {inactive.length > 0 && (
            <Callout tone="danger" title={t('Accesos sin vigencia: {n}', { n: inactive.length })}>
              <ul>
                {inactive.map(({ m, user, state }) => (
                  <li key={m.id}>
                    {state === 'revoked'
                      ? t('{name}: acceso revocado el {date}', { name: user?.name ?? m.userId, date: formatDate(m.revokedAt?.slice(0, 10)) })
                      : state === 'future'
                        ? t('{name}: acceso vigente a partir del {date}', { name: user?.name ?? m.userId, date: formatDate(m.validFrom) })
                        : t('{name}: acceso caducado el {date}. No tiene ningún permiso.', { name: user?.name ?? m.userId, date: formatDate(m.validUntil) })}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {termed.length > 0 && (
            <Callout tone="neutral" title={t('Accesos con fecha de fin')}>
              <ul>
                {termed.map(({ m, user }) => (
                  <li key={m.id}>
                    {m.validUntil && t('{name}: acceso hasta el {date}', { name: user?.name ?? m.userId, date: formatDate(m.validUntil) })}
                    {(Object.entries(m.roleValidUntil ?? {}) as [RoleId, string][]).map(([r, d]) => (
                      <span key={r}>{t('{name}: rol «{role}» hasta el {date} ({days} días)', { name: user?.name ?? m.userId, role: t(ROLES[r].label), date: formatDate(d), days: Math.max(0, diffDays(ctx.today, d)) })}</span>
                    ))}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
        </div>
      )}

      <Card title={t('Usuarios con acceso a {company}', { company: ctx.company.tradeName })} flush>
        {members.length === 0 ? (
          <EmptyState title={t('No hay accesos registrados')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Usuarios y accesos')}</caption>
              <thead>
                <tr>
                  <th>{t('Usuario')}</th>
                  <th>{t('Roles')}</th>
                  <th>{t('Ficha de empleado')}</th>
                  <th>{t('Válido desde')}</th>
                  <th>{t('Válido hasta')}</th>
                  <th>{t('Estado')}</th>
                  <th>{t('Referencia del mandato')}</th>
                </tr>
              </thead>
              <tbody>
                {members.map(({ m, user, state }) => (
                  <tr key={m.id} className={state !== 'active' ? 'settings-expired' : undefined}>
                    <td>
                      <span className="strong">{user?.name ?? m.userId}</span>
                      {user && <div className="sub">{user.title}{user.organisation ? ` · ${user.organisation}` : ''}</div>}
                    </td>
                    <td>
                      <div className="status-stack">
                        {m.roles.map((r) => {
                          const until = m.roleValidUntil?.[r];
                          const expired = !!until && ctx.today > until;
                          return (
                            <Badge key={r} tone={expired ? 'danger' : 'neutral'} icon={false} title={t(ROLES[r].restriction)}>
                              {t(ROLES[r].label)}
                              {until && <span className="settings-role-term">{expired ? t('caducado el {date}', { date: formatDate(until) }) : t('hasta {date}', { date: formatDate(until) })}</span>}
                            </Badge>
                          );
                        })}
                      </div>
                    </td>
                    <td>{m.employeeId ? <EmployeeLink id={m.employeeId} /> : <span className="muted small">{t('Sin ficha de empleado')}</span>}</td>
                    <td>
                      <DateText date={m.validFrom} />
                    </td>
                    <td>{m.validUntil ? <DateText date={m.validUntil} /> : <span className="muted small">{t('Sin fecha de fin')}</span>}</td>
                    <td>
                      <Badge tone={ACCESS_STATE[state].tone}>{t(ACCESS_STATE[state].label)}</Badge>
                    </td>
                    <td className="small">{m.reference ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('Qué puede hacer cada rol')}>
        <div className="settings-roles">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="settings-role">
              <div className="strong">{t(ROLES[r].label)}</div>
              <p className="small">{t(ROLES[r].description)}</p>
              <p className="tiny muted">
                {t('Límite')}: {t(ROLES[r].restriction)}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card title={t('Matriz de permisos por rol')} flush>
        <div className="table-wrap">
          <table className="table settings-matrix">
            <caption className="sr-only">{t('Matriz de permisos por rol')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Permiso')}</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} scope="col" className="settings-matrix-role">{t(ROLES[r].label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p}>
                  <th scope="row" className="settings-matrix-perm">
                    {t(PERMISSION_LABEL[p] ?? p)}
                    <div className="sub mono">{p}</div>
                  </th>
                  {ROLE_ORDER.map((r) => {
                    const has = ROLES[r].permissions.includes(p);
                    return (
                      <td key={r} className="settings-matrix-cell">
                        {has ? <Check size={16} aria-hidden className="settings-yes" /> : <Minus size={14} aria-hidden className="muted" />}
                        <span className="sr-only">{has ? t('Sí') : t('No')}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-footer tiny muted stack-sm">
          <span>{t('Los permisos propios (fichar, solicitar correcciones y ausencias) solo se aplican si el usuario tiene una ficha de empleado en esta empresa.')}</span>
          <span>{t('Nadie revisa sus propias correcciones, ausencias o incidencias. El servidor real debe repetir todas estas comprobaciones.')}</span>
        </div>
      </Card>
    </div>
  );
}
