/** In-app notifications (PLT-08) and the derived task inbox (PLT-04). */
import { addDays, diffDays, nowISO } from '../domain/dates';
import type { AppNotification, Database, ISODate, RoleId } from '../domain/types';
import { patchUiOnly, transact } from '../store/db';
import { collectionStatus, isCollectible, isOverdue, openDispute, outstandingCents } from '../store/selectors';
import { getCtx, type Ctx } from './context';
import { autoChecks } from './handoverService';
import { canReviewExpense } from './expenseService';

export function isRecipient(ctx: Ctx, n: AppNotification): boolean {
  if (n.companyId !== ctx.company.id) return false;
  if (n.recipientUserIds.includes(ctx.user.id)) return true;
  const roles = ctx.membership?.roles ?? [];
  return n.recipientRoles.some((r) => roles.includes(r));
}

export function visibleNotifications(ctx: Ctx): AppNotification[] {
  return ctx.db.notifications.filter((n) => isRecipient(ctx, n)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function markRead(id: string, read = true) {
  const ctx = getCtx();
  const n = ctx.db.notifications.find((x) => x.id === id);
  if (!n || !isRecipient(ctx, n)) return;
  const readBy = { ...n.readBy };
  if (read) readBy[ctx.user.id] = nowISO();
  else delete readBy[ctx.user.id];
  patchUiOnly('notifications', id, { readBy });
}

export function markAllRead() {
  const ctx = getCtx();
  for (const n of visibleNotifications(ctx)) if (!n.readBy[ctx.user.id]) markRead(n.id);
}

/** Creates notifications for time-based conditions (overdue, due soon, handover, authorisation expiry). Idempotent. */
export function refreshDerivedNotifications() {
  const ctx = getCtx();
  if (!ctx.membership) return;
  const db = ctx.db;
  const items: Omit<AppNotification, 'id' | 'createdAt' | 'readBy' | 'companyId'>[] = [];
  for (const inv of db.invoices.filter((i) => i.companyId === ctx.company.id && isCollectible(i))) {
    const st = collectionStatus(db, inv);
    if (st === 'paid' || !inv.dueDate) continue;
    if (isOverdue(db, inv, ctx.today)) {
      items.push({ type: 'invoice_overdue', title: 'Factura vencida pendiente de cobro', body: `Factura ${inv.number} vencida.`, recipientRoles: ['admin', 'owner'], recipientUserIds: [], link: `/facturas/${inv.id}?tab=cobros`, dedupeKey: `overdue:${inv.id}` });
    } else if (diffDays(ctx.today, inv.dueDate) <= 5) {
      items.push({ type: 'invoice_due_soon', title: 'Vencimiento próximo', body: `La factura ${inv.number} vence el ${inv.dueDate.split('-').reverse().join('/')}.`, recipientRoles: ['admin'], recipientUserIds: [], link: `/facturas/${inv.id}`, dedupeKey: `duesoon:${inv.id}` });
    }
  }
  for (const h of db.handovers.filter((x) => x.companyId === ctx.company.id && x.status === 'in_preparation')) {
    const target = addDays(h.periodTo, 10);
    if (ctx.today >= addDays(h.periodTo, 3)) {
      items.push({ type: 'handover_incomplete', title: 'Traspaso contable incompleto', body: `${h.label}: objetivo interno de entrega ${target.split('-').reverse().join('/')}.`, recipientRoles: ['admin', 'owner', 'gestoria'], recipientUserIds: [], link: '/gestoria', dedupeKey: `handover:${h.id}` });
    }
  }
  const p = ctx.provider;
  if (p?.authorisationExpires && diffDays(ctx.today, p.authorisationExpires) <= 30) {
    items.push({ type: 'fiscal_uncertain', title: 'La autorización del proveedor fiscal caduca pronto', body: 'Renueve el mandato antes de la fecha de caducidad.', recipientRoles: ['owner', 'issuer'], recipientUserIds: [], link: '/integracion-fiscal', dedupeKey: `providerauth:${p.authorisationExpires}` });
  }
  const fresh = items.filter((n) => !db.notifications.some((x) => x.companyId === ctx.company.id && x.dedupeKey === n.dedupeKey));
  if (fresh.length === 0) return;
  transact({ ...ctx.actor, id: 'system', name: 'Sistema' }, (tx) => fresh.forEach((n) => tx.notify(n)));
}

// ─────────────────────────────── Tasks (PLT-04) ───────────────────────────────

export interface Task {
  id: string;
  title: string;
  detail: string;
  category: 'fiscal' | 'aprobacion' | 'gastos' | 'cobros' | 'traspaso' | 'normativo' | 'integracion';
  ownerRole: RoleId;
  backupRole: RoleId;
  trigger: string;
  dueDate: ISODate | null;
  /** Legal deadlines and internal targets are always distinguished (PLT-04). */
  deadlineKind: 'legal' | 'internal' | 'none';
  severity: 'high' | 'medium' | 'low';
  link: string;
  evidenceRule: string;
}

export const ROLE_SHORT: Record<RoleId, string> = {
  owner: 'Propiedad',
  admin: 'Administración',
  issuer: 'Emisor/a',
  employee: 'Empleado/a',
  supervisor: 'Supervisión',
  gestoria: 'Gestoría',
};

export function deriveTasks(db: Database, ctx: Ctx): Task[] {
  const t: Task[] = [];
  const cid = ctx.company.id;
  const today = ctx.today;
  for (const inv of db.invoices.filter((i) => i.companyId === cid)) {
    const label = inv.number ?? 'Borrador';
    if (inv.pendingOperationId) {
      t.push({ id: `t-unc-${inv.id}`, title: `Conciliar emisión incierta (${label})`, detail: 'El proveedor no respondió. No reintente: concilie por clave de operación.', category: 'fiscal', ownerRole: 'issuer', backupRole: 'owner', trigger: 'Tiempo de espera del proveedor', dueDate: addDays(today, 0), deadlineKind: 'internal', severity: 'high', link: '/integracion-fiscal', evidenceRule: 'Resultado de conciliación registrado' });
    } else if (inv.fiscalStatus === 'rejected' || inv.fiscalStatus === 'needs_review') {
      t.push({ id: `t-fis-${inv.id}`, title: `${inv.fiscalStatus === 'rejected' ? 'Registro rechazado' : 'Registro con errores'}: ${label}`, detail: 'Subsane y reenvíe el registro. La factura sigue visible; la aceptación fiscal no se marca como correcta.', category: 'fiscal', ownerRole: 'issuer', backupRole: 'owner', trigger: 'Respuesta del proveedor (simulada)', dueDate: addDays((inv.updatedAt ?? '').slice(0, 10) || today, 2), deadlineKind: 'internal', severity: 'high', link: `/facturas/${inv.id}?tab=fiscal`, evidenceRule: 'Nuevo envío con resultado aceptado' });
    }
    if (inv.documentStatus === 'draft' && inv.review.state === 'requested') {
      t.push({ id: `t-apr-${inv.id}`, title: `Aprobar borrador para ${db.customers.find((c) => c.id === inv.customerId)?.legalName ?? ''}`, detail: inv.review.comment || 'Aprobación solicitada.', category: 'aprobacion', ownerRole: 'issuer', backupRole: 'owner', trigger: 'Solicitud de aprobación', dueDate: addDays((inv.review.at ?? today).slice(0, 10), 1), deadlineKind: 'internal', severity: 'medium', link: `/facturas/${inv.id}`, evidenceRule: 'Aprobación o devolución con comentario' });
    }
    if (inv.documentStatus === 'approved' && !inv.pendingOperationId) {
      const op = inv.operationDate ?? today;
      const [y, m] = op.split('-').map(Number);
      const legal = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-15`;
      const customer = db.customers.find((c) => c.id === inv.customerId);
      t.push({ id: `t-iss-${inv.id}`, title: `Emitir factura aprobada (${customer?.legalName ?? ''})`, detail: customer?.kind !== 'individual' ? 'Destinatario empresario: expedir antes del día 16 del mes siguiente a la operación (RD 1619/2012, art. 11.2).' : 'Expedir en el momento de la operación (RD 1619/2012, art. 11.1).', category: 'aprobacion', ownerRole: 'issuer', backupRole: 'owner', trigger: 'Factura aprobada', dueDate: customer?.kind !== 'individual' ? legal : op, deadlineKind: 'legal', severity: legal < today ? 'high' : 'medium', link: `/facturas/${inv.id}`, evidenceRule: 'Factura emitida con número y resultado fiscal' });
    }
    if (isCollectible(inv) && isOverdue(db, inv, today) && !openDispute(db, inv.id)) {
      t.push({ id: `t-col-${inv.id}`, title: `Gestionar cobro vencido ${label}`, detail: `Pendiente: ${(outstandingCents(db, inv) / 100).toFixed(2).replace('.', ',')} €.`, category: 'cobros', ownerRole: 'admin', backupRole: 'owner', trigger: 'Vencimiento superado', dueDate: inv.dueDate, deadlineKind: 'internal', severity: diffDays(inv.dueDate!, today) > 30 ? 'high' : 'medium', link: `/facturas/${inv.id}?tab=cobros`, evidenceRule: 'Cobro registrado, recordatorio enviado o disputa documentada' });
    }
  }
  for (const e of db.expenses.filter((x) => x.companyId === cid && x.reviewStatus === 'submitted')) {
    if (!canReviewExpense(ctx, e).ok && !ctx.perms.has('expenses.view_all')) continue;
    t.push({ id: `t-exp-${e.id}`, title: `Revisar gasto: ${e.description}`, detail: `${(e.totalCents / 100).toFixed(2).replace('.', ',')} € · ${e.kind === 'employee_expense' ? 'gasto de empleado' : 'factura recibida'}`, category: 'gastos', ownerRole: e.kind === 'employee_expense' ? 'supervisor' : 'owner', backupRole: 'owner', trigger: 'Gasto enviado a revisión', dueDate: addDays((e.submittedAt ?? today).slice(0, 10), 3), deadlineKind: 'internal', severity: 'low', link: `/gastos/${e.id}`, evidenceRule: 'Aprobación o rechazo con motivo; justificante adjunto' });
  }
  for (const h of db.handovers.filter((x) => x.companyId === cid && x.status !== 'acknowledged')) {
    const checks = autoChecks(db, h);
    const pending = Object.values(checks).filter((v) => !v).length;
    t.push({ id: `t-hnd-${h.id}`, title: h.status === 'delivered' ? `Confirmar recepción del traspaso ${h.label}` : `Completar traspaso contable ${h.label}`, detail: h.status === 'delivered' ? 'Pendiente de acuse de la gestoría.' : `${pending} comprobación(es) automática(s) pendiente(s).`, category: 'traspaso', ownerRole: h.status === 'delivered' ? 'gestoria' : 'admin', backupRole: 'owner', trigger: 'Cierre de periodo', dueDate: addDays(h.periodTo, 10), deadlineKind: 'internal', severity: 'medium', link: '/gestoria', evidenceRule: 'Checklist completo y exportación generada' });
  }
  const fc = ctx.finance;
  if (fc.sif.state === 'applicable' && fc.sif.deadline) {
    t.push({ id: 't-sif', title: 'Sistema de facturación adaptado (RRSIF)', detail: `Obligación ${fc.taxpayerType === 'IS' ? 'para contribuyentes del IS' : 'para el resto de obligados'}: sistemas adaptados antes de esta fecha. Hay un anuncio de aplazamiento a octubre de 2028 SIN instrumento publicado: no se aplica.`, category: 'normativo', ownerRole: 'owner', backupRole: 'issuer', trigger: 'Registro de reglas', dueDate: fc.sif.deadline, deadlineKind: 'legal', severity: diffDays(today, fc.sif.deadline) < 120 ? 'high' : 'medium', link: '/configuracion?tab=fiscal', evidenceRule: 'Proveedor aprobado con declaración responsable vigente' });
  }
  if (fc.b2b.state === 'applicable' && fc.b2b.deadline) {
    t.push({ id: 't-b2b', title: 'Factura electrónica B2B (condicional, FIN-09)', detail: 'Capacidad no validada en el producto. Debe estar disponible antes de la fecha o el alcance permanecerá bloqueado.', category: 'normativo', ownerRole: 'owner', backupRole: 'gestoria', trigger: 'RD 238/2026 + Orden HAC/1028/2026', dueDate: fc.b2b.deadline, deadlineKind: 'legal', severity: 'low', link: '/configuracion?tab=fiscal', evidenceRule: 'Conector de intercambio validado' });
  }
  if (ctx.provider?.authorisationExpires && diffDays(today, ctx.provider.authorisationExpires) <= 30) {
    t.push({ id: 't-prov', title: 'Renovar autorización del proveedor fiscal', detail: `Caduca el ${ctx.provider.authorisationExpires.split('-').reverse().join('/')}.`, category: 'integracion', ownerRole: 'owner', backupRole: 'issuer', trigger: 'Caducidad de mandato', dueDate: ctx.provider.authorisationExpires, deadlineKind: 'internal', severity: 'high', link: '/integracion-fiscal', evidenceRule: 'Nuevo mandato registrado' });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return t.sort((a, b) => order[a.severity] - order[b.severity] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}

/** Tasks relevant to the current user's roles (owner and backup). */
export function myTasks(ctx: Ctx): Task[] {
  const roles = ctx.membership?.roles ?? [];
  return deriveTasks(ctx.db, ctx).filter((t) => roles.includes(t.ownerRole) || roles.includes(t.backupRole) || roles.includes('owner'));
}
