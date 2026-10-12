import { AUDIT_ACTION_LABEL } from '../domain/audit';
import { ROLES } from '../domain/permissions';
import type { AuditEvent } from '../domain/types';
import { t } from '../i18n';
import { DateTimeText, EmptyState } from './ui';

/** Append-only audit trail rendering (PLT-06): actor, time, action, reason, before/after. */
export function AuditList({ events, limit }: { events: AuditEvent[]; limit?: number }) {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.seq - a.seq));
  const shown = limit ? sorted.slice(0, limit) : sorted;
  if (!shown.length) return <EmptyState title={t('Sin eventos registrados')} />;
  return (
    <ol className="timeline">
      {shown.map((e) => (
        <li key={e.id}>
          <div className="when">
            <DateTimeText at={e.at} /> · {e.actorName}
            {e.actorRoles.length > 0 && <> ({e.actorRoles.map((r) => (ROLES[r] ? t(ROLES[r].label) : r)).join(', ')})</>}
          </div>
          <div className="what">{AUDIT_ACTION_LABEL[e.action] ? t(AUDIT_ACTION_LABEL[e.action]) : e.action}{e.entityLabel ? <span className="muted" style={{ fontWeight: 400 }}> · {e.entityLabel}</span> : null}</div>
          <div className="small">{t(e.summary)}</div>
          {e.reason && <div className="small muted">{t('Motivo / nota:')} {e.reason}</div>}
          {e.changes.length > 0 && (
            <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {e.changes.map((c, i) => (
                <li key={i}>
                  {t(c.field)}: <span className="muted">{c.before ? t(c.before) : '—'}</span> → {c.after ? t(c.after) : '—'}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
