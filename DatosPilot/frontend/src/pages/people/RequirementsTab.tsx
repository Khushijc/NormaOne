/**
 * Requisitos aplicables tab: the requirement matrix of one employee (itemsFor, health-masked) with
 * why each requirement applies, its evidence status, the three kinds of dates kept apart and the
 * review authority. Actions are offered only to the roles the services accept.
 */
import { Ban, FileLock2, FileUp, RotateCcw, Search, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AUTHORITY_LABEL, PermissionError } from '../../domain/permissions';
import type { MatrixItem } from '../../domain/requirements';
import { CATEGORY_LABEL, REQUIREMENT_TYPE, SOURCE_KIND_LABEL } from '../../domain/status';
import { formatDate, isValidISODate } from '../../domain/time';
import type { Employee } from '../../domain/types';
import { t } from '../../i18n';
import { canReviewAuthority, canSeeHealth, userName, worksiteName } from '../../services/context';
import { requestEvidence, visibleDocuments } from '../../services/evidenceService';
import { openClinicalAttachment } from '../../services/healthService';
import { markNotApplicable, revokeNotApplicable } from '../../services/requirementService';
import { useCtx } from '../../store/hooks';
import { ItemStatusBadge, KindDate, msg, RestrictedNote } from '../../components/bits';
import { Badge, Button, Callout, Card, ConfirmDialog, DateTimeText, EmptyState, Modal, SelectField, SortHeader, TextAreaField, TextField, sortRows, useAction, useSort, useToast } from '../../components/ui';
import { AWAITING_STATUSES, MISSING_STATUSES, REVIEW_STATUSES, VIA_LABEL, norm } from './peopleData';

type Group = 'todos' | 'pendientes' | 'revision' | 'aceptados' | 'no_aplicables' | 'opcionales';
type Dialog = { kind: 'request' | 'na'; item: MatrixItem } | { kind: 'revoke_na'; item: MatrixItem } | null;

const REQUESTABLE = ['document', 'training', 'ppe_issue'];
const UPLOADABLE = ['document', 'training'];

/** Lower = needs attention first. */
function priority(it: MatrixItem): number {
  if (it.status === 'not_applicable') return 6;
  if (!it.counted) return 5;
  if (it.critical && !it.satisfied) return 0;
  if (REVIEW_STATUSES.includes(it.status)) return 1;
  if (MISSING_STATUSES.includes(it.status)) return 2;
  if (AWAITING_STATUSES.includes(it.status)) return 3;
  return 4;
}

export function RequirementsTab({ emp, isSelf, items }: { emp: Employee; isSelf: boolean; items: MatrixItem[] }) {
  const ctx = useCtx();
  const { runOk, pending } = useAction();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>('todos');
  const [site, setSite] = useState('');
  const [clinical, setClinical] = useState<{ ok: boolean; text: string } | null>(null);
  const [clinicalBusy, setClinicalBusy] = useState(false);
  const { sort, onSort } = useSort('priority', 'asc');

  const docIds = useMemo(() => new Set(visibleDocuments(ctx).map((d) => d.id)), [ctx]);
  const health = canSeeHealth(ctx) || isSelf;
  const active = emp.status === 'active';
  const siteIds = [...new Set(items.flatMap((i) => i.worksiteIds))];

  const rows = useMemo(() => {
    const needle = norm(q.trim());
    const list = items.filter((it) => {
      if (needle && !norm(`${it.version.name} ${it.template.code}`).includes(needle)) return false;
      if (site && !it.worksiteIds.includes(site)) return false;
      switch (group) {
        case 'pendientes': return it.counted && (MISSING_STATUSES.includes(it.status) || AWAITING_STATUSES.includes(it.status));
        case 'revision': return REVIEW_STATUSES.includes(it.status);
        case 'aceptados': return it.satisfied && it.status !== 'not_applicable';
        case 'no_aplicables': return it.status === 'not_applicable';
        case 'opcionales': return it.version.requirementType === 'optional';
        default: return true;
      }
    });
    return sortRows(list, sort, (it, col) => (col === 'name' ? it.version.name : col === 'status' ? it.status : col === 'authority' ? it.version.reviewAuthority : priority(it) * 1000 + (it.critical ? 0 : 1)));
  }, [items, q, site, group, sort]);

  const openClinical = async () => {
    setClinicalBusy(true);
    try {
      const ref = await openClinicalAttachment(emp.id);
      setClinical({ ok: true, text: ref });
    } catch (e) {
      toast.error(e);
      setClinical({
        ok: false,
        text: e instanceof PermissionError ? t('Acceso denegado: el documento clínico no está disponible para su rol. El intento ha quedado registrado en la auditoría.') : t('No consta una conclusión vigente del servicio médico con referencia a un expediente clínico externo.'),
      });
    } finally {
      setClinicalBusy(false);
    }
  };

  const docVersionCount = (id: string | null) => (id ? ctx.db.docVersions.filter((v) => v.documentId === id).length : 0);
  const noExpiry = (versionId: string | null) => !!versionId && ctx.db.docVersions.find((v) => v.id === versionId)?.expiryMode === 'none';

  return (
    <div className="stack">
      {clinical && (
        <Callout tone={clinical.ok ? 'info' : 'danger'} title={clinical.ok ? t('Referencia del expediente clínico externo') : t('Documento clínico no disponible')}>
          {clinical.ok ? (
            <>
              <span className="mono">{clinical.text}</span>
              <div className="tiny muted">{t('El informe clínico se custodia fuera del portal, en el servicio médico. La consulta queda registrada en la auditoría restringida.')}</div>
            </>
          ) : (
            clinical.text
          )}
        </Callout>
      )}
      <Card flush>
        <div className="toolbar">
          <TextField className="search" label={t('Buscar requisito')} placeholder={t('Nombre o código')} value={q} onChange={(e) => setQ(e.target.value)} />
          <SelectField label={t('Mostrar')} value={group} onChange={(e) => setGroup(e.target.value as Group)}>
            <option value="todos">{t('Todos')}</option>
            <option value="pendientes">{t('Pendientes de evidencia o de revisión')}</option>
            <option value="revision">{t('Revisión profesional necesaria')}</option>
            <option value="aceptados">{t('Aceptados')}</option>
            <option value="no_aplicables">{t('No aplicables')}</option>
            <option value="opcionales">{t('Opcionales')}</option>
          </SelectField>
          {siteIds.length > 1 && (
            <SelectField label={t('Centro de trabajo')} value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">{t('Todos')}</option>
              {siteIds.map((w) => (
                <option key={w} value={w}>{worksiteName(ctx.db, w)}</option>
              ))}
            </SelectField>
          )}
        </div>
        {items.length === 0 ? (
          <EmptyState title={t('Sin requisitos aplicables')}>{active ? t('Ningún requisito aprobado y vigente aplica a la asignación actual.') : t('No se calculan requisitos para personas inactivas.')}</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title={t('Ningún requisito coincide con los filtros')} />
        ) : (
          <div className="table-wrap">
            <table className="table matrix-table">
              <caption className="sr-only">{t('Requisitos aplicables de {name}', { name: `${emp.firstName} ${emp.lastName}` })}</caption>
              <thead>
                <tr>
                  <SortHeader label={t('Requisito')} col="name" sort={sort} onSort={onSort} />
                  <SortHeader label={t('Estado')} col="priority" sort={sort} onSort={onSort} />
                  <th>{t('Fechas')}</th>
                  <SortHeader label={t('Autoridad de revisión')} col="authority" sort={sort} onSort={onSort} />
                  <th>{t('Por qué aplica')}</th>
                  <th>{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => {
                  const v = it.version;
                  const masked = it.restricted && !health;
                  const ev = it.evidence;
                  const canReview = active && canReviewAuthority(ctx, v.reviewAuthority, emp.id);
                  const canRequest = active && ctx.can('evidence.request') && !it.restricted && REQUESTABLE.includes(v.evidenceMode) && !ev.requestId && (MISSING_STATUSES.includes(it.status) || REVIEW_STATUSES.includes(it.status)) && it.status !== 'pending_ack' && it.status !== 'requested';
                  const canUpload = active && (ctx.can('evidence.upload') || (isSelf && ctx.can('own.submit'))) && !it.restricted && UPLOADABLE.includes(v.evidenceMode) && it.status !== 'not_applicable' && !AWAITING_STATUSES.includes(it.status);
                  const canMarkNA = canReview && it.status !== 'not_applicable' && v.requirementType !== 'not_applicable';
                  const canRevokeNA = canReview && !!it.decision;
                  const docVisible = !!ev.documentId && docIds.has(ev.documentId);
                  const siteLabel = (it.worksiteId ? [it.worksiteId] : it.worksiteIds).map((w) => worksiteName(ctx.db, w)).join(', ');
                  const hasDates = !masked && !!(ev.acceptedVersionId || ev.issueId || ev.providerReviewDate || ev.internalFollowUpDate || ev.legalExpiryDate);
                  return (
                    <tr key={it.key} className={it.critical && !it.satisfied ? 'row-critical' : undefined}>
                      <td className="req-cell">
                        {ctx.can('requirements.view') ? <Link to={`/requisitos/${it.template.id}`} className="strong">{v.name}</Link> : <span className="strong">{v.name}</span>}
                        <div className="sub">
                          <span className="mono">{it.template.code}</span> · v{v.version} · {t(CATEGORY_LABEL[v.category])}
                        </div>
                        <div className="row-wrap badges">
                          <span className="sr-only">{t('Tipo')}: </span>
                          {it.decision ? (
                            <Badge tone="neutral">{t('No aplicable (decisión individual)')}</Badge>
                          ) : (
                            <Badge tone={REQUIREMENT_TYPE[v.requirementType].tone} title={t(REQUIREMENT_TYPE[v.requirementType].help)}>
                              {v.requirementType === 'mandatory_policy' ? t('Obligatorio') : t(REQUIREMENT_TYPE[v.requirementType].label)}
                            </Badge>
                          )}
                          {it.critical && <Badge tone="danger">{t('Crítico')}</Badge>}
                        </div>
                        <div className="sub">
                          {t('Centros')}: {siteLabel || t('General')}
                        </div>
                      </td>
                      <td className="status-cell">
                        <ItemStatusBadge status={it.status} />
                        <div className="sub">{msg(it.reason)}</div>
                        {masked && <RestrictedNote />}
                        {!masked && ev.requestId && it.status !== 'requested' && <div className="sub">{t('Hay una solicitud de evidencia abierta.')}</div>}
                        {!masked && ev.pendingVersionId && it.status !== 'received' && it.status !== 'in_review' && <div className="sub">{t('Hay una versión nueva pendiente de revisión.')}</div>}
                        {it.decision && (
                          <div className="sub">
                            {t('Decidido por {user}', { user: userName(ctx.db, it.decision.decidedBy) })} · <DateTimeText at={it.decision.decidedAt} />
                          </div>
                        )}
                        {docVisible && (
                          <div className="sub">
                            <Link to={`/documentacion/${ev.documentId}`}>{docVersionCount(ev.documentId) > 1 ? t('Historial del documento ({n} versiones)', { n: docVersionCount(ev.documentId) }) : t('Ver documento')}</Link>
                          </div>
                        )}
                      </td>
                      <td className="dates-cell">
                        {hasDates ? (
                          <dl className="date-list">
                            <dt>{t('Caducidad legal')}</dt>
                            <dd><KindDate kind="legal" date={ev.legalExpiryDate} noExpiry={noExpiry(ev.acceptedVersionId)} today={ctx.today} /></dd>
                            <dt>{t('Revisión del proveedor')}</dt>
                            <dd><KindDate kind="provider" date={ev.providerReviewDate} today={ctx.today} /></dd>
                            <dt>{t('Seguimiento interno')}</dt>
                            <dd><KindDate kind="internal" date={ev.internalFollowUpDate} today={ctx.today} /></dd>
                          </dl>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td className="small authority-cell">
                        {t(AUTHORITY_LABEL[v.reviewAuthority])}
                        {v.responsibleReviewer && !masked && <div className="sub">{v.responsibleReviewer}</div>}
                      </td>
                      <td className="small why-cell">
                        {it.via.map((x) => (
                          <div key={x}>{t(VIA_LABEL[x])}</div>
                        ))}
                        <div className="sub">
                          {t(SOURCE_KIND_LABEL[v.source.kind])}
                          {v.source.label ? `: ${v.source.label}` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="action-stack">
                          {canRequest && (
                            <Button size="sm" icon={Send} onClick={() => setDialog({ kind: 'request', item: it })}>
                              {t('Solicitar evidencia')}
                            </Button>
                          )}
                          {canUpload && (
                            <Link className="btn sm" to={`/documentacion?nuevo=1&requisito=${encodeURIComponent(it.template.id)}&empleado=${encodeURIComponent(emp.id)}`}>
                              <FileUp size={15} aria-hidden />
                              {t('Aportar documento')}
                            </Link>
                          )}
                          {canMarkNA && (
                            <Button size="sm" variant="ghost" icon={Ban} onClick={() => setDialog({ kind: 'na', item: it })}>
                              {t('Marcar no aplicable')}
                            </Button>
                          )}
                          {canRevokeNA && (
                            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setDialog({ kind: 'revoke_na', item: it })}>
                              {t('Revocar no aplicable')}
                            </Button>
                          )}
                          {it.restricted && !isSelf && (
                            <Button size="sm" variant="ghost" icon={FileLock2} onClick={openClinical} loading={clinicalBusy} title={t('Solo medicina del trabajo. Los intentos sin permiso quedan registrados.')}>
                              {t('Ver documento clínico')}
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
        )}
      </Card>
      <p className="readiness-note">{t('Aceptado significa que la autoridad de revisión indicada aceptó la evidencia; no es una aprobación profesional de seguridad. Subir un documento no equivale a su aceptación.')}</p>

      {dialog?.kind === 'request' && <RequestModal emp={emp} item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'na' && (
        <ConfirmDialog
          title={t('Marcar como no aplicable')}
          confirmLabel={t('Marcar no aplicable')}
          requireReason
          reasonLabel={t('Motivo por el que no aplica (mínimo 10 caracteres)')}
          message={
            <div className="stack-sm">
              <p className="strong">{dialog.item.version.name}{dialog.item.worksiteId ? ` · ${worksiteName(ctx.db, dialog.item.worksiteId)}` : ''}</p>
              <p className="small muted">{t('La decisión queda registrada con su nombre como autoridad de revisión ({authority}) y el motivo. Se puede revocar más adelante.', { authority: t(AUTHORITY_LABEL[dialog.item.version.reviewAuthority]) })}</p>
            </div>
          }
          onConfirm={(reason) => runOk(() => markNotApplicable(dialog.item.template.id, emp.id, dialog.item.worksiteId, reason), t('No aplicabilidad registrada'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'revoke_na' && dialog.item.decision && (
        <ConfirmDialog
          title={t('Revocar la decisión de no aplicabilidad')}
          confirmLabel={t('Revocar')}
          danger
          requireReason
          message={
            <div className="stack-sm">
              <p className="strong">{dialog.item.version.name}</p>
              <p className="small">{t('Motivo registrado')}: {dialog.item.decision.reason}</p>
              <p className="small muted">{t('El requisito vuelve a aplicarse y a contar para la disponibilidad.')}</p>
            </div>
          }
          onConfirm={(reason) => runOk(() => revokeNotApplicable(dialog.item.decision!.id, reason), t('El requisito vuelve a aplicarse'))}
          onClose={() => setDialog(null)}
        />
      )}
      {pending && <span className="sr-only" role="status">{t('Cargando…')}</span>}
    </div>
  );
}

function RequestModal({ emp, item, onClose }: { emp: Employee; item: MatrixItem; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [followUp, setFollowUp] = useState('');
  const [note, setNote] = useState('');
  const error = followUp && (!isValidISODate(followUp) || followUp < ctx.today) ? t('Hoy o una fecha posterior.') : undefined;
  const submit = async () => {
    if (error) return;
    const ok = await run(() => requestEvidence({ employeeId: emp.id, templateId: item.template.id, worksiteId: item.worksiteId, followUpDate: followUp || null, note }), t('Solicitud de evidencia enviada'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('Solicitar evidencia')}
      description={`${emp.firstName} ${emp.lastName} · ${item.version.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Enviar solicitud')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">{t('Evidencia esperada')}: {item.version.evidenceRequired || '—'}</p>
        <TextField label={t('Seguimiento interno')} type="date" min={ctx.today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} error={error} hint={t('Fecha interna de seguimiento elegida por usted; no es un plazo legal. Opcional.')} />
        <TextAreaField label={t('Nota para la persona trabajadora')} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        {followUp && !error && <p className="tiny muted">{t('Seguimiento el {date}', { date: formatDate(followUp) })}</p>}
      </div>
    </Modal>
  );
}
