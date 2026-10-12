/**
 * Runtime-generated text (labels, gate and validation messages, tasks, seeded audit trail and
 * notifications, rule register) must have an English rendering. Strings stay Spanish in the
 * records; this checks that t() can display each of them in English.
 * Run alone with: npx vitest run src/i18n
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasEnglish, setLangForTests } from './index';
import { financeIssueGate, TERRITORY_LABEL } from '../domain/applicability';
import { AUDIT_ACTION_LABEL } from '../domain/audit';
import { PERIOD_LABELS } from '../domain/dates';
import { ROLES } from '../domain/permissions';
import * as STATUS from '../domain/status';
import { validateCustomer, validateExpense, validateInvoiceForApproval, validateSupplier } from '../domain/validation';
import { getDb, initDatabase, initSession, resetDemoData, setSession } from '../store/db';
import { AGEING_LABEL } from '../store/selectors';
import { getCtx } from '../services/context';
import { SCENARIO_LABEL } from '../services/adminService';
import { PAYMENT_METHOD_LABEL } from '../services/collectionService';
import { DOCUMENT_TYPE_LABEL, EXPENSE_CATEGORIES } from '../services/expenseService';
import { deriveTasks, ROLE_SHORT } from '../services/notificationService';

const COMPANIES: [string, string][] = [
  ['usr_laura', 'cmp_levante'],
  ['usr_carmen', 'cmp_ruiz'],
  ['usr_iker', 'cmp_ibaigane'],
];

function collect(): Map<string, string> {
  const out = new Map<string, string>();
  const add = (where: string, s: string | null | undefined) => {
    if (s && s.trim() && /\p{L}{2,}/u.test(s)) out.set(s, where);
  };
  for (const [name, table] of Object.entries(STATUS)) {
    if (typeof table !== 'object') continue;
    for (const meta of Object.values(table as Record<string, { label: string; help: string }>)) {
      add(name, meta.label);
      add(name, meta.help);
    }
  }
  for (const r of Object.values(ROLES)) [r.label, r.description, r.restriction].forEach((s) => add('ROLES', s));
  for (const [n, tbl] of Object.entries({ AUDIT_ACTION_LABEL, PERIOD_LABELS, TERRITORY_LABEL, SCENARIO_LABEL, PAYMENT_METHOD_LABEL, DOCUMENT_TYPE_LABEL, EXPENSE_CATEGORIES, ROLE_SHORT, AGEING_LABEL })) {
    for (const s of Object.values(tbl as Record<string, string>)) add(n, s);
  }

  const db = getDb();
  for (const e of db.audit) {
    add('audit.summary', e.summary);
    for (const c of e.changes) add('audit.change.field', c.field);
  }
  for (const n of db.notifications) {
    add('notification.title', n.title);
    add('notification.body', n.body);
  }
  for (const r of db.rules) [r.title, r.jurisdiction, r.applicability, r.note].forEach((s) => add('rule', s));
  for (const tc of db.taxCodes) [tc.label, tc.note, tc.mention].forEach((s) => add('taxCode', s));
  for (const h of db.handovers) {
    add('handover.label', h.label);
    for (const c of h.checklist) add('handover.check', c.label);
  }

  for (const [user, company] of COMPANIES) {
    setSession({ userId: user, companyId: company, demoDate: '2026-10-09' });
    const ctx = getCtx();
    for (const g of financeIssueGate(ctx.company, ctx.finance, ctx.provider, ctx.today)) add('gate', g.message);
    for (const task of deriveTasks(ctx.db, ctx)) [task.title, task.detail, task.trigger, task.evidenceRule].forEach((s) => add('task', s));
    for (const inv of ctx.db.invoices.filter((i) => i.companyId === company)) {
      const cust = ctx.db.customers.find((c) => c.id === inv.customerId);
      const v = validateInvoiceForApproval(inv, cust, ctx.finance, ctx.db.taxCodes, ctx.today);
      [...Object.values(v.errors), ...v.warnings].forEach((s) => add('invoice validation', s));
    }
    for (const c of ctx.db.customers.filter((c) => c.companyId === company)) {
      const v = validateCustomer(c, ctx.db.customers.filter((x) => x.companyId === company), c.id);
      [...Object.values(v.errors), ...v.warnings].forEach((s) => add('customer validation', s));
    }
    for (const s of ctx.db.suppliers.filter((x) => x.companyId === company)) {
      const v = validateSupplier(s, ctx.db.suppliers.filter((x) => x.companyId === company), s.id);
      [...Object.values(v.errors), ...v.warnings].forEach((m) => add('supplier validation', m));
    }
    for (const e of ctx.db.expenses.filter((x) => x.companyId === company)) {
      const v = validateExpense(e, ctx.today, true);
      [...Object.values(v.errors), ...v.warnings].forEach((m) => add('expense validation', m));
    }
  }
  // Empty records surface the "required field" messages.
  [...Object.values(validateExpense({}, '2026-10-09', true).errors), ...Object.values(validateCustomer({}, []).errors), ...Object.values(validateSupplier({}, []).errors)].forEach((s) => add('empty-form validation', s));
  return out;
}

describe('runtime text has English renderings', () => {
  beforeAll(() => {
    resetDemoData();
    initDatabase();
    initSession();
    setLangForTests('en');
  });
  afterAll(() => setLangForTests('es'));

  it('labels, messages, tasks, seeded audit/notifications and reference data', () => {
    const missing = [...collect()].filter(([s]) => !hasEnglish(s)).map(([s, where]) => `[${where}] ${s}`);
    expect(missing, `No English rendering for:\n${missing.join('\n')}`).toEqual([]);
  });
});
