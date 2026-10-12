/**
 * Incidencias y revisiones (`/incidencias`): the central queue of exceptions DERIVED from the rules
 * on every read (requirements, documents, actions, CAE, changes and — for health users — the
 * restricted area). Only the human review (owner, status, history) is stored, via updateException.
 */
import { Info, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmployeeLink, msg, RestrictedNote, WorksiteLink } from '../../components/bits';
import { Button, Callout, Card, EmptyState, PageHeader, Pagination, SortHeader, sortRows, StatusBadge, usePaged, useSort } from '../../components/ui';
import { EXCEPTION_TYPE_LABEL, isOpenException, type ExceptionType, type ExceptionView } from '../../domain/exceptions';
import { EXCEPTION_STATUS } from '../../domain/status';
import type { ExceptionStatus } from '../../domain/types';
import { t } from '../../i18n';
import { employeeName, userName, worksiteName } from '../../services/context';
import { canManageException, visibleExceptions } from '../../services/opsService';
import { useCtx } from '../../store/hooks';
import { ExceptionDetail, ExceptionTargetDate, lastReview, SEVERITY_LABEL, SEVERITY_RANK, SeverityBadge, type Severity } from './exceptionParts';

type StatusFilter = '' | 'unresolved' | ExceptionStatus;

interface Filters {
  type: ExceptionType | '';
  status: StatusFilter;
  owner: string; // '' all · '__none' unassigned · '__me' mine · user id
  severity: Severity | '';
  worksite: string;
  employee: string;
  q: string;
}

const NO_FILTERS: Filters = { type: '', status: '', owner: '', severity: '', worksite: '', employee: '', q: '' };
const TYPE_ORDER = Object.keys(EXCEPTION_TYPE_LABEL) as ExceptionType[];
const isType = (s: string | null): s is ExceptionType => !!s && s in EXCEPTION_TYPE_LABEL;

export function ExceptionsPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const all = useMemo(() => visibleExceptions(ctx), [ctx]);
  const tipo = params.get('tipo');
  const [f, setF] = useState<Filters>(() => ({ ...NO_FILTERS, type: isType(tipo) ? tipo : '', employee: params.get('empleado') ?? '', worksite: params.get('centro') ?? '' }));
  useEffect(() => {
    setF((x) => ({ ...x, type: isType(tipo) ? tipo : '' }));
  }, [tipo]);

  const updateParams = (patch: Record<string, string | null>, replace = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace });
  };
  const setType = (type: ExceptionType | '') => {
    setF((x) => ({ ...x, type }));
    updateParams({ tipo: type || null });
    paged.reset();
  };
  const set = (patch: Partial<Filters>) => {
    setF((x) => ({ ...x, ...patch }));
    paged.reset();
  };

  const openKey = params.get('clave');
  const selected = openKey ? all.find((e) => e.key === openKey) ?? null : null;

  const filtered = useMemo(() => {
    const needle = f.q.trim().toLowerCase();
    return all.filter((e) => {
      if (f.type && e.type !== f.type) return false;
      if (f.status === 'unresolved' ? !isOpenException(e.status) : f.status && e.status !== f.status) return false;
      if (f.owner && (f.owner === '__none' ? !!e.ownerUserId : f.owner === '__me' ? e.ownerUserId !== ctx.user.id : e.ownerUserId !== f.owner)) return false;
      if (f.severity && e.severity !== f.severity) return false;
      if (f.worksite && e.worksiteId !== f.worksite) return false;
      if (f.employee && e.employeeId !== f.employee) return false;
      if (needle) {
        const hay = [employeeName(ctx.db, e.employeeId), worksiteName(ctx.db, e.worksiteId), msg(e.source), msg(e.reason), t(EXCEPTION_TYPE_LABEL[e.type]), userName(ctx.db, e.ownerUserId)].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [all, f, ctx.db, ctx.user.id]);

  const { sort, onSort } = useSort('severity', 'desc');
  const rows = useMemo(
    () =>
      sortRows(filtered, sort, (e, col) =>
        col === 'severity' ? SEVERITY_RANK[e.severity] * 10 + (isOpenException(e.status) ? 1 : 0)
        : col === 'type' ? t(EXCEPTION_TYPE_LABEL[e.type])
        : col === 'subject' ? (e.employeeId ? employeeName(ctx.db, e.employeeId) : worksiteName(ctx.db, e.worksiteId))
        : col === 'owner' ? (e.ownerUserId ? userName(ctx.db, e.ownerUserId) : null)
        : col === 'target' ? e.targetDate
        : col === 'status' ? t(EXCEPTION_STATUS[e.status].label)
        : col === 'review' ? lastReview(e)?.at ?? null
        : null,
      ),
    [filtered, sort, ctx.db],
  );
  const paged = usePaged(rows, 25);

  // KPI tiles: unresolved exceptions per type (types with no exception are omitted).
  const byType = useMemo(() => {
    const m = new Map<ExceptionType, { open: number; total: number }>();
    for (const e of all) {
      const c = m.get(e.type) ?? { open: 0, total: 0 };
      c.total += 1;
      if (isOpenException(e.status)) c.open += 1;
      m.set(e.type, c);
    }
    return TYPE_ORDER.filter((ty) => m.has(ty)).map((ty) => ({ type: ty, ...m.get(ty)! }));
  }, [all]);
  const totalOpen = all.filter((e) => isOpenException(e.status)).length;

  const employees = useMemo(() => {
    const ids = [...new Set(all.map((e) => e.employeeId).filter((x): x is string => !!x))];
    return ids.map((id) => ({ id, name: employeeName(ctx.db, id) })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [all, ctx.db]);
  const worksites = useMemo(() => {
    const ids = [...new Set(all.map((e) => e.worksiteId).filter((x): x is string => !!x))];
    return ids.map((id) => ({ id, name: worksiteName(ctx.db, id) })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [all, ctx.db]);
  const owners = useMemo(() => {
    const ids = [...new Set(all.map((e) => e.ownerUserId).filter((x): x is string => !!x))];
    return ids.map((id) => ({ id, name: userName(ctx.db, id) })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [all, ctx.db]);
  const types = useMemo(() => TYPE_ORDER.filter((ty) => all.some((e) => e.type === ty)), [all]);
  const anyFilter = Object.values(f).some(Boolean);
  const manageAny = all.some((e) => canManageException(ctx, e));

  return (
    <>
      <PageHeader title={t('Incidencias y revisiones')} subtitle={t('Cola central de lo que requiere revisión: evidencias que faltan o caducan, revisiones programadas, cambios de puesto, acciones abiertas, coordinación CAE pendiente y huecos críticos.')} />
      <div className="stack">
        <Callout tone="info" icon={Info} title={t('La cola se calcula a partir de las reglas configuradas; no es una lista manual')}>
          {t('En cada consulta se derivan las incidencias de los requisitos, documentos, acciones, coordinación CAE y cambios de puesto. Solo se guarda la revisión humana: responsable, estado e historial.')}{' '}
          {t('Una incidencia marcada como resuelta cuya causa persiste sigue en la lista como «Resuelta», con la causa visible; cuando la causa desaparece de los datos, deja de aparecer.')}
          {!manageAny && all.length > 0 && <div className="small exc-readonly">{t('Su rol permite consultar estas incidencias, no gestionarlas.')}</div>}
        </Callout>

        {openKey && !selected && (
          <Callout tone="warning" title={t('Incidencia no disponible')}>
            {t('La incidencia indicada ya no se detecta en los datos o está fuera de su ámbito.')}{' '}
            <Button size="sm" variant="ghost" onClick={() => updateParams({ clave: null })}>
              {t('Cerrar aviso')}
            </Button>
          </Callout>
        )}

        {all.length > 0 && (
          <div className="kpis exc-kpis" role="group" aria-label={t('Incidencias sin resolver por tipo')}>
            <button type="button" className={`kpi ${totalOpen ? 'tone-warning' : ''}`} aria-pressed={!f.type} onClick={() => setType('')}>
              <span className="label">{t('Todas las incidencias sin resolver')}</span>
              <span className="value">{totalOpen}</span>
              <span className="meta">{t('{n} en total, incluidas las resueltas', { n: all.length })}</span>
            </button>
            {byType.map((k) => (
              <button key={k.type} type="button" className={`kpi ${k.open && (k.type === 'critical_gap' || k.type === 'expired_document' || k.type === 'quarantine') ? 'tone-danger' : ''}`} aria-pressed={f.type === k.type} onClick={() => setType(f.type === k.type ? '' : k.type)}>
                <span className="label">{t(EXCEPTION_TYPE_LABEL[k.type])}</span>
                <span className="value">{k.open}</span>
                <span className="meta">{k.total !== k.open ? t('{n} resueltas', { n: k.total - k.open }) : t('Sin resolver')}</span>
              </button>
            ))}
          </div>
        )}

        <Card flush>
          <div className="toolbar" role="search" aria-label={t('Filtros de incidencias')}>
            <div className="field search">
              <label htmlFor="ex-q">{t('Buscar')}</label>
              <div className="health-search">
                <Search size={14} aria-hidden />
                <input id="ex-q" className="input" type="search" value={f.q} placeholder={t('Empleado, centro, requisito o motivo')} onChange={(e) => set({ q: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="ex-type">{t('Tipo')}</label>
              <select id="ex-type" className="select" value={f.type} onChange={(e) => setType(e.target.value as ExceptionType | '')}>
                <option value="">{t('Todos')}</option>
                {types.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(EXCEPTION_TYPE_LABEL[ty])}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-status">{t('Estado')}</label>
              <select id="ex-status" className="select" value={f.status} onChange={(e) => set({ status: e.target.value as StatusFilter })}>
                <option value="">{t('Todos')}</option>
                <option value="unresolved">{t('Sin resolver')}</option>
                {(Object.keys(EXCEPTION_STATUS) as ExceptionStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {t(EXCEPTION_STATUS[s].label)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-owner">{t('Responsable')}</label>
              <select id="ex-owner" className="select" value={f.owner} onChange={(e) => set({ owner: e.target.value })}>
                <option value="">{t('Todos')}</option>
                <option value="__me">{t('Asignadas a mí')}</option>
                <option value="__none">{t('Sin responsable')}</option>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-sev">{t('Severidad')}</label>
              <select id="ex-sev" className="select" value={f.severity} onChange={(e) => set({ severity: e.target.value as Severity | '' })}>
                <option value="">{t('Todas')}</option>
                {(['high', 'medium', 'low'] as Severity[]).map((s) => (
                  <option key={s} value={s}>
                    {t(SEVERITY_LABEL[s])}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-ws">{t('Centro de trabajo')}</label>
              <select id="ex-ws" className="select" value={f.worksite} onChange={(e) => set({ worksite: e.target.value })}>
                <option value="">{t('Todos')}</option>
                {worksites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-emp">{t('Empleado')}</label>
              <select id="ex-emp" className="select" value={f.employee} onChange={(e) => set({ employee: e.target.value })}>
                <option value="">{t('Todos')}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            {anyFilter && (
              <Button
                variant="ghost"
                onClick={() => {
                  setF(NO_FILTERS);
                  updateParams({ tipo: null, empleado: null, centro: null });
                  paged.reset();
                }}
              >
                {t('Limpiar filtros')}
              </Button>
            )}
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={all.length === 0 ? t('No hay incidencias en su ámbito') : t('Ninguna incidencia coincide con los filtros')}>
              {all.length === 0 ? t('Cuando las reglas detecten algo que revisar (una evidencia que falta, un documento que caduca, una acción abierta…), aparecerá aquí.') : t('Cambie o limpie los filtros.')}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table exc-table">
                  <thead>
                    <tr>
                      <SortHeader label={t('Tipo')} col="type" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Empleado o centro')} col="subject" sort={sort} onSort={onSort} />
                      <th>{t('Requisito u origen')}</th>
                      <th>{t('Motivo')}</th>
                      <SortHeader label={t('Responsable')} col="owner" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Fecha objetivo')} col="target" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                      <th>{t('Siguiente paso')}</th>
                      <SortHeader label={t('Revisión')} col="review" sort={sort} onSort={onSort} />
                      <th>{t('Acciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((e) => (
                      <ExceptionRowView key={e.key} e={e} highlighted={e.key === openKey} onOpen={() => updateParams({ clave: e.key }, false)} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination {...paged.props} />
            </>
          )}
        </Card>
      </div>
      {selected && <ExceptionDetail e={selected} onClose={() => updateParams({ clave: null })} />}
    </>
  );
}

function ExceptionRowView({ e, highlighted, onOpen }: { e: ExceptionView; highlighted: boolean; onOpen: () => void }) {
  const ctx = useCtx();
  const manage = canManageException(ctx, e);
  const last = lastReview(e);
  return (
    <tr className={highlighted ? 'exc-row-highlight' : undefined} aria-current={highlighted || undefined}>
      <td>
        <div className="stack-sm exc-type">
          <span className="small strong">{t(EXCEPTION_TYPE_LABEL[e.type])}</span>
          <span className="row-wrap">
            <SeverityBadge s={e.severity} />
            {e.restricted && <RestrictedNote>{t('Área restringida')}</RestrictedNote>}
          </span>
        </div>
      </td>
      <td className="small">
        {e.employeeId && <EmployeeLink id={e.employeeId} />}
        {e.worksiteId && (
          <div className={e.employeeId ? 'sub' : undefined}>
            <WorksiteLink id={e.worksiteId} />
          </div>
        )}
        {!e.employeeId && !e.worksiteId && <span className="muted">{t('Empresa')}</span>}
      </td>
      <td className="small">{msg(e.source)}</td>
      <td className="small exc-reason">{msg(e.reason)}</td>
      <td className="small">{e.ownerUserId ? userName(ctx.db, e.ownerUserId) : <span className="muted">{t('Sin responsable')}</span>}</td>
      <td>
        <ExceptionTargetDate e={e} />
      </td>
      <td>
        <StatusBadge meta={EXCEPTION_STATUS[e.status]} />
      </td>
      <td className="small exc-reason">{msg(e.nextAction)}</td>
      <td className="small">
        {last ? (
          <>
            <span className="nowrap">{t('{n} pasos', { n: e.review!.history.length })}</span>
            <div className="sub">{userName(ctx.db, last.by)}</div>
          </>
        ) : (
          <span className="muted">{t('Sin revisar')}</span>
        )}
      </td>
      <td>
        <div className="row-wrap exc-actions">
          <Button size="sm" variant={manage && isOpenException(e.status) ? 'primary' : 'secondary'} onClick={onOpen} aria-label={t('Abrir la incidencia: {type}', { type: t(EXCEPTION_TYPE_LABEL[e.type]) })}>
            {manage ? t('Revisar') : t('Ver')}
          </Button>
          <Link className="btn sm ghost" to={e.link}>
            {t('Ir al registro')}
          </Link>
        </div>
      </td>
    </tr>
  );
}
