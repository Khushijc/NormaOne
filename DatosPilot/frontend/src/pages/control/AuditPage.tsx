/**
 * Auditoría (PLT-06, SEC-05): the active company's append-only event log, newest first.
 * There is no operation to edit or delete events. Restricted (health) events are listed only to
 * health-authorised users. The integrity check recomputes the demo hash chain; browser storage
 * is NOT tamper-proof (production: server-side append-only storage with SHA-256).
 */
import { History, Lock, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auditText, RestrictedNote } from '../../components/bits';
import { ExportButton } from '../../components/ExportButton';
import { Badge, Button, Callout, Card, Checkbox, DateTimeText, EmptyState, PageHeader, Pagination, SelectField, TextField, usePaged } from '../../components/ui';
import { AUDIT_ACTION_LABEL, verifyAuditChain } from '../../domain/audit';
import { ROLES } from '../../domain/permissions';
import { localDate } from '../../domain/time';
import type { AuditEvent } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { canSeeHealth, employeeName } from '../../services/context';
import { EMPTY_FILTERS } from '../../services/reportService';
import { getDb } from '../../store/db';
import { useCtx } from '../../store/hooks';

const ENTITY_LABEL: Record<string, string> = {
  action: tKey('Acción preventiva'),
  assessment: tKey('Evaluación de riesgos'),
  cae: tKey('Caso CAE'),
  course: tKey('Curso'),
  demo: tKey('Datos de demostración'),
  document: tKey('Documento'),
  employee: tKey('Empleado'),
  equipment: tKey('Equipo del catálogo [auditoría]'),
  exception: tKey('Incidencia [auditoría]'),
  export: tKey('Exportación'),
  health: tKey('Área de salud [auditoría]'),
  job_role: tKey('Puesto'),
  membership: tKey('Acceso de usuario'),
  ppe: tKey('Entrega de EPI [auditoría]'),
  readiness: tKey('Disponibilidad'),
  request: tKey('Solicitud de evidencia'),
  requirement: tKey('Requisito'),
  session: tKey('Sesión de demostración'),
  settings: tKey('Configuración'),
  training: tKey('Formación'),
  worksite: tKey('Centro de trabajo'),
};

const entityLabel = (type: string) => (ENTITY_LABEL[type] ? t(ENTITY_LABEL[type]) : type);
const actionLabel = (e: AuditEvent) => AUDIT_ACTION_LABEL[e.action] ?? e.action;

/** Where the audited record can be opened (the target screen re-checks access). */
function entityLink(e: AuditEvent): string | null {
  switch (e.entityType) {
    case 'requirement':
      return `/requisitos/${e.entityId}`;
    case 'document':
      return `/documentacion/${e.entityId}`;
    case 'action':
      return `/acciones/${e.entityId}`;
    case 'assessment':
      return `/evaluaciones/${e.entityId}`;
    case 'cae':
      return `/cae/${e.entityId}`;
    case 'employee':
      return `/empleados/${e.entityId}`;
    case 'worksite':
      return `/centros/${e.entityId}`;
    case 'readiness':
      return e.entityId.includes('|') ? `/empleados/${e.entityId.split('|')[0]}` : null;
    case 'export':
      return '/informes';
    case 'job_role':
    case 'settings':
    case 'membership':
      return '/configuracion';
    default:
      return null;
  }
}

interface AuditFilters {
  action: string;
  actor: string;
  entityType: string;
  employeeId: string;
  from: string;
  to: string;
  q: string;
}

const NO_FILTERS: AuditFilters = { action: '', actor: '', entityType: '', employeeId: '', from: '', to: '', q: '' };

const NOT_TAMPER_PROOF = tKey('Huella de demostración no criptográfica guardada en el almacenamiento local del navegador: NO es un almacenamiento a prueba de manipulación. En producción, los eventos se guardarán en el servidor en almacenamiento de solo inserción, encadenados con SHA-256.');

export function AuditPage() {
  const ctx = useCtx();
  const tz = ctx.company.timezone;
  const health = canSeeHealth(ctx);
  const [params, setParams] = useSearchParams();
  const onlyRestricted = health && params.get('restringido') === '1';
  const [f, setF] = useState<AuditFilters>(NO_FILTERS);
  const [check, setCheck] = useState<{ ok: boolean; brokenAt: number | null; count: number; at: string } | null>(null);

  const events = useMemo(() => ctx.db.audit.filter((e) => e.companyId === ctx.company.id && (health || !e.restricted)), [ctx, health]);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const hay = (e: AuditEvent) =>
      [e.summary, t(e.summary), e.entityLabel, t(e.entityLabel), e.reason ?? '', actionLabel(e), t(actionLabel(e)), e.actor.name, e.recipient ?? '', e.version ?? '', ...e.changes.map((c) => `${c.field} ${c.before} ${c.after}`)].join(' ').toLowerCase();
    return events
      .filter((e) => {
        if (onlyRestricted && !e.restricted) return false;
        if (f.action && e.action !== f.action) return false;
        if (f.actor && e.actor.userId !== f.actor) return false;
        if (f.entityType && e.entityType !== f.entityType) return false;
        if (f.employeeId && e.employeeId !== f.employeeId) return false;
        const d = localDate(e.at, tz);
        if (f.from && d < f.from) return false;
        if (f.to && d > f.to) return false;
        return !q || hay(e).includes(q);
      })
      .sort((a, b) => b.seq - a.seq);
    // ctx.lang: search also matches the translated text, so re-filter when the language changes.
  }, [events, f, tz, onlyRestricted, ctx.lang]);
  const paged = usePaged(rows, 25);

  const actions = useMemo(() => [...new Set(events.map((e) => e.action))].sort((a, b) => t(AUDIT_ACTION_LABEL[a] ?? a).localeCompare(t(AUDIT_ACTION_LABEL[b] ?? b), 'es')), [events]);
  const actors = useMemo(() => [...new Map(events.map((e) => [e.actor.userId, e.actor.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [events]);
  const entityTypes = useMemo(() => [...new Set(events.map((e) => e.entityType))].sort((a, b) => entityLabel(a).localeCompare(entityLabel(b), 'es')), [events]);
  const employees = useMemo(
    () =>
      [...new Set(events.map((e) => e.employeeId).filter((x): x is string => !!x))]
        .map((id) => ({ id, name: employeeName(ctx.db, id) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [events, ctx.db],
  );
  const set = (patch: Partial<AuditFilters>) => {
    setF((x) => ({ ...x, ...patch }));
    paged.reset();
  };
  const anyFilter = Object.values(f).some(Boolean) || onlyRestricted;
  const dateError = f.from && f.to && f.from > f.to ? t('La fecha inicial es posterior a la final.') : undefined;

  const setOnlyRestricted = (v: boolean) => {
    const next = new URLSearchParams(params);
    if (v) next.set('restringido', '1');
    else next.delete('restringido');
    setParams(next, { replace: true });
    paged.reset();
  };

  const verify = () => {
    // The chain is per company and includes restricted events, so it is checked on the stored
    // (untranslated) log. Only the result is shown, never the hidden events.
    const all = getDb().audit.filter((e) => e.companyId === ctx.company.id);
    const r = verifyAuditChain(all);
    setCheck({ ...r, count: all.length, at: new Date().toISOString() });
  };

  return (
    <>
      <PageHeader
        title={t('Auditoría')}
        subtitle={t('Registro de solo inserción de {company}: no existe ninguna operación para editar ni borrar eventos.', { company: ctx.company.tradeName })}
        actions={
          <>
            <Button icon={ShieldQuestion} onClick={verify}>
              {t('Comprobar integridad')}
            </Button>
            {ctx.can('reports.export') && <ExportButton reportId="audit" filters={{ ...EMPTY_FILTERS, employeeId: f.employeeId }} />}
          </>
        }
      />
      <div className="stack">
        {check ? (
          check.ok ? (
            <Callout tone="success" icon={ShieldCheck} title={t('Cadena íntegra: {n} eventos encadenados', { n: check.count })}>
              {t('Cada evento incluye la huella del anterior y su recálculo coincide.')} {t(NOT_TAMPER_PROOF)}
              <div className="tiny muted">
                {t('Comprobado')}: <DateTimeText at={check.at} tz={tz} />
              </div>
            </Callout>
          ) : (
            <Callout tone="danger" icon={ShieldX} title={t('Cadena alterada a partir del evento nº {n}', { n: check.brokenAt ?? '—' })}>
              {t('El recálculo no coincide: los datos locales se han modificado fuera de la aplicación.')} {t(NOT_TAMPER_PROOF)}
            </Callout>
          )
        ) : (
          <Callout tone="warning" icon={ShieldQuestion} title={t('Cadena de huellas de demostración')}>
            {t(NOT_TAMPER_PROOF)} {t('Pulse «Comprobar integridad» para recalcular la cadena.')}
          </Callout>
        )}

        {!health && (
          <Callout tone="neutral" icon={Lock}>
            {t('Los eventos restringidos (área de salud) no se muestran a su rol. Solo el personal autorizado para la información de aptitud puede consultarlos.')}
          </Callout>
        )}

        <Card flush>
          <div className="toolbar" role="search" aria-label={t('Filtros de auditoría')}>
            <TextField className="search" label={t('Buscar')} value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('Resumen, registro, motivo, destinatario')} />
            <SelectField label={t('Acción')} value={f.action} onChange={(e) => set({ action: e.target.value })}>
              <option value="">{t('Todas')}</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {t(AUDIT_ACTION_LABEL[a] ?? a)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('Actor')} value={f.actor} onChange={(e) => set({ actor: e.target.value })}>
              <option value="">{t('Todos')}</option>
              {actors.map(([id, name]) => (
                <option key={id} value={id}>
                  {t(name)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('Tipo de registro')} value={f.entityType} onChange={(e) => set({ entityType: e.target.value })}>
              <option value="">{t('Todos')}</option>
              {entityTypes.map((x) => (
                <option key={x} value={x}>
                  {entityLabel(x)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('Empleado')} value={f.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
              <option value="">{t('Todos')}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </SelectField>
            <TextField type="date" label={t('Desde [periodo]')} value={f.from} onChange={(e) => set({ from: e.target.value })} error={dateError} />
            <TextField type="date" label={t('Hasta [periodo]')} value={f.to} onChange={(e) => set({ to: e.target.value })} />
            {health && (
              <div className="control-check">
                <Checkbox label={t('Solo restringidos')} checked={onlyRestricted} onChange={setOnlyRestricted} />
              </div>
            )}
            {anyFilter && (
              <Button
                variant="ghost"
                onClick={() => {
                  setF(NO_FILTERS);
                  setOnlyRestricted(false);
                }}
              >
                {t('Limpiar filtros')}
              </Button>
            )}
          </div>
          <div className="control-report-meta">
            <span className="small muted">{t('{n} eventos', { n: rows.length })}</span>
            {ctx.can('reports.export') && <span className="tiny muted">{t('La exportación aplica solo el filtro de empleado; el resto de filtros es de consulta en pantalla.')}</span>}
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={History} title={events.length === 0 ? t('Sin eventos registrados [auditoría]') : t('Ningún evento coincide con los filtros')} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table control-audit-table">
                  <caption className="sr-only">{t('Eventos de auditoría, del más reciente al más antiguo')}</caption>
                  <thead>
                    <tr>
                      <th className="num">{t('Nº')}</th>
                      <th>{t('Fecha y hora')}</th>
                      <th>{t('Actor')}</th>
                      <th>{t('Acción')}</th>
                      <th>{t('Registro [auditoría]')}</th>
                      <th>{t('Resumen [auditoría]')}</th>
                      <th>{t('Motivo')}</th>
                      <th>{t('Cambios')}</th>
                      <th>{t('Versión')}</th>
                      <th>{t('Destinatario')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((e) => {
                      const to = entityLink(e);
                      return (
                        <tr key={e.id}>
                          <td className="num small">
                            {e.seq}
                            <div className="sub mono" title={t('Huella del evento (demo)')}>
                              {e.hash}
                            </div>
                          </td>
                          <td className="small">
                            <DateTimeText at={e.at} tz={tz} />
                          </td>
                          <td className="small">
                            {t(e.actor.name)}
                            {e.actor.roles.length > 0 && <div className="sub">{e.actor.roles.map((r) => (ROLES[r] ? t(ROLES[r].label) : r)).join(', ')}</div>}
                          </td>
                          <td className="small">
                            <span className="strong">{t(actionLabel(e))}</span>
                            {e.restricted && (
                              <div>
                                <Badge tone="danger" icon={Lock}>{t('Restringido (salud)')}</Badge>
                              </div>
                            )}
                          </td>
                          <td className="small">
                            {to ? <Link to={to}>{t(e.entityLabel)}</Link> : t(e.entityLabel)}
                            <div className="sub">{entityLabel(e.entityType)}</div>
                            {e.employeeId && e.entityType !== 'employee' && <div className="sub">{employeeName(ctx.db, e.employeeId)}</div>}
                          </td>
                          <td className="small control-audit-text">{auditText(e.summary)}</td>
                          <td className="small control-audit-text">{e.reason ? auditText(e.reason) : <span className="muted">—</span>}</td>
                          <td className="small control-audit-text">
                            {e.changes.length === 0 ? (
                              <span className="muted">—</span>
                            ) : (
                              <ul className="control-changes">
                                {e.changes.map((c, i) => (
                                  <li key={i}>
                                    <span className="strong">{t(c.field)}</span>: {c.before ? auditText(c.before) : '—'} → {c.after ? auditText(c.after) : '—'}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="small">{e.version ? t(e.version) : <span className="muted">—</span>}</td>
                          <td className="small">{e.recipient ? t(e.recipient) : <span className="muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination {...paged.props} />
            </>
          )}
          <div className="card-footer tiny muted row-wrap">
            {health ? <RestrictedNote>{t('Los eventos restringidos se muestran porque su rol está autorizado para la información de aptitud.')}</RestrictedNote> : null}
            <span>{t('Fechas y horas en la zona horaria de la empresa ({tz}).', { tz })}</span>
          </div>
        </Card>
      </div>
    </>
  );
}
