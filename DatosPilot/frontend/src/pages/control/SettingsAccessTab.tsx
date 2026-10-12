import { Ban, Users } from 'lucide-react';
import { useState } from 'react';
import { EmployeeLink } from '../../components/bits';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, useAction } from '../../components/ui';
import { isMembershipActive, ROLE_ORDER, ROLES } from '../../domain/permissions';
import type { Tone } from '../../domain/status';
import { formatDate } from '../../domain/time';
import type { Membership, RoleId } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { worksiteName } from '../../services/context';
import { revokeMembership } from '../../services/opsService';
import { useCtx } from '../../store/hooks';

type AccessState = 'active' | 'revoked' | 'expired' | 'future';

const ACCESS_STATE: Record<AccessState, { label: string; tone: Tone }> = {
  active: { label: tKey('Vigente [acceso]'), tone: 'success' },
  revoked: { label: tKey('Revocado'), tone: 'danger' },
  expired: { label: tKey('Caducado'), tone: 'warning' },
  future: { label: tKey('Aún no vigente'), tone: 'info' },
};

function accessState(m: Membership, today: string): AccessState {
  if (m.status === 'revoked') return 'revoked';
  if (isMembershipActive(m, today)) return 'active';
  return m.validFrom && today < m.validFrom ? 'future' : 'expired';
}

/** Memberships of the active company. Revocation takes effect immediately and is audited. */
export function SettingsAccessTab() {
  const ctx = useCtx();
  const [revoking, setRevoking] = useState<Membership | null>(null);
  const { runOk } = useAction();
  const canEdit = ctx.can('settings.manage');

  const members = ctx.db.memberships
    .filter((m) => m.companyId === ctx.company.id)
    .map((m) => ({ m, user: ctx.db.users.find((u) => u.id === m.userId), state: accessState(m, ctx.today) }))
    .sort((a, b) => Number(a.state !== 'active') - Number(b.state !== 'active') || (a.user?.name ?? '').localeCompare(b.user?.name ?? '', 'es'));
  const scopeText = (m: Membership) => (m.worksiteScope ? m.worksiteScope.map((w) => worksiteName(ctx.db, w)).join(', ') : null);
  const providerName = (id: string | null) => (id ? ctx.db.providers.find((p) => p.id === id)?.name ?? id : null);

  return (
    <div className="stack">
      <Callout tone="info" title={t('Quién accede, con qué roles y hasta cuándo')}>
        {t('Las cuentas de usuario se crean en la plataforma común del portal. Aquí se consultan los accesos a esta empresa y se pueden revocar: la revocación es inmediata y bloquea lecturas, descargas y acciones posteriores. Un acceso caducado o revocado no tiene ningún permiso.')}
      </Callout>

      <Card flush title={<h2 className="row"><Users size={16} aria-hidden /> {t('Accesos a {company}', { company: ctx.company.tradeName })}</h2>}>
        {members.length === 0 ? (
          <EmptyState icon={Users} title={t('No hay accesos registrados')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Accesos de usuarios')}</caption>
              <thead>
                <tr>
                  <th>{t('Usuario')}</th>
                  <th>{t('Roles')}</th>
                  <th>{t('Ficha de empleado')}</th>
                  <th>{t('Proveedor')}</th>
                  <th>{t('Centros')}</th>
                  <th>{t('Vigencia [periodo]')}</th>
                  <th>{t('Referencia')}</th>
                  <th>{t('Estado')}</th>
                  {canEdit && <th><span className="sr-only">{t('Acciones')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {members.map(({ m, user, state }) => {
                  const self = m.userId === ctx.user.id;
                  return (
                    <tr key={m.id} className={state !== 'active' ? 'control-inactive' : undefined}>
                      <td>
                        <span className="strong">{user?.name ?? m.userId}</span>
                        {self && <span className="tiny muted"> ({t('usted')})</span>}
                        {user && (
                          <div className="sub">
                            {user.title}
                            {user.organisation ? ` · ${user.organisation}` : ''}
                          </div>
                        )}
                        {user && <div className="sub control-break">{user.email}</div>}
                      </td>
                      <td>
                        <div className="status-stack">
                          {[...m.roles]
                            .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b))
                            .map((r: RoleId) => {
                              const until = m.roleValidUntil?.[r];
                              const expired = !!until && ctx.today > until;
                              return (
                                <Badge key={r} tone={expired ? 'danger' : 'neutral'} icon={false} title={t(ROLES[r].restriction)}>
                                  {t(ROLES[r].label)}
                                  {until && <span className="control-role-term">{expired ? t('rol caducado el {date}', { date: formatDate(until) }) : t('rol hasta {date}', { date: formatDate(until) })}</span>}
                                </Badge>
                              );
                            })}
                        </div>
                      </td>
                      <td className="small">{m.employeeId ? <EmployeeLink id={m.employeeId} /> : <span className="muted">{t('Sin ficha')}</span>}</td>
                      <td className="small">{providerName(m.providerId) ?? <span className="muted">—</span>}</td>
                      <td className="small">{scopeText(m) ?? <span className="muted">{t('Todos los centros')}</span>}</td>
                      <td className="small">
                        {m.validFrom || m.validUntil ? (
                          <>
                            {m.validFrom && (
                              <div>
                                {t('Desde [periodo]')} <DateText date={m.validFrom} />
                              </div>
                            )}
                            {m.validUntil && (
                              <div>
                                {t('Hasta [periodo]')} <DateText date={m.validUntil} />
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="muted">{t('Sin fecha de fin [acceso]')}</span>
                        )}
                      </td>
                      <td className="small control-audit-text">{m.reference ?? <span className="muted">—</span>}</td>
                      <td>
                        <Badge tone={ACCESS_STATE[state].tone}>{t(ACCESS_STATE[state].label)}</Badge>
                        {m.revokedAt && (
                          <div className="sub">
                            <DateTimeText at={m.revokedAt} tz={ctx.company.timezone} />
                          </div>
                        )}
                      </td>
                      {canEdit && (
                        <td>
                          {m.status !== 'revoked' && !self && (
                            <Button size="sm" variant="danger-outline" icon={Ban} onClick={() => setRevoking(m)} aria-label={t('Revocar el acceso de {name}', { name: user?.name ?? m.userId })}>
                              {t('Revocar')}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer tiny muted">
          {t('No puede revocar su propio acceso. Las fechas de fin de un rol (p. ej., el mandato de un delegado de prevención) solo retiran ese rol; el resto sigue vigente.')}
        </div>
      </Card>

      <Card title={t('Qué permite cada rol')}>
        <div className="control-roles">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="control-role">
              <div className="strong">{t(ROLES[r].label)}</div>
              <p className="small">{t(ROLES[r].description)}</p>
              <p className="tiny muted">
                {t('Límite')}: {t(ROLES[r].restriction)}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {revoking && (
        <ConfirmDialog
          title={t('Revocar acceso')}
          danger
          confirmLabel={t('Revocar de inmediato')}
          requireReason
          reasonLabel={t('Motivo de la revocación (queda en la auditoría)')}
          onClose={() => setRevoking(null)}
          message={
            <Callout tone="danger">
              {t('{name} perderá de inmediato el acceso a {company}: no podrá leer, descargar ni registrar nada. Para volver a darle acceso será necesario un nuevo alta en la plataforma.', {
                name: ctx.db.users.find((u) => u.id === revoking.userId)?.name ?? revoking.userId,
                company: ctx.company.tradeName,
              })}
            </Callout>
          }
          onConfirm={(reason) => runOk(() => revokeMembership(revoking.id, reason), t('Acceso revocado'))}
        />
      )}
    </div>
  );
}

