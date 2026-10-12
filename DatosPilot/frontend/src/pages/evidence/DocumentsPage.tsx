/**
 * Documentación (`/documentacion`): documents visible to the caller plus open evidence requests.
 * Health and quarantined documents are never listed; restricted ones only for authorised users
 * (visibleDocuments). Filters live in the URL so other screens can link here.
 */
import { FileSearch, FileText, Upload } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AccessBadge, DocStatusBadge, EmployeeLink, KindDate, WorksiteLink } from '../../components/bits';
import { Button, Callout, Card, Checkbox, DateText, EmptyState, PageHeader, Pagination, SelectField, SortHeader, StatusBadge, TextField, sortRows, usePaged, useSort } from '../../components/ui';
import { assignmentOn } from '../../domain/requirements';
import { DOC_STATUS, REQUEST_STATUS } from '../../domain/status';
import type { AccessClass, DocStatus, DocumentVersion, ID, ISODate } from '../../domain/types';
import { t } from '../../i18n';
import { canDecide, versionsOfDocument, visibleDocuments } from '../../services/evidenceService';
import { canSeeEmployee, canSeeHealth, employeeName, userName, visibleWorksiteIds, worksiteName } from '../../services/context';
import { useCtx } from '../../store/hooks';
import { LegalExpiry, RequirementRef, templateInfo } from './evidenceShared';
import { SubmitDocumentModal } from './SubmitDocumentModal';

type RowStatus = DocStatus | 'requested';
const STATUS_ORDER: RowStatus[] = ['requested', 'received', 'in_review', 'accepted', 'rejected', 'superseded'];

interface Row {
  key: string;
  kind: 'doc' | 'request';
  docId: ID | null;
  code: string;
  title: string;
  categoryId: string | null;
  categoryLabel: string;
  employeeId: ID | null;
  worksiteId: ID | null;
  subject: string;
  templateId: ID | null;
  requirement: string;
  issuer: string;
  issueDate: ISODate | null;
  version: DocumentVersion | null;
  status: RowStatus;
  followUp: ISODate | null;
  reviewerId: ID | null;
  accessClass: AccessClass | null;
  at: string;
  mine: boolean;
}

export function DocumentsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const status = get('estado');
  const employee = get('empleado');
  const category = get('categoria');
  const worksite = get('centro');
  const requirement = get('requisito');
  const q = get('q');
  const mineOnly = params.get('revision') === '1';
  const isNew = params.get('nuevo') === '1';

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    paged.reset();
  };
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  const canOthers = ctx.can('evidence.upload');
  const canOwn = ctx.can('own.submit') && !!ctx.employee;
  const canReview = ctx.can('evidence.review') || ctx.can('health.manage');

  const rows = useMemo<Row[]>(() => {
    const cats = new Map(ctx.db.categories.filter((c) => c.companyId === ctx.company.id).map((c) => [c.id, c.label]));
    const subjectOf = (empId: ID | null, wsId: ID | null) => (empId ? employeeName(ctx.db, empId) : wsId ? worksiteName(ctx.db, wsId) : t('Toda la empresa'));
    const reqText = (tid: ID | null) => {
      const info = templateInfo(ctx.db, tid, ctx.today);
      return info ? `${info.code} ${info.name}` : '';
    };
    const out: Row[] = visibleDocuments(ctx).map((d) => {
      const v = versionsOfDocument(ctx, d.id)[0] ?? null;
      return {
        key: d.id,
        kind: 'doc',
        docId: d.id,
        code: d.code,
        title: d.title,
        categoryId: d.categoryId,
        categoryLabel: cats.get(d.categoryId) ?? d.categoryId,
        employeeId: d.employeeId,
        worksiteId: d.worksiteId,
        subject: subjectOf(d.employeeId, d.worksiteId),
        templateId: d.templateId,
        requirement: reqText(d.templateId),
        issuer: v?.issuer ?? '',
        issueDate: v?.issueDate ?? null,
        version: v,
        status: v?.status ?? 'received',
        followUp: v?.internalFollowUpDate ?? null,
        reviewerId: v?.reviewerId ?? null,
        accessClass: d.accessClass,
        at: v?.receivedAt ?? d.createdAt,
        mine: !!v && (v.status === 'received' || v.status === 'in_review') && canDecide(ctx, d, v),
      };
    });
    const health = canSeeHealth(ctx);
    for (const r of ctx.db.requests) {
      if (r.companyId !== ctx.company.id || r.status !== 'open' || !r.employeeId || !canSeeEmployee(ctx, r.employeeId)) continue;
      const tpl = ctx.db.templates.find((x) => x.id === r.templateId);
      const info = templateInfo(ctx.db, r.templateId, ctx.today);
      const isHealth = ctx.db.versions.some((v) => v.templateId === r.templateId && v.category === 'health_surveillance');
      if (isHealth && !health && r.employeeId !== ctx.employee?.id) continue;
      out.push({
        key: r.id,
        kind: 'request',
        docId: null,
        code: '',
        title: info?.name ?? tpl?.code ?? '',
        categoryId: null,
        categoryLabel: '',
        employeeId: r.employeeId,
        worksiteId: r.worksiteId,
        subject: subjectOf(r.employeeId, r.worksiteId),
        templateId: r.templateId,
        requirement: reqText(r.templateId),
        issuer: '',
        issueDate: null,
        version: null,
        status: 'requested',
        followUp: r.followUpDate,
        reviewerId: null,
        accessClass: null,
        at: r.requestedAt,
        mine: false,
      });
    }
    return out;
  }, [ctx]);

  const siteOf = useMemo(() => {
    const cache = new Map<ID, ID[]>();
    return (empId: ID) => {
      if (!cache.has(empId)) cache.set(empId, assignmentOn(ctx.db, empId, ctx.today)?.worksiteIds ?? []);
      return cache.get(empId)!;
    };
  }, [ctx]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (employee && r.employeeId !== employee) return false;
      if (category && r.categoryId !== category) return false;
      if (requirement && r.templateId !== requirement) return false;
      if (worksite && r.worksiteId !== worksite && !(r.employeeId && siteOf(r.employeeId).includes(worksite))) return false;
      if (mineOnly && !r.mine) return false;
      if (needle && ![r.code, r.title, r.subject, r.issuer, r.requirement, r.categoryLabel].some((x) => x.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, status, employee, category, requirement, worksite, mineOnly, q, siteOf]);

  const { sort, onSort } = useSort('at', 'desc');
  const sorted = sortRows(filtered, sort, (r, col) => {
    switch (col) {
      case 'code':
        return r.code || null;
      case 'title':
        return r.title;
      case 'category':
        return r.categoryLabel || null;
      case 'subject':
        return r.subject;
      case 'requirement':
        return r.requirement || null;
      case 'issuer':
        return r.issuer || null;
      case 'issue':
        return r.issueDate;
      case 'legal':
        return r.version?.legalExpiryDate ?? null;
      case 'provider':
        return r.version?.providerReviewDate ?? null;
      case 'internal':
        return r.followUp;
      case 'status':
        return STATUS_ORDER.indexOf(r.status);
      case 'reviewer':
        return r.reviewerId ? userName(ctx.db, r.reviewerId) : null;
      default:
        return r.at;
    }
  });
  const paged = usePaged(sorted, 25);

  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  const mineCount = rows.filter((r) => r.mine).length;

  const employeeOptions = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.employeeId).filter((x): x is ID => !!x))];
    return ids.map((id) => ({ id, name: employeeName(ctx.db, id) })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [rows, ctx.db]);
  const requirementOptions = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.templateId).filter((x): x is ID => !!x))];
    return ids
      .map((id) => ({ id, info: templateInfo(ctx.db, id, ctx.today) }))
      .filter((x) => !!x.info)
      .sort((a, b) => a.info!.code.localeCompare(b.info!.code, 'es'));
  }, [rows, ctx.db, ctx.today]);
  const worksiteIds = visibleWorksiteIds(ctx);
  const worksites = ctx.db.worksites.filter((w) => worksiteIds.has(w.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const categories = ctx.db.categories.filter((c) => c.companyId === ctx.company.id && c.accessClass !== 'health' && c.accessClass !== 'quarantined');
  const anyFilter = !!(status || employee || category || worksite || requirement || q || mineOnly);

  const kpi = (label: string, value: number, onClick: () => void, active: boolean, tone?: 'warning' | 'danger', meta?: string) => (
    <button type="button" className={`kpi ${tone ? `tone-${tone}` : ''} ${active ? 'ev-kpi-active' : ''}`} onClick={onClick} aria-pressed={active}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {meta && <span className="meta">{meta}</span>}
    </button>
  );

  return (
    <div className="stack-lg">
      <PageHeader
        title={t('Documentación')}
        subtitle={t('Documentos y evidencias de prevención en su ámbito, con su historial de versiones y las solicitudes abiertas. La subida no implica aprobación.')}
        actions={
          (canOthers || canOwn) && (
            <Button variant="primary" icon={Upload} onClick={() => setParam('nuevo', '1')}>
              {t('Presentar documento')}
            </Button>
          )
        }
      />

      <div className="kpis">
        {kpi(t('Solicitudes abiertas'), count('requested'), () => setParam('estado', status === 'requested' ? '' : 'requested'), status === 'requested', 'warning', t('Evidencia pedida y aún no presentada'))}
        {kpi(t('Recibidos'), count('received'), () => setParam('estado', status === 'received' ? '' : 'received'), status === 'received', undefined, t('Pendientes de que empiece la revisión'))}
        {kpi(t(DOC_STATUS.in_review.label), count('in_review'), () => setParam('estado', status === 'in_review' ? '' : 'in_review'), status === 'in_review')}
        {canReview && kpi(t('Pendientes de mi revisión'), mineCount, () => setParam('revision', mineOnly ? '' : '1'), mineOnly, mineCount ? 'warning' : undefined, t('Según la autoridad de revisión configurada'))}
        {kpi(t('Rechazados'), count('rejected'), () => setParam('estado', status === 'rejected' ? '' : 'rejected'), status === 'rejected', count('rejected') ? 'danger' : undefined, t('Última versión rechazada con motivo'))}
      </div>

      <Card flush>
        <div className="toolbar">
          <TextField className="search" label={t('Buscar')} type="search" placeholder={t('Código, título, persona, emisor…')} value={q} onChange={(e) => setParam('q', e.target.value)} />
          <SelectField label={t('Estado')} value={status} onChange={(e) => setParam('estado', e.target.value)}>
            <option value="">{t('Todos')}</option>
            <option value="requested">{t(REQUEST_STATUS.open.label)}</option>
            {(['received', 'in_review', 'accepted', 'rejected', 'superseded'] as DocStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(DOC_STATUS[s].label)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Tipo de documento')} value={category} onChange={(e) => setParam('categoria', e.target.value)}>
            <option value="">{t('Todos')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
          {employeeOptions.length > 1 && (
            <SelectField label={t('Empleado')} value={employee} onChange={(e) => setParam('empleado', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {employeeOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </SelectField>
          )}
          {worksites.length > 1 && (
            <SelectField label={t('Centro')} value={worksite} onChange={(e) => setParam('centro', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField label={t('Requisito')} value={requirement} onChange={(e) => setParam('requisito', e.target.value)}>
            <option value="">{t('Todos')}</option>
            {requirementOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.info!.code} · {r.info!.name}
              </option>
            ))}
          </SelectField>
          {canReview && (
            <div className="ev-toolbar-check">
              <Checkbox label={t('Pendientes de mi revisión')} checked={mineOnly} onChange={(v) => setParam('revision', v ? '1' : '')} />
            </div>
          )}
          {anyFilter && (
            <Button variant="ghost" onClick={clearFilters}>
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={FileText} title={t('Sin documentos en su ámbito')} action={(canOthers || canOwn) && <Button icon={Upload} onClick={() => setParam('nuevo', '1')}>{t('Presentar documento')}</Button>}>
            {t('Aquí aparecerán los documentos que pueda consultar según su rol y las solicitudes de evidencia abiertas.')}
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FileSearch} title={t('Ningún documento coincide con los filtros')} action={<Button onClick={clearFilters}>{t('Limpiar filtros')}</Button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table ev-docs-table">
                <thead>
                  <tr>
                    <SortHeader label={t('Código')} col="code" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Título')} col="title" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Tipo')} col="category" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Empleado o centro')} col="subject" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Requisito')} col="requirement" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Emisor')} col="issuer" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Fecha de emisión')} col="issue" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Caducidad legal')} col="legal" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Revisión del proveedor')} col="provider" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Seguimiento interno')} col="internal" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Versión y estado')} col="status" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Persona revisora')} col="reviewer" sort={sort} onSort={onSort} />
                    <th>{t('Acceso')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => (
                    <tr key={r.key} className={r.kind === 'doc' ? 'clickable' : 'ev-request-row'} onClick={r.docId ? () => navigate(`/documentacion/${r.docId}`) : undefined}>
                      <td className="nowrap">{r.kind === 'doc' ? <span className="tag">{r.code}</span> : <span className="muted small">{t('Solicitud')}</span>}</td>
                      <td className="ev-title-cell">
                        {r.docId ? (
                          <Link to={`/documentacion/${r.docId}`} onClick={(e) => e.stopPropagation()}>
                            {r.title}
                          </Link>
                        ) : (
                          <>
                            <span>{r.title}</span>
                            {(canOthers || (canOwn && r.employeeId === ctx.employee?.id)) && r.employeeId && r.templateId && (
                              <span className="sub" style={{ display: 'block' }}>
                                <Link to={`/documentacion?nuevo=1&requisito=${r.templateId}&empleado=${r.employeeId}`} onClick={(e) => e.stopPropagation()}>
                                  {t('Presentar documento')}
                                </Link>
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="small ev-cat">{r.categoryLabel || <span className="muted">—</span>}</td>
                      <td onClick={(e) => e.stopPropagation()}>{r.employeeId ? <EmployeeLink id={r.employeeId} /> : r.worksiteId ? <WorksiteLink id={r.worksiteId} /> : <span className="muted">{t('Toda la empresa')}</span>}</td>
                      <td className="small ev-req" onClick={(e) => e.stopPropagation()}>
                        {r.templateId ? <RequirementRef templateId={r.templateId} /> : <span className="muted">—</span>}
                      </td>
                      <td className="small">{r.issuer || <span className="muted">—</span>}</td>
                      <td>{r.issueDate ? <DateText date={r.issueDate} /> : <span className="muted">—</span>}</td>
                      <td>{r.version ? <LegalExpiry v={r.version} /> : <span className="muted">—</span>}</td>
                      <td>{r.version ? <KindDate kind="provider" date={r.version.providerReviewDate} today={r.version.status === 'accepted' ? ctx.today : undefined} /> : <span className="muted">—</span>}</td>
                      <td>{r.version || r.followUp ? <KindDate kind="internal" date={r.followUp} today={ctx.today} /> : <span className="muted">—</span>}</td>
                      <td>
                        {r.version ? (
                          <span className="ev-status-cell">
                            <span className="small muted nowrap">{t('v{n}', { n: r.version.version })}</span>
                            <DocStatusBadge status={r.version.status} />
                          </span>
                        ) : (
                          <StatusBadge meta={REQUEST_STATUS.open} />
                        )}
                        {r.mine && <span className="sub" style={{ display: 'block' }}>{t('Le corresponde revisar')}</span>}
                      </td>
                      <td className="small">{r.reviewerId ? userName(ctx.db, r.reviewerId) : <span className="muted">—</span>}</td>
                      <td>{r.accessClass ? r.accessClass === 'ordinary' ? <span className="small muted">{t('Ordinario')}</span> : <AccessBadge cls={r.accessClass} /> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>

      <Callout tone="neutral">
        {t('Los documentos con posible contenido médico o clínico no aparecen en esta lista: van a cuarentena y solo los gestiona el servicio médico en el área restringida. La caducidad legal, la revisión del proveedor y el seguimiento interno son fechas distintas; si el emisor no indica la caducidad no se inventa ninguna.')}
      </Callout>

      {isNew && (canOthers || canOwn) && (
        <SubmitDocumentModal
          initialEmployeeId={params.get('empleado')}
          initialTemplateId={params.get('requisito')}
          trainingId={params.get('formacion')}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete('nuevo');
            next.delete('formacion');
            setParams(next, { replace: true });
          }}
          onSubmitted={(id) => navigate(`/documentacion/${id}`)}
        />
      )}
    </div>
  );
}

