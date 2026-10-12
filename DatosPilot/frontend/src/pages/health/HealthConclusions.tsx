import { CheckCheck, History, Lock, Plus, Search, Stethoscope } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmployeeLink } from '../../components/bits';
import { Badge, Button, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, Pagination, SortHeader, sortRows, useAction, usePaged, useSort } from '../../components/ui';
import { FITNESS_LABEL } from '../../domain/status';
import type { FitnessConclusion, HealthConclusion, ID } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { employeeName, userName } from '../../services/context';
import { confirmMeasures } from '../../services/healthService';
import { useCtx } from '../../store/hooks';
import { ConclusionModal } from './healthForms';
import { ClinicalReferenceButton, FitnessBadge, HealthHistoryModal, type HealthRow } from './healthShared';

type Situation = '' | FitnessConclusion | 'measures_pending' | 'awaiting' | 'none';

const RANK: Record<FitnessConclusion, number> = { unfit: 4, temporarily_unfit: 3, fit_with_measures: 2, fit: 1 };

/** What the row shows when there is no current conclusion. */
function withoutConclusion(r: HealthRow): string {
  const o = r.offer;
  if (!o) return tKey('Sin oferta registrada');
  if (o.response === 'pending') return tKey('Oferta pendiente de respuesta');
  if (o.response === 'declined') return tKey('Oferta no aceptada (no es un incumplimiento)');
  return tKey('Oferta aceptada: pendiente de la conclusión del servicio médico');
}

const awaiting = (r: HealthRow) => !r.conclusion && r.offer?.response === 'accepted';
const measuresPending = (c: HealthConclusion | null) => !!c && c.conclusion === 'fit_with_measures' && !c.measuresConfirmedAt;

export function ConclusionsTab({ rows, employeeId, onEmployee }: { rows: HealthRow[]; employeeId: ID; onEmployee: (id: ID) => void }) {
  const ctx = useCtx();
  const manage = ctx.can('health.manage');
  const [q, setQ] = useState('');
  const [situation, setSituation] = useState<Situation>('');
  const [concludeFor, setConcludeFor] = useState<{ employeeId: ID | null } | null>(null);
  const [confirmFor, setConfirmFor] = useState<HealthConclusion | null>(null);
  const [historyOf, setHistoryOf] = useState<ID | null>(null);
  const historyRow = historyOf ? rows.find((r) => r.employee.id === historyOf) ?? null : null;
  const { runOk } = useAction();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (employeeId && r.employee.id !== employeeId) return false;
      if (needle && !employeeName(ctx.db, r.employee.id).toLowerCase().includes(needle) && !r.employee.code.toLowerCase().includes(needle)) return false;
      if (!situation) return true;
      if (situation === 'measures_pending') return measuresPending(r.conclusion);
      if (situation === 'awaiting') return awaiting(r);
      if (situation === 'none') return !r.conclusion;
      return r.conclusion?.conclusion === situation;
    });
  }, [rows, employeeId, q, situation, ctx.db]);
  const { sort, onSort } = useSort('conclusion', 'desc');
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (r, col) => {
        const c = r.conclusion;
        if (col === 'employee') return employeeName(ctx.db, r.employee.id);
        if (col === 'conclusion') return c ? RANK[c.conclusion] * 10 + (measuresPending(c) ? 5 : 0) : awaiting(r) ? 1 : 0;
        if (col === 'date') return c?.conclusionDate ?? null;
        if (col === 'next') return c?.nextReviewDate ?? null;
        return null;
      }),
    [filtered, sort, ctx.db],
  );
  const paged = usePaged(sorted, 25);
  const counts = {
    pendingMeasures: rows.filter((r) => measuresPending(r.conclusion)).length,
    awaiting: rows.filter(awaiting).length,
    restricted: rows.filter((r) => r.conclusion && (r.conclusion.conclusion === 'temporarily_unfit' || r.conclusion.conclusion === 'unfit')).length,
  };
  const anyFilter = !!(q || situation || employeeId);

  return (
    <div className="stack">
      <div className="kpis health-kpis">
        <button type="button" className={`kpi ${counts.pendingMeasures ? 'tone-warning' : ''}`} aria-pressed={situation === 'measures_pending'} onClick={() => setSituation(situation === 'measures_pending' ? '' : 'measures_pending')}>
          <span className="label">{t('Medidas pendientes de aplicar')}</span>
          <span className="value">{counts.pendingMeasures}</span>
          <span className="meta">{t('Conclusiones «apto con medidas» sin confirmar')}</span>
        </button>
        <button type="button" className="kpi" aria-pressed={situation === 'awaiting'} onClick={() => setSituation(situation === 'awaiting' ? '' : 'awaiting')}>
          <span className="label">{t('Pendientes del servicio médico')}</span>
          <span className="value">{counts.awaiting}</span>
          <span className="meta">{t('Ofertas aceptadas sin conclusión')}</span>
        </button>
        <div className="kpi health-kpi-static">
          <span className="label">{t('No aptos (temporal o definitivo)')}</span>
          <span className="value">{counts.restricted}</span>
          <span className="meta">{t('No asignar a la tarea evaluada')}</span>
        </div>
      </div>
      <Card
        flush
        title={
          <h2 className="row">
            <Stethoscope size={16} aria-hidden /> {t('Conclusiones de aptitud vigentes')}
          </h2>
        }
        actions={
          manage ? (
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setConcludeFor({ employeeId: employeeId || null })}>
              {t('Registrar conclusión')}
            </Button>
          ) : (
            <span className="health-locked small">
              <Lock size={12} aria-hidden /> {t('Solo el servicio médico registra conclusiones')}
            </span>
          )
        }
      >
        <div className="toolbar" role="search" aria-label={t('Filtros de conclusiones')}>
          <div className="field search">
            <label htmlFor="hc-q">{t('Buscar')}</label>
            <div className="health-search">
              <Search size={14} aria-hidden />
              <input id="hc-q" className="input" type="search" value={q} placeholder={t('Nombre o código de empleado')} onChange={(e) => { setQ(e.target.value); paged.reset(); }} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="hc-emp">{t('Empleado')}</label>
            <select id="hc-emp" className="select" value={employeeId} onChange={(e) => { onEmployee(e.target.value); paged.reset(); }}>
              <option value="">{t('Todos')}</option>
              {rows.map((r) => (
                <option key={r.employee.id} value={r.employee.id}>
                  {employeeName(ctx.db, r.employee.id)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hc-sit">{t('Situación de aptitud')}</label>
            <select id="hc-sit" className="select" value={situation} onChange={(e) => { setSituation(e.target.value as Situation); paged.reset(); }}>
              <option value="">{t('Todas')}</option>
              {(Object.keys(FITNESS_LABEL) as FitnessConclusion[]).map((c) => (
                <option key={c} value={c}>
                  {t(FITNESS_LABEL[c].label)}
                </option>
              ))}
              <option value="measures_pending">{t('Medidas pendientes de aplicar')}</option>
              <option value="awaiting">{t('Pendientes del servicio médico')}</option>
              <option value="none">{t('Sin conclusión vigente')}</option>
            </select>
          </div>
          {anyFilter && (
            <Button variant="ghost" onClick={() => { setQ(''); setSituation(''); onEmployee(''); }}>
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon={Stethoscope} title={rows.length === 0 ? t('No hay personas trabajadoras en su ámbito') : t('Ninguna persona coincide con los filtros')}>
            {rows.length === 0 ? undefined : t('Cambie o limpie los filtros.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table health-table">
                <thead>
                  <tr>
                    <SortHeader label={t('Empleado')} col="employee" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Conclusión')} col="conclusion" sort={sort} onSort={onSort} />
                    <th>{t('Ámbito')}</th>
                    <th>{t('Medidas operativas')}</th>
                    <SortHeader label={t('Fecha de la conclusión')} col="date" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Próxima revisión')} col="next" sort={sort} onSort={onSort} />
                    <th>{t('Registrada por')}</th>
                    <th>{t('Medidas aplicadas')}</th>
                    <th>{t('Acciones')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => {
                    const c = r.conclusion;
                    const superseded = r.conclusions.filter((x) => x.status === 'superseded').length;
                    return (
                      <tr key={r.employee.id} className={employeeId === r.employee.id ? 'health-row-focus' : undefined}>
                        <td>
                          <EmployeeLink id={r.employee.id} />
                          <div className="sub">{r.employee.code}</div>
                        </td>
                        {c ? (
                          <>
                            <td>
                              <FitnessBadge c={c.conclusion} />
                            </td>
                            <td className="small health-scope">{c.scope}</td>
                            <td className="small health-measures">{c.measures || <span className="muted">{t('Sin medidas indicadas')}</span>}</td>
                            <td>
                              <DateText date={c.conclusionDate} />
                            </td>
                            <td>
                              {c.nextReviewDate ? (
                                <span className={c.nextReviewDate < ctx.today ? 'health-overdue' : undefined}>
                                  <DateText date={c.nextReviewDate} />
                                </span>
                              ) : (
                                <span className="muted small">{t('No indicada por el servicio médico')}</span>
                              )}
                            </td>
                            <td className="small">{userName(ctx.db, c.recordedBy)}</td>
                            <td>
                              {c.conclusion !== 'fit_with_measures' ? (
                                <span className="muted small">{t('Sin medidas que confirmar')}</span>
                              ) : c.measuresConfirmedAt ? (
                                <>
                                  <Badge tone="success">{t('Aplicadas')}</Badge>
                                  <div className="sub">
                                    {userName(ctx.db, c.measuresConfirmedBy)} · <DateTimeText at={c.measuresConfirmedAt} tz={ctx.company.timezone} />
                                  </div>
                                </>
                              ) : (
                                <Badge tone="warning">{t('Pendientes de aplicar')}</Badge>
                              )}
                            </td>
                          </>
                        ) : (
                          <td colSpan={7} className="small muted">
                            {t(withoutConclusion(r))}
                          </td>
                        )}
                        <td>
                          <div className="row-wrap health-actions">
                            {manage && (
                              <Button size="sm" variant={awaiting(r) ? 'primary' : 'secondary'} icon={Plus} onClick={() => setConcludeFor({ employeeId: r.employee.id })} aria-label={t('Registrar conclusión para {name}', { name: employeeName(ctx.db, r.employee.id) })}>
                                {t('Registrar conclusión')}
                              </Button>
                            )}
                            {measuresPending(c) && (
                              <Button size="sm" variant="primary" icon={CheckCheck} onClick={() => setConfirmFor(c)} aria-label={t('Confirmar medidas aplicadas de {name}', { name: employeeName(ctx.db, r.employee.id) })}>
                                {t('Confirmar medidas aplicadas')}
                              </Button>
                            )}
                            {c && <ClinicalReferenceButton employeeId={r.employee.id} />}
                            {(r.conclusions.length > 0 || r.offers.length > 0) && (
                              <Button size="sm" variant="ghost" icon={History} onClick={() => setHistoryOf(r.employee.id)} aria-label={t('Historial de {name}', { name: employeeName(ctx.db, r.employee.id) })}>
                                {superseded ? t('Historial ({n} anteriores)', { n: superseded }) : t('Historial')}
                              </Button>
                            )}
                          </div>
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
      {concludeFor && <ConclusionModal employeeId={concludeFor.employeeId} onClose={() => setConcludeFor(null)} />}
      {historyRow && <HealthHistoryModal row={historyRow} onClose={() => setHistoryOf(null)} />}
      {confirmFor && (
        <ConfirmDialog
          title={t('Confirmar medidas preventivas aplicadas')}
          message={
            <div className="stack-sm">
              <p className="small">
                <strong>{employeeName(ctx.db, confirmFor.employeeId)}</strong>
                {' · '}
                {confirmFor.measures}
              </p>
              <p className="small muted">{t('Confirme que la empresa ha aplicado las medidas operativas indicadas por el servicio médico. Describa cómo (sin datos clínicos); queda en la auditoría restringida.')}</p>
            </div>
          }
          confirmLabel={t('Confirmar medidas aplicadas')}
          requireReason
          reasonLabel={t('Cómo se han aplicado las medidas')}
          onConfirm={(note) => runOk(() => confirmMeasures(confirmFor.id, note), t('Medidas preventivas registradas como aplicadas'))}
          onClose={() => setConfirmFor(null)}
        />
      )}
    </div>
  );
}
