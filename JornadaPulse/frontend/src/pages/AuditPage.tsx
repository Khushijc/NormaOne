/**
 * Auditoría (PLT-06, SEC-05): the company's append-only event log, newest first. There is no
 * operation to edit or delete events. The integrity check recomputes the demo hash chain;
 * browser storage cannot be tamper-proof (production: SHA-256 + write-once server storage).
 */
import { ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportButton } from '../components/ExportButton';
import { Button, Callout, Card, DateTimeText, EmptyState, PageHeader, Pagination, usePaged } from '../components/ui';
import { AUDIT_ACTION_LABEL, verifyAuditChain } from '../domain/audit';
import { ROLES } from '../domain/permissions';
import { formatInstant, localDate } from '../domain/time';
import type { AuditEvent } from '../domain/types';
import { t, tKey } from '../i18n';
import { employeeName, getCtx } from '../services/context';
import type { Column } from '../services/reportService';
import { useCtx } from '../store/hooks';

/** Action groups (prefix of the action code). */
const GROUP_LABEL: Record<string, string> = {
  time: tKey('Fichajes'),
  correction: tKey('Correcciones'),
  absence: tKey('Ausencias'),
  shift: tKey('Turnos'),
  policy: tKey('Políticas y convenios'),
  calendar: tKey('Calendarios laborales'),
  absence_type: tKey('Tipos de ausencia'),
  protocol: tKey('Protocolo de registro'),
  employee: tKey('Empleados'),
  relationship: tKey('Condiciones laborales'),
  anomaly: tKey('Incidencias'),
  period: tKey('Cierre de periodos'),
  export: tKey('Exportaciones'),
  retention: tKey('Conservación'),
  membership: tKey('Accesos'),
  session: tKey('Sesiones de demostración'),
  demo: tKey('Datos de demostración'),
};

const groupOf = (action: string) => action.split('.')[0];
const actionLabel = (e: AuditEvent) => AUDIT_ACTION_LABEL[e.action] ?? e.action;

/** Where an audited entity can be opened. */
function entityLink(e: AuditEvent): string | null {
  switch (e.entityType) {
    case 'correction':
      return `/correcciones/${e.entityId}`;
    case 'absence':
      return `/ausencias/${e.entityId}`;
    case 'employee':
      return `/equipo/${e.entityId}`;
    case 'anomaly':
      return `/incidencias?clave=${encodeURIComponent(e.entityId)}`;
    case 'period':
      return '/informes?informe=cierre';
    case 'export':
      return '/informes';
    case 'shift':
    case 'policy':
    case 'protocol':
      return '/turnos';
    default:
      return null;
  }
}

const ENTITY_LABEL: Record<string, string> = {
  absence: tKey('Ausencia'),
  absence_type: tKey('Tipo de ausencia'),
  agreement: tKey('Convenio'),
  anomaly: tKey('Incidencia'),
  calendar: tKey('Calendario'),
  company: tKey('Empresa'),
  correction: tKey('Corrección'),
  employee: tKey('Empleado'),
  event: tKey('Evento de fichaje'),
  export: tKey('Exportación'),
  failed_attempt: tKey('Intento no registrado'),
  period: tKey('Periodo'),
  policy: tKey('Política'),
  protocol: tKey('Protocolo de registro'),
  session: tKey('Sesión'),
  shift: tKey('Turno'),
};

const changesText = (e: AuditEvent) => e.changes.map((c) => `${c.field}: ${c.before || '—'} → ${c.after || '—'}`).join(' | ');

const AUDIT_COLUMNS: Column<AuditEvent>[] = [
  { key: 'seq', label: 'Secuencia', value: (e) => e.seq },
  { key: 'fecha', label: 'Fecha y hora', value: (e) => `${formatInstant(e.at)} (${e.at})` },
  { key: 'actor', label: 'Actor', value: (e) => `${e.actor.name}${e.actor.roles.length ? ` (${e.actor.roles.map((r) => ROLES[r]?.label ?? r).join(', ')})` : ''}` },
  { key: 'accion', label: 'Acción', value: (e) => actionLabel(e) },
  { key: 'entidad', label: 'Entidad', value: (e) => `${e.entityType}:${e.entityId} · ${e.entityLabel}` },
  { key: 'empleado', label: 'Empleado', value: (e) => (e.employeeId ? e.employeeId : '') },
  { key: 'resumen', label: 'Resumen', value: (e) => e.summary },
  { key: 'motivo', label: 'Motivo', value: (e) => (e.reason && sensitiveAbsenceEvent(e) ? 'Reservado (categoría sensible)' : e.reason ?? '') },
  { key: 'cambios', label: 'Cambios', value: changesText },
  { key: 'hash', label: 'Huella (demo)', value: (e) => `${e.prevHash} → ${e.hash}` },
];

interface AuditFilters {
  group: string;
  actor: string;
  employeeId: string;
  from: string;
  to: string;
  q: string;
}

const NO_FILTERS: AuditFilters = { group: '', actor: '', employeeId: '', from: '', to: '', q: '' };
const EXPORT_TITLE = 'Auditoría';

/**
 * Reasons on events about sensitive absences (sick leave) are visible only to the employee and to
 * roles with access to sensitive categories; everyone else with audit access sees them masked.
 */
function sensitiveAbsenceEvent(e: AuditEvent): boolean {
  const ctx = getCtx();
  if (e.entityType !== 'absence' || ctx.perms.has('absences.view_sensitive') || (ctx.employee && e.employeeId === ctx.employee.id)) return false;
  const a = ctx.db.absences.find((x) => x.id === e.entityId);
  return !!ctx.db.absenceTypes.find((x) => x.id === a?.typeId)?.sensitive;
}

export function AuditPage() {
  const ctx = useCtx();
  const reasonHidden = sensitiveAbsenceEvent;
  const tz = ctx.company.timezone;
  const events = useMemo(() => ctx.db.audit.filter((e) => e.companyId === ctx.company.id), [ctx]);
  const [f, setF] = useState<AuditFilters>(NO_FILTERS);
  const [check, setCheck] = useState<{ ok: boolean; brokenAt: number | null; count: number; at: string } | null>(null);
  const set = (patch: Partial<AuditFilters>) => setF((x) => ({ ...x, ...patch }));

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    // Search the stored Spanish text and its rendering in the interface language.
    const hay = (e: AuditEvent) => `${e.summary} ${t(e.summary)} ${e.entityLabel} ${e.reason ?? ''} ${actionLabel(e)} ${t(actionLabel(e))} ${e.actor.name} ${changesText(e)}`.toLowerCase();
    return events
      .filter((e) => {
        if (f.group && groupOf(e.action) !== f.group) return false;
        if (f.actor && e.actor.userId !== f.actor) return false;
        if (f.employeeId && e.employeeId !== f.employeeId) return false;
        const d = localDate(e.at, tz);
        if (f.from && d < f.from) return false;
        if (f.to && d > f.to) return false;
        return !q || hay(e).includes(q);
      })
      .sort((a, b) => b.seq - a.seq);
    // ctx.lang: re-filter when the interface language changes (translated search text).
  }, [events, f, tz, ctx.lang]);
  const paged = usePaged(rows, 25);

  const groups = useMemo(() => [...new Set(events.map((e) => groupOf(e.action)))].sort(), [events]);
  const actors = useMemo(() => [...new Map(events.map((e) => [e.actor.userId, e.actor.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [events]);
  const employees = useMemo(() => [...new Set(events.map((e) => e.employeeId).filter((x): x is string => !!x))].map((id) => ({ id, name: employeeName(ctx.db, id) })).sort((a, b) => a.name.localeCompare(b.name, 'es')), [events, ctx.db]);
  const anyFilter = Object.values(f).some(Boolean);
  const exportColumns = useMemo<Column<AuditEvent>[]>(() => AUDIT_COLUMNS.map((c) => (c.key === 'empleado' ? { ...c, value: (e) => (e.employeeId ? employeeName(ctx.db, e.employeeId) : '') } : c)), [ctx.db]);
  const filterText = [
    f.group && `grupo ${GROUP_LABEL[f.group] ?? f.group}`,
    f.actor && `actor ${actors.find(([id]) => id === f.actor)?.[1] ?? f.actor}`,
    f.employeeId && `empleado ${employeeName(ctx.db, f.employeeId)}`,
    (f.from || f.to) && `fechas ${f.from || '…'} → ${f.to || '…'}`,
    f.q.trim() && `búsqueda «${f.q.trim()}»`,
  ]
    .filter(Boolean)
    .join(' · ') || 'Sin filtros';

  const verify = () => {
    const r = verifyAuditChain(events);
    setCheck({ ...r, count: events.length, at: new Date().toISOString() });
  };

  return (
    <>
      <PageHeader
        title={t('Auditoría')}
        subtitle={t('Registro de solo inserción de la empresa activa: no existe ninguna operación para editar o borrar eventos.')}
        actions={
          <>
            <Button icon={ShieldQuestion} onClick={verify}>{t('Comprobar integridad')}</Button>
            {ctx.can('reports.export') && <ExportButton kind="auditoria" title={EXPORT_TITLE} rows={rows} columns={exportColumns} filters={filterText} />}
          </>
        }
      />
      <div className="stack">
        {check ? (
          check.ok ? (
            <Callout tone="success" icon={ShieldCheck} title={t('Cadena íntegra: {n} eventos encadenados', { n: check.count })}>
              {t('Cada evento incluye la huella del anterior y su recálculo coincide.')} {t('Huella de demostración no criptográfica: el almacenamiento del navegador no es a prueba de manipulación. En producción, SHA-256 y almacenamiento de una sola escritura en el servidor.')}
              <div className="tiny muted"><DateTimeText at={check.at} tz={tz} /></div>
            </Callout>
          ) : (
            <Callout tone="danger" icon={ShieldX} title={t('Cadena alterada a partir del evento {n}', { n: check.brokenAt ?? '—' })}>
              {t('Los datos locales se han modificado fuera de la aplicación.')} {t('Huella de demostración no criptográfica: el almacenamiento del navegador no es a prueba de manipulación. En producción, SHA-256 y almacenamiento de una sola escritura en el servidor.')}
            </Callout>
          )
        ) : (
          <Callout tone="neutral" icon={ShieldQuestion}>
            {t('Pulse «Comprobar integridad» para recalcular la cadena de huellas.')} {t('Huella de demostración no criptográfica: el almacenamiento del navegador no es a prueba de manipulación. En producción, SHA-256 y almacenamiento de una sola escritura en el servidor.')}
          </Callout>
        )}
        <Card flush>
          <div className="toolbar" role="search" aria-label={t('Filtros')}>
            <div className="field search">
              <label htmlFor="au-q">{t('Buscar')}</label>
              <input id="au-q" className="input" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('Texto, motivo, recibo')} />
            </div>
            <div className="field">
              <label htmlFor="au-g">{t('Tipo de acción')}</label>
              <select id="au-g" className="select" value={f.group} onChange={(e) => set({ group: e.target.value })}>
                <option value="">{t('Todas')}</option>
                {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g] ? t(GROUP_LABEL[g]) : g}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="au-a">{t('Actor')}</label>
              <select id="au-a" className="select" value={f.actor} onChange={(e) => set({ actor: e.target.value })}>
                <option value="">{t('Todos')}</option>
                {actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="au-e">{t('Empleado')}</label>
              <select id="au-e" className="select" value={f.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
                <option value="">{t('Todos')}</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="au-from">{t('Desde')}</label>
              <input id="au-from" type="date" className="input" value={f.from} onChange={(e) => set({ from: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="au-to">{t('Hasta')}</label>
              <input id="au-to" type="date" className="input" value={f.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
            {anyFilter && <Button variant="ghost" onClick={() => setF(NO_FILTERS)}>{t('Limpiar filtros')}</Button>}
          </div>
          {rows.length === 0 ? (
            <EmptyState title={events.length === 0 ? t('Sin eventos registrados') : t('Ningún evento coincide con los filtros')} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">{t('Eventos de auditoría, del más reciente al más antiguo')}</caption>
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>{t('Fecha y hora')}</th>
                      <th>{t('Actor')}</th>
                      <th>{t('Acción')}</th>
                      <th>{t('Entidad')}</th>
                      <th>{t('Empleado')}</th>
                      <th>{t('Detalle')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((e) => {
                      const to = entityLink(e);
                      return (
                        <tr key={e.id}>
                          <td className="num small">{e.seq}</td>
                          <td className="small"><DateTimeText at={e.at} tz={tz} /></td>
                          <td className="small">
                            {e.actor.name}
                            <div className="sub">{e.actor.roles.map((r) => (ROLES[r] ? t(ROLES[r].label) : r)).join(', ')}</div>
                          </td>
                          <td className="small strong">{t(actionLabel(e))}</td>
                          <td className="small">
                            {to ? <Link to={to}>{t(e.entityLabel)}</Link> : t(e.entityLabel)}
                            <div className="sub">{ENTITY_LABEL[e.entityType] ? t(ENTITY_LABEL[e.entityType]) : e.entityType}</div>
                          </td>
                          <td className="small">{e.employeeId ? employeeName(ctx.db, e.employeeId) : <span className="muted">—</span>}</td>
                          <td className="small control-audit-detail">
                            {t(e.summary)}
                            {e.reason && <div className="sub">{t('Motivo')}: {reasonHidden(e) ? t('Reservado (categoría sensible)') : t(e.reason)}</div>}
                            {e.changes.map((c, i) => (
                              <div key={i} className="sub">
                                {t(c.field)}: {c.before || '—'} → {c.after || '—'}
                              </div>
                            ))}
                            <div className="sub mono control-break" title={t('Huella anterior → huella del evento (demo)')}>{e.prevHash} → {e.hash}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination {...paged.props} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
