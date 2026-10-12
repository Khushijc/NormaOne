import { History } from 'lucide-react';
import { AUDIT_ACTION_LABEL } from '../domain/audit';
import { ROLES } from '../domain/permissions';
import { formatInstant } from '../domain/time';
import type { AuditEvent } from '../domain/types';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { canSeeHealth } from '../services/context';
import { EmptyState } from './ui';
import { auditText } from './bits';

/**
 * Audit trail for one record or employee (newest first). Users with `audit.view` see the
 * company's events; others see only events about their own records. Restricted (health)
 * events are listed only to health-authorised users, who see them even without `audit.view`.
 */
export function AuditList({ filter, limit = 50 }: { filter: (e: AuditEvent) => boolean; limit?: number }) {
  const ctx = useCtx();
  const own = (e: AuditEvent) => !!ctx.employee && e.employeeId === ctx.employee.id;
  const health = canSeeHealth(ctx);
  const events = ctx.db.audit
    .filter((e) => e.companyId === ctx.company.id && filter(e) && (ctx.can('audit.view') || own(e) || (e.restricted && health)) && (!e.restricted || health))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, limit);
  if (!events.length) return <EmptyState icon={History} title={t('Sin eventos registrados')} />;
  return (
    <ol className="timeline" aria-label={t('Historial de auditoría')}>
      {events.map((e) => (
        <li key={e.id}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="strong">{t(AUDIT_ACTION_LABEL[e.action] ?? e.action)}</span>
            <span className="tiny muted nowrap">{formatInstant(e.at)}</span>
          </div>
          <div className="tiny">{auditText(e.summary)}</div>
          {e.reason && <div className="tiny muted">{t('Motivo')}: {auditText(e.reason)}</div>}
          {(e.version || e.recipient) && (
            <div className="tiny muted">
              {e.version ? `${t('Versión')}: ${e.version}` : ''}
              {e.version && e.recipient ? ' · ' : ''}
              {e.recipient ? `${t('Destinatario')}: ${e.recipient}` : ''}
            </div>
          )}
          {e.changes.length > 0 && (
            <ul className="tiny muted" style={{ margin: '2px 0 0', paddingLeft: 16 }}>
              {e.changes.map((c, i) => (
                <li key={i}>
                  {t(c.field)}: {auditText(c.before)} → {auditText(c.after)}
                </li>
              ))}
            </ul>
          )}
          <div className="tiny muted">
            {t(e.actor.name)}
            {e.actor.roles.length ? ` · ${e.actor.roles.map((r) => t(ROLES[r].label)).join(', ')}` : ''} · #{e.seq}
          </div>
        </li>
      ))}
    </ol>
  );
}
