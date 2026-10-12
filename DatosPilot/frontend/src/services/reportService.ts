/**
 * Evidence reports and exports (PRL-08, PLT-06, NFR-10).
 *
 * Rows are built HERE from the caller's permitted scope, never taken from the screen, so an export
 * cannot contain more than the caller may see. Health-related details are always masked in
 * general reports; the restricted health report is available only to health-authorised users.
 * Every export carries metadata (company, scope, recipient, generation time, open items) and is
 * recorded in the audit log with a demo fingerprint. Unresolved items stay visible.
 */
import { AUTHORITY_LABEL, PermissionError, type Permission } from '../domain/permissions';
import { ACTION_STATUS, ASSESSMENT_STATUS, CATEGORY_LABEL, DOC_STATUS, EXPIRY_RULE_LABEL, FITNESS_LABEL, ISSUE_STATUS, ITEM_STATUS, READINESS, REQUIREMENT_TYPE, TRAINING_STATUS, CAE_REVIEW } from '../domain/status';
import { AUDIT_ACTION_LABEL } from '../domain/audit';
import { assignmentOn, maskItem, matrixFor, versionOn } from '../domain/requirements';
import { formatDate, nowInstant } from '../domain/time';
import { demoHash, newId } from '../domain/ids';
import type { ExportJob, ID } from '../domain/types';
import { transact } from '../store/db';
import { alertDays, can, canSeeEmployee, canSeeHealth, employeeName, getCtx, latency, roleName, userName, visibleEmployeeIds, visibleReadiness, visibleWorksiteIds, worksiteName, readinessAggregate, type Ctx } from './context';
import { visibleDocuments } from './evidenceService';
import { visibleActions, visibleAssessments } from './safetyService';
import { visibleIssues, visibleTrainings } from './trainingService';
import { casePending, shareableVersions, visibleCases } from './caeService';
import { healthRows } from './healthService';

export interface Filters {
  worksiteId: ID | '';
  departmentId: ID | '';
  employeeId: ID | '';
  category: string;
  status: string;
  caseId: ID | '';
}

export const EMPTY_FILTERS: Filters = { worksiteId: '', departmentId: '', employeeId: '', category: '', status: '', caseId: '' };

export interface Column {
  key: string;
  label: string;
}

export type Row = Record<string, string | number>;

export interface ReportResult {
  columns: Column[];
  rows: Row[];
  /** Unresolved items declared in the export (missing, in review, open…). */
  unresolved: number;
  scope: string;
  redacted: boolean;
}

export interface ReportDef {
  id: string;
  title: string;
  description: string;
  /** Any of these permissions gives access. */
  perms: Permission[];
  restricted?: boolean;
  needsCase?: boolean;
  build: (ctx: Ctx, f: Filters) => ReportResult;
}

const d = (x: string | null | undefined) => (x ? formatDate(x.slice(0, 10)) : '—');
const col = (key: string, label: string): Column => ({ key, label });

function employeeFilter(ctx: Ctx, f: Filters): ID[] {
  return [...visibleEmployeeIds(ctx)].filter((id) => {
    const e = ctx.db.employees.find((x) => x.id === id);
    if (!e || e.status !== 'active') return false;
    if (f.employeeId && id !== f.employeeId) return false;
    const a = assignmentOn(ctx.db, id, ctx.today);
    if (f.departmentId && a?.departmentId !== f.departmentId) return false;
    if (f.worksiteId && !a?.worksiteIds.includes(f.worksiteId)) return false;
    return true;
  });
}

/** Filter values are item-status or readiness keys depending on the report; show the label, never the raw key. */
const statusLabel = (k: string): string => (ITEM_STATUS as Record<string, { label: string }>)[k]?.label ?? (READINESS as Record<string, { label: string }>)[k]?.label ?? k;

function scopeText(ctx: Ctx, f: Filters): string {
  const parts = [f.worksiteId && `Centro: ${worksiteName(ctx.db, f.worksiteId)}`, f.departmentId && `Departamento: ${ctx.db.departments.find((x) => x.id === f.departmentId)?.name}`, f.employeeId && `Empleado: ${employeeName(ctx.db, f.employeeId)}`, f.category && `Categoría: ${CATEGORY_LABEL[f.category as keyof typeof CATEGORY_LABEL] ?? f.category}`, f.status && `Estado: ${statusLabel(f.status)}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Sin filtros (todo el ámbito permitido)';
}

/** General reports never carry health detail (masked like for a non-health viewer). */
function generalItems(ctx: Ctx, employeeId: ID) {
  return matrixFor(ctx.db, ctx.company.id, employeeId, ctx.today, alertDays(ctx)).map((it) => maskItem(it, false));
}

const itemRow = (ctx: Ctx, it: ReturnType<typeof generalItems>[number]): Row => ({
  empleado: employeeName(ctx.db, it.employeeId),
  codigo: it.template.code,
  requisito: it.version.name,
  version_requisito: `v${it.version.version}`,
  tipo: REQUIREMENT_TYPE[it.version.requirementType].label,
  critico: it.critical ? 'Sí' : 'No',
  centro: it.worksiteId ? worksiteName(ctx.db, it.worksiteId) : it.worksiteIds.map((w) => worksiteName(ctx.db, w)).join(', ') || '—',
  estado: ITEM_STATUS[it.status].label,
  detalle: it.reason.params ? Object.entries(it.reason.params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), it.reason.text) : it.reason.text,
  autoridad_revision: AUTHORITY_LABEL[it.version.reviewAuthority],
  caducidad_legal: d(it.evidence.legalExpiryDate),
  revision_proveedor: d(it.evidence.providerReviewDate),
  seguimiento_interno: d(it.evidence.internalFollowUpDate),
});

const ITEM_COLUMNS = [col('empleado', 'Empleado'), col('codigo', 'Código'), col('requisito', 'Requisito'), col('version_requisito', 'Versión'), col('tipo', 'Tipo'), col('critico', 'Crítico'), col('centro', 'Centro'), col('estado', 'Estado'), col('detalle', 'Detalle'), col('autoridad_revision', 'Autoridad de revisión'), col('caducidad_legal', 'Caducidad legal'), col('revision_proveedor', 'Revisión del proveedor'), col('seguimiento_interno', 'Seguimiento interno')];

function itemsReport(ctx: Ctx, f: Filters, keep: (it: ReturnType<typeof generalItems>[number]) => boolean): ReportResult {
  const rows: Row[] = [];
  let unresolved = 0;
  let redacted = false;
  for (const id of employeeFilter(ctx, f)) {
    for (const it of generalItems(ctx, id)) {
      if (f.worksiteId && !it.worksiteIds.includes(f.worksiteId)) continue;
      if (f.category && it.version.category !== f.category) continue;
      if (f.status && it.status !== f.status) continue;
      if (!keep(it)) continue;
      if (it.restricted) redacted = true;
      if (it.counted && !it.satisfied) unresolved++;
      rows.push(itemRow(ctx, it));
    }
  }
  return { columns: ITEM_COLUMNS, rows, unresolved, scope: scopeText(ctx, f), redacted };
}

export const REPORTS: ReportDef[] = [
  {
    id: 'employee_evidence',
    title: 'Resumen de evidencias por empleado',
    description: 'Requisitos aplicables, estado de la evidencia, versión del requisito y fechas reales.',
    perms: ['employees.view_all', 'team.view', 'own.view'],
    build: (ctx, f) => itemsReport(ctx, f, () => true),
  },
  {
    id: 'missing',
    title: 'Evidencias obligatorias pendientes',
    description: 'Requisitos obligatorios sin evidencia aceptada (opcionales y no aplicables excluidos).',
    perms: ['employees.view_all', 'team.view'],
    build: (ctx, f) => itemsReport(ctx, f, (it) => it.counted && !it.satisfied),
  },
  {
    id: 'worksite_summary',
    title: 'Resumen por centro de trabajo',
    description: 'Disponibilidad agregada, acciones abiertas, evaluación aceptada y puntos CAE pendientes.',
    perms: ['worksites.view', 'team.view', 'representative.view'],
    build: (ctx, f) => {
      const agg = new Map(readinessAggregate(ctx).map((x) => [x.worksiteId, x]));
      const actions = visibleActions(ctx);
      const rows: Row[] = [];
      let unresolved = 0;
      for (const w of ctx.db.worksites.filter((x) => x.companyId === ctx.company.id && visibleWorksiteIds(ctx).has(x.id) && (!f.worksiteId || x.id === f.worksiteId))) {
        const a = agg.get(w.id);
        const c = (s: string) => a?.counts[s] ?? 0;
        const open = actions.filter((x) => x.worksiteId === w.id && x.status !== 'resolved').length;
        const kase = ctx.db.caeCases.find((x) => x.worksiteId === w.id && x.status !== 'closed');
        const p = kase ? casePending(ctx, kase) : null;
        const assessment = ctx.db.assessments.find((x) => x.worksiteId === w.id && x.status !== 'superseded');
        unresolved += c('blocked') + c('incomplete') + c('professional_review') + open;
        rows.push({ centro: `${w.code} · ${w.name}`, activo: w.active ? 'Sí' : 'No', asignaciones: a?.total ?? 0, listas: c('ready'), en_revision: c('in_review'), incompletas: c('incomplete'), revision_profesional: c('professional_review'), bloqueadas: c('blocked'), pendientes_evaluacion: c('pending_evaluation'), acciones_abiertas: open, evaluacion_centro: assessment ? `${assessment.code} v${assessment.version} (${ASSESSMENT_STATUS[assessment.status].label})` : 'Sin evaluación específica del centro', cae_pendiente: p ? `${p.notSent + p.noReceipt + p.noAck + p.toReview} puntos` : '—' });
      }
      return { columns: [col('centro', 'Centro'), col('activo', 'Activo'), col('asignaciones', 'Asignaciones'), col('listas', 'Listas según requisitos'), col('en_revision', 'En revisión'), col('incompletas', 'Incompletas'), col('revision_profesional', 'Revisión profesional'), col('bloqueadas', 'Bloqueadas'), col('pendientes_evaluacion', 'Pendientes de evaluación'), col('acciones_abiertas', 'Acciones abiertas'), col('evaluacion_centro', 'Evaluación del centro'), col('cae_pendiente', 'CAE pendiente')], rows, unresolved, scope: scopeText(ctx, f), redacted: false };
    },
  },
  {
    id: 'role_matrix',
    title: 'Matriz de puestos y requisitos',
    description: 'Qué requisitos aplican a cada puesto según las versiones vigentes (con su fuente y autoridad).',
    perms: ['requirements.view'],
    build: (ctx) => {
      const rows: Row[] = [];
      for (const t of ctx.db.templates.filter((x) => x.companyId === ctx.company.id)) {
        const v = versionOn(ctx.db, t.id, ctx.today);
        if (!v) continue;
        for (const r of ctx.db.jobRoles.filter((x) => x.companyId === ctx.company.id && x.active)) {
          const s = v.scope;
          const byRole = s.jobRoleIds.includes(r.id) || (s.riskTags.length > 0 && s.riskTags.some((tag) => r.riskTags.includes(tag)) && (!s.jobRoleIds.length || s.jobRoleIds.includes(r.id)));
          const site = s.worksiteIds.length > 0 && (!s.jobRoleIds.length || s.jobRoleIds.includes(r.id));
          const applies = s.appliesToAll || byRole || site;
          if (!applies) continue;
          rows.push({ puesto: r.name, codigo: t.code, requisito: v.name, version: `v${v.version}`, tipo: REQUIREMENT_TYPE[v.requirementType].label, critico: v.critical ? 'Sí' : 'No', ambito: s.appliesToAll ? 'Toda la plantilla' : site && !byRole ? `Solo en: ${s.worksiteIds.map((w) => worksiteName(ctx.db, w)).join(', ')}` : 'Por puesto o riesgo', fuente: v.source.label, autoridad: AUTHORITY_LABEL[v.reviewAuthority], caducidad: EXPIRY_RULE_LABEL[v.expiryRule] });
        }
      }
      return { columns: [col('puesto', 'Puesto'), col('codigo', 'Código'), col('requisito', 'Requisito'), col('version', 'Versión'), col('tipo', 'Tipo'), col('critico', 'Crítico'), col('ambito', 'Ámbito'), col('fuente', 'Fuente'), col('autoridad', 'Autoridad de revisión'), col('caducidad', 'Caducidad')], rows, unresolved: 0, scope: 'Versiones vigentes hoy', redacted: false };
    },
  },
  {
    id: 'awaiting_review',
    title: 'Documentos pendientes de revisión',
    description: 'Versiones recibidas o en revisión, con su autoridad de revisión.',
    perms: ['evidence.view_all', 'evidence.review'],
    build: (ctx, f) => {
      const rows: Row[] = [];
      for (const doc of visibleDocuments(ctx)) {
        if (f.employeeId && doc.employeeId !== f.employeeId) continue;
        if (f.worksiteId && doc.worksiteId && doc.worksiteId !== f.worksiteId) continue;
        for (const v of ctx.db.docVersions.filter((x) => x.documentId === doc.id && (x.status === 'received' || x.status === 'in_review'))) {
          rows.push({ codigo: doc.code, documento: doc.title, version: `v${v.version}`, empleado: employeeName(ctx.db, doc.employeeId), estado: DOC_STATUS[v.status].label, recibido: d(v.receivedAt), presentado_por: userName(ctx.db, v.submittedBy), revisor: userName(ctx.db, v.reviewerId) });
        }
      }
      return { columns: [col('codigo', 'Código'), col('documento', 'Documento'), col('version', 'Versión'), col('empleado', 'Empleado'), col('estado', 'Estado'), col('recibido', 'Recibido'), col('presentado_por', 'Presentado por'), col('revisor', 'Revisor')], rows, unresolved: rows.length, scope: scopeText(ctx, f), redacted: false };
    },
  },
  {
    id: 'dates',
    title: 'Caducidades y fechas de revisión',
    description: 'Solo fechas que existen: caducidad legal, revisión del proveedor, seguimiento interno, objetivos de acciones y revisiones de evaluaciones.',
    perms: ['evidence.view_all', 'team.view'],
    build: (ctx, f) => {
      const rows: Row[] = [];
      for (const doc of visibleDocuments(ctx)) {
        if (f.employeeId && doc.employeeId !== f.employeeId) continue;
        const v = ctx.db.docVersions.filter((x) => x.documentId === doc.id && x.status === 'accepted').sort((a, b) => b.version - a.version)[0];
        if (!v) continue;
        const push = (tipo: string, fecha: string | null) => fecha && rows.push({ tipo, fecha: d(fecha), fecha_iso: fecha, documento: `${doc.code} · ${doc.title}`, empleado: employeeName(ctx.db, doc.employeeId), situacion: fecha < ctx.today ? 'Vencida' : 'Próxima' });
        push('Caducidad legal', v.legalExpiryDate);
        push('Revisión del proveedor', v.providerReviewDate);
        push('Seguimiento interno', v.internalFollowUpDate);
      }
      for (const a of visibleActions(ctx)) if (a.targetDate && a.status !== 'resolved') rows.push({ tipo: 'Fecha objetivo de acción', fecha: d(a.targetDate), fecha_iso: a.targetDate, documento: `${a.code} · ${a.title}`, empleado: employeeName(ctx.db, a.employeeId), situacion: a.targetDate < ctx.today ? 'Vencida' : 'Próxima' });
      for (const a of visibleAssessments(ctx)) if (a.reviewDate && a.status === 'accepted') rows.push({ tipo: 'Revisión de evaluación (fijada por el evaluador)', fecha: d(a.reviewDate), fecha_iso: a.reviewDate, documento: `${a.code} · ${a.title}`, empleado: '—', situacion: a.reviewDate < ctx.today ? 'Vencida' : 'Próxima' });
      rows.sort((a, b) => String(a.fecha_iso).localeCompare(String(b.fecha_iso)));
      return { columns: [col('tipo', 'Tipo de fecha'), col('fecha', 'Fecha'), col('documento', 'Documento o acción'), col('empleado', 'Empleado'), col('situacion', 'Situación')], rows, unresolved: rows.filter((r) => r.situacion === 'Vencida').length, scope: `${scopeText(ctx, f)}. Los documentos sin fecha no aparecen con un plazo inventado.`, redacted: false };
    },
  },
  {
    id: 'training',
    title: 'Formación: asistencia, finalización y evidencia',
    description: 'Hechos separados: asignación, asistencia, finalización y aceptación de la evidencia.',
    perms: ['training.manage', 'employees.view_all', 'team.view'],
    build: (ctx, f) => {
      const ids = new Set(employeeFilter(ctx, f));
      const rows = visibleTrainings(ctx)
        .filter((t) => ids.has(t.employeeId))
        .map((t) => {
          const c = ctx.db.courses.find((x) => x.id === t.courseId);
          const v = t.documentId ? ctx.db.docVersions.filter((x) => x.documentId === t.documentId).sort((a, b) => b.version - a.version)[0] : undefined;
          return { empleado: employeeName(ctx.db, t.employeeId), curso: c ? `${c.code} · ${c.title}` : t.courseId, estado: TRAINING_STATUS[t.status].label, prevista: d(t.scheduledDate), asistencia: d(t.attendanceDate), finalizacion: d(t.completionDate), evidencia: v ? DOC_STATUS[v.status].label : 'Sin evidencia' } as Row;
        });
      return { columns: [col('empleado', 'Empleado'), col('curso', 'Curso'), col('estado', 'Estado'), col('prevista', 'Prevista'), col('asistencia', 'Asistencia'), col('finalizacion', 'Finalización'), col('evidencia', 'Evidencia')], rows, unresolved: rows.filter((r) => r.evidencia !== 'Aceptado').length, scope: scopeText(ctx, f), redacted: false };
    },
  },
  {
    id: 'ppe',
    title: 'Entregas de EPI y confirmaciones',
    description: 'Entrega, confirmación de recepción y revisión programada (si está configurada).',
    perms: ['ppe.manage', 'employees.view_all', 'team.view'],
    build: (ctx, f) => {
      const ids = new Set(employeeFilter(ctx, f));
      const rows = visibleIssues(ctx)
        .filter((i) => ids.has(i.employeeId))
        .map((i) => {
          const item = ctx.db.equipment.find((x) => x.id === i.itemId);
          const ack = ctx.db.acknowledgements.find((a) => a.subject.kind === 'ppe_issue' && a.subject.id === i.id);
          return { empleado: employeeName(ctx.db, i.employeeId), equipo: item ? `${item.code} · ${item.name}` : i.itemId, identificador: i.identifier || '—', entrega: d(i.issuedAt), estado: ISSUE_STATUS[i.status].label, confirmacion: ack ? d(ack.acknowledgedAt) : 'Pendiente', revision_programada: d(i.replacementDue) } as Row;
        });
      return { columns: [col('empleado', 'Empleado'), col('equipo', 'Equipo'), col('identificador', 'Identificador'), col('entrega', 'Entrega'), col('estado', 'Estado'), col('confirmacion', 'Confirmación'), col('revision_programada', 'Revisión programada')], rows, unresolved: rows.filter((r) => r.confirmacion === 'Pendiente' && r.estado === 'Entregado').length, scope: scopeText(ctx, f), redacted: false };
    },
  },
  {
    id: 'actions',
    title: 'Acciones preventivas abiertas',
    description: 'Acciones sin resolver con responsable, fecha objetivo justificada y estado.',
    perms: ['actions.view_all', 'representative.view', 'team.view'],
    build: (ctx, f) => {
      const rows = visibleActions(ctx)
        .filter((a) => a.status !== 'resolved' && (!f.worksiteId || a.worksiteId === f.worksiteId))
        .map((a) => ({ codigo: a.code, titulo: a.title, origen: a.source.label, centro: worksiteName(ctx.db, a.worksiteId), empleado: a.employeeId ? employeeName(ctx.db, a.employeeId) : '—', responsable: userName(ctx.db, a.ownerUserId), fecha_objetivo: d(a.targetDate), vencida: a.targetDate && a.targetDate < ctx.today ? 'Sí' : 'No', estado: ACTION_STATUS[a.status].label, autoridad: AUTHORITY_LABEL[a.reviewAuthority] }) as Row);
      return { columns: [col('codigo', 'Código'), col('titulo', 'Título'), col('origen', 'Origen'), col('centro', 'Centro'), col('empleado', 'Empleado'), col('responsable', 'Responsable'), col('fecha_objetivo', 'Fecha objetivo'), col('vencida', 'Vencida'), col('estado', 'Estado'), col('autoridad', 'Autoridad de revisión')], rows, unresolved: rows.length, scope: scopeText(ctx, f), redacted: !can(ctx, 'actions.view_all') };
    },
  },
  {
    id: 'assessments',
    title: 'Registro de evaluaciones de riesgos',
    description: 'Versiones, estado, evaluador y fechas de revisión establecidas. Sin puntuaciones calculadas.',
    perms: ['risk.view', 'representative.view'],
    build: (ctx, f) => {
      const rows = visibleAssessments(ctx)
        .filter((a) => !f.worksiteId || a.worksiteId === f.worksiteId)
        .map((a) => ({ codigo: a.code, version: `v${a.version}`, titulo: a.title, centro: worksiteName(ctx.db, a.worksiteId), puestos: a.jobRoleIds.map((r) => roleName(ctx.db, r)).join(', ') || '—', evaluador: a.assessorName, emision: d(a.issueDate), revision: a.reviewDate ? d(a.reviewDate) : 'No establecida', estado: ASSESSMENT_STATUS[a.status].label }) as Row);
      return { columns: [col('codigo', 'Código'), col('version', 'Versión'), col('titulo', 'Título'), col('centro', 'Centro'), col('puestos', 'Puestos'), col('evaluador', 'Evaluador'), col('emision', 'Emisión'), col('revision', 'Revisión'), col('estado', 'Estado')], rows, unresolved: rows.filter((r) => r.estado !== ASSESSMENT_STATUS.accepted.label && r.estado !== ASSESSMENT_STATUS.superseded.label).length, scope: scopeText(ctx, f), redacted: false };
    },
  },
  {
    id: 'cae_package',
    title: 'Paquete de coordinación CAE',
    description: 'Solo evidencia aceptada y relevante para el centro, intercambios con su estado y puntos pendientes.',
    perms: ['cae.view'],
    needsCase: true,
    build: (ctx, f) => {
      const c = visibleCases(ctx).find((x) => x.id === f.caseId);
      if (!c) return { columns: [], rows: [], unresolved: 0, scope: 'Seleccione un caso CAE', redacted: false };
      const rows: Row[] = [];
      for (const { doc, version } of shareableVersions(ctx, c)) rows.push({ seccion: 'Evidencia aceptada', elemento: `${doc.code} · ${doc.title}`, version: `v${version.version}`, emisor: version.issuer, fecha: d(version.issueDate), estado: DOC_STATUS[version.status].label, observaciones: version.legalExpiryDate ? `Caduca ${d(version.legalExpiryDate)}` : version.expiryMode === 'none' ? 'Sin caducidad' : 'Caducidad no indicada' });
      for (const x of ctx.db.caeExchanges.filter((e) => e.caseId === c.id)) {
        const from = c.participants.find((p) => p.id === x.senderParticipantId)?.organisation ?? '—';
        const to = c.participants.find((p) => p.id === x.recipientParticipantId)?.organisation ?? '—';
        rows.push({ seccion: x.direction === 'sent' ? 'Información enviada' : 'Información recibida', elemento: x.subject, version: x.versionLabel, emisor: `${from} → ${to}`, fecha: d(x.sentAt), estado: x.direction === 'sent' ? (x.acknowledgedAt ? 'Acuse de comprensión registrado' : x.receivedAt ? 'Recibido, sin acuse' : x.sentAt ? 'Enviado, sin confirmación de recepción' : 'Pendiente de envío') : CAE_REVIEW[x.review].label, observaciones: x.followUp || '—' });
      }
      const p = casePending(ctx, c);
      const open = p.notSent + p.noReceipt + p.noAck + p.toReview;
      if (c.openQuestions) rows.push({ seccion: 'Puntos pendientes', elemento: c.openQuestions, version: '—', emisor: '—', fecha: d(c.nextFollowUp), estado: 'Abierto', observaciones: `Seguimiento: ${userName(ctx.db, c.followUpOwnerId)}` });
      return { columns: [col('seccion', 'Sección'), col('elemento', 'Elemento'), col('version', 'Versión'), col('emisor', 'Emisor / destino'), col('fecha', 'Fecha'), col('estado', 'Estado'), col('observaciones', 'Observaciones')], rows, unresolved: open + (c.openQuestions ? 1 : 0), scope: `${c.code} · ${worksiteName(ctx.db, c.worksiteId)}. Excluidos: documentos personales, restringidos, de salud y no aceptados.`, redacted: true };
    },
  },
  {
    id: 'readiness',
    title: 'Disponibilidad por asignación',
    description: 'Estado derivado de los requisitos configurados, con sus motivos. No es una aprobación profesional de seguridad.',
    perms: ['readiness.view_all', 'team.view'],
    build: (ctx, f) => {
      const ids = new Set(employeeFilter(ctx, f));
      const rows = visibleReadiness(ctx)
        .filter((r) => ids.has(r.employeeId) && (!f.worksiteId || r.worksiteId === f.worksiteId) && (!f.status || r.state === f.status))
        .map((r) => ({ empleado: employeeName(ctx.db, r.employeeId), centro: worksiteName(ctx.db, r.worksiteId), estado: READINESS[r.state].label, requisitos: `${r.counts.satisfied}/${r.counts.counted}`, criticos_pendientes: r.counts.criticalOpen, motivos: r.reasons.filter((x) => x.state === r.state).map((x) => (x.msg.params ? Object.entries(x.msg.params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), x.msg.text) : x.msg.text)).join(' | ') || '—', confirmada: r.confirmation ? d(r.confirmation.decidedAt) : '—' }) as Row);
      return { columns: [col('empleado', 'Empleado'), col('centro', 'Centro'), col('estado', 'Estado'), col('requisitos', 'Requisitos aceptados'), col('criticos_pendientes', 'Críticos pendientes'), col('motivos', 'Motivos'), col('confirmada', 'Confirmada')], rows, unresolved: rows.filter((r) => r.estado !== READINESS.ready.label).length, scope: scopeText(ctx, f), redacted: true };
    },
  },
  {
    id: 'audit',
    title: 'Historial de auditoría',
    description: 'Eventos de auditoría de la empresa (los eventos restringidos solo para usuarios autorizados).',
    perms: ['audit.view'],
    build: (ctx, f) => {
      const health = canSeeHealth(ctx);
      const rows = ctx.db.audit
        .filter((e) => e.companyId === ctx.company.id && (health || !e.restricted) && (!f.employeeId || e.employeeId === f.employeeId))
        .sort((a, b) => b.seq - a.seq)
        .map((e) => ({ secuencia: e.seq, fecha: e.at, actor: e.actor.name, accion: AUDIT_ACTION_LABEL[e.action] ?? e.action, registro: e.entityLabel, resumen: e.summary, motivo: e.reason ?? '—', version: e.version ?? '—', destinatario: e.recipient ?? '—', huella: e.hash }) as Row);
      return { columns: [col('secuencia', 'Nº'), col('fecha', 'Fecha (UTC)'), col('actor', 'Actor'), col('accion', 'Acción'), col('registro', 'Registro'), col('resumen', 'Resumen'), col('motivo', 'Motivo'), col('version', 'Versión'), col('destinatario', 'Destinatario'), col('huella', 'Huella demo')], rows, unresolved: 0, scope: health ? scopeText(ctx, f) : `${scopeText(ctx, f)}. Eventos restringidos excluidos.`, redacted: !health };
    },
  },
  {
    id: 'health',
    title: 'Conclusiones de aptitud (restringido)',
    description: 'Solo para personal autorizado: oferta, respuesta y conclusión mínima. Sin datos clínicos.',
    perms: ['health.manage', 'health.view_conclusions'],
    restricted: true,
    build: (ctx, f) => {
      const ids = new Set(employeeFilter(ctx, f));
      const rows = healthRows(ctx)
        .filter((r) => ids.has(r.employee.id))
        .map((r) => ({ empleado: `${r.employee.firstName} ${r.employee.lastName}`, oferta: r.offer ? `${r.offer.basis === 'voluntary' ? 'Voluntaria' : 'Obligatoria (excepción art. 22.1)'} · ${d(r.offer.offeredAt)}` : 'Sin oferta', respuesta: r.offer ? (r.offer.response === 'pending' ? 'Pendiente' : r.offer.response === 'accepted' ? 'Aceptada' : 'No aceptada (no es incumplimiento)') : '—', conclusion: r.conclusion ? FITNESS_LABEL[r.conclusion.conclusion].label : '—', medidas: r.conclusion?.measures || '—', fecha: d(r.conclusion?.conclusionDate), proxima_revision: r.conclusion?.nextReviewDate ? d(r.conclusion.nextReviewDate) : 'No indicada' }) as Row);
      return { columns: [col('empleado', 'Empleado'), col('oferta', 'Oferta'), col('respuesta', 'Respuesta'), col('conclusion', 'Conclusión'), col('medidas', 'Medidas preventivas'), col('fecha', 'Fecha'), col('proxima_revision', 'Próxima revisión')], rows, unresolved: rows.filter((r) => r.conclusion === '—').length, scope: `${scopeText(ctx, f)}. Destinatarios autorizados únicamente; sin informes clínicos.`, redacted: false };
    },
  },
];

export function availableReports(ctx: Ctx): ReportDef[] {
  return REPORTS.filter((r) => r.perms.some((p) => can(ctx, p)));
}

export function runReport(ctx: Ctx, id: string, f: Filters): ReportResult {
  const def = REPORTS.find((r) => r.id === id);
  if (!def || !def.perms.some((p) => can(ctx, p))) throw new PermissionError();
  if (f.employeeId && !canSeeEmployee(ctx, f.employeeId)) return { columns: [], rows: [], unresolved: 0, scope: '', redacted: false };
  return def.build(ctx, f);
}

export const EXPORT_NOTICE = 'Informe operativo generado con datos de demostración. Muestra evidencias revisadas según la configuración aprobada; no certifica el cumplimiento legal ni la seguridad de ningún puesto o centro.';

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadFile(name: string, content: string, type: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportRequest {
  reportId: string;
  format: 'csv' | 'json';
  filters: Filters;
  recipient: string;
  download?: boolean;
}

export async function createExport(req: ExportRequest): Promise<{ job: ExportJob; content: string }> {
  await latency(250);
  const ctx = getCtx();
  const def = REPORTS.find((r) => r.id === req.reportId);
  const ownOnly = !can(ctx, 'reports.export') && can(ctx, 'own.view') && req.reportId === 'employee_evidence';
  if (!def || !def.perms.some((p) => can(ctx, p))) throw new PermissionError();
  if (!can(ctx, 'reports.export') && !ownOnly && !(can(ctx, 'representative.view') && ['worksite_summary', 'actions', 'assessments'].includes(def.id)) && !(def.restricted && can(ctx, 'health.manage'))) throw new PermissionError();
  const filters = ownOnly ? { ...req.filters, employeeId: ctx.employee!.id } : req.filters;
  const result = runReport(ctx, def.id, filters);
  const at = nowInstant();
  const meta = {
    empresa: ctx.company.legalName,
    nif: ctx.company.nif,
    informe: def.title,
    ambito: result.scope,
    destinatario: req.recipient.trim() || 'Uso interno',
    generado: at,
    generado_por: ctx.user.name,
    registros: result.rows.length,
    pendientes_declarados: result.unresolved,
    datos_de_salud: def.restricted ? 'Conclusiones mínimas; destinatario autorizado' : 'Excluidos o enmascarados',
    redaccion: result.redacted ? 'Se han omitido o enmascarado datos que el destinatario no puede recibir.' : 'Sin redacción adicional',
    aviso: EXPORT_NOTICE,
  };
  let content: string;
  if (req.format === 'csv') {
    const head = Object.entries(meta).map(([k, v]) => `# ${k};${csvCell(String(v))}`);
    content = '﻿' + [...head, result.columns.map((c) => csvCell(c.label)).join(';'), ...result.rows.map((r) => result.columns.map((c) => csvCell(r[c.key] ?? '')).join(';'))].join('\n');
  } else {
    content = JSON.stringify({ metadatos: meta, columnas: result.columns, filas: result.rows.map((r) => Object.fromEntries(result.columns.map((c) => [c.key, r[c.key] ?? '']))) }, null, 2);
  }
  const stamp = at.slice(0, 16).replace(/[-:T]/g, '');
  const fileName = `datospilot_${def.id}_${stamp}.${req.format}`;
  const job: ExportJob = { id: newId('exp'), companyId: ctx.company.id, kind: def.id, format: req.format, fileName, scope: result.scope, recipient: meta.destinatario, recordCount: result.rows.length, openItems: result.unresolved, redacted: result.redacted, generatedBy: ctx.user.id, generatedAt: at, fingerprint: demoHash(content) };
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('exports', job);
    tx.audit({ action: 'export.create', entityType: 'export', entityId: job.id, entityLabel: fileName, summary: `${def.title}: ${job.recordCount} registros, ${job.openItems} pendientes declarados${job.redacted ? ', con redacción' : ''}. Huella demo ${job.fingerprint}.`, recipient: meta.destinatario, restricted: !!def.restricted });
  });
  if (req.download !== false) downloadFile(fileName, content, req.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
  return { job, content };
}

export function visibleExports(ctx: Ctx) {
  const health = canSeeHealth(ctx);
  return ctx.db.exports.filter((e) => e.companyId === ctx.company.id && (can(ctx, 'audit.view') || e.generatedBy === ctx.user.id) && (health || REPORTS.find((r) => r.id === e.kind)?.restricted !== true));
}

