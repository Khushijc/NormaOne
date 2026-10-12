import { roundCents } from './money';
import type { Cents, InvoiceLine, InvoiceTotals, TaxBreakdownEntry, TaxCode } from './types';

export interface LineAmounts {
  grossCents: Cents;
  discountCents: Cents;
  baseCents: Cents;
}

/** Line amounts: gross = qty × unit price; discount applied per line; rounded to cents. */
export function lineAmounts(line: Pick<InvoiceLine, 'quantity' | 'unitPriceCents' | 'discountPct'>): LineAmounts {
  const grossCents = roundCents(line.quantity * line.unitPriceCents);
  const discountCents = roundCents((grossCents * (line.discountPct || 0)) / 100);
  return { grossCents, discountCents, baseCents: grossCents - discountCents };
}

/**
 * Invoice totals. Tax is calculated per tax treatment on the aggregated base of all
 * lines sharing it (one "base imponible / tipo / cuota" row per rate, as shown on the
 * invoice — RD 1619/2012 art. 6.1.g–i), then rounded to cents.
 *
 * Withholding (IRPF) is applied on the total taxable base and reduces the payable
 * amount, not the invoice total.
 */
export function computeTotals(lines: InvoiceLine[], taxCodes: TaxCode[], withholdingPct = 0): InvoiceTotals {
  let grossCents = 0;
  let discountCents = 0;
  const groups = new Map<string, Cents>();
  for (const l of lines) {
    const a = lineAmounts(l);
    grossCents += a.grossCents;
    discountCents += a.discountCents;
    groups.set(l.taxCode, (groups.get(l.taxCode) ?? 0) + a.baseCents);
  }
  const breakdown: TaxBreakdownEntry[] = [];
  for (const [code, base] of groups) {
    const tc = taxCodes.find((t) => t.code === code);
    const rate = tc?.ratePct ?? 0;
    breakdown.push({
      taxCode: code,
      label: tc?.label ?? `Código desconocido (${code})`,
      ratePct: rate,
      baseCents: base,
      taxCents: roundCents((base * rate) / 100),
      mention: tc?.mention ?? null,
    });
  }
  breakdown.sort((a, b) => b.ratePct - a.ratePct);
  const baseCents = grossCents - discountCents;
  const taxCents = breakdown.reduce((s, b) => s + b.taxCents, 0);
  const withholdingCents = withholdingPct > 0 ? roundCents((baseCents * withholdingPct) / 100) : 0;
  const totalCents = baseCents + taxCents;
  return {
    grossCents,
    discountCents,
    baseCents,
    taxCents,
    withholdingPct,
    withholdingCents,
    totalCents,
    payableCents: totalCents - withholdingCents,
    breakdown,
  };
}

export const EMPTY_TOTALS: InvoiceTotals = {
  grossCents: 0,
  discountCents: 0,
  baseCents: 0,
  taxCents: 0,
  withholdingPct: 0,
  withholdingCents: 0,
  totalCents: 0,
  payableCents: 0,
  breakdown: [],
};
