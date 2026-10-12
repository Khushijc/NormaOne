/**
 * Tabs of the requirement detail: versions (history kept, read-only), affected employees
 * (health items masked as itemsFor() does) and explicit assignments / not-applicable decisions.
 */
import { CalendarClock, FileUp, History, Lock, UserX, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ITEM_STATUS, SATISFIED, type ItemStatus } from '../../domain/status';
import { affectedBy, maskItem, type MatrixItem } from '../../domain/requirements';
import { formatDate } from '../../domain/time';
import type { RequirementAssignment, RequirementVersion } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { alertDays, canReviewAuthority, canSeeEmployee, canSeeHealth, employeeName, itemsFor, roleName, userName } from '../../services/context';
import { approvalPermission, endAssignment, markNotApplicable, revokeNotApplicable } from '../../services/requirementService';
import { useCtx } from '../../store/hooks';
import { Badge, Button, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, Modal, Pagination, SelectField, SortHeader, TextField, sortRows, usePaged, useAction, useSort } from '../../components/ui';
import { EmployeeLink, ItemStatusBadge, RestrictedNote, WorksiteLink, msg } from '../../components/bits';
import { CriticalBadge, TARGET_KIND_LABEL, TypeBadge, VersionStatusBadge, VersionSummary, targetLabel, type TemplateRow } from './shared';

// ─────────────────────────────── Versions ───────────────────────────────

export function VersionsTab({ row }: { row: TemplateRow }) {
  const ctx = useCtx();
  const [open, setOpen] = useState<RequirementVersion | null>(null);
  const list = [...row.versions].reverse();
  if (!list.length) return <Card><EmptyState icon={History} title={t('Sin versiones')} /></Card>;
  return (
    <Card title={t('Versiones')} flush>
      <p className="small muted rq-pad">{t('Las versiones aprobadas nunca se modifican: cada cambio crea una versión nueva con fecha de efecto. Las evidencias revisadas con una versión anterior conservan esa referencia.')}</p>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{t('Versiones del requisito')}</caption>
          <thead>
            <tr>
              <th>{t('Versión')}</th>
              <th>{t('Estado')}</th>
              <th>{t('En vigor desde')}</th>
              <th>{t('Hasta')}</th>
              <th>{t('Motivo del cambio')}</th>
              <th>{t('Aprobación')}</th>
              <th>
                <span className="sr-only">{t('Acciones')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} className={row.current?.id === v.id ? 'rq-row-current' : ''}>
                <td className="nowrap strong">
                  v{v.version}
                  {row.current?.id === v.id && (
                    <div>
                      <Badge tone="success">{t('En vigor hoy')}</Badge>
                    </div>
                  )}
                </td>
                <td>
                  <div className="status-stack">
                    <VersionStatusBadge v={v} today={ctx.today} />
                    <TypeBadge v={v} />
                    <CriticalBadge v={v} />
                  </div>
                </td>
                <td><DateText date={v.effectiveFrom} /></td>
                <td>{v.effectiveTo ? <DateText date={v.effectiveTo} /> : <span className="muted small">{t('Sin fecha de fin')}</span>}</td>
                <td className="rq-wrap small">
                  {v.changeReason || <span className="muted">—</span>}
                  {v.invalidatesPriorEvidence && (
                    <div>
                      <Badge tone="warning">{t('Exige revisar evidencias anteriores')}</Badge>
                    </div>
                  )}
                </td>
                <td className="small rq-wrap">
                  {v.approvedBy && v.status !== 'pending_approval' && v.status !== 'draft' ? (
                    <>
                      <div>{v.status === 'rejected' ? t('Rechazada por {who}', { who: userName(ctx.db, v.approvedBy) }) : userName(ctx.db, v.approvedBy)}</div>
                      <div className="tiny muted"><DateTimeText at={v.approvedAt} /></div>
                    </>
                  ) : v.status === 'rejected' ? (
                    <div className="tiny">{t('Rechazada')}: {v.approvalNote}</div>
                  ) : (
                    <span className="muted">{t('Sin aprobar')}</span>
                  )}
                  <div className="tiny muted">{t('Redactada por {who}', { who: userName(ctx.db, v.createdBy) })}</div>
                </td>
                <td>
                  <Button size="sm" onClick={() => setOpen(v)} aria-label={t('Ver la versión {n}', { n: v.version })}>
                    {t('Ver')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal wide title={t('{code} · versión {n} (solo lectura)', { code: row.template.code, n: open.version })} onClose={() => setOpen(null)} footer={<Button onClick={() => setOpen(null)}>{t('Cerrar')}</Button>}>
          <VersionSummary ctx={ctx} v={open} code={row.template.code} />
        </Modal>
      )}
    </Card>
  );
}

// ─────────────────────────────── Affected employees ───────────────────────────────

const VIA_LABEL = { scope: tKey('Ámbito de la versión'), assignment: tKey('Asignación explícita') } as const;

export function AffectedTab({ row }: { row: TemplateRow }) {
  const ctx = useCtx();
  const { runOk } = useAction();
  const [when, setWhen] = useState<'today' | 'scheduled'>('today');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ItemStatus | ''>('');
  const [markFor, setMarkFor] = useState<MatrixItem | null>(null);
  const { sort, onSort } = useSort('employee', 'asc');
  const scheduled = row.scheduled;
  const date = when === 'scheduled' && scheduled ? scheduled.effectiveFrom : ctx.today;
  const health = canSeeHealth(ctx);

  const items = useMemo(() => {
    const raw = affectedBy(ctx.db, ctx.company.id, row.template.id, date, alertDays(ctx)).filter((i) => canSeeEmployee(ctx, i.employeeId));
    if (date === ctx.today) return raw.map((i) => itemsFor(ctx, i.employeeId).find((x) => x.key === i.key) ?? maskItem(i, false));
    return raw.map((i) => maskItem(i, health || ctx.employee?.id === i.employeeId));
  }, [ctx, row.template.id, date, health]);

  const filtered = items.filter((i) => (!status || i.status === status) && (!q.trim() || employeeName(ctx.db, i.employeeId).toLowerCase().includes(q.trim().toLowerCase())));
  const sorted = sortRows(filtered, sort, (i, col) => (col === 'employee' ? employeeName(ctx.db, i.employeeId) : col === 'status' ? t(ITEM_STATUS[i.status].label) : null));
  const paged = usePaged(sorted, 25);
  const { reset } = paged;
  useEffect(() => reset(), [q, status, when]); // eslint-disable-line react-hooks/exhaustive-deps

  const satisfied = items.filter((i) => SATISFIED.includes(i.status)).length;
  const v = row.current;
  const mayMark = (i: MatrixItem) => !!v && date === ctx.today && v.requirementType !== 'not_applicable' && !i.satisfied && (canReviewAuthority(ctx, v.reviewAuthority, i.employeeId) || ctx.can(approvalPermission(v)));
  const canUpload = ctx.can('evidence.upload') || ctx.can('evidence.request');

  if (!row.current && !scheduled) {
    return (
      <Card>
        <EmptyState icon={Users} title={t('No afecta a nadie')}>
          {row.template.retiredAt ? t('El requisito está retirado: ya no se aplica. Las evidencias anteriores se conservan en el expediente de cada persona.') : t('No hay ninguna versión aprobada en vigor. Las personas afectadas aparecerán cuando se apruebe o active una versión.')}
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card flush title={t('Personas y asignaciones afectadas')}>
      <div className="toolbar">
        {scheduled && (
          <div className="field">
            <span className="small strong" id="rq-when">{t('Fecha de cálculo')}</span>
            <div className="segmented" role="group" aria-labelledby="rq-when">
              <button type="button" aria-pressed={when === 'today'} onClick={() => setWhen('today')} disabled={!row.current}>
                {t('Hoy')}
              </button>
              <button type="button" aria-pressed={when === 'scheduled'} onClick={() => setWhen('scheduled')}>
                <CalendarClock size={13} aria-hidden /> {t('Desde v{n} ({date})', { n: scheduled.version, date: formatDate(scheduled.effectiveFrom) })}
              </button>
            </div>
          </div>
        )}
        <TextField className="search" label={t('Buscar persona')} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label={t('Estado de la evidencia')} value={status} onChange={(e) => setStatus(e.target.value as ItemStatus | '')}>
          <option value="">{t('Todos')}</option>
          {(Object.keys(ITEM_STATUS) as ItemStatus[]).map((s) => (
            <option key={s} value={s}>{t(ITEM_STATUS[s].label)}</option>
          ))}
        </SelectField>
      </div>
      <div className="rq-pad stack-sm">
        <div className="row-wrap small">
          <span>{t('{n} elementos en su ámbito', { n: items.length })}</span>
          <span className="muted">·</span>
          <span>{t('{n} resueltos', { n: satisfied })}</span>
          <span className="muted">·</span>
          <span>{t('{n} pendientes', { n: items.length - satisfied })}</span>
        </div>
        <p className="tiny muted">{t('«Aceptado» significa que la autoridad de revisión aceptó la evidencia; no es una aprobación profesional de seguridad. Los requisitos de salud solo muestran si condicionan la asignación.')}</p>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Users} title={t('Nadie en su ámbito está afectado en esta fecha')} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title={t('Ninguna persona coincide con los filtros')} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Personas afectadas por el requisito')}</caption>
              <thead>
                <tr>
                  <SortHeader label={t('Empleado')} col="employee" sort={sort} onSort={onSort} />
                  <th>{t('Centros')}</th>
                  <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                  <th>{t('Motivo')}</th>
                  <th>{t('Aplica por')}</th>
                  <th>
                    <span className="sr-only">{t('Acciones')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((i) => {
                  const masked = i.restricted && !health && ctx.employee?.id !== i.employeeId;
                  return (
                    <tr key={i.key}>
                      <td className="nowrap">
                        <EmployeeLink id={i.employeeId} />
                        {i.critical && (
                          <div>
                            <Badge tone="danger">{t('Crítico')}</Badge>
                          </div>
                        )}
                      </td>
                      <td className="small">
                        {i.worksiteIds.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          i.worksiteIds.map((w) => (
                            <div key={w}>
                              <WorksiteLink id={w} />
                            </div>
                          ))
                        )}
                      </td>
                      <td>
                        <ItemStatusBadge status={i.status} />
                      </td>
                      <td className="small rq-wrap">
                        {msg(i.reason)}
                        {masked && (
                          <div>
                            <RestrictedNote />
                          </div>
                        )}
                      </td>
                      <td className="small">{i.via.map((x) => t(VIA_LABEL[x])).join(' · ')}</td>
                      <td>
                        <div className="row-wrap">
                          <Link className="btn sm ghost" to={`/empleados/${i.employeeId}?tab=requisitos`}>
                            {t('Expediente')}
                          </Link>
                          {canUpload && !masked && (v?.evidenceMode === 'document' || v?.evidenceMode === 'training') && !i.satisfied && date === ctx.today && (
                            <Link className="btn sm ghost" to={`/documentacion?nuevo=1&requisito=${row.template.id}&empleado=${i.employeeId}`}>
                              <FileUp size={13} aria-hidden /> {t('Aportar evidencia')}
                            </Link>
                          )}
                          {mayMark(i) && (
                            <Button size="sm" variant="ghost" icon={UserX} onClick={() => setMarkFor(i)}>
                              {t('No aplicable')}
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
      {markFor && (
        <ConfirmDialog
          title={t('Marcar como no aplicable')}
          message={
            <p className="small">
              {t('{name} dejará de tener este requisito pendiente. Explique por qué no se aplica (mínimo 10 caracteres); la decisión queda registrada y puede revocarse.', { name: employeeName(ctx.db, markFor.employeeId) })}
            </p>
          }
          requireReason
          reasonLabel={t('Motivo de la decisión')}
          confirmLabel={t('Marcar como no aplicable')}
          onConfirm={(r) => runOk(() => markNotApplicable(row.template.id, markFor.employeeId, markFor.worksiteId, r), t('Marcado como no aplicable'))}
          onClose={() => setMarkFor(null)}
        />
      )}
    </Card>
  );
}

// ─────────────────────────────── Assignments and decisions ───────────────────────────────

function assignmentState(a: RequirementAssignment, today: string): { label: string; tone: 'success' | 'info' | 'neutral' } {
  if (a.endedBy || (a.effectiveTo && a.effectiveTo < today)) return { label: tKey('Finalizada [asignación]'), tone: 'neutral' };
  if (a.effectiveFrom > today) return { label: tKey('Programada'), tone: 'info' };
  return { label: tKey('Vigente'), tone: 'success' };
}

export function AssignmentsTab({ row, onAssign, assignBlock }: { row: TemplateRow; onAssign: () => void; assignBlock: string | null }) {
  const ctx = useCtx();
  const { runOk } = useAction();
  const [ending, setEnding] = useState<RequirementAssignment | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const id = row.template.id;
  const health = canSeeHealth(ctx);
  const restricted = row.display.category === 'health_surveillance';
  const assignments = ctx.db.requirementAssignments.filter((a) => a.templateId === id && a.companyId === ctx.company.id).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  const decisions = ctx.db.applicability.filter((d) => d.templateId === id && d.companyId === ctx.company.id && canSeeEmployee(ctx, d.employeeId)).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  const canEnd = ctx.can('requirements.manage') || ctx.can('requirements.approve_professional');
  const v = row.current;
  const canRevoke = (employeeId: string) => !!v && (canReviewAuthority(ctx, v.reviewAuthority, employeeId) || ctx.can(approvalPermission(v)));

  const targetCell = (a: RequirementAssignment) => {
    if (a.target.kind === 'employee') return canSeeEmployee(ctx, a.target.id) ? <EmployeeLink id={a.target.id} /> : <span className="muted">{t('Persona fuera de su ámbito')}</span>;
    if (a.target.kind === 'worksite') return <WorksiteLink id={a.target.id} />;
    return <span>{roleName(ctx.db, a.target.id)}</span>;
  };

  return (
    <div className="stack">
      <Card
        flush
        title={t('Asignaciones explícitas')}
        actions={
          ctx.can('requirements.assign') ? (
            <Button variant="primary" size="sm" onClick={onAssign} disabled={!!assignBlock} title={assignBlock ?? undefined}>
              {t('Asignar')}
            </Button>
          ) : undefined
        }
      >
        <p className="small muted rq-pad">
          {t('Además del ámbito de la versión (puestos, centros, riesgos), el requisito puede asignarse expresamente a una persona, un puesto o un centro. Finalizar una asignación reduce requisitos: lo decide la coordinación de PRL o un profesional.')}
        </p>
        {assignBlock && ctx.can('requirements.assign') && <p className="small rq-pad rq-locked">{assignBlock}</p>}
        {assignments.length === 0 ? (
          <EmptyState icon={Users} title={t('Sin asignaciones explícitas')}>
            {t('El requisito se aplica solo según el ámbito de su versión.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Asignaciones explícitas del requisito')}</caption>
              <thead>
                <tr>
                  <th>{t('Destino')}</th>
                  <th>{t('Desde')}</th>
                  <th>{t('Hasta')}</th>
                  <th>{t('Motivo')}</th>
                  <th>{t('Asignado por')}</th>
                  <th>{t('Estado')}</th>
                  <th>
                    <span className="sr-only">{t('Acciones')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => {
                  const st = assignmentState(a, ctx.today);
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="tiny muted">{t(TARGET_KIND_LABEL[a.target.kind])}</div>
                        {targetCell(a)}
                      </td>
                      <td><DateText date={a.effectiveFrom} /></td>
                      <td>{a.effectiveTo ? <DateText date={a.effectiveTo} /> : <span className="muted small">{t('Sin fecha de fin')}</span>}</td>
                      <td className="small rq-wrap">
                        {a.reason}
                        {a.endReason && <div className="tiny muted">{t('Fin')}: {a.endReason} ({userName(ctx.db, a.endedBy)})</div>}
                      </td>
                      <td className="small">
                        {userName(ctx.db, a.assignedBy)}
                        <div className="tiny muted"><DateTimeText at={a.assignedAt} /></div>
                      </td>
                      <td><Badge tone={st.tone}>{t(st.label)}</Badge></td>
                      <td>
                        {canEnd && !a.effectiveTo && (
                          <Button size="sm" variant="danger-outline" onClick={() => setEnding(a)} aria-label={t('Finalizar la asignación a {target}', { target: targetLabel(ctx, a.target) })}>
                            {t('Finalizar asignación')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card flush title={t('Decisiones de no aplicabilidad')}>
        <p className="small muted rq-pad">{t('Una persona revisora autorizada puede decidir que el requisito no se aplica a una persona concreta, con motivo. La decisión puede revocarse y queda en la auditoría.')}</p>
        {decisions.length === 0 ? (
          <EmptyState icon={UserX} title={t('Sin decisiones de no aplicabilidad')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Decisiones de no aplicabilidad')}</caption>
              <thead>
                <tr>
                  <th>{t('Empleado')}</th>
                  <th>{t('Centro')}</th>
                  <th>{t('Motivo')}</th>
                  <th>{t('Decidido por')}</th>
                  <th>{t('Estado')}</th>
                  <th>
                    <span className="sr-only">{t('Acciones')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.id}>
                    <td><EmployeeLink id={d.employeeId} /></td>
                    <td>{d.worksiteId ? <WorksiteLink id={d.worksiteId} /> : <span className="muted small">{t('Todos sus centros')}</span>}</td>
                    <td className="small rq-wrap">{restricted && !health ? <RestrictedNote /> : d.reason}</td>
                    <td className="small">
                      {userName(ctx.db, d.decidedBy)}
                      <div className="tiny muted"><DateTimeText at={d.decidedAt} /></div>
                    </td>
                    <td>
                      {d.revokedAt ? (
                        <Badge tone="neutral">{t('Revocada')}</Badge>
                      ) : (
                        <Badge tone="info">{t('Vigente')}</Badge>
                      )}
                      {d.revokedAt && <div className="tiny muted">{userName(ctx.db, d.revokedBy)} · <DateTimeText at={d.revokedAt} /></div>}
                    </td>
                    <td>
                      {!d.revokedAt && canRevoke(d.employeeId) && (
                        <Button size="sm" variant="ghost" onClick={() => setRevoking(d.id)}>
                          {t('Revocar')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {restricted && !health && (
          <p className="tiny muted rq-pad">
            <Lock size={12} aria-hidden /> {t('Los motivos de las decisiones sobre vigilancia de la salud solo los ve el personal autorizado.')}
          </p>
        )}
      </Card>

      {ending && (
        <ConfirmDialog
          title={t('Finalizar asignación')}
          message={<p className="small">{t('La asignación a {target} dejará de aplicarse desde hoy. Las evidencias ya aportadas se conservan.', { target: targetLabel(ctx, ending.target) })}</p>}
          danger
          requireReason
          confirmLabel={t('Finalizar asignación')}
          onConfirm={(r) => runOk(() => endAssignment(ending.id, r), t('Asignación finalizada'))}
          onClose={() => setEnding(null)}
        />
      )}
      {revoking && (
        <ConfirmDialog
          title={t('Revocar la decisión de no aplicabilidad')}
          message={<p className="small">{t('El requisito volverá a aplicarse a esta persona y aparecerá como pendiente si falta la evidencia.')}</p>}
          requireReason
          confirmLabel={t('Revocar')}
          onConfirm={(r) => runOk(() => revokeNotApplicable(revoking, r), t('Decisión revocada: el requisito vuelve a aplicarse'))}
          onClose={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
