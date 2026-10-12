/**
 * Employee profile tabs listing related records: documents (only those the caller may see),
 * training (attendance, completion and evidence kept as separate columns), equipment issued
 * (with the worker's acknowledgement, which is not training) and preventive actions.
 */
import { ClipboardList, FileStack, FileUp, GraduationCap, HardHat } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { ACTION_STATUS, ISSUE_STATUS, ITEM_STATUS, PRIORITY, TRAINING_STATUS } from '../../domain/status';
import type { Employee } from '../../domain/types';
import { t } from '../../i18n';
import { userName, worksiteName } from '../../services/context';
import { documentState, visibleDocuments } from '../../services/evidenceService';
import { visibleActions } from '../../services/safetyService';
import { visibleIssues, visibleTrainings } from '../../services/trainingService';
import { useCtx } from '../../store/hooks';
import { AccessBadge, DocStatusBadge, KindDate } from '../../components/bits';
import { Badge, Card, Checkbox, DateText, DateTimeText, EmptyState, Pagination, StatusBadge, usePaged } from '../../components/ui';

// ─────────────────────────────── Documentación ───────────────────────────────

export function DocumentsTab({ emp, isSelf }: { emp: Employee; isSelf: boolean }) {
  const ctx = useCtx();
  const rows = useMemo(
    () =>
      visibleDocuments(ctx)
        .filter((d) => d.employeeId === emp.id)
        .map((d) => ({ d, s: documentState(ctx, d.id) }))
        .sort((a, b) => (b.s.latest?.receivedAt ?? '').localeCompare(a.s.latest?.receivedAt ?? '')),
    [ctx, emp.id],
  );
  const paged = usePaged(rows, 10);
  const canUpload = emp.status === 'active' && (ctx.can('evidence.upload') || (isSelf && ctx.can('own.submit')));
  const category = (id: string) => ctx.db.categories.find((c) => c.id === id && c.companyId === ctx.company.id)?.label ?? id;
  const requirement = (templateId: string | null) => {
    if (!templateId) return null;
    const list = ctx.db.versions.filter((v) => v.templateId === templateId).sort((a, b) => b.version - a.version);
    return list[0]?.name ?? null;
  };

  return (
    <Card
      title={t('Documentación de la persona')}
      flush
      actions={
        canUpload ? (
          <Link className="btn sm" to={`/documentacion?nuevo=1&empleado=${encodeURIComponent(emp.id)}`}>
            <FileUp size={15} aria-hidden />
            {t('Aportar documento')}
          </Link>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon={FileStack} title={t('Sin documentos visibles')}>
          {t('No hay documentos de esta persona que su rol pueda consultar. Los documentos de salud nunca se listan aquí.')}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Documento')}</th>
                  <th>{t('Categoría')}</th>
                  <th>{t('Requisito')}</th>
                  <th>{t('Última versión')}</th>
                  <th>{t('Versión aceptada')}</th>
                  <th>{t('Caducidad legal')}</th>
                  <th>{t('Recibido')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map(({ d, s }) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/documentacion/${d.id}`} className="strong">{d.title}</Link>
                      <div className="sub">
                        <span className="mono">{d.code}</span> <AccessBadge cls={d.accessClass} />
                      </div>
                    </td>
                    <td className="small">{category(d.categoryId)}</td>
                    <td className="small">{requirement(d.templateId) ?? <span className="muted">—</span>}</td>
                    <td>
                      {s.latest ? (
                        <>
                          <DocStatusBadge status={s.latest.status} />
                          <div className="sub">{t('Versión {n}', { n: s.latest.version })}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{s.accepted ? t('Versión {n}', { n: s.accepted.version }) : <span className="muted small">{t('Ninguna')}</span>}</td>
                    <td>{s.accepted ? <KindDate kind="legal" date={s.accepted.legalExpiryDate} noExpiry={s.accepted.expiryMode === 'none'} today={ctx.today} /> : <span className="muted">—</span>}</td>
                    <td>{s.latest ? <DateTimeText at={s.latest.receivedAt} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paged.props} />
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────── Formación ───────────────────────────────

export function TrainingTab({ emp }: { emp: Employee }) {
  const ctx = useCtx();
  const rows = useMemo(() => visibleTrainings(ctx).filter((x) => x.employeeId === emp.id).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt)), [ctx, emp.id]);
  const docIds = useMemo(() => new Set(visibleDocuments(ctx).map((d) => d.id)), [ctx]);
  const course = (id: string) => ctx.db.courses.find((c) => c.id === id);

  return (
    <Card
      title={t('Formación')}
      flush
      actions={
        <Link className="btn sm ghost" to="/formacion?tab=asignaciones">
          {t('Ir a Formación')}
        </Link>
      }
    >
      <p className="readiness-note card-note">{t('La asistencia, la finalización y la aceptación de la evidencia se registran por separado: ninguna implica las otras.')}</p>
      {rows.length === 0 ? (
        <EmptyState icon={GraduationCap} title={t('Sin formación asignada')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Curso')}</th>
                <th>{t('Estado')}</th>
                <th>{t('Fecha prevista')}</th>
                <th>{t('Asistencia')}</th>
                <th>{t('Finalización')}</th>
                <th>{t('Evidencia')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const c = course(x.courseId);
                const s = x.documentId ? documentState(ctx, x.documentId) : null;
                return (
                  <tr key={x.id}>
                    <td>
                      <span className="strong">{c?.title ?? '—'}</span>
                      <div className="sub">{c ? `${c.code} · ${c.providerName}` : ''}</div>
                    </td>
                    <td><StatusBadge meta={TRAINING_STATUS[x.status]} /></td>
                    <td>{x.scheduledDate ? <DateText date={x.scheduledDate} /> : <span className="muted small">{t('Sin programar')}</span>}</td>
                    <td>{x.attendanceDate ? <DateText date={x.attendanceDate} /> : <span className="muted small">{t('Sin registrar')}</span>}</td>
                    <td>
                      {x.completionDate ? (
                        <>
                          <DateText date={x.completionDate} />
                          {x.hours !== null && <div className="sub">{t('{n} h', { n: x.hours })}</div>}
                        </>
                      ) : (
                        <span className="muted small">{t('Sin registrar')}</span>
                      )}
                    </td>
                    <td>
                      {s?.latest ? (
                        <>
                          <DocStatusBadge status={s.accepted ? 'accepted' : s.latest.status} />
                          {x.documentId && docIds.has(x.documentId) && (
                            <div className="sub">
                              <Link to={`/documentacion/${x.documentId}`}>{t('Ver documento')}</Link>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted small">{t('Sin evidencia aportada')}</span>
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
  );
}

// ─────────────────────────────── Equipos asignados ───────────────────────────────

export function EquipmentTab({ emp }: { emp: Employee }) {
  const ctx = useCtx();
  const rows = useMemo(() => visibleIssues(ctx).filter((x) => x.employeeId === emp.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)), [ctx, emp.id]);
  const item = (id: string) => ctx.db.equipment.find((e) => e.id === id);
  const ack = (issueId: string) => ctx.db.acknowledgements.find((a) => a.subject.kind === 'ppe_issue' && a.subject.id === issueId);

  return (
    <Card
      title={t('Equipos asignados')}
      flush
      actions={
        <Link className="btn sm ghost" to="/epi?tab=entregas">
          {t('Ir a EPI')}
        </Link>
      }
    >
      <p className="readiness-note card-note">{t('La confirmación de recepción del equipo no equivale a formación sobre su uso.')}</p>
      {rows.length === 0 ? (
        <EmptyState icon={HardHat} title={t('Sin equipos entregados')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Equipo de protección')}</th>
                <th>{t('Identificador y talla')}</th>
                <th>{t('Centro')}</th>
                <th>{t('Fecha de entrega')}</th>
                <th>{t('Estado')}</th>
                <th>{t('Confirmación de recepción')}</th>
                <th>{t('Revisión o sustitución')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const e = item(x.itemId);
                const a = ack(x.id);
                return (
                  <tr key={x.id}>
                    <td>
                      <span className="strong">{e?.name ?? '—'}</span>
                      <div className="sub">{e?.code}</div>
                    </td>
                    <td className="small">
                      {x.identifier || '—'}
                      {x.size && <div className="sub">{t('Talla {size}', { size: x.size })}</div>}
                    </td>
                    <td className="small">{x.worksiteId ? worksiteName(ctx.db, x.worksiteId) : <span className="muted">—</span>}</td>
                    <td><DateText date={x.issuedAt} /></td>
                    <td><StatusBadge meta={ISSUE_STATUS[x.status]} /></td>
                    <td>
                      {a ? (
                        <>
                          <Badge tone="success">{t('Recepción confirmada')}</Badge>
                          <div className="sub">
                            <DateTimeText at={a.acknowledgedAt} />
                            {a.method === 'paper_recorded' ? ` · ${t('Registro en papel')}` : ''}
                          </div>
                        </>
                      ) : x.status === 'issued' ? (
                        <Badge tone="warning">{t(ITEM_STATUS.pending_ack.label)}</Badge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{x.status === 'issued' ? <KindDate kind="provider" date={x.replacementDue} today={ctx.today} /> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────── Acciones ───────────────────────────────

export function ActionsTab({ emp }: { emp: Employee }) {
  const ctx = useCtx();
  const [showResolved, setShowResolved] = useState(false);
  const all = useMemo(() => visibleActions(ctx).filter((a) => a.employeeId === emp.id).sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999')), [ctx, emp.id]);
  const rows = showResolved ? all : all.filter((a) => a.status !== 'resolved');

  return (
    <Card
      title={t('Acciones pendientes')}
      flush
      actions={<Checkbox label={t('Incluir resueltas')} checked={showResolved} onChange={setShowResolved} />}
    >
      {rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={all.length ? t('Sin acciones pendientes') : t('Sin acciones vinculadas a esta persona')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Acción')}</th>
                <th>{t('Prioridad')}</th>
                <th>{t('Estado')}</th>
                <th>{t('Responsable')}</th>
                <th>{t('Fecha objetivo')}</th>
                <th>{t('Autoridad de revisión')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/acciones/${a.id}`} className="strong">{a.title}</Link>
                    <div className="sub">
                      <span className="mono">{a.code}</span>
                      {a.affectsReadiness && a.status !== 'resolved' && (
                        <>
                          {' '}
                          <Badge tone="danger">{t('Condiciona la disponibilidad')}</Badge>
                        </>
                      )}
                    </div>
                  </td>
                  <td><StatusBadge meta={PRIORITY[a.priority]} /></td>
                  <td><StatusBadge meta={ACTION_STATUS[a.status]} /></td>
                  <td className="small">{a.ownerUserId ? userName(ctx.db, a.ownerUserId) : <span className="muted">{t('Sin asignar')}</span>}</td>
                  <td><KindDate kind="target" date={a.targetDate} today={a.status === 'resolved' ? undefined : ctx.today} /></td>
                  <td className="small">{t(AUTHORITY_LABEL[a.reviewAuthority])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
