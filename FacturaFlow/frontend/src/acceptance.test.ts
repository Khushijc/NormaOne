/**
 * Automated acceptance tests mapped to the BRD (AC-FIN-01..04, AC-PLT-01..04) and to
 * the researched rules. They exercise the service layer (= the future API contract).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { currentRule, ruleHistory } from './domain/applicability';
import { verifyAuditChain } from './domain/audit';
import { computeTotals } from './domain/invoiceCalc';
import { validateNif } from './domain/nif';
import { BusinessRuleError, PermissionError } from './domain/permissions';
import type { InvoiceLine } from './domain/types';
import { getDb, initDatabase, initSession, resetDemoData, setSession } from './store/db';
import { collectionStatus, outstandingCents, paidCents } from './store/selectors';
import { getCtx, NotFoundError } from './services/context';
import { revokeMembership, setNextScenario, updateFinanceConfig } from './services/adminService';
import { checkPayment, openDisputeOn, planReminders, recordPayment, reversePayment } from './services/collectionService';
import { duplicatesFor, reviewExpense } from './services/expenseService';
import { approveInvoice, createRectification, issueInvoice, reconcileOperation, saveDraft, issueOperationKey } from './services/invoiceService';
import { resetProviderState, setProviderDelay, submitRecord } from './services/mock/fiscalProvider';
import { deriveTasks } from './services/notificationService';
import { createExport } from './services/exportService';

const TODAY = '2026-10-09';
const as = (userId: string, companyId = 'cmp_levante') => setSession({ userId, companyId, demoDate: TODAY });

beforeEach(() => {
  resetDemoData();
  resetProviderState();
  setProviderDelay(0, 0);
  initDatabase();
  initSession();
  as('usr_laura');
});

describe('Domain calculations', () => {
  it('computes per-rate tax breakdown, discounts and IRPF withholding', () => {
    const lines: InvoiceLine[] = [
      { id: 'a', description: 'Servicio', quantity: 2, unitPriceCents: 10000, discountPct: 10, taxCode: 'IVA21' },
      { id: 'b', description: 'Servicio reducido', quantity: 1, unitPriceCents: 5000, discountPct: 0, taxCode: 'IVA10' },
    ];
    const t = computeTotals(lines, getDb().taxCodes, 15);
    expect(t.baseCents).toBe(18000 + 5000);
    expect(t.breakdown.find((b) => b.taxCode === 'IVA21')?.taxCents).toBe(3780);
    expect(t.breakdown.find((b) => b.taxCode === 'IVA10')?.taxCents).toBe(500);
    expect(t.totalCents).toBe(23000 + 4280);
    expect(t.withholdingCents).toBe(3450);
    expect(t.payableCents).toBe(27280 - 3450);
  });

  it('validates Spanish identifiers (DNI, NIE, entity) and flags the unofficial entity algorithm as a warning only', () => {
    expect(validateNif('12345678Z').valid).toBe(true);
    expect(validateNif('12345678A').valid).toBe(false);
    expect(validateNif('X1234567L').valid).toBe(true);
    expect(validateNif('B12345674').valid).toBe(true);
    const r = validateNif('B12345670');
    expect(r.valid).toBe(true);
    expect(r.uncertain).toBe(true);
  });
});

describe('AC-FIN-01 — duplicate-safe issue under timeout', () => {
  it('a timeout leaves an uncertain operation, blocks re-issue, and reconciliation yields exactly one invoice', async () => {
    as('usr_marta');
    await setNextScenario('timeout_processed');
    const first = await issueInvoice('inv_lev_027');
    expect(first.kind).toBe('uncertain');
    await expect(issueInvoice('inv_lev_027')).rejects.toBeInstanceOf(BusinessRuleError);

    const op = getDb().fiscalOperations.find((o) => o.invoiceId === 'inv_lev_027' && o.state === 'uncertain')!;
    const rec = await reconcileOperation(op.id);
    expect(rec.kind).toBe('issued');
    const inv = getDb().invoices.find((i) => i.id === 'inv_lev_027')!;
    expect(inv.documentStatus).toBe('issued');
    expect(inv.number).toBe(op.reservedNumber);
    expect(getDb().invoices.filter((i) => i.number === inv.number)).toHaveLength(1);

    // Replaying the same operation key at the provider returns the same identifier.
    const replay = await submitRecord({ operationKey: issueOperationKey('inv_lev_027'), number: inv.number!, issuerNif: 'X', payload: {}, scenario: 'accept' });
    expect(replay.duplicate).toBe(true);
    expect(replay.providerInvoiceId).toBe(inv.providerInvoiceId);
  });

  it('reconciles the seeded uncertain operation to the number it reserved', async () => {
    as('usr_marta');
    const op = getDb().fiscalOperations.find((o) => o.state === 'uncertain')!;
    const r = await reconcileOperation(op.id);
    expect(r.kind).toBe('issued');
    expect(getDb().invoices.find((i) => i.id === op.invoiceId)!.number).toBe('F2026-0026');
  });

  it('a not-processed timeout allows a retry with the same key and number (no gap, no duplicate)', async () => {
    as('usr_marta');
    await setNextScenario('timeout_not_processed');
    await issueInvoice('inv_lev_027');
    const op = getDb().fiscalOperations.find((o) => o.invoiceId === 'inv_lev_027' && o.state === 'uncertain')!;
    expect((await reconcileOperation(op.id)).kind).toBe('not_processed');
    const retry = await issueInvoice('inv_lev_027');
    expect(retry.kind).toBe('issued');
    const ops = getDb().fiscalOperations.filter((o) => o.invoiceId === 'inv_lev_027');
    expect(new Set(ops.map((o) => o.operationKey)).size).toBe(1);
    expect(new Set(ops.map((o) => o.reservedNumber)).size).toBe(1);
  });
});

describe('AC-FIN-02 — rejected fiscal record', () => {
  it('keeps the invoice visible, does not mark fiscal acceptance and creates an assigned exception', async () => {
    as('usr_marta');
    await setNextScenario('reject');
    const r = await issueInvoice('inv_lev_027');
    expect(r.kind).toBe('rejected');
    const inv = getDb().invoices.find((i) => i.id === 'inv_lev_027')!;
    expect(inv.fiscalStatus).toBe('rejected');
    expect(inv.exchangeStatus).toBe('not_sent');
    expect(collectionStatus(getDb(), inv)).toBe('unpaid');
    const tasks = deriveTasks(getDb(), getCtx());
    expect(tasks.some((t) => t.id === `t-fis-${inv.id}` && t.ownerRole === 'issuer' && t.backupRole === 'owner')).toBe(true);
  });
});

describe('AC-FIN-03 — rectification preserves the original', () => {
  it('creates a linked rectifying invoice; the original content is unchanged', async () => {
    as('usr_javier');
    const original = structuredClone(getDb().invoices.find((i) => i.id === 'inv_lev_003')!);
    const corrected = original.lines.map((l, i) => (i === 0 ? { ...l, unitPriceCents: l.unitPriceCents - 5000 } : l));
    const rect = await createRectification(original.id, { reasonCode: 'R1', method: 'differences', reasonText: 'Precio pactado inferior', correctedLines: corrected });
    expect(rect.totals.baseCents).toBe(-5000);
    as('usr_marta');
    await approveInvoice(rect.id);
    expect((await issueInvoice(rect.id)).kind).toBe('issued');
    const after = getDb().invoices.find((i) => i.id === original.id)!;
    expect(after.lines).toEqual(original.lines);
    expect(after.totals).toEqual(original.totals);
    expect(after.documentStatus).toBe('rectified');
    expect(after.rectifiedByIds).toContain(rect.id);
    const issuedRect = getDb().invoices.find((i) => i.id === rect.id)!;
    expect(issuedRect.number?.startsWith('R2026-')).toBe(true);
    expect(issuedRect.rectification?.reasonText).toBe('Precio pactado inferior');
  });

  it('refuses in-place edits of issued invoices', async () => {
    as('usr_javier');
    const inv = getDb().invoices.find((i) => i.id === 'inv_lev_003')!;
    await expect(saveDraft(inv.id, { customerId: inv.customerId, seriesId: inv.seriesId, operationDate: null, dueDate: inv.dueDate, lines: inv.lines, notes: 'x', paymentTerms: '', withholdingPct: 0 })).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('AC-FIN-04 — activation gates', () => {
  it('blocks issue for an unsupported (foral) configuration and names the responsible adviser', async () => {
    as('usr_iker', 'cmp_ibaigane');
    await expect(issueInvoice('inv_ibg_001')).rejects.toSatisfy((e: BusinessRuleError) => e.details.some((d) => d.includes('Responsable')) && e.details.some((d) => d.includes('Bizkaia')));
  });

  it('blocks issue when the B2B obligation is in force without a validated connector', async () => {
    as('usr_laura');
    await updateFinanceConfig({ priorYearTurnoverBand: 'over_8m' });
    const fc = getDb().financeConfigs.find((f) => f.companyId === 'cmp_levante')!;
    expect(fc.b2b.deadline).toBe('2027-10-06');
    expect(fc.configApprovedAt).toBeNull(); // fact change withdraws adviser approval
  });
});

describe('Shared platform acceptance', () => {
  it('AC-PLT-01 — another company’s record is not retrievable by guessing its id', async () => {
    as('usr_laura');
    await expect(approveInvoice('inv_ibg_001')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('AC-PLT-02 — revoking the adviser blocks subsequent actions immediately', async () => {
    as('usr_laura');
    await revokeMembership('mbr_carlos_lev', 'Fin del mandato');
    as('usr_carlos');
    expect(getCtx().perms.size).toBe(0);
    expect(() => createExport({ kind: 'x', baseName: 'x', format: 'csv', rows: [], columns: [], periodFrom: null, periodTo: null, filters: '', download: false })).toThrow(PermissionError);
  });

  it('AC-PLT-03 — rule changes keep predecessors; announcements and future rules never apply', () => {
    const rules = getDb().rules;
    expect(ruleHistory(rules, 'sif.deadline.is').length).toBe(4);
    expect(currentRule(rules, 'sif.deadline.is', TODAY)?.value).toBe('2027-01-01');
    expect(currentRule(rules, 'sif.deadline.is', '2029-01-01')?.value).toBe('2027-01-01');
    expect(currentRule(rules, 'sif.deadline.is', '2025-05-01')?.value).toBe('2026-01-01');
    expect(currentRule(rules, 'b2b.deadline.rest', '2026-10-05')).toBeNull();
  });

  it('PLT-06 — the audit trail is an intact hash chain and tampering is detected', () => {
    const events = getDb().audit.filter((e) => e.companyId === 'cmp_levante');
    expect(verifyAuditChain(events).ok).toBe(true);
    const tampered = events.map((e, i) => (i === 5 ? { ...e, summary: 'editado' } : e));
    expect(verifyAuditChain(tampered).ok).toBe(false);
  });

  it('separation of duties — administration cannot approve invoices', async () => {
    as('usr_javier');
    await expect(approveInvoice('inv_lev_028')).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('FIN-07 — payments, cash limit, disputes and reminders', () => {
  it('records partial and full payments and derives the collection status', async () => {
    as('usr_javier');
    const inv = getDb().invoices.find((i) => i.id === 'inv_lev_024')!;
    const due = outstandingCents(getDb(), inv);
    await recordPayment(inv.id, { date: TODAY, amountCents: 10000, method: 'transfer', reference: 'TRF-1', note: '' });
    expect(collectionStatus(getDb(), inv)).toBe('partial');
    await recordPayment(inv.id, { date: TODAY, amountCents: due - 10000, method: 'transfer', reference: 'TRF-2', note: '' });
    expect(collectionStatus(getDb(), inv)).toBe('paid');
    expect(checkPayment(inv.id, { date: TODAY, amountCents: 1, method: 'transfer', reference: 'x', note: '' }).length).toBeGreaterThan(0);
    as('usr_marta');
    const p = getDb().payments.find((x) => x.reference === 'TRF-2')!;
    await reversePayment(p.id, 'Devolución bancaria');
    expect(paidCents(getDb(), inv.id)).toBe(10000);
    expect(getDb().payments.some((x) => x.id === p.id)).toBe(true);
  });

  it('blocks cumulative cash payments of €1,000 or more (Ley 7/2012)', () => {
    as('usr_javier');
    const errors = checkPayment('inv_lev_014', { date: TODAY, amountCents: 100_000, method: 'cash', reference: '', note: '' });
    expect(errors.some((e) => e.includes('efectivo'))).toBe(true);
  });

  it('suppresses reminders while a dispute hold applies and never reminds paid invoices', async () => {
    as('usr_javier');
    await openDisputeOn('inv_lev_019', 'Cliente discute importe', true);
    const plan = planReminders();
    expect(plan.filter((p) => p.invoiceId === 'inv_lev_019').every((p) => p.action === 'suppress')).toBe(true);
    expect(plan.some((p) => p.invoiceId === 'inv_lev_001')).toBe(false);
  });
});

describe('FIN-06 — expenses', () => {
  it('detects the seeded duplicate supplier invoice', () => {
    as('usr_laura');
    const dup = getDb().expenses.find((e) => e.description.includes('reenvío'))!;
    expect(duplicatesFor(dup).length).toBeGreaterThan(0);
  });

  it('enforces the supervisor approval limit', async () => {
    as('usr_elena');
    const big = getDb().expenses.find((e) => e.documentNumber === 'FIT-T-77812')!;
    await expect(reviewExpense(big.id, 'approve', '')).rejects.toBeInstanceOf(BusinessRuleError);
    const small = getDb().expenses.find((e) => e.documentNumber === 'A-55120')!;
    await reviewExpense(small.id, 'approve', 'OK');
    expect(getDb().expenses.find((e) => e.id === small.id)!.reviewStatus).toBe('approved');
  });
});
