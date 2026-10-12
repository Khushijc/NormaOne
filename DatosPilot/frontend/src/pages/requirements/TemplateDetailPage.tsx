/**
 * Requisito PRL detail (/requisitos/:id): summary of the version in force, versions (history kept),
 * affected people, explicit assignments / not-applicable decisions and the audit trail.
 * The approval workflow panel explains who must decide a draft or pending version and why the
 * current user can or cannot (four-eyes, medical-only approval for health requirements).
 */
import { Archive, CheckCircle2, Eye, FilePen, GitBranchPlus, PlayCircle, Send, ShieldAlert, Stethoscope, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { CATEGORY_LABEL, VERSION_STATUS } from '../../domain/status';
import type { RequirementVersion } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { formatDate } from '../../domain/time';
import { userName } from '../../services/context';
import { activateVersion, approvalPermission, needsProfessionalApproval, rejectApproval, submitForApproval, templateRows } from '../../services/requirementService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { AuditList } from '../../components/AuditList';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, DateTimeText, Modal, PageHeader, StatusBadge, Tabs, useAction } from '../../components/ui';
import { ApproveDialog, AssignDialog, RetireDialog } from './TemplateDialogs';
import { AffectedTab, AssignmentsTab, VersionsTab } from './TemplateTabs';
import { VersionForm, type FormMode } from './VersionForm';
import { CriticalBadge, TypeBadge, VersionSummary, approvalIssues, approverBlock, canDraft, isHealthVersion, primaryStatus, type TemplateRow } from './shared';

type Tab = 'resumen' | 'versiones' | 'afectados' | 'asignaciones' | 'historial';
const TABS: Tab[] = ['resumen', 'versiones', 'afectados', 'asignaciones', 'historial'];

export function TemplateDetailPage() {
  const { id = '' } = useParams();
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<FormMode | null>(null);
  const [dialog, setDialog] = useState<'retire' | 'assign' | null>(null);

  const row = templateRows(ctx).find((r) => r.template.id === id);
  if (!row) return <RecordNotFound back="/requisitos" label={tKey('Requisitos PRL')} />;

  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'resumen';
  const setTab = (next: Tab) => setParams((p) => { p.set('tab', next); return p; }, { replace: true });

  const { template, display, latest, current } = row;
  const retired = !!template.retiredAt;
  const mayDraft = canDraft(ctx);
  const inProgress = latest && (latest.status === 'draft' || latest.status === 'pending_approval' || latest.status === 'rejected') ? latest : null;
  const health = isHealthVersion(display) || (!!latest && isHealthVersion(latest));

  // Retirement: needs manage or a professional; mandatory / critical / health ones need the professional.
  const retireBase = current ?? row.versions.filter((v) => v.status !== 'draft' && v.status !== 'pending_approval' && v.status !== 'rejected').pop() ?? null;
  const mayRetireRole = ctx.can('requirements.manage') || ctx.can('requirements.approve_professional') || ctx.can('requirements.approve_health');
  const retireBlock = !retireBase ? t('No hay ninguna versión aprobada que retirar.') : needsProfessionalApproval(retireBase) && !ctx.can(approvalPermission(retireBase)) ? t('Retirar un requisito obligatorio, crítico o de salud requiere la decisión de un profesional.') : null;
  const assignBlock = retired ? t('El requisito está retirado: no admite nuevas asignaciones.') : !current && !row.scheduled ? t('Solo se asignan requisitos con una versión aprobada.') : null;

  return (
    <div className="stack-lg">
      <PageHeader
        breadcrumbs={
          <>
            <Link to="/requisitos">{t('Requisitos PRL')}</Link> / <span>{template.code}</span>
          </>
        }
        title={`${template.code} · ${display.name}`}
        subtitle={
          <span className="rq-header-badges">
            <StatusBadge meta={VERSION_STATUS[primaryStatus(row, ctx.today)]} prefix="Estado" />
            <TypeBadge v={display} />
            <CriticalBadge v={display} />
            <Badge tone="neutral" icon={false}>{t(CATEGORY_LABEL[display.category])}</Badge>
            <span className="small muted">v{display.version}</span>
          </span>
        }
        actions={
          <>
            {mayDraft && !retired && !inProgress && (
              <Button icon={GitBranchPlus} onClick={() => setForm('new_version')}>
                {t('Nueva versión')}
              </Button>
            )}
            {mayRetireRole && !retired && retireBase && (
              <Button variant="danger-outline" icon={Archive} onClick={() => setDialog('retire')} disabled={!!retireBlock} title={retireBlock ?? undefined}>
                {t('Retirar')}
              </Button>
            )}
          </>
        }
      />

      {retired && <RetiredCallout ctx={ctx} row={row} />}

      {health && (
        <Callout tone="warning" icon={Stethoscope} title={t('Vigilancia de la salud')}>
          {t('Solo el servicio médico puede aprobar requisitos de vigilancia de la salud. Un reconocimiento obligatorio exige un supuesto del art. 22.1 LPRL, el informe previo de la representación y una referencia profesional.')}
        </Callout>
      )}

      {mayRetireRole && !retired && retireBase && retireBlock && <p className="tiny muted">{retireBlock}</p>}

      {inProgress && <WorkflowPanel row={row} v={inProgress} onEdit={() => setForm('edit')} />}

      <Tabs<Tab>
        label={t('Secciones del requisito')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'resumen', label: t('Resumen') },
          { id: 'versiones', label: t('Versiones'), count: row.versions.length },
          { id: 'afectados', label: t('Afectados') },
          { id: 'asignaciones', label: t('Asignaciones') },
          { id: 'historial', label: t('Historial') },
        ]}
      />

      {tab === 'resumen' && (
        <div className="stack">
          {!current && !retired && (
            <Callout tone="info">{t('Ninguna versión está en vigor hoy. Se muestra la última versión registrada, que todavía no produce efectos.')}</Callout>
          )}
          {row.scheduled && row.scheduled.id !== display.id && (
            <Callout tone="info" title={t('Versión programada')}>
              {t('La versión {n} está aprobada y entrará en vigor el {date}. Hasta entonces se aplica la versión mostrada.', { n: row.scheduled.version, date: formatDate(row.scheduled.effectiveFrom) })}
            </Callout>
          )}
          <VersionSummary ctx={ctx} v={display} code={template.code} />
        </div>
      )}
      {tab === 'versiones' && <VersionsTab row={row} />}
      {tab === 'afectados' && <AffectedTab row={row} />}
      {tab === 'asignaciones' && <AssignmentsTab row={row} onAssign={() => setDialog('assign')} assignBlock={assignBlock} />}
      {tab === 'historial' && (
        <Card title={t('Historial del requisito')}>
          <AuditList filter={(e) => e.entityId === template.id} />
        </Card>
      )}

      {form === 'new_version' && latest && <VersionForm mode="new_version" templateId={template.id} code={template.code} base={latest} onClose={() => setForm(null)} onSaved={() => { setForm(null); setTab('versiones'); }} />}
      {form === 'edit' && inProgress && <VersionForm mode="edit" templateId={template.id} code={template.code} base={inProgress} onClose={() => setForm(null)} onSaved={() => setForm(null)} />}
      {dialog === 'retire' && <RetireDialog templateId={template.id} code={template.code} name={display.name} onClose={() => setDialog(null)} />}
      {dialog === 'assign' && <AssignDialog templateId={template.id} code={template.code} onClose={() => setDialog(null)} />}
    </div>
  );
}

function RetiredCallout({ ctx, row }: { ctx: UiCtx; row: TemplateRow }) {
  const ev = ctx.db.audit.filter((e) => e.companyId === ctx.company.id && e.entityId === row.template.id && e.action === 'requirement.retire').sort((a, b) => b.seq - a.seq)[0];
  const last = row.versions[row.versions.length - 1];
  const until = row.versions.map((v) => v.effectiveTo).filter((d): d is string => !!d).sort().pop();
  return (
    <Callout tone="neutral" icon={Archive} title={t('Requisito retirado')}>
      <div className="stack-sm" style={{ gap: 4 }}>
        <div>
          {until ? t('Dejó de aplicarse después del {date}.', { date: formatDate(until) }) : t('Retirado el {date}.', { date: formatDate((row.template.retiredAt ?? '').slice(0, 10)) })} {t('El historial, las versiones y las evidencias se conservan.')}
        </div>
        <div>
          <span className="strong">{t('Motivo')}:</span> {row.template.retireReason ? t(row.template.retireReason) : ev?.reason ? t(ev.reason) : last?.applicabilityNote || t('No consta el motivo.')}
        </div>
      </div>
    </Callout>
  );
}

/** Draft / pending / rejected version: who decides it, why it can or cannot be approved, and the actions. */
function WorkflowPanel({ row, v, onEdit }: { row: TemplateRow; v: RequirementVersion; onEdit: () => void }) {
  const ctx = useCtx();
  const { runOk } = useAction();
  const [view, setView] = useState(false);
  const [confirm, setConfirm] = useState<'submit' | 'activate' | 'reject' | 'approve' | null>(null);
  const code = row.template.code;
  const mayDraft = canDraft(ctx);
  const needs = needsProfessionalApproval(v);
  const health = isHealthVersion(v);
  const issues = approvalIssues(ctx, v);
  const block = v.status === 'pending_approval' ? approverBlock(ctx, v) : null;
  const decider = health ? t(AUTHORITY_LABEL.provider_medical) : t(AUTHORITY_LABEL.provider_technical);
  const editable = v.status === 'draft' || v.status === 'rejected';

  return (
    <Card
      className={`rq-workflow rq-workflow-${v.status}`}
      title={
        <div className="row-wrap">
          <h2>{t('Versión {n} en tramitación', { n: v.version })}</h2>
          <StatusBadge meta={VERSION_STATUS[v.status]} />
        </div>
      }
      actions={
        <Button size="sm" variant="ghost" icon={Eye} onClick={() => setView(true)}>
          {t('Ver propuesta')}
        </Button>
      }
    >
      <div className="stack">
        <div className="small">
          {t('Redactada por {who}', { who: userName(ctx.db, v.createdBy) })} · <DateTimeText at={v.createdAt} /> · {t('En vigor desde')} <DateText date={v.effectiveFrom} />
          {v.changeReason && (
            <div className="muted">
              {t('Motivo del cambio')}: {v.changeReason}
            </div>
          )}
        </div>

        {v.status === 'rejected' && (
          <Callout tone="danger" icon={XCircle} title={t('Aprobación rechazada')}>
            {v.approvalNote ? <>{t('Motivo')}: {v.approvalNote}</> : t('Sin motivo registrado.')} {t('Corrija el borrador y vuelva a enviarlo; la versión rechazada no produce efectos.')}
          </Callout>
        )}

        {editable && (
          <p className="small">
            {needs
              ? t('Este requisito es obligatorio, crítico o de salud: necesita la aprobación de {who} antes de aplicarse.', { who: decider })
              : t('Opcional o no aplicable: la coordinación de PRL puede activarlo directamente sin aprobación profesional.')}
          </p>
        )}

        {v.status === 'pending_approval' && <p className="small">{t('Pendiente de la decisión de: {who}. Quien redactó la versión no puede aprobarla (doble control).', { who: decider })}</p>}

        {(v.status === 'pending_approval' || (editable && needs)) && issues.length > 0 && (
          <Callout tone={v.status === 'pending_approval' ? 'danger' : 'warning'} icon={ShieldAlert} title={v.status === 'pending_approval' ? t('No se puede aprobar tal como está') : t('Antes de enviarla, tenga en cuenta que no podrá aprobarse mientras falte:')}>
            <ul className="rq-error-list">
              {issues.map((e, i) => (
                <li key={i}>{t(e)}</li>
              ))}
            </ul>
            {health && v.health?.kind === 'mandatory_exception' && (
              <div className="tiny">{t('Una administración no puede convertir por sí misma un reconocimiento médico en obligatorio: debe existir un supuesto legal, el informe previo de la representación y la decisión del servicio médico.')}</div>
            )}
          </Callout>
        )}

        {v.status === 'pending_approval' && block && (
          <p className="small rq-locked">
            <ShieldAlert size={14} aria-hidden /> {block}
          </p>
        )}

        <div className="row-wrap">
          {editable && mayDraft && (
            <Button icon={FilePen} onClick={onEdit}>
              {t('Editar borrador')}
            </Button>
          )}
          {editable && mayDraft && needs && (
            <Button variant="primary" icon={Send} onClick={() => setConfirm('submit')}>
              {t('Enviar a aprobación')}
            </Button>
          )}
          {v.status === 'draft' && !needs && ctx.can('requirements.manage') && (
            <Button variant="primary" icon={PlayCircle} onClick={() => setConfirm('activate')}>
              {t('Activar')}
            </Button>
          )}
          {v.status === 'draft' && !needs && !ctx.can('requirements.manage') && mayDraft && <span className="small rq-locked">{t('Solo la coordinación de PRL puede activar este borrador.')}</span>}
          {v.status === 'pending_approval' && !block && (
            <>
              <Button variant="primary" icon={CheckCircle2} onClick={() => setConfirm('approve')} disabled={issues.length > 0} title={issues.length ? t('Hay requisitos sin cumplir para la aprobación (ver la lista).') : undefined}>
                {t('Aprobar')}
              </Button>
              <Button variant="danger-outline" icon={XCircle} onClick={() => setConfirm('reject')}>
                {t('Rechazar')}
              </Button>
            </>
          )}
        </div>
      </div>

      {view && (
        <Modal wide title={t('{code} · versión {n} (solo lectura)', { code, n: v.version })} onClose={() => setView(false)} footer={<Button onClick={() => setView(false)}>{t('Cerrar')}</Button>}>
          <VersionSummary ctx={ctx} v={v} code={code} />
        </Modal>
      )}
      {confirm === 'submit' && (
        <ConfirmDialog
          title={t('Enviar a aprobación')}
          message={<p className="small">{t('Se enviará a {who} para su aprobación. Mientras tanto no produce efectos ni puede editarse.', { who: decider })}</p>}
          confirmLabel={t('Enviar a aprobación')}
          onConfirm={() => runOk(() => submitForApproval(v.id), t('Enviado a aprobación profesional'))}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'activate' && (
        <ConfirmDialog
          title={t('Activar versión {n}', { n: v.version })}
          message={<p className="small">{t('La versión se aplicará desde el {date}. Las versiones anteriores se conservan en el historial.', { date: formatDate(v.effectiveFrom) })}</p>}
          confirmLabel={t('Activar')}
          onConfirm={() => runOk(() => activateVersion(v.id), t('Versión activada'))}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'reject' && (
        <ConfirmDialog
          title={t('Rechazar la aprobación')}
          message={<p className="small">{t('La versión no producirá efectos. Quien la redactó recibirá el motivo para corregirla.')}</p>}
          danger
          requireReason
          reasonLabel={t('Motivo del rechazo')}
          confirmLabel={t('Rechazar')}
          onConfirm={(r) => runOk(() => rejectApproval(v.id, r), t('Aprobación rechazada'))}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'approve' && <ApproveDialog v={v} code={code} onClose={() => setConfirm(null)} />}
    </Card>
  );
}
