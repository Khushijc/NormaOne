/** Company settings, applicability decisions, series, users and the provider simulation (PLT-01, PLT-03, PLT-07, FIN-01). */
import { deriveB2bDeadline, deriveSifDeadline } from '../domain/applicability';
import { isValidISODate, nowISO } from '../domain/dates';
import { newId } from '../domain/ids';
import { BusinessRuleError } from '../domain/permissions';
import type {
  ApplicabilityState,
  AuditChange,
  CollectionPolicy,
  Company,
  FinanceConfig,
  ID,
  InvoiceSeries,
  Membership,
  ProviderConfig,
  ProviderScenario,
  RoleId,
  User,
} from '../domain/types';
import { transact } from '../store/db';
import { getCtx, latency, ownRecord, requirePerm } from './context';
import { healthCheck } from './mock/fiscalProvider';

function changesOf(before: object, after: object, labels: Record<string, string>): AuditChange[] {
  const b = before as Record<string, unknown>, a = after as Record<string, unknown>;
  return Object.keys(a)
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ field: labels[k] ?? k, before: typeof b[k] === 'object' ? JSON.stringify(b[k]) : String(b[k] ?? ''), after: typeof a[k] === 'object' ? JSON.stringify(a[k]) : String(a[k] ?? '') }));
}

export async function updateCompany(patch: Partial<Company>, markReviewedBy: string | null) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.company');
  if (patch.legalName !== undefined && !patch.legalName.trim()) throw new BusinessRuleError('La razón social es obligatoria.');
  transact(ctx.actor, (tx) => {
    const before = tx.get('companies', ctx.company.id)!;
    const reviewed = markReviewedBy?.trim() ? { profileReviewedBy: markReviewedBy.trim(), profileReviewedAt: ctx.today } : {};
    tx.update('companies', ctx.company.id, { ...patch, ...reviewed });
    tx.audit({ action: 'config.update', entityType: 'company', entityId: ctx.company.id, entityLabel: before.legalName, summary: markReviewedBy ? `Perfil actualizado y revisado por ${markReviewedBy}.` : 'Perfil de empresa actualizado.', reason: null, changes: changesOf(before, patch, { legalName: 'Razón social', employeeCount: 'Plantilla', activity: 'Actividad', cnae: 'CNAE', taxAdministration: 'Administración tributaria' }) });
  });
}

const FC_LABELS: Record<string, string> = {
  taxpayerType: 'Tipo de contribuyente',
  territory: 'Territorio fiscal',
  siiParticipant: 'Acogida al SII',
  vatRegime: 'Régimen de IVA',
  priorYearTurnoverBand: 'Volumen de operaciones año anterior',
  sifMode: 'Modalidad SIF',
  approvedTaxCodes: 'Tipos impositivos aprobados',
  requireDifferentApprover: 'Aprobador distinto del autor',
  defaultPaymentTermsDays: 'Plazo de pago por defecto',
  irpfWithholding: 'Retención IRPF',
  responsibleAdviser: 'Asesor responsable',
};

/**
 * Updates the finance configuration. Changing a fact that drives applicability
 * re-derives the SIF/B2B deadlines from the rule register and withdraws the adviser's
 * configuration approval, so live issue is blocked until it is reviewed again.
 */
export async function updateFinanceConfig(patch: Partial<FinanceConfig>) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.company');
  if (patch.sifMode && patch.sifMode !== ctx.finance.sifMode && ctx.finance.sifMode === 'verifactu') {
    throw new BusinessRuleError('La modalidad VERI*FACTU debe mantenerse al menos hasta el final del año natural (RD 1007/2023, art. 16.5). Cambio no permitido desde el prototipo.');
  }
  const facts: (keyof FinanceConfig)[] = ['taxpayerType', 'territory', 'siiParticipant', 'vatRegime', 'priorYearTurnoverBand'];
  const factChanged = facts.some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(ctx.finance[k]));
  transact(ctx.actor, (tx) => {
    const before = tx.db.financeConfigs.find((f) => f.companyId === ctx.company.id)!;
    let next: FinanceConfig = { ...before, ...patch };
    if (factChanged) {
      const sif = deriveSifDeadline(next, tx.db.rules, ctx.today);
      const b2b = deriveB2bDeadline(next, tx.db.rules, ctx.today);
      next = {
        ...next,
        sif: { ...next.sif, deadline: sif.deadline, ruleIds: sif.rule ? [sif.rule.id] : [], state: 'pending_review', reviewer: null, reviewedAt: null },
        b2b: { ...next.b2b, deadline: b2b.deadline, ruleIds: b2b.rule ? [b2b.rule.id] : [], state: 'pending_review', reviewer: null, reviewedAt: null },
        configApprovedAt: null,
        configApprovedBy: null,
      };
    }
    tx.updateWhere('financeConfigs', (f) => f.companyId === ctx.company.id, next);
    tx.audit({
      action: 'config.update',
      entityType: 'financeConfig',
      entityId: ctx.company.id,
      entityLabel: 'Configuración fiscal',
      summary: factChanged ? 'Datos de aplicabilidad modificados: plazos recalculados desde el registro de reglas; decisiones y aprobación del asesor pasan a "pendiente de revisión".' : 'Configuración fiscal modificada.',
      reason: null,
      changes: changesOf(before, patch, FC_LABELS),
    });
  });
}

export async function recordApplicabilityDecision(which: 'sif' | 'b2b', state: ApplicabilityState, reviewer: string, basis: string, nextReview: string | null) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.company');
  if (!reviewer.trim()) throw new BusinessRuleError('Indique el profesional que revisa la decisión.');
  if (!basis.trim()) throw new BusinessRuleError('Indique la base de la decisión.');
  if (nextReview && !isValidISODate(nextReview)) throw new BusinessRuleError('Fecha de próxima revisión no válida.');
  transact(ctx.actor, (tx) => {
    const fc = tx.db.financeConfigs.find((f) => f.companyId === ctx.company.id)!;
    const derived = which === 'sif' ? deriveSifDeadline(fc, tx.db.rules, ctx.today) : deriveB2bDeadline(fc, tx.db.rules, ctx.today);
    const decision = { state, deadline: state === 'applicable' ? derived.deadline : null, ruleIds: derived.rule ? [derived.rule.id] : [], basis, decidedBy: ctx.user.id, reviewer, reviewedAt: ctx.today, nextReview };
    tx.updateWhere('financeConfigs', (f) => f.companyId === ctx.company.id, { [which]: decision } as Partial<FinanceConfig>);
    tx.audit({ action: 'config.update', entityType: 'financeConfig', entityId: ctx.company.id, entityLabel: which === 'sif' ? 'Aplicabilidad SIF' : 'Aplicabilidad B2B', summary: `Decisión registrada: ${state} · plazo ${decision.deadline ?? '—'} · regla ${decision.ruleIds.join(', ') || '—'}.`, reason: `${basis} (revisor: ${reviewer})`, changes: [{ field: 'Estado', before: fc[which].state, after: state }] });
  });
}

export async function approveFinanceConfig(reviewer: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.company');
  if (!reviewer.trim()) throw new BusinessRuleError('Indique el asesor que aprueba la configuración.');
  transact(ctx.actor, (tx) => {
    tx.updateWhere('financeConfigs', (f) => f.companyId === ctx.company.id, { configApprovedBy: reviewer, configApprovedAt: ctx.today });
    tx.audit({ action: 'config.update', entityType: 'financeConfig', entityId: ctx.company.id, entityLabel: 'Configuración fiscal', summary: `Configuración aprobada por ${reviewer}.`, reason: null, changes: [] });
  });
}

export async function setTaxCodeApproval(code: string, approved: boolean, reviewer: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.company');
  const tc = ctx.db.taxCodes.find((t) => t.code === code);
  if (!tc) throw new BusinessRuleError('Código desconocido.');
  if (approved && tc.supportStatus === 'unsupported') throw new BusinessRuleError(`"${tc.label}" no está soportado en esta versión del producto: no puede aprobarse.`);
  if (approved && tc.supportStatus === 'requires_review' && !reviewer.trim()) throw new BusinessRuleError('Este tratamiento requiere identificar al profesional que lo ha revisado.');
  transact(ctx.actor, (tx) => {
    const fc = tx.db.financeConfigs.find((f) => f.companyId === ctx.company.id)!;
    const list = approved ? Array.from(new Set([...fc.approvedTaxCodes, code])) : fc.approvedTaxCodes.filter((c) => c !== code);
    tx.updateWhere('financeConfigs', (f) => f.companyId === ctx.company.id, { approvedTaxCodes: list });
    tx.audit({ action: 'config.update', entityType: 'financeConfig', entityId: ctx.company.id, entityLabel: 'Tipos impositivos', summary: `${tc.label} ${approved ? 'aprobado' : 'retirado'} para la empresa.`, reason: reviewer || null, changes: [{ field: 'Tipos aprobados', before: fc.approvedTaxCodes.join(', '), after: list.join(', ') }] });
  });
}

export async function saveSeries(id: ID | null, input: Pick<InvoiceSeries, 'code' | 'prefix' | 'kind' | 'padding' | 'description' | 'active'> & { nextNumber?: number }) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.company');
  if (!/^[A-Z0-9]{1,10}$/.test(input.code)) throw new BusinessRuleError('Código de serie: 1–10 caracteres en mayúsculas o dígitos.');
  if (!input.prefix.trim()) throw new BusinessRuleError('Indique el prefijo.');
  if (input.padding < 1 || input.padding > 8) throw new BusinessRuleError('Relleno entre 1 y 8 dígitos.');
  const others = ctx.db.series.filter((s) => s.companyId === ctx.company.id && s.id !== id);
  if (others.some((s) => s.code === input.code || s.prefix === input.prefix)) throw new BusinessRuleError('Ya existe una serie con ese código o prefijo.');
  transact(ctx.actor, (tx) => {
    if (id) {
      const s = ownRecord(ctx, tx.get('series', id));
      const used = tx.db.invoices.some((i) => i.seriesId === id && i.number);
      if (used && (input.prefix !== s.prefix || input.kind !== s.kind || input.padding !== s.padding)) {
        throw new BusinessRuleError('La serie ya tiene facturas emitidas: no se puede cambiar su prefijo, tipo ni formato (numeración correlativa). Cree una serie nueva.');
      }
      if (input.nextNumber !== undefined && input.nextNumber < s.nextNumber) throw new BusinessRuleError('El contador no puede retroceder: generaría números duplicados.');
      tx.update('series', id, { ...input, nextNumber: input.nextNumber ?? s.nextNumber });
      tx.audit({ action: 'series.update', entityType: 'series', entityId: id, entityLabel: input.code, summary: 'Serie modificada.', reason: null, changes: changesOf(s, input, { active: 'Activa', description: 'Descripción', nextNumber: 'Siguiente número' }) });
    } else {
      const s: InvoiceSeries = { id: newId('ser'), companyId: ctx.company.id, ...input, nextNumber: Math.max(1, input.nextNumber ?? 1) };
      tx.insert('series', s);
      tx.audit({ action: 'series.update', entityType: 'series', entityId: s.id, entityLabel: s.code, summary: `Serie ${s.kind === 'rectifying' ? 'de rectificativas ' : ''}creada (${s.prefix}).`, reason: null, changes: [] });
    }
  });
}

export async function updateCollectionPolicy(patch: Partial<CollectionPolicy>) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.company');
  if (patch.reminderOffsetsDays && (patch.reminderOffsetsDays.some((d) => !Number.isInteger(d) || d < 0 || d > 365) || patch.reminderOffsetsDays.length === 0)) {
    throw new BusinessRuleError('Indique días enteros entre 0 y 365, separados por comas.');
  }
  transact(ctx.actor, (tx) => {
    const before = tx.db.collectionPolicies.find((p) => p.companyId === ctx.company.id)!;
    tx.updateWhere('collectionPolicies', (p) => p.companyId === ctx.company.id, { ...patch, reminderOffsetsDays: patch.reminderOffsetsDays ? [...patch.reminderOffsetsDays].sort((a, b) => a - b) : before.reminderOffsetsDays });
    tx.audit({ action: 'config.update', entityType: 'collectionPolicy', entityId: ctx.company.id, entityLabel: 'Política de cobro', summary: 'Política de recordatorios modificada.', reason: null, changes: changesOf(before, patch, { reminderOffsetsDays: 'Recordatorios (días)', suppressWhenDisputed: 'Suprimir en disputa' }) });
  });
}

// ─────────────────────────────── Provider simulation ───────────────────────────────

export const SCENARIO_LABEL: Record<ProviderScenario, string> = {
  accept: 'Aceptación (Correcto)',
  accept_with_errors: 'Aceptado con errores',
  reject: 'Rechazo (Incorrecto)',
  timeout_processed: 'Tiempo de espera — el proveedor SÍ lo procesó',
  timeout_not_processed: 'Tiempo de espera — el proveedor NO lo procesó',
  outage: 'Proveedor no disponible',
};

export async function setNextScenario(s: ProviderScenario) {
  const ctx = getCtx();
  requirePerm(ctx, 'fiscal.simulate', 'fiscal.reconcile');
  transact(ctx.actor, (tx) => {
    tx.updateWhere('providerConfigs', (p) => p.companyId === ctx.company.id, { nextScenario: s });
    tx.audit({ action: 'fiscal.config', entityType: 'providerConfig', entityId: ctx.company.id, entityLabel: 'Simulación', summary: `Próximo envío simulará: ${SCENARIO_LABEL[s]}.`, reason: null, changes: [] });
  });
}

export async function setProviderStatus(status: ProviderConfig['status']) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.company');
  if (!ctx.provider || ctx.provider.status === 'not_configured') throw new BusinessRuleError('No hay proveedor configurado para esta empresa.');
  transact(ctx.actor, (tx) => {
    tx.updateWhere('providerConfigs', (p) => p.companyId === ctx.company.id, { status });
    tx.audit({ action: 'fiscal.config', entityType: 'providerConfig', entityId: ctx.company.id, entityLabel: ctx.provider!.providerName, summary: `Estado del proveedor (simulado) → ${status}.`, reason: null, changes: [{ field: 'Estado', before: ctx.provider!.status, after: status }] });
  });
}

export async function runHealthCheck() {
  const ctx = getCtx();
  requirePerm(ctx, 'fiscal.view');
  const r = await healthCheck();
  transact(ctx.actor, (tx) => tx.updateWhere('providerConfigs', (p) => p.companyId === ctx.company.id, { lastHealthCheckAt: r.at }));
  return r;
}

// ─────────────────────────────── Users & memberships ───────────────────────────────

export interface MembershipInput {
  roles: RoleId[];
  validUntil: string | null;
  approvalLimitCents: number | null;
  teamUserIds: ID[];
  mandateRef: string | null;
}

function validateMembership(input: MembershipInput) {
  if (input.roles.length === 0) throw new BusinessRuleError('Asigne al menos un rol.');
  if (input.validUntil && !isValidISODate(input.validUntil)) throw new BusinessRuleError('Fecha de caducidad no válida.');
  if (input.roles.includes('gestoria') && !input.mandateRef?.trim()) throw new BusinessRuleError('El acceso de la gestoría requiere referencia a un mandato explícito del cliente.');
  if (input.roles.includes('gestoria') && !input.validUntil) throw new BusinessRuleError('El acceso de asesores externos debe tener fecha de caducidad.');
  if (input.roles.includes('gestoria') && input.roles.length > 1) throw new BusinessRuleError('El rol de gestoría no se combina con roles internos.');
  if (input.roles.includes('supervisor') && (input.approvalLimitCents === null || input.approvalLimitCents <= 0)) throw new BusinessRuleError('Indique el límite de aprobación del supervisor.');
}

export async function inviteUser(user: Pick<User, 'name' | 'email' | 'title' | 'organisation'>, input: MembershipInput) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.users');
  validateMembership(input);
  if (!user.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(user.email)) throw new BusinessRuleError('Nombre y correo válidos son obligatorios.');
  transact(ctx.actor, (tx) => {
    let u = tx.db.users.find((x) => x.email.toLowerCase() === user.email.toLowerCase());
    if (!u) {
      u = { id: newId('usr'), ...user, email: user.email.toLowerCase() };
      tx.insert('users', u);
    }
    if (tx.db.memberships.some((m) => m.userId === u!.id && m.companyId === ctx.company.id && m.status === 'active')) throw new BusinessRuleError('La persona ya tiene acceso activo a esta empresa.');
    const m: Membership = { id: newId('mbr'), userId: u.id, companyId: ctx.company.id, ...input, status: 'active', grantedBy: ctx.user.id, grantedAt: nowISO(), revokedAt: null, revokedBy: null };
    tx.insert('memberships', m);
    tx.audit({ action: 'membership.grant', entityType: 'membership', entityId: m.id, entityLabel: u.name, summary: `Acceso concedido: ${input.roles.join(', ')}${input.validUntil ? ` hasta ${input.validUntil}` : ''}. Invitación simulada (no se envía correo).`, reason: input.mandateRef, changes: [] });
  });
}

export async function updateMembership(id: ID, input: MembershipInput) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.users');
  validateMembership(input);
  transact(ctx.actor, (tx) => {
    const m = ownRecord(ctx, tx.get('memberships', id));
    if (m.status !== 'active') throw new BusinessRuleError('No se puede modificar un acceso revocado; conceda uno nuevo.');
    if (m.userId === ctx.user.id && m.roles.includes('owner') && !input.roles.includes('owner')) {
      const owners = tx.db.memberships.filter((x) => x.companyId === ctx.company.id && x.status === 'active' && x.roles.includes('owner'));
      if (owners.length <= 1) throw new BusinessRuleError('Debe quedar al menos una persona con rol de propiedad.');
    }
    tx.update('memberships', id, input);
    const name = tx.db.users.find((u) => u.id === m.userId)?.name ?? m.userId;
    tx.audit({ action: 'membership.update', entityType: 'membership', entityId: id, entityLabel: name, summary: 'Roles o límites modificados.', reason: null, changes: changesOf(m, input, { roles: 'Roles', validUntil: 'Válido hasta', approvalLimitCents: 'Límite de aprobación (cént.)', teamUserIds: 'Equipo', mandateRef: 'Mandato' }) });
    tx.notify({ type: 'access_changed', title: 'Sus permisos han cambiado', body: 'Revise sus accesos en la empresa.', recipientRoles: [], recipientUserIds: [m.userId], link: '/', dedupeKey: `access:${id}:${Date.now()}` });
  });
}

/** Revocation is immediate: the next read or queued action by that user is denied (AC-PLT-02). */
export async function revokeMembership(id: ID, reason: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.users');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo de la revocación.');
  transact(ctx.actor, (tx) => {
    const m = ownRecord(ctx, tx.get('memberships', id));
    if (m.userId === ctx.user.id) throw new BusinessRuleError('No puede revocar su propio acceso.');
    tx.update('memberships', id, { status: 'revoked', revokedAt: nowISO(), revokedBy: ctx.user.id });
    const name = tx.db.users.find((u) => u.id === m.userId)?.name ?? m.userId;
    tx.audit({ action: 'membership.revoke', entityType: 'membership', entityId: id, entityLabel: name, summary: 'Acceso revocado con efecto inmediato. La identidad histórica se conserva en la auditoría.', reason, changes: [{ field: 'Estado', before: 'Activo', after: 'Revocado' }] });
  });
}
