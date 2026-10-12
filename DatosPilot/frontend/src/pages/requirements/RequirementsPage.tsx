/**
 * Requisitos PRL — catalogue of requirement templates (PRL-01, PRL-07).
 * Search, filters, sorting and pagination over the current/latest version of each template;
 * counts per status; pending approvals highlighted for the professional approvers.
 */
import { ClipboardList, FilePlus2, ShieldQuestion } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { affectedBy } from '../../domain/requirements';
import { CATEGORY_LABEL, REQUIREMENT_TYPE, VERSION_STATUS } from '../../domain/status';
import type { RequirementCategory, RequirementType, ReviewAuthority, VersionStatus } from '../../domain/types';
import { t } from '../../i18n';
import { alertDays, userName, visibleEmployeeIds } from '../../services/context';
import { approvalPermission, templateRows } from '../../services/requirementService';
import { useCtx } from '../../store/hooks';
import { Badge, Button, Callout, Card, DateText, EmptyState, PageHeader, Pagination, SelectField, SortHeader, StatusBadge, TextField, sortRows, usePaged, useSort } from '../../components/ui';
import { CriticalBadge, FILTER_STATUSES, TypeBadge, approverBlock, canDraft, isApprover, primaryStatus, rowFlags, type TemplateRow } from './shared';
import { VersionForm } from './VersionForm';

type CriticalFilter = '' | 'yes' | 'no';

export function RequirementsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState<RequirementCategory | ''>((params.get('categoria') as RequirementCategory) ?? '');
  const [type, setType] = useState<RequirementType | ''>((params.get('tipo') as RequirementType) ?? '');
  const [status, setStatus] = useState<VersionStatus | ''>((params.get('estado') as VersionStatus) ?? '');
  const [critical, setCritical] = useState<CriticalFilter>('');
  const [authority, setAuthority] = useState<ReviewAuthority | ''>('');
  const { sort, onSort } = useSort('code', 'asc');
  const creating = params.get('nuevo') === '1';
  const mayDraft = canDraft(ctx);

  const rows = useMemo(() => templateRows(ctx), [ctx]);
  const visible = useMemo(() => visibleEmployeeIds(ctx), [ctx]);
  const affectedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.template.id, new Set(affectedBy(ctx.db, ctx.company.id, r.template.id, ctx.today, alertDays(ctx)).filter((i) => visible.has(i.employeeId)).map((i) => i.employeeId)).size);
    return m;
  }, [rows, ctx, visible]);

  const flags = useMemo(() => new Map(rows.map((r) => [r.template.id, rowFlags(r, ctx.today)])), [rows, ctx.today]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of FILTER_STATUSES) c[s] = rows.filter((r) => flags.get(r.template.id)!.has(s)).length;
    return c;
  }, [rows, flags]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const v = r.display;
      if (needle && ![r.template.code, v.name, v.description, v.source.label, v.applicabilityNote].some((s) => s.toLowerCase().includes(needle))) return false;
      if (category && v.category !== category) return false;
      if (type && v.requirementType !== type) return false;
      if (status && !flags.get(r.template.id)!.has(status)) return false;
      if (critical && (critical === 'yes') !== v.critical) return false;
      if (authority && v.reviewAuthority !== authority) return false;
      return true;
    });
  }, [rows, q, category, type, status, critical, authority, flags]);

  const sorted = sortRows(filtered, sort, (r, col) => {
    const v = r.display;
    switch (col) {
      case 'code': return r.template.code;
      case 'name': return v.name;
      case 'type': return t(REQUIREMENT_TYPE[v.requirementType].label);
      case 'status': return t(VERSION_STATUS[primaryStatus(r, ctx.today)].label);
      case 'critical': return v.critical ? 1 : 0;
      case 'authority': return t(AUTHORITY_LABEL[v.reviewAuthority]);
      case 'from': return v.effectiveFrom;
      case 'affected': return affectedCount.get(r.template.id) ?? 0;
      default: return null;
    }
  });
  const paged = usePaged(sorted, 25);
  const { reset } = paged;
  useEffect(() => reset(), [q, category, type, status, critical, authority]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pending approvals for this approver (own drafts are listed with the four-eyes reason).
  const approvable = rows.filter((r) => r.pending && ctx.can(approvalPermission(r.pending)));
  const pendingIds = new Set(approvable.map((r) => r.template.id));

  const openForm = () => setParams((p) => { p.set('nuevo', '1'); return p; });
  const closeForm = () => setParams((p) => { p.delete('nuevo'); return p; });
  const anyFilter = !!(q || category || type || status || critical || authority);
  const clear = () => { setQ(''); setCategory(''); setType(''); setStatus(''); setCritical(''); setAuthority(''); };

  return (
    <div className="stack-lg">
      <PageHeader
        title={t('Requisitos PRL')}
        subtitle={t('Plantillas versionadas de los requisitos de prevención que la política aprobada exige por puesto, centro o riesgo. Cada requisito indica su fuente y quién lo aprobó.')}
        actions={
          mayDraft ? (
            <Button variant="primary" icon={FilePlus2} onClick={openForm}>
              {t('Nuevo requisito')}
            </Button>
          ) : undefined
        }
      />

      <div className="kpis rq-kpis" role="group" aria-label={t('Requisitos por estado')}>
        {FILTER_STATUSES.map((s) => (
          <button key={s} type="button" title={t(VERSION_STATUS[s].help)} className={`kpi ${s === 'pending_approval' && counts[s] ? 'tone-warning' : ''} ${status === s ? 'rq-kpi-on' : ''}`} aria-pressed={status === s} onClick={() => setStatus(status === s ? '' : s)}>
            <span className="label">{t(VERSION_STATUS[s].label)}</span>
            <span className="value">{counts[s]}</span>
          </button>
        ))}
      </div>

      {isApprover(ctx) && approvable.length > 0 && (
        <Callout tone="warning" icon={ShieldQuestion} title={t('Aprobaciones pendientes que le corresponden ({n})', { n: approvable.length })}>
          <ul className="rq-pending-list">
            {approvable.map((r) => {
              const block = approverBlock(ctx, r.pending!);
              return (
                <li key={r.template.id}>
                  <Link to={`/requisitos/${r.template.id}`}>
                    {r.template.code} · {r.pending!.name} (v{r.pending!.version})
                  </Link>{' '}
                  <span className="tiny muted">
                    · {t('Propuesto por {who}', { who: userName(ctx.db, r.pending!.createdBy) })}
                    {block ? ` · ${block}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </Callout>
      )}

      <Card flush>
        <div className="toolbar">
          <TextField className="search" label={t('Buscar')} type="search" placeholder={t('Código, nombre, fuente…')} value={q} onChange={(e) => setQ(e.target.value)} />
          <SelectField label={t('Categoría')} value={category} onChange={(e) => setCategory(e.target.value as RequirementCategory | '')}>
            <option value="">{t('Todas')}</option>
            {(Object.keys(CATEGORY_LABEL) as RequirementCategory[]).map((c) => (
              <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>
            ))}
          </SelectField>
          <SelectField label={t('Tipo')} value={type} onChange={(e) => setType(e.target.value as RequirementType | '')}>
            <option value="">{t('Todos')}</option>
            {(Object.keys(REQUIREMENT_TYPE) as RequirementType[]).map((k) => (
              <option key={k} value={k}>{t(REQUIREMENT_TYPE[k].label)}</option>
            ))}
          </SelectField>
          <SelectField label={t('Estado')} value={status} onChange={(e) => setStatus(e.target.value as VersionStatus | '')}>
            <option value="">{t('Todos')}</option>
            {FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>{t(VERSION_STATUS[s].label)}</option>
            ))}
          </SelectField>
          <SelectField label={t('Crítico')} value={critical} onChange={(e) => setCritical(e.target.value as CriticalFilter)}>
            <option value="">{t('Todos')}</option>
            <option value="yes">{t('Sí')}</option>
            <option value="no">{t('No')}</option>
          </SelectField>
          <SelectField label={t('Autoridad de revisión')} value={authority} onChange={(e) => setAuthority(e.target.value as ReviewAuthority | '')}>
            <option value="">{t('Todas')}</option>
            {(Object.keys(AUTHORITY_LABEL) as ReviewAuthority[]).map((a) => (
              <option key={a} value={a}>{t(AUTHORITY_LABEL[a])}</option>
            ))}
          </SelectField>
          {anyFilter && (
            <Button variant="ghost" onClick={clear}>
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t('Todavía no hay requisitos configurados')} action={mayDraft ? <Button variant="primary" icon={FilePlus2} onClick={openForm}>{t('Nuevo requisito')}</Button> : undefined}>
            {t('Configure los requisitos a partir de la evaluación de riesgos, las normas aplicables y el criterio del servicio de prevención.')}
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t('Ningún requisito coincide con los filtros')} action={<Button onClick={clear}>{t('Limpiar filtros')}</Button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table rq-table">
                <caption className="sr-only">{t('Catálogo de requisitos PRL')}</caption>
                <thead>
                  <tr>
                    <SortHeader label={t('Código')} col="code" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Requisito')} col="name" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Tipo')} col="type" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Crítico')} col="critical" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Autoridad de revisión')} col="authority" sort={sort} onSort={onSort} />
                    <SortHeader label={t('En vigor desde')} col="from" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Personas afectadas')} col="affected" sort={sort} onSort={onSort} num />
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => (
                    <CatalogueRow key={r.template.id} row={r} highlight={pendingIds.has(r.template.id)} affected={affectedCount.get(r.template.id) ?? 0} onOpen={() => navigate(`/requisitos/${r.template.id}`)} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>

      {creating && mayDraft && <VersionForm mode="create" onClose={closeForm} onSaved={(id) => navigate(`/requisitos/${id}`)} />}
    </div>
  );
}

function CatalogueRow({ row, highlight, affected, onOpen }: { row: TemplateRow; highlight: boolean; affected: number; onOpen: () => void }) {
  const ctx = useCtx();
  const v = row.display;
  const main = primaryStatus(row, ctx.today);
  const extra: VersionStatus[] = [];
  if (row.pending && main !== 'pending_approval') extra.push('pending_approval');
  if (row.scheduled && main !== 'scheduled') extra.push('scheduled');
  if (row.latest?.status === 'draft' && main !== 'draft') extra.push('draft');
  if (row.latest?.status === 'rejected' && main !== 'rejected') extra.push('rejected');
  return (
    <tr className={`clickable ${highlight ? 'rq-row-pending' : ''}`} onClick={onOpen}>
      <td className="nowrap strong">
        <Link to={`/requisitos/${row.template.id}`} onClick={(e) => e.stopPropagation()}>
          {row.template.code}
        </Link>
      </td>
      <td className="rq-name-cell">
        <div>{v.name}</div>
        <div className="sub">
          {t(CATEGORY_LABEL[v.category])} · v{v.version}
        </div>
      </td>
      <td className="rq-type-cell">
        <TypeBadge v={v} />
      </td>
      <td>
        <div className="status-stack">
          <StatusBadge meta={VERSION_STATUS[main]} />
          {extra.map((s) => (
            <Badge key={s} tone={VERSION_STATUS[s].tone} title={t(VERSION_STATUS[s].help)}>
              {s === 'pending_approval' ? t('Nueva versión pendiente') : s === 'scheduled' ? t('Versión programada') : s === 'draft' ? t('Borrador en curso') : t('Última propuesta rechazada')}
            </Badge>
          ))}
        </div>
      </td>
      <td>{v.critical ? <CriticalBadge v={v} /> : <span className="muted">{t('No')}</span>}</td>
      <td className="small rq-auth-cell">{t(AUTHORITY_LABEL[v.reviewAuthority])}</td>
      <td>
        <DateText date={(row.scheduled && !row.current ? row.scheduled : v).effectiveFrom} />
      </td>
      <td className="num">{affected}</td>
    </tr>
  );
}
