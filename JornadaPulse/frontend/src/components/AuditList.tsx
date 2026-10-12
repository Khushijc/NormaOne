import { History } from 'lucide-react';
import { AUDIT_ACTION_LABEL } from '../domain/audit';
import { ROLES } from '../domain/permissions';
import { formatInstant } from '../domain/time';
import type { AuditEvent } from '../domain/types';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { EmptyState } from './ui';

/**
 * Audit trail for one record or employee (newest first). Only users with `audit.view` see
 * other people's events; employees see the events about their own records.
 */
export function AuditList({ filter, limit = 50 }: { filter: (e: AuditEvent) => boolean; limit?: number }) {
  const ctx = useCtx();
  const own = (e: AuditEvent) => !!ctx.employee && e.employeeId === ctx.employee.id;
  const events = ctx.db.audit
    .filter((e) => e.companyId === ctx.company.id && filter(e) && (ctx.can('audit.view') || own(e)))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, limit);
  /** Reasons on events about sensitive absences are shown only to the employee and to roles with access. */
  const reasonHidden = (e: AuditEvent) => {
    if (e.entityType !== 'absence' || ctx.can('absences.view_sensitive') || own(e)) return false;
    const a = ctx.db.absences.find((x) => x.id === e.entityId);
    return !!ctx.db.absenceTypes.find((x) => x.id === a?.typeId)?.sensitive;
  };
  if (!events.length) return <EmptyState icon={History} title={t('Sin eventos registrados')} />;
  return (
    <ol className="timeline" aria-label={t('Historial de auditoría')}>
      {events.map((e) => (
        <li key={e.id}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="strong">{t(AUDIT_ACTION_LABEL[e.action] ?? e.action)}</span>
            <span className="tiny muted nowrap">{formatInstant(e.at)}</span>
          </div>
          <div className="tiny">{t(e.summary)}</div>
          {e.reason && <div className="tiny muted">{t('Motivo')}: {reasonHidden(e) ? t('Reservado (categoría sensible)') : t(e.reason)}</div>}
          {e.changes.length > 0 && (
            <ul className="tiny muted" style={{ margin: '2px 0 0', paddingLeft: 16 }}>
              {e.changes.map((c, i) => (
                <li key={i}>
                  {t(c.field)}: {c.before} → {c.after}
                </li>
              ))}
            </ul>
          )}
          <div className="tiny muted">
            {e.actor.name}
            {e.actor.roles.length ? ` · ${e.actor.roles.map((r) => t(ROLES[r].label)).join(', ')}` : ''} · #{e.seq}
          </div>
        </li>
      ))}
    </ol>
  );
}
