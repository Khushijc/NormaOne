import { computeTotals } from './invoiceCalc';
import { isValidISODate, diffDays } from './dates';
import { normaliseNif, validateEuVat, validateNif } from './nif';
import type { Customer, ExpenseRecord, FinanceConfig, Invoice, PartyBase, Supplier, TaxCode, Attachment, ISODate } from './types';

export interface ValidationResult {
  /** Field-level blocking errors (key = field path). */
  errors: Record<string, string>;
  /** Non-blocking warnings shown before approval. */
  warnings: string[];
}

export const ok = (r: ValidationResult) => Object.keys(r.errors).length === 0;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Spanish postal codes: 5 digits, province prefix 01–52. */
const ES_POSTCODE_RE = /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/;

// ─────────────────────────────── Parties ───────────────────────────────

export function validateParty(p: Partial<PartyBase>, existing: PartyBase[], selfId?: string): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  if (!p.legalName?.trim()) errors.legalName = 'La razón social o nombre completo es obligatorio.';
  const businessLike = p.kind === 'company' || p.kind === 'self_employed' || p.kind === 'public_admin';

  if (p.idType === 'NIF') {
    const r = validateNif(p.idNumber ?? '');
    if (!r.valid) errors.idNumber = r.message;
    else if (r.uncertain) warnings.push(r.message);
    if (!r.valid) {
      /* already reported */
    } else if (p.kind === 'company' && r.kind !== 'ENTITY') warnings.push('El tipo es "empresa" pero el NIF corresponde a una persona física. Compruebe la clasificación.');
    else if ((p.kind === 'self_employed' || p.kind === 'individual') && r.kind === 'ENTITY') warnings.push('El NIF corresponde a una entidad pero el tipo es persona física. Compruebe la clasificación.');
  } else if (p.idType === 'NIF_IVA') {
    const r = validateEuVat(p.idNumber ?? '');
    if (!r.valid) errors.idNumber = r.message;
    warnings.push('Operaciones con clientes o proveedores de otros Estados miembros: tratamiento fiscal fuera del alcance inicial; requiere revisión del asesor.');
  } else if (p.idType === 'PASSPORT' || p.idType === 'FOREIGN_ID' || p.idType === 'OTHER') {
    if (!p.idNumber?.trim()) errors.idNumber = 'Indique el número del documento identificativo.';
  } else if (p.idType === 'NONE') {
    if (businessLike) errors.idNumber = 'Un empresario, profesional o administración debe tener NIF.';
  }

  if (p.email && !EMAIL_RE.test(p.email)) errors.email = 'Correo electrónico no válido.';
  const a = p.address;
  if (businessLike) {
    if (!a?.street?.trim()) errors['address.street'] = 'El domicilio es obligatorio para facturar a empresarios o profesionales.';
    if (!a?.city?.trim()) errors['address.city'] = 'La población es obligatoria.';
  }
  if (a?.country === 'ES' && a.postalCode && !ES_POSTCODE_RE.test(a.postalCode)) errors['address.postalCode'] = 'Código postal español no válido (5 dígitos, provincia 01–52).';
  if (a?.country === 'ES' && a.postalCode && /^(35|38|51|52)/.test(a.postalCode)) {
    warnings.push('Código postal de Canarias, Ceuta o Melilla: el tratamiento de IVA puede no aplicar (IGIC/IPSI). Requiere revisión del asesor.');
  }
  if (p.kind === 'public_admin') warnings.push('Facturas a Administraciones Públicas (FACe, Ley 25/2013) quedan fuera del alcance inicial.');

  // Duplicate warnings (never silent merges).
  const nif = normaliseNif(p.idNumber ?? '');
  if (nif) {
    const dup = existing.find((e) => e.id !== selfId && normaliseNif(e.idNumber) === nif);
    if (dup) warnings.push(`Posible duplicado: ya existe "${dup.legalName}" con el mismo identificador${dup.archived ? ' (archivado)' : ''}.`);
  }
  const name = p.legalName?.trim().toLowerCase();
  if (name) {
    const dupName = existing.find((e) => e.id !== selfId && e.legalName.trim().toLowerCase() === name && normaliseNif(e.idNumber) !== nif);
    if (dupName) warnings.push(`Ya existe un registro con el mismo nombre ("${dupName.legalName}") y distinto identificador.`);
  }
  return { errors, warnings };
}

export function validateCustomer(c: Partial<Customer>, existing: Customer[], selfId?: string): ValidationResult {
  const r = validateParty(c, existing, selfId);
  if (c.paymentTermsDays === undefined || c.paymentTermsDays === null || Number.isNaN(c.paymentTermsDays) || c.paymentTermsDays < 0) {
    r.errors.paymentTermsDays = 'Indique un plazo de pago en días (0 o más).';
  } else if (c.paymentTermsDays > 60 && c.kind !== 'individual') {
    r.errors.paymentTermsDays = 'Entre empresas el plazo pactado no puede superar 60 días naturales (Ley 3/2004, art. 4.3).';
  } else if (c.paymentTermsDays > 30 && c.kind !== 'individual') {
    r.warnings.push('Plazo superior al legal por defecto de 30 días: debe estar pactado expresamente (Ley 3/2004, art. 4).');
  }
  if (c.deliveryChannel === 'email' && !c.email) r.errors.email = 'El canal de envío es correo electrónico: indique un correo.';
  return r;
}

export function validateSupplier(s: Partial<Supplier>, existing: Supplier[], selfId?: string): ValidationResult {
  const r = validateParty(s, existing, selfId);
  if (s.ibanMasked && !/^[A-Z]{2}\d{2}[\s*•\dA-Z]{4,}$/.test(s.ibanMasked.replace(/\s/g, ''))) {
    r.errors.ibanMasked = 'IBAN no válido (p. ej. ES91 •••• •••• 1332).';
  }
  return r;
}

// ─────────────────────────────── Sales invoices ───────────────────────────────

export function validateInvoiceForApproval(
  inv: Invoice,
  customer: Customer | undefined,
  fc: FinanceConfig,
  taxCodes: TaxCode[],
  todayISO: ISODate,
  originalOperationDate: ISODate | null = null,
): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  if (!customer) errors.customerId = 'Seleccione un cliente.';
  else {
    if (customer.archived) errors.customerId = 'El cliente está archivado. Reactívelo o seleccione otro.';
    const businessLike = customer.kind !== 'individual';
    if (businessLike && customer.idType !== 'NIF' && customer.idType !== 'NIF_IVA') errors.customerId = 'El cliente no tiene NIF: obligatorio para destinatarios empresarios o profesionales.';
    const nifCheck = customer.idType === 'NIF' ? validateNif(customer.idNumber) : null;
    if (nifCheck?.uncertain) warnings.push(`NIF del cliente: ${nifCheck.message}`);
    if (nifCheck && !nifCheck.valid) errors.customerId = 'El NIF del cliente no supera la validación. Corrija la ficha del cliente.';
    if (businessLike && !customer.address.street) errors.customerId = 'Falta el domicilio del cliente.';
    if (customer.idType === 'NIF_IVA' || customer.address.country !== 'ES') errors.customerId = 'Cliente no establecido en el territorio de aplicación del IVA: escenario internacional no soportado en esta versión.';
    if (customer.kind === 'individual' && customer.idType === 'NONE') warnings.push('Cliente particular sin NIF. Confirme con el asesor si debe constar el NIF del destinatario para esta operación.');
    if (customer.kind === 'public_admin') errors.customerId = 'Facturación a Administraciones Públicas (FACe) no soportada en esta versión.';
  }

  if (!inv.seriesId) errors.seriesId = 'Seleccione una serie de facturación.';
  if (inv.lines.length === 0) errors.lines = 'Añada al menos una línea.';

  const rectifying = inv.kind === 'rectifying';
  inv.lines.forEach((l, i) => {
    const p = `lines.${i}`;
    if (!l.description.trim()) errors[`${p}.description`] = 'Describa el servicio o producto.';
    if (!Number.isFinite(l.quantity) || l.quantity === 0) errors[`${p}.quantity`] = 'Cantidad distinta de cero.';
    else if (!rectifying && l.quantity < 0) errors[`${p}.quantity`] = 'Cantidad negativa solo en rectificativas por diferencias.';
    if (!Number.isFinite(l.unitPriceCents)) errors[`${p}.unitPriceCents`] = 'Precio no válido.';
    else if (!rectifying && l.unitPriceCents < 0) errors[`${p}.unitPriceCents`] = 'Precio negativo no permitido en factura ordinaria.';
    if (l.discountPct < 0 || l.discountPct > 100) errors[`${p}.discountPct`] = 'Descuento entre 0 y 100 %.';
    const tc = taxCodes.find((t) => t.code === l.taxCode);
    if (!tc) errors[`${p}.taxCode`] = 'Seleccione un tratamiento fiscal.';
    else if (tc.supportStatus === 'unsupported') errors[`${p}.taxCode`] = `"${tc.label}" no está soportado en esta versión.`;
    else if (!fc.approvedTaxCodes.includes(tc.code)) errors[`${p}.taxCode`] = `"${tc.label}" no está aprobado para esta empresa. Solicite la revisión al asesor (${fc.responsibleAdviser}).`;
  });

  const recomputed = computeTotals(inv.lines, taxCodes, inv.totals.withholdingPct);
  if (recomputed.totalCents !== inv.totals.totalCents || recomputed.taxCents !== inv.totals.taxCents) {
    errors.totals = 'Los totales no coinciden con las líneas. Vuelva a calcular antes de aprobar.';
  }
  if (!rectifying && recomputed.totalCents <= 0) errors.totals = 'El total de una factura ordinaria debe ser positivo.';

  if (inv.operationDate && !isValidISODate(inv.operationDate)) errors.operationDate = 'Fecha de operación no válida.';
  if (inv.operationDate && inv.operationDate > todayISO) warnings.push('La fecha de operación es futura: confirme que procede facturar ahora.');
  if (!inv.dueDate || !isValidISODate(inv.dueDate)) errors.dueDate = 'Indique la fecha de vencimiento.';
  else if (inv.dueDate < todayISO) errors.dueDate = 'El vencimiento no puede ser anterior a hoy (fecha prevista de emisión).';
  else if (inv.kind === 'ordinary' && customer && customer.kind !== 'individual' && diffDays(inv.operationDate && inv.operationDate < todayISO ? inv.operationDate : todayISO, inv.dueDate) > 60) {
    errors.dueDate = 'Entre empresas el vencimiento no puede superar 60 días naturales desde la prestación del servicio (Ley 3/2004, art. 4.3).';
  }
  // RD 1619/2012 art. 11.2: to a business recipient, issue before day 16 of the month after the tax accrual.
  if (inv.kind === 'ordinary' && inv.operationDate && customer && customer.kind !== 'individual') {
    const [y, m] = inv.operationDate.split('-').map(Number);
    const limit = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-15`;
    if (todayISO > limit) warnings.push(`Plazo de expedición superado: para esta operación la factura debía expedirse antes del 16 del mes siguiente (${limit.split('-').reverse().join('/')}). RD 1619/2012, art. 11.`);
  }

  if (rectifying) {
    if (!inv.rectification?.originalInvoiceId) errors.rectification = 'La rectificativa debe vincularse a la factura original.';
    if (!inv.rectification?.reasonText.trim()) errors.rectification = 'Indique el motivo de la rectificación.';
    // Art. 15.3 RD 1619/2012: within four years from the accrual of the tax (operation date used as a proxy).
    const original = originalOperationDate;
    if (original && diffDays(original, todayISO) > 4 * 365 + 1) errors.rectification = 'Han pasado más de cuatro años desde el devengo de la operación original: no puede rectificarse (RD 1619/2012, art. 15.3). Consulte al asesor.';
  }
  const needsMention = recomputed.breakdown.filter((b) => b.mention);
  if (needsMention.length) warnings.push(`La factura incluirá las menciones obligatorias: ${needsMention.map((b) => `"${b.mention}"`).join('; ')}.`);
  if (fc.irpfWithholding.applies && inv.totals.withholdingPct === 0 && customer && customer.kind !== 'individual') {
    warnings.push('La configuración indica que aplica retención IRPF a clientes empresarios/profesionales y esta factura no la incluye.');
  }
  return { errors, warnings };
}

// ─────────────────────────────── Expenses ───────────────────────────────

export interface DuplicateHit {
  id: string;
  reason: string;
}

export function findExpenseDuplicates(e: Partial<ExpenseRecord>, all: ExpenseRecord[], attachments: Attachment[], newFingerprints: string[] = []): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  const docNo = (e.documentNumber ?? '').trim().toUpperCase();
  const myFingerprints = new Set([...newFingerprints, ...attachments.filter((a) => e.attachmentIds?.includes(a.id)).map((a) => a.fingerprint)]);
  for (const o of all) {
    if (o.id === e.id || o.companyId !== e.companyId) continue;
    const sameParty = (e.supplierId && o.supplierId === e.supplierId) || (!e.supplierId && e.merchantName && o.merchantName.trim().toLowerCase() === e.merchantName.trim().toLowerCase());
    if (sameParty && docNo && o.documentNumber.trim().toUpperCase() === docNo) {
      hits.push({ id: o.id, reason: `Mismo proveedor y número de documento (${o.documentNumber}).` });
      continue;
    }
    if (sameParty && o.documentDate === e.documentDate && o.totalCents === e.totalCents) {
      hits.push({ id: o.id, reason: 'Mismo proveedor, fecha e importe total.' });
      continue;
    }
    const otherFps = attachments.filter((a) => o.attachmentIds.includes(a.id)).map((a) => a.fingerprint);
    if (otherFps.some((f) => myFingerprints.has(f))) hits.push({ id: o.id, reason: 'El mismo archivo justificante ya está adjunto a otro gasto.' });
  }
  return hits;
}

export function validateExpense(e: Partial<ExpenseRecord>, todayISO: ISODate, forSubmission: boolean): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];
  if (!e.supplierId && !e.merchantName?.trim()) errors.supplierId = 'Seleccione un proveedor o indique el establecimiento.';
  if (e.kind === 'supplier_invoice' && !e.supplierId) errors.supplierId = 'Las facturas recibidas deben vincularse a un proveedor registrado.';
  if (!e.documentDate || !isValidISODate(e.documentDate)) errors.documentDate = 'Fecha del documento no válida.';
  else if (e.documentDate > todayISO) errors.documentDate = 'La fecha del documento no puede ser futura.';
  if (!e.accountingPeriod || !/^\d{4}-(0[1-9]|1[0-2])$/.test(e.accountingPeriod)) errors.accountingPeriod = 'Periodo contable no válido (AAAA-MM).';
  if (!e.category) errors.category = 'Seleccione una categoría.';
  if (!e.description?.trim()) errors.description = 'Describa el gasto.';
  if (e.documentType !== 'receipt_no_vat' && !e.documentNumber?.trim()) errors.documentNumber = 'Indique el número de factura o ticket.';
  if (e.baseCents === undefined || e.baseCents === null || e.baseCents < 0) errors.baseCents = 'Base imponible no válida.';
  if ((e.vatCents ?? 0) < 0) errors.vatCents = 'Cuota de IVA no válida.';
  const expectedVat = Math.round(((e.baseCents ?? 0) * (e.vatRatePct ?? 0)) / 100);
  if (e.baseCents !== undefined && Math.abs((e.vatCents ?? 0) - expectedVat) > 2) {
    warnings.push(`La cuota de IVA (${((e.vatCents ?? 0) / 100).toFixed(2)}) no coincide con base × tipo (${(expectedVat / 100).toFixed(2)}). Verifique el documento.`);
  }
  const total = (e.baseCents ?? 0) + (e.vatCents ?? 0) - (e.withholdingCents ?? 0);
  if (e.totalCents !== undefined && e.totalCents !== total) errors.totalCents = 'El total debe ser base + IVA − retención.';

  if (e.documentType === 'simplified_invoice' && (e.vatCents ?? 0) > 0 && !e.recipientNifShown) {
    warnings.push('Factura simplificada sin NIF de la empresa destinataria ni cuota desglosada: la cuota de IVA podría no ser deducible. La gestoría decide el tratamiento.');
  }
  if (e.documentType === 'receipt_no_vat' && (e.vatCents ?? 0) > 0) errors.vatCents = 'Un recibo sin IVA no puede llevar cuota de IVA.';
  if (forSubmission && (!e.attachmentIds || e.attachmentIds.length === 0)) errors.attachments = 'Adjunte el justificante antes de enviarlo a revisión.';
  if (e.kind === 'supplier_invoice' && e.dueDate && e.documentDate && diffDays(e.documentDate, e.dueDate) > 60) {
    warnings.push('Vencimiento superior a 60 días: revise el plazo legal de pago a proveedores (Ley 3/2004).');
  }
  return { errors, warnings };
}
