/**
 * Shared pieces for the Requisitos PRL screens: status flags of a template row, approval blockers,
 * scope / rule summaries and the read-only version summary (used in «Resumen» and for historical
 * versions). Everything here is read-only: actions go through services/requirementService.
 */
import { ExternalLink, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { versionStatusOn } from '../../domain/requirements';
import { CATEGORY_LABEL, EVIDENCE_MODE_LABEL, EXPIRY_RULE_LABEL, REQUIREMENT_TYPE, REVIEW_RULE_LABEL, SOURCE_KIND_LABEL, VERSION_STATUS } from '../../domain/status';
import type { ExpiryRule, HealthBasis, ID, RequirementScope, RequirementVersion, ReviewRule, VersionStatus } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { approvalPermission, templateRows, validateVersion } from '../../services/requirementService';
import { employeeName, roleName, userName, worksiteName } from '../../services/context';
import { Badge, DateText, DateTimeText, KV, StatusBadge } from '../../components/ui';
import type { UiCtx } from '../../store/hooks';

export type TemplateRow = ReturnType<typeof templateRows>[number];

export const isHealthVersion = (v: Pick<RequirementVersion, 'category' | 'evidenceMode'>) => v.category === 'health_surveillance' || v.evidenceMode === 'health';

/** Statuses offered in the catalogue filter (a template can carry several at once). */
export const FILTER_STATUSES: VersionStatus[] = ['active', 'pending_approval', 'scheduled', 'draft', 'rejected', 'retired'];

/** Display status of the template: the version shown in the catalogue on today's date. */
export function primaryStatus(row: TemplateRow, today: string): VersionStatus {
  if (row.template.retiredAt && !row.current) return 'retired';
  return versionStatusOn(row.display, today);
}

/** Every status that applies to the template (current version, pending approval, scheduled, draft…). */
export function rowFlags(row: TemplateRow, today: string): Set<VersionStatus> {
  const f = new Set<VersionStatus>([primaryStatus(row, today)]);
  if (row.template.retiredAt) f.add('retired');
  if (row.current && versionStatusOn(row.current, today) === 'active') f.add('active');
  if (row.pending) f.add('pending_approval');
  if (row.scheduled) f.add('scheduled');
  if (row.latest?.status === 'draft') f.add('draft');
  if (row.latest?.status === 'rejected') f.add('rejected');
  return f;
}

/** Issues that prevent approving the version as it stands (independent of who approves). */
export function approvalIssues(ctx: UiCtx, v: RequirementVersion): string[] {
  return validateVersion(ctx, { ...v }, { forApproval: true });
}

/** Why the current user cannot approve / reject this pending version (null = may decide). */
export function approverBlock(ctx: UiCtx, v: RequirementVersion): string | null {
  if (!ctx.can(approvalPermission(v))) {
    return isHealthVersion(v)
      ? t('Su rol no puede aprobar este requisito: los requisitos de vigilancia de la salud solo los aprueba el servicio médico.')
      : t('Su rol no puede aprobar este requisito: corresponde a un profesional del servicio de prevención.');
  }
  if (v.createdBy === ctx.user.id) return t('Usted redactó esta versión: debe decidirla otra persona (doble control).');
  return null;
}

export const isApprover = (ctx: UiCtx) => ctx.can('requirements.approve_professional') || ctx.can('requirements.approve_health');
export const canDraft = (ctx: UiCtx) => ctx.can('requirements.draft') || ctx.can('requirements.manage');

export const HEALTH_GROUND_LABEL: Record<NonNullable<HealthBasis['exceptionGround']>, string> = {
  indispensable_evaluation: tKey('Imprescindible para evaluar los efectos de las condiciones de trabajo en la salud'),
  danger_to_others: tKey('Verificar si el estado de salud puede suponer un peligro para la persona o para terceros'),
  specific_legal_provision: tKey('Disposición legal específica (riesgos o actividades de especial peligrosidad)'),
};

export const HEALTH_KIND_LABEL: Record<HealthBasis['kind'], string> = {
  voluntary: tKey('Voluntaria (oferta que la persona trabajadora puede rechazar)'),
  mandatory_exception: tKey('Obligatoria por excepción del art. 22.1 LPRL'),
};

export const EXPIRY_EXPLAIN: Record<ExpiryRule, string> = {
  none: tKey('El emisor no establece caducidad: no se calcula ninguna fecha.'),
  per_document: tKey('Se usa la fecha que indique cada documento; si no la indica, queda como «Revisión necesaria». No se inventa una fecha.'),
  not_determined: tKey('Revisión necesaria: un profesional debe determinar la caducidad. No equivale a «sin caducidad».'),
};

export const REVIEW_EXPLAIN: Record<ReviewRule['kind'], string> = {
  none: tKey('No hay una revisión periódica configurada.'),
  interval: tKey('Periodicidad fijada expresamente por el proveedor o un profesional.'),
  per_document: tKey('Cada documento debe indicar su fecha de revisión; si falta, queda como «Revisión necesaria».'),
  not_determined: tKey('Revisión necesaria: la periodicidad todavía no está determinada por un profesional. No se aplican periodicidades por defecto.'),
};

export const TARGET_KIND_LABEL: Record<'employee' | 'role' | 'worksite', string> = {
  employee: tKey('Empleado/a'),
  role: tKey('Puesto'),
  worksite: tKey('Centro de trabajo'),
};

export const VersionStatusBadge = ({ v, today }: { v: RequirementVersion; today: string }) => <StatusBadge meta={VERSION_STATUS[versionStatusOn(v, today)]} prefix={tKey('Estado de la versión')} />;
export const TypeBadge = ({ v }: { v: Pick<RequirementVersion, 'requirementType'> }) => <StatusBadge meta={REQUIREMENT_TYPE[v.requirementType]} prefix={tKey('Tipo de requisito')} />;

export function CriticalBadge({ v }: { v: Pick<RequirementVersion, 'critical' | 'exceptionAllowed'> }) {
  if (!v.critical) return null;
  return (
    <Badge tone="danger" title={t('Bloquea la disponibilidad mientras no esté resuelto. Solo lo fija el profesional que aprueba.')}>
      {v.exceptionAllowed ? t('Crítico (admite excepción validada)') : t('Crítico')}
    </Badge>
  );
}

function List({ items, empty }: { items: ReactNode[]; empty: string }) {
  if (!items.length) return <span className="muted">{t(empty)}</span>;
  return (
    <ul className="rq-inline-list">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

/** Human-readable scope: who the requirement applies to under this version. */
export function ScopeSummary({ ctx, scope, perWorksite }: { ctx: UiCtx; scope: RequirementScope; perWorksite: boolean }) {
  const tag = (id: string) => ctx.db.riskTags.find((r) => r.id === id && r.companyId === ctx.company.id);
  return (
    <div className="stack-sm">
      {scope.appliesToAll && (
        <div>
          <Badge tone="info">{t('Toda la plantilla')}</Badge>
        </div>
      )}
      <KV
        items={[
          [t('Puestos'), <List key="r" empty={tKey('Cualquier puesto')} items={scope.jobRoleIds.map((id) => roleName(ctx.db, id))} />],
          [t('Centros'), <List key="w" empty={tKey('Cualquier centro')} items={scope.worksiteIds.map((id) => <Link key={id} to={`/centros/${id}`}>{worksiteName(ctx.db, id)}</Link>)} />],
          [
            t('Riesgos'),
            <List
              key="k"
              empty={tKey('Sin criterio de riesgo')}
              items={scope.riskTags.map((id) => {
                const r = tag(id);
                return (
                  <span key={id}>
                    {r?.label ?? id}
                    {r?.specialist && (
                      <>
                        {' '}
                        <Badge tone="warning">{t('Fuera del alcance inicial')}</Badge>
                      </>
                    )}
                  </span>
                );
              })}
            />,
          ],
          [t('Empleados concretos'), <List key="e" empty={tKey('Ninguno')} items={scope.employeeIds.map((id) => employeeName(ctx.db, id))} />],
          [t('Unidad de evidencia'), perWorksite ? t('Una por centro de trabajo (instrucciones de cada centro)') : t('Una por persona trabajadora')],
        ]}
      />
      <p className="tiny muted">{t('Cuando se combinan criterios, la persona debe cumplirlos todos (puesto, centro y riesgo). Los empleados concretos y «toda la plantilla» se añaden siempre.')}</p>
    </div>
  );
}

export function linkedEvidence(ctx: UiCtx, v: RequirementVersion): ReactNode {
  if (v.evidenceMode === 'training') {
    const c = ctx.db.courses.find((x) => x.id === v.courseId);
    return c ? <Link to="/formacion?tab=catalogo">{c.code} · {c.title}</Link> : <span className="muted">{t('Sin curso vinculado')}</span>;
  }
  if (v.evidenceMode === 'ppe_issue') {
    const e = ctx.db.equipment.find((x) => x.id === v.equipmentItemId);
    return e ? <Link to="/epi?tab=catalogo">{e.code} · {e.name}</Link> : <span className="muted">{t('Sin equipo vinculado')}</span>;
  }
  if (v.evidenceMode === 'acknowledgement') {
    const d = ctx.db.documents.find((x) => x.id === v.instructionDocumentId);
    return d ? <Link to={`/documentacion/${d.id}`}>{d.code} · {d.title}</Link> : <span className="muted">{t('Sin documento vinculado')}</span>;
  }
  return null;
}

export function SourceLink({ v }: { v: RequirementVersion }) {
  return (
    <span>
      <span className="muted">{t(SOURCE_KIND_LABEL[v.source.kind])}</span>
      {' · '}
      {v.source.label || <span className="muted">{t('Sin referencia')}</span>}
      {v.source.url && (
        <>
          {' '}
          <a href={v.source.url} target="_blank" rel="noreferrer noopener" className="nowrap">
            {t('Abrir fuente')} <ExternalLink size={12} aria-hidden style={{ verticalAlign: -1 }} />
            <span className="sr-only"> ({t('se abre en una pestaña nueva')})</span>
          </a>
        </>
      )}
      {v.source.assessmentId && (
        <>
          {' · '}
          <Link to={`/evaluaciones/${v.source.assessmentId}`}>{t('Ver evaluación')}</Link>
        </>
      )}
    </span>
  );
}

export function ExpiryRuleText({ rule }: { rule: ExpiryRule }) {
  return (
    <div>
      <div className="strong">{t(EXPIRY_RULE_LABEL[rule])}</div>
      <div className="tiny muted">{t(EXPIRY_EXPLAIN[rule])}</div>
    </div>
  );
}

export function ReviewRuleText({ rule }: { rule: ReviewRule }) {
  return (
    <div>
      <div className="strong">
        {t(REVIEW_RULE_LABEL[rule.kind])}
        {rule.kind === 'interval' && rule.months ? ` · ${t('cada {n} meses', { n: rule.months })}` : ''}
      </div>
      {rule.kind === 'interval' && rule.setBy && <div className="tiny">{t('Fijada por: {who}', { who: rule.setBy })}</div>}
      <div className="tiny muted">{t(REVIEW_EXPLAIN[rule.kind])}</div>
    </div>
  );
}

export function HealthBasisText({ h }: { h: HealthBasis | null }) {
  if (!h) return <span className="muted">{t('No indicada')}</span>;
  return (
    <div className="stack-sm" style={{ gap: 2 }}>
      <div className="strong">{t(HEALTH_KIND_LABEL[h.kind])}</div>
      {h.kind === 'mandatory_exception' && (
        <KV
          items={[
            [t('Supuesto del art. 22.1'), h.exceptionGround ? t(HEALTH_GROUND_LABEL[h.exceptionGround]) : <span className="rq-missing">{t('Falta')}</span>],
            [t('Informe previo de la representación'), h.representativesReportOn ? <DateText date={h.representativesReportOn} /> : <span className="rq-missing">{t('Falta')}</span>],
            [t('Referencia profesional'), h.professionalReference || <span className="rq-missing">{t('Falta')}</span>],
          ]}
        />
      )}
      {h.kind === 'voluntary' && h.professionalReference && <div className="tiny">{t('Referencia profesional')}: {h.professionalReference}</div>}
    </div>
  );
}

const yesNo = (b: boolean) => (b ? t('Sí') : t('No'));

/** Full read-only description of one version (summary tab and historical versions). */
export function VersionSummary({ ctx, v, code }: { ctx: UiCtx; v: RequirementVersion; code: string }) {
  const approved = v.approvedBy && v.status !== 'draft' && v.status !== 'pending_approval';
  return (
    <div className="rq-summary">
      <section className="card">
        <div className="card-header">
          <h2>{t('Definición')}</h2>
        </div>
        <div className="card-body">
          <KV
            items={[
              [t('Código'), <span key="c" className="strong">{code}</span>],
              [t('Nombre'), v.name],
              [t('Descripción'), v.description || <span className="muted">{t('Sin descripción')}</span>],
              [t('Finalidad'), v.purpose || <span className="muted">{t('No indicada')}</span>],
              [t('Categoría'), t(CATEGORY_LABEL[v.category])],
              [t('Tipo de requisito'), <TypeBadge key="t" v={v} />],
              [t('Cómo se acredita'), <span key="m">{t(EVIDENCE_MODE_LABEL[v.evidenceMode])}{linkedEvidence(ctx, v) && <> · {linkedEvidence(ctx, v)}</>}</span>],
              [t('Evidencia requerida'), v.evidenceRequired],
            ]}
          />
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>{t('Ámbito: a quién se aplica')}</h2>
        </div>
        <div className="card-body">
          <ScopeSummary ctx={ctx} scope={v.scope} perWorksite={v.perWorksite} />
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>{t('Fuente y aplicabilidad')}</h2>
        </div>
        <div className="card-body">
          <KV
            items={[
              [t('Fuente o referencia'), <SourceLink key="s" v={v} />],
              [t('Por qué se aplica'), v.applicabilityNote || <span className="muted">{t('Sin explicación')}</span>],
            ]}
          />
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>{t('Revisión, caducidad y fechas')}</h2>
        </div>
        <div className="card-body">
          <KV
            items={[
              [t('Autoridad de revisión'), t(AUTHORITY_LABEL[v.reviewAuthority])],
              [t('Persona revisora responsable'), v.responsibleReviewer || <span className="muted">{t('No indicada')}</span>],
              [t('Caducidad legal de la evidencia'), <ExpiryRuleText key="x" rule={v.expiryRule} />],
              [t('Revisión periódica de la evidencia'), <ReviewRuleText key="r" rule={v.reviewRule} />],
              [t('Revisión de la política'), v.policyReviewDate ? <DateText date={v.policyReviewDate} /> : <span className="muted">{t('No establecida')}</span>],
              [t('En vigor desde'), <DateText key="f" date={v.effectiveFrom} />],
              [t('En vigor hasta'), v.effectiveTo ? <DateText date={v.effectiveTo} /> : <span className="muted">{t('Sin fecha de fin')}</span>],
            ]}
          />
        </div>
      </section>

      {isHealthVersion(v) && (
        <section className="card">
          <div className="card-header">
            <h2>{t('Base de la vigilancia de la salud')}</h2>
            <Badge tone="danger" icon={Lock}>{t('Área restringida')}</Badge>
          </div>
          <div className="card-body">
            <HealthBasisText h={v.health} />
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>{t('Aprobación y estado')}</h2>
        </div>
        <div className="card-body">
          <KV
            items={[
              [t('Versión'), <span key="v">v{v.version} · <VersionStatusBadge v={v} today={ctx.today} /></span>],
              [t('Crítico para la asignación'), <span key="c">{yesNo(v.critical)} <span className="tiny muted">· {t('solo lo fija el profesional que aprueba')}</span></span>],
              [t('Admite excepción validada'), yesNo(v.exceptionAllowed)],
              [t('Invalida evidencias anteriores'), yesNo(v.invalidatesPriorEvidence)],
              [t('Redactada por'), <span key="a">{userName(ctx.db, v.createdBy)} · <DateTimeText at={v.createdAt} /></span>],
              [t('Aprobada por'), approved ? <span>{userName(ctx.db, v.approvedBy)} · <DateTimeText at={v.approvedAt} /></span> : <span className="muted">{t('Sin aprobar')}</span>],
              [v.status === 'rejected' ? t('Motivo del rechazo') : t('Nota de aprobación'), v.approvalNote || <span className="muted">—</span>],
              [t('Motivo del cambio'), v.changeReason || <span className="muted">—</span>],
            ]}
          />
        </div>
      </section>
    </div>
  );
}

export const targetLabel = (ctx: UiCtx, target: { kind: 'employee' | 'role' | 'worksite'; id: ID }) =>
  target.kind === 'employee' ? employeeName(ctx.db, target.id) : target.kind === 'role' ? roleName(ctx.db, target.id) : worksiteName(ctx.db, target.id);
