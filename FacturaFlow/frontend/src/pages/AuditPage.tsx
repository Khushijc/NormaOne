import { ShieldCheck, ShieldX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportButton } from '../components/ExportButton';
import { Callout, Card, DateTimeText, EmptyState, PageHeader, Pagination, usePaged } from '../components/ui';
import { AUDIT_ACTION_LABEL, verifyAuditChain } from '../domain/audit';
import { formatDateTime } from '../domain/dates';
import { ROLES } from '../domain/permissions';
import type { AuditEvent } from '../domain/types';
import { t } from '../i18n';
import { useCtx, useLang } from '../store/hooks';

const LINK: Record<string, (id: string) => string> = {
  invoice: (id) => `/facturas/${id}`,
  customer: (id) => `/clientes/${id}`,
  supplier: (id) => `/proveedores/${id}`,
  expense: (id) => `/gastos/${id}`,
};

export function AuditPage() {
  const ctx = useCtx();
  const lang = useLang();
  const events = ctx.db.audit.filter((e) => e.companyId === ctx.company.id);
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [actor, setActor] = useState('');
  const chain = useMemo(() => verifyAuditChain(events), [events]);
  const rows = useMemo(() => {
    const s = q.toLowerCase();
    const actionLabel = (e: AuditEvent) => AUDIT_ACTION_LABEL[e.action] ?? e.action;
    // Search both the stored Spanish text and its rendering in the interface language.
    const haystack = (e: AuditEvent) => `${e.summary} ${e.entityLabel} ${e.reason ?? ''} ${actionLabel(e)} ${t(e.summary)} ${t(e.entityLabel)} ${t(actionLabel(e))}`.toLowerCase();
    return events
      .filter((e) => (!entity || e.entityType === entity) && (!actor || e.actorId === actor) && (!s || haystack(e).includes(s)))
      .sort((a, b) => b.seq - a.seq);
  }, [events, q, entity, actor, lang]);
  const paged = usePaged(rows, 50);
  const actors = Array.from(new Map(events.map((e) => [e.actorId, e.actorName])).entries());

  return (
    <>
      <PageHeader
        title={t('Auditoría')}
        subtitle={t('Registro de solo inserción: no existe ninguna operación para editar o borrar eventos. Muestra actor, empresa, momento, acción, motivo y valores anterior/actual.')}
        actions={<ExportButton<AuditEvent> kind="audit" baseName="auditoria" rows={rows} filters={[entity, actor, q].filter(Boolean).join(', ') || 'Sin filtros'} columns={[
          { key: 'seq', label: 'Secuencia', value: (e) => e.seq },
          { key: 'fecha', label: 'Fecha y hora (Europe/Madrid)', value: (e) => formatDateTime(e.at) },
          { key: 'actor', label: 'Actor', value: (e) => e.actorName },
          { key: 'roles', label: 'Roles', value: (e) => e.actorRoles.join(', ') },
          { key: 'accion', label: 'Acción', value: (e) => AUDIT_ACTION_LABEL[e.action] ?? e.action },
          { key: 'entidad', label: 'Entidad', value: (e) => `${e.entityType}:${e.entityId}` },
          { key: 'etiqueta', label: 'Registro', value: (e) => e.entityLabel },
          { key: 'resumen', label: 'Resumen', value: (e) => e.summary },
          { key: 'motivo', label: 'Motivo', value: (e) => e.reason ?? '' },
          { key: 'cambios', label: 'Cambios', value: (e) => e.changes.map((c) => `${c.field}: ${c.before} → ${c.after}`).join(' | ') },
          { key: 'hash', label: 'Huella (demo)', value: (e) => e.hash },
        ]} />}
      />
      <div style={{ marginBottom: 12 }}>
        {chain.ok ? (
          <Callout tone="success" icon={ShieldCheck} title={t('Cadena íntegra: {n} eventos encadenados', { n: events.length })}>{t('Cada evento incluye la huella del anterior. Huella de demostración no criptográfica; en producción, SHA-256 y almacenamiento inmutable en servidor (SEC-05).')}</Callout>
        ) : (
          <Callout tone="danger" icon={ShieldX} title={t('Cadena alterada a partir del evento {n}', { n: chain.brokenAt ?? '—' })}>{t('Los datos locales se han modificado fuera de la aplicación.')}</Callout>
        )}
      </div>
      <Card flush>
        <div className="toolbar">
          <div className="field search"><label htmlFor="a-q">{t('Buscar')}</label><input id="a-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Texto, número, motivo')} /></div>
          <div className="field">
            <label htmlFor="a-e">{t('Entidad')}</label>
            <select id="a-e" className="select" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">{t('Todas')}</option>
              {Array.from(new Set(events.map((e) => e.entityType))).map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-a">{t('Actor')}</label>
            <select id="a-a" className="select" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">{t('Todos')}</option>
              {actors.map(([id, name]) => <option key={id} value={id}>{t(name)}</option>)}
            </select>
          </div>
        </div>
        {rows.length === 0 ? <EmptyState title={t('Sin eventos')} /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th className="num">#</th><th>{t('Fecha')}</th><th>{t('Actor')}</th><th>{t('Acción')}</th><th>{t('Registro')}</th><th>{t('Detalle')}</th></tr></thead>
                <tbody>
                  {paged.rows.map((e) => (
                    <tr key={e.id}>
                      <td className="num small">{e.seq}</td>
                      <td className="small"><DateTimeText at={e.at} /></td>
                      <td className="small">{t(e.actorName)}<div className="sub">{e.actorRoles.map((r) => (ROLES[r] ? t(ROLES[r].label) : r)).join(', ')}</div></td>
                      <td className="small strong">{t(AUDIT_ACTION_LABEL[e.action] ?? e.action)}</td>
                      <td className="small">{LINK[e.entityType] ? <Link to={LINK[e.entityType](e.entityId)}>{t(e.entityLabel)}</Link> : t(e.entityLabel)}</td>
                      <td className="small">
                        {t(e.summary)}
                        {e.reason && <div className="sub">{t('Motivo')}: {e.reason}</div>}
                        {e.changes.map((c, i) => <div key={i} className="sub">{t(c.field)}: {c.before || '—'} → {c.after || '—'}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>
    </>
  );
}
