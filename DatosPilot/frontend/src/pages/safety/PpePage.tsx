/**
 * Equipos de protección (EPI): catalogue, issues with the worker's acknowledgement kept as a
 * separate fact, and the employee's own equipment. The app records facts; the risk assessment
 * and the prevention policy decide which equipment is required or sufficient.
 */
import { CheckCircle2, ClipboardCheck, FileText, HardHat, Pencil, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmployeeLink, WorksiteLink } from '../../components/bits';
import { ExportButton } from '../../components/ExportButton';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, PageHeader, Pagination, SelectField, SortHeader, StatusBadge, Tabs, TextField, sortRows, useAction, usePaged, useSort } from '../../components/ui';
import { ISSUE_STATUS } from '../../domain/status';
import { addDays } from '../../domain/time';
import type { Acknowledgement, EquipmentIssue, EquipmentItem, IssueStatus } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { alertDays, employeeName, roleName, visibleWorksiteIds, worksiteName } from '../../services/context';
import { acknowledgeIssue } from '../../services/evidenceService';
import { EMPTY_FILTERS } from '../../services/reportService';
import { visibleIssues } from '../../services/trainingService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { ACK_METHOD_LABEL, CloseIssueDialog, EquipmentDialog, IssueDetailDialog, IssueDialog, issueHistoryText } from './PpeDialogs';
import { KpiButton, NameList, PpeSchedule, ScheduledDate } from './shared';

type TabId = 'catalogo' | 'entregas' | 'mis-equipos';
type StatusFilter = '' | IssueStatus | 'pending_ack' | 'review_soon' | 'lost_open';

type Dialog =
  | { kind: 'equipment'; item: EquipmentItem | null }
  | { kind: 'issue'; replacing: EquipmentIssue | null }
  | { kind: 'detail'; issueId: string }
  | { kind: 'close'; issueId: string }
  | { kind: 'paper'; issueId: string }
  | { kind: 'own-ack'; issueId: string };

const STATUS_FILTER_LABEL: Record<Exclude<StatusFilter, '' | IssueStatus>, string> = {
  pending_ack: tKey('Entregados sin confirmación de recepción'),
  review_soon: tKey('Revisión programada vencida o próxima'),
  lost_open: tKey('Perdidos o dañados sin reponer'),
};

function ackMap(ctx: UiCtx): Map<string, Acknowledgement> {
  const m = new Map<string, Acknowledgement>();
  for (const a of ctx.db.acknowledgements) if (a.companyId === ctx.company.id && a.subject.kind === 'ppe_issue') m.set(a.subject.id, a);
  return m;
}

export function PpePage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { runOk } = useAction();
  const canManage = ctx.can('ppe.manage');
  const canSeeIssues = canManage || ctx.can('employees.view_all') || ctx.can('team.view');
  const hasOwn = !!ctx.employee && ctx.can('own.view');

  const items = useMemo(() => ctx.db.equipment.filter((x) => x.companyId === ctx.company.id), [ctx]);
  const issues = useMemo(() => visibleIssues(ctx), [ctx]);
  const acks = useMemo(() => ackMap(ctx), [ctx]);
  const ownIssues = useMemo(() => (ctx.employee ? issues.filter((i) => i.employeeId === ctx.employee!.id) : []), [issues, ctx.employee]);
  const ownPending = ownIssues.filter((i) => i.status === 'issued' && !acks.has(i.id)).length;

  const allowed: Record<TabId, boolean> = { catalogo: true, entregas: canSeeIssues, 'mis-equipos': hasOwn };
  const requested = params.get('tab') as TabId | null;
  const tab: TabId = requested && allowed[requested] ? requested : canSeeIssues ? 'entregas' : hasOwn ? 'mis-equipos' : 'catalogo';
  const setTab = (v: TabId) => {
    const p = new URLSearchParams(params);
    p.set('tab', v);
    setParams(p, { replace: true });
  };

  const current = dialog && 'issueId' in dialog ? issues.find((i) => i.id === dialog.issueId) : undefined;

  return (
    <>
      <PageHeader
        title={t('Equipos de protección (EPI)')}
        subtitle={t('Catálogo, entregas y confirmaciones de recepción. La aplicación registra hechos: no decide qué equipo es necesario ni si es suficiente.')}
        actions={
          canManage && (
            <>
              {tab === 'catalogo' && (
                <Button icon={Plus} onClick={() => setDialog({ kind: 'equipment', item: null })}>
                  {t('Nuevo equipo')}
                </Button>
              )}
              <Button variant="primary" icon={HardHat} onClick={() => setDialog({ kind: 'issue', replacing: null })}>
                {t('Registrar entrega')}
              </Button>
            </>
          )
        }
      />
      <Tabs<TabId>
        label={t('Secciones de equipos de protección')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'catalogo', label: t('Catálogo'), count: items.length },
          { id: 'entregas', label: t('Entregas [EPI]'), count: issues.length, hidden: !canSeeIssues },
          { id: 'mis-equipos', label: t('Mis equipos'), count: ownPending || undefined, hidden: !hasOwn },
        ]}
      />
      {tab === 'catalogo' && <CatalogTab items={items} canManage={canManage} onEdit={(item) => setDialog({ kind: 'equipment', item })} />}
      {tab === 'entregas' && <IssuesTab issues={issues} acks={acks} canManage={canManage} onOpen={(id) => setDialog({ kind: 'detail', issueId: id })} />}
      {tab === 'mis-equipos' && <OwnTab issues={ownIssues} acks={acks} onConfirm={(id) => setDialog({ kind: 'own-ack', issueId: id })} />}

      {dialog?.kind === 'equipment' && <EquipmentDialog item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'issue' && <IssueDialog replacing={dialog.replacing} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'detail' && current && (
        <IssueDetailDialog
          issue={current}
          ack={acks.get(current.id)}
          onClose={() => setDialog(null)}
          onReplace={() => setDialog({ kind: 'issue', replacing: current })}
          onCloseIssue={() => setDialog({ kind: 'close', issueId: current.id })}
          onPaperAck={() => setDialog({ kind: 'paper', issueId: current.id })}
        />
      )}
      {dialog?.kind === 'close' && current && <CloseIssueDialog issue={current} onClose={() => setDialog({ kind: 'detail', issueId: current.id })} />}
      {dialog?.kind === 'paper' && current && (
        <ConfirmDialog
          title={t('Registrar confirmación firmada en papel')}
          confirmLabel={t('Registrar confirmación')}
          message={
            <div className="stack-sm">
              <p>{t('{name} firmó en papel la recepción de {item}.', { name: employeeName(ctx.db, current.employeeId), item: ctx.db.equipment.find((x) => x.id === current.itemId)?.name ?? '' })}</p>
              <p className="small muted">{t('Registre solo una confirmación realmente firmada por la persona trabajadora y conserve el original. La confirmación de recepción no acredita formación.')}</p>
            </div>
          }
          onConfirm={() => runOk(() => acknowledgeIssue(current.id, current.employeeId), t('Confirmación en papel registrada'))}
          onClose={() => setDialog({ kind: 'detail', issueId: current.id })}
        />
      )}
      {dialog?.kind === 'own-ack' && current && (
        <ConfirmDialog
          title={t('Confirmar recepción del equipo')}
          confirmLabel={t('Confirmo la recepción')}
          message={
            <div className="stack-sm">
              <p className="strong">{ctx.db.equipment.find((x) => x.id === current.itemId)?.name}</p>
              <p>{t('Declaro que he recibido el equipo y las instrucciones de uso y mantenimiento del fabricante.')}</p>
              <p className="small muted">{t('Su confirmación queda registrada con fecha y hora. No acredita formación ni que el equipo sea el adecuado: si no lo ha recibido o no le sirve, no confirme y avise a su responsable.')}</p>
            </div>
          }
          onConfirm={() => runOk(() => acknowledgeIssue(current.id), t('Recepción confirmada'))}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────── Catalogue ───────────────────────────────

function CatalogTab({ items, canManage, onEdit }: { items: EquipmentItem[]; canManage: boolean; onEdit: (item: EquipmentItem) => void }) {
  const ctx = useCtx();
  const [q, setQ] = useState('');
  const { sort, onSort } = useSort('code', 'asc');
  const tagLabel = (id: string) => ctx.db.riskTags.find((r) => r.id === id && r.companyId === ctx.company.id)?.label ?? id;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = items.filter((i) => !s || `${i.code} ${i.name} ${i.type} ${i.description}`.toLowerCase().includes(s));
    return sortRows(filtered, sort, (i, col) => (col === 'name' ? i.name : col === 'type' ? i.type : i.code));
  }, [items, q, sort]);
  const paged = usePaged(rows);
  return (
    <div className="stack">
      <Callout tone="info" title={t('Equipos de ejemplo')}>
        {t('Los equipos del catálogo son ilustrativos. La evaluación de riesgos y la política preventiva deciden qué equipo es necesario para cada puesto o centro; la aplicación no decide que un equipo sea suficiente.')}
      </Callout>
      <Card flush>
        <div className="toolbar sf-toolbar">
          <TextField className="search" label={t('Buscar')} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Código, nombre o tipo')} />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={HardHat} title={items.length ? t('Ningún equipo coincide con la búsqueda') : t('Catálogo vacío')}>
            {items.length ? t('Pruebe con otro término.') : canManage ? t('Añada los equipos que indique la evaluación de riesgos.') : t('La empresa todavía no ha configurado equipos.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label={t('Código')} col="code" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Equipo [EPI]')} col="name" sort={sort} onSort={onSort} />
                    <th>{t('Puestos')}</th>
                    <th>{t('Riesgos')}</th>
                    <th>{t('Centros')}</th>
                    <th>{t('Inspección o sustitución')}</th>
                    <th>{t('Identificador')}</th>
                    {canManage && <th><span className="sr-only">{t('Acciones')}</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((i) => (
                    <tr key={i.id}>
                      <td className="nowrap">
                        {i.code}
                        {!i.active && (
                          <div>
                            <Badge tone="neutral">{t('Inactivo')}</Badge>
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <div className="strong">{i.name}</div>
                        <div className="sub">{i.type}</div>
                        {i.description && <div className="sub">{i.description}</div>}
                      </td>
                      <td className="small">
                        <NameList names={i.jobRoleIds.map((r) => roleName(ctx.db, r))} />
                      </td>
                      <td className="small">
                        <NameList names={i.riskTags.map(tagLabel)} />
                      </td>
                      <td className="small">{i.worksiteIds.length ? <NameList names={i.worksiteIds.map((w) => worksiteName(ctx.db, w))} /> : <span className="muted">{t('Cualquier centro')}</span>}</td>
                      <td className="small" style={{ minWidth: 180 }}>
                        <PpeSchedule rule={i.replacement} />
                      </td>
                      <td className="small nowrap">{i.identifierRequired ? t('Obligatorio') : t('No requerido')}</td>
                      {canManage && (
                        <td>
                          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(i)} aria-label={t('Editar {name}', { name: i.name })}>
                            {t('Editar')}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────── Issues ───────────────────────────────

function IssuesTab({ issues, acks, canManage, onOpen }: { issues: EquipmentIssue[]; acks: Map<string, Acknowledgement>; canManage: boolean; onOpen: (id: string) => void }) {
  const ctx = useCtx();
  const [params] = useSearchParams();
  const [emp, setEmp] = useState(params.get('empleado') ?? '');
  const [ws, setWs] = useState(params.get('centro') ?? '');
  const [itemId, setItemId] = useState(params.get('equipo') ?? '');
  const [status, setStatus] = useState<StatusFilter>((params.get('estado') as StatusFilter) ?? '');
  const { sort, onSort } = useSort('issuedAt', 'desc');
  const soon = addDays(ctx.today, alertDays(ctx));
  const all = useMemo(() => ctx.db.issues.filter((x) => x.companyId === ctx.company.id), [ctx]);

  const matchStatus = (i: EquipmentIssue, s: StatusFilter) => {
    if (!s) return true;
    if (s === 'pending_ack') return i.status === 'issued' && !acks.has(i.id);
    if (s === 'review_soon') return i.status === 'issued' && !!i.replacementDue && i.replacementDue <= soon;
    if (s === 'lost_open') return i.status === 'lost' && !i.replacedById;
    return i.status === s;
  };
  const counts = {
    issued: issues.filter((i) => i.status === 'issued').length,
    pending_ack: issues.filter((i) => matchStatus(i, 'pending_ack')).length,
    review_soon: issues.filter((i) => matchStatus(i, 'review_soon')).length,
    lost_open: issues.filter((i) => matchStatus(i, 'lost_open')).length,
  };
  const employeeIds = [...new Set(issues.map((i) => i.employeeId))].sort((a, b) => employeeName(ctx.db, a).localeCompare(employeeName(ctx.db, b), 'es'));
  const sites = [...visibleWorksiteIds(ctx)];
  const items = ctx.db.equipment.filter((x) => x.companyId === ctx.company.id);

  const rows = useMemo(() => {
    const filtered = issues.filter((i) => (!emp || i.employeeId === emp) && (!ws || i.worksiteId === ws) && (!itemId || i.itemId === itemId) && matchStatus(i, status));
    return sortRows(filtered, sort, (i, col) => {
      if (col === 'employee') return employeeName(ctx.db, i.employeeId);
      if (col === 'item') return ctx.db.equipment.find((x) => x.id === i.itemId)?.name ?? '';
      if (col === 'status') return i.status;
      if (col === 'ack') return acks.get(i.id)?.acknowledgedAt ?? '';
      if (col === 'due') return i.replacementDue;
      return i.issuedAt;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, emp, ws, itemId, status, sort, acks, ctx.db]);
  const paged = usePaged(rows);
  const filtered = !!(emp || ws || itemId || status);
  const toggle = (s: StatusFilter) => setStatus((cur) => (cur === s ? '' : s));

  return (
    <div className="stack">
      <div className="kpis">
        <KpiButton label={t('Equipos entregados')} value={counts.issued} pressed={status === 'issued'} onClick={() => toggle('issued')} />
        <KpiButton label={t('Sin confirmación de recepción')} value={counts.pending_ack} tone={counts.pending_ack ? 'warning' : undefined} pressed={status === 'pending_ack'} onClick={() => toggle('pending_ack')} />
        <KpiButton label={t('Revisión programada vencida o próxima')} value={counts.review_soon} meta={t('Solo fechas programadas; próximos {n} días', { n: alertDays(ctx) })} tone={counts.review_soon ? 'warning' : undefined} pressed={status === 'review_soon'} onClick={() => toggle('review_soon')} />
        <KpiButton label={t('Perdidos o dañados sin reponer')} value={counts.lost_open} tone={counts.lost_open ? 'danger' : undefined} pressed={status === 'lost_open'} onClick={() => toggle('lost_open')} />
      </div>
      <Card flush>
        <div className="toolbar sf-toolbar">
          <SelectField label={t('Persona trabajadora')} value={emp} onChange={(e) => setEmp(e.target.value)}>
            <option value="">{t('Todas')}</option>
            {employeeIds.map((id) => (
              <option key={id} value={id}>
                {employeeName(ctx.db, id)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Centro')} value={ws} onChange={(e) => setWs(e.target.value)}>
            <option value="">{t('Todos')}</option>
            {sites.map((id) => (
              <option key={id} value={id}>
                {worksiteName(ctx.db, id)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Equipo [EPI]')} value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">{t('Todos')}</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} · {i.name}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Estado')} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="">{t('Todos')}</option>
            {(Object.keys(ISSUE_STATUS) as IssueStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(ISSUE_STATUS[s].label)}
              </option>
            ))}
            {(Object.keys(STATUS_FILTER_LABEL) as (keyof typeof STATUS_FILTER_LABEL)[]).map((s) => (
              <option key={s} value={s}>
                {t(STATUS_FILTER_LABEL[s])}
              </option>
            ))}
          </SelectField>
          {filtered && (
            <Button
              variant="ghost"
              onClick={() => {
                setEmp('');
                setWs('');
                setItemId('');
                setStatus('');
              }}
            >
              {t('Limpiar filtros')}
            </Button>
          )}
          <div className="grow" />
          {ctx.can('reports.export') && <ExportButton reportId="ppe" filters={{ ...EMPTY_FILTERS, employeeId: emp, worksiteId: ws }} />}
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={issues.length ? Search : HardHat} title={issues.length ? t('Ninguna entrega coincide con los filtros') : t('Sin entregas registradas')}>
            {issues.length ? t('Cambie o limpie los filtros.') : canManage ? t('Registre la primera entrega desde «Registrar entrega».') : t('No hay entregas de equipos en su ámbito.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label={t('Persona trabajadora')} col="employee" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Equipo [EPI]')} col="item" sort={sort} onSort={onSort} />
                    <th>{t('Identificador / talla')}</th>
                    <th>{t('Centro')}</th>
                    <SortHeader label={t('Entrega [EPI]')} col="issuedAt" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Confirmación de recepción')} col="ack" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Revisión o sustitución programada')} col="due" sort={sort} onSort={onSort} />
                    <th>{t('Documento')}</th>
                    <th>{t('Historial')}</th>
                    <th><span className="sr-only">{t('Acciones')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((i) => {
                    const item = ctx.db.equipment.find((x) => x.id === i.itemId);
                    const ack = acks.get(i.id);
                    const doc = i.documentId ? ctx.db.documents.find((d) => d.id === i.documentId) : undefined;
                    return (
                      <tr key={i.id}>
                        <td className="nowrap">
                          <EmployeeLink id={i.employeeId} />
                        </td>
                        <td style={{ minWidth: 170 }}>
                          {item?.name ?? i.itemId}
                          <div className="sub">{item?.code}</div>
                        </td>
                        <td className="small">
                          {i.identifier || <span className="muted">—</span>}
                          {i.size && <div className="sub">{t('Talla {size}', { size: i.size })}</div>}
                        </td>
                        <td className="small">{i.worksiteId ? <WorksiteLink id={i.worksiteId} /> : <span className="muted">—</span>}</td>
                        <td>
                          <DateText date={i.issuedAt} />
                        </td>
                        <td>
                          <StatusBadge meta={ISSUE_STATUS[i.status]} />
                        </td>
                        <td className="small">
                          {ack ? (
                            <span className="stack-sm" style={{ gap: 0 }}>
                              <span>
                                <CheckCircle2 size={12} aria-hidden style={{ verticalAlign: -1, color: 'var(--success)' }} /> <DateTimeText at={ack.acknowledgedAt} />
                              </span>
                              <span className="tiny muted">{t(ACK_METHOD_LABEL[ack.method])}</span>
                            </span>
                          ) : i.status === 'issued' ? (
                            <Badge tone="warning">{t('Pendiente')}</Badge>
                          ) : (
                            <span className="muted">{t('Sin confirmación registrada')}</span>
                          )}
                        </td>
                        <td className="small">{i.status === 'issued' ? <ScheduledDate date={i.replacementDue} today={ctx.today} /> : <span className="muted">—</span>}</td>
                        <td className="small">
                          {doc ? (
                            <Link to={`/documentacion/${doc.id}`}>
                              <FileText size={12} aria-hidden style={{ verticalAlign: -1 }} /> {doc.code}
                            </Link>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="small" style={{ minWidth: 150 }}>
                          {issueHistoryText(i, all) ?? <span className="muted">—</span>}
                        </td>
                        <td>
                          <Button size="sm" icon={canManage ? ClipboardCheck : undefined} onClick={() => onOpen(i.id)} aria-label={t('Abrir la entrega de {item} a {name}', { item: item?.name ?? '', name: employeeName(ctx.db, i.employeeId) })}>
                            {canManage ? t('Gestionar') : t('Ver')}
                          </Button>
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
      <p className="tiny muted">{t('La confirmación de recepción es un hecho distinto de la entrega y del documento de soporte. Las fechas de revisión solo aparecen si alguien las programó.')}</p>
    </div>
  );
}

// ─────────────────────────────── Own equipment ───────────────────────────────

function OwnTab({ issues, acks, onConfirm }: { issues: EquipmentIssue[]; acks: Map<string, Acknowledgement>; onConfirm: (id: string) => void }) {
  const ctx = useCtx();
  const canAck = ctx.can('own.acknowledge');
  const rows = [...issues].sort((a, b) => {
    const pa = a.status === 'issued' && !acks.has(a.id) ? 0 : a.status === 'issued' ? 1 : 2;
    const pb = b.status === 'issued' && !acks.has(b.id) ? 0 : b.status === 'issued' ? 1 : 2;
    return pa - pb || b.issuedAt.localeCompare(a.issuedAt);
  });
  const pending = rows.filter((i) => i.status === 'issued' && !acks.has(i.id)).length;
  return (
    <div className="stack">
      {pending > 0 && (
        <Callout tone="warning" title={t('Tiene {n} equipos pendientes de confirmar', { n: pending })}>
          {t('Confirme la recepción solo si ha recibido el equipo y sus instrucciones de uso y mantenimiento.')}
        </Callout>
      )}
      <Card title={t('Mis equipos de protección')} flush>
        {rows.length === 0 ? (
          <EmptyState icon={HardHat} title={t('No tiene equipos entregados')}>
            {t('Cuando la empresa registre una entrega a su nombre aparecerá aquí para que confirme la recepción.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Equipo [EPI]')}</th>
                  <th>{t('Identificador / talla')}</th>
                  <th>{t('Entrega [EPI]')}</th>
                  <th>{t('Estado')}</th>
                  <th>{t('Confirmación de recepción')}</th>
                  <th>{t('Revisión o sustitución programada')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const item = ctx.db.equipment.find((x) => x.id === i.itemId);
                  const ack = acks.get(i.id);
                  return (
                    <tr key={i.id}>
                      <td style={{ minWidth: 180 }}>
                        <div className="strong">{item?.name ?? i.itemId}</div>
                        {item?.type && <div className="sub">{item.type}</div>}
                      </td>
                      <td className="small">
                        {i.identifier || <span className="muted">—</span>}
                        {i.size && <div className="sub">{t('Talla {size}', { size: i.size })}</div>}
                      </td>
                      <td>
                        <DateText date={i.issuedAt} />
                      </td>
                      <td>
                        <StatusBadge meta={ISSUE_STATUS[i.status]} />
                      </td>
                      <td className="small">
                        {ack ? (
                          <span>
                            <CheckCircle2 size={12} aria-hidden style={{ verticalAlign: -1, color: 'var(--success)' }} /> <DateTimeText at={ack.acknowledgedAt} />
                          </span>
                        ) : i.status === 'issued' ? (
                          canAck ? (
                            <Button size="sm" variant="primary" icon={ClipboardCheck} onClick={() => onConfirm(i.id)}>
                              {t('Confirmar recepción')}
                            </Button>
                          ) : (
                            <Badge tone="warning">{t('Pendiente')}</Badge>
                          )
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="small">{i.status === 'issued' ? <ScheduledDate date={i.replacementDue} today={ctx.today} /> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="tiny muted">{t('Confirmar la recepción no acredita formación ni que el equipo sea el adecuado para su puesto; eso lo decide la evaluación de riesgos.')}</p>
    </div>
  );
}
