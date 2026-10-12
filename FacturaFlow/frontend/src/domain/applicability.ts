import { diffDays } from './dates';
import type { Company, FinanceConfig, ISODate, ProviderConfig, RuleVersion, TaxTerritory } from './types';

/**
 * Applicability and activation gates for live (here: simulated) invoice issue.
 * FIN-01, PLT-01, PLT-07, AC-FIN-04 and BRD §02 "Spain-specific onboarding gates".
 */

export const TERRITORY_LABEL: Record<TaxTerritory, string> = {
  common_mainland: 'Territorio común — península',
  common_balearic: 'Territorio común — Illes Balears',
  canarias: 'Canarias (IGIC)',
  ceuta: 'Ceuta (IPSI)',
  melilla: 'Melilla (IPSI)',
  foral_alava: 'Territorio foral — Álava (TicketBAI)',
  foral_bizkaia: 'Territorio foral — Bizkaia (Batuz/TicketBAI)',
  foral_gipuzkoa: 'Territorio foral — Gipuzkoa (TicketBAI)',
  foral_navarra: 'Territorio foral — Navarra',
};

export const SUPPORTED_TERRITORIES: TaxTerritory[] = ['common_mainland', 'common_balearic'];

/** Latest rule version for a key that is in force on `on` (announcements and future rules never apply). */
export function currentRule(rules: RuleVersion[], key: string, on: ISODate): RuleVersion | null {
  const candidates = rules
    .filter((r) => r.key === key && r.status !== 'announced' && r.effectiveDate !== null && r.effectiveDate <= on)
    .sort((a, b) => (a.effectiveDate! < b.effectiveDate! ? 1 : -1));
  return candidates[0] ?? null;
}

export function ruleHistory(rules: RuleVersion[], key: string): RuleVersion[] {
  return rules.filter((r) => r.key === key).sort((a, b) => ((a.effectiveDate ?? '9999') < (b.effectiveDate ?? '9999') ? -1 : 1));
}

/** RRSIF deadline by taxpayer type (RD 1007/2023 DF 4 as amended). */
export function deriveSifDeadline(fc: Pick<FinanceConfig, 'taxpayerType'>, rules: RuleVersion[], on: ISODate): { deadline: ISODate | null; rule: RuleVersion | null } {
  const key = fc.taxpayerType === 'IS' ? 'sif.deadline.is' : 'sif.deadline.other';
  const rule = currentRule(rules, key, on);
  return { deadline: rule?.value ?? null, rule };
}

/** B2B e-invoicing deadline by prior-year turnover band (RD 238/2026 DF 4 + Orden HAC/1028/2026). */
export function deriveB2bDeadline(fc: Pick<FinanceConfig, 'priorYearTurnoverBand'>, rules: RuleVersion[], on: ISODate): { deadline: ISODate | null; rule: RuleVersion | null } {
  if (fc.priorYearTurnoverBand === 'unknown') return { deadline: null, rule: null };
  const key = fc.priorYearTurnoverBand === 'over_8m' ? 'b2b.deadline.over8m' : 'b2b.deadline.rest';
  const rule = currentRule(rules, key, on);
  return { deadline: rule?.value ?? null, rule };
}

export interface GateIssue {
  code: string;
  severity: 'block' | 'warn';
  message: string;
  /** Who must resolve it (BRD: "show a reason and owner for every blocked configuration"). */
  owner: string;
  requirement: string;
}

export function financeIssueGate(
  company: Company,
  fc: FinanceConfig,
  provider: ProviderConfig | undefined,
  on: ISODate,
): GateIssue[] {
  const issues: GateIssue[] = [];
  const adviser = fc.responsibleAdviser || 'Asesor fiscal (sin asignar)';

  if (!company.profileReviewedAt) {
    issues.push({ code: 'PROFILE_UNREVIEWED', severity: 'block', message: 'El perfil de la empresa no ha sido revisado por una persona responsable.', owner: 'Propietario/a', requirement: 'PLT-01' });
  }
  if (!SUPPORTED_TERRITORIES.includes(fc.territory)) {
    issues.push({
      code: 'TERRITORY_UNSUPPORTED',
      severity: 'block',
      message: `Configuración fiscal no soportada en esta versión: ${TERRITORY_LABEL[fc.territory]}. La emisión permanece desactivada hasta que una configuración específica supere la revisión.`,
      owner: adviser,
      requirement: 'FIN-01 · BRD §02',
    });
  }
  if (fc.siiParticipant) {
    issues.push({
      code: 'SII_PARTICIPANT',
      severity: 'block',
      message: 'La empresa lleva los libros registro a través del SII: está excluida del RRSIF y su flujo no está soportado en esta versión.',
      owner: adviser,
      requirement: 'FIN-01 · RD 1007/2023 art. 3.3',
    });
  }
  if (fc.vatRegime !== 'general') {
    issues.push({
      code: 'VAT_REGIME_UNSUPPORTED',
      severity: 'block',
      message: 'Solo el régimen general de IVA está aprobado para la emisión en esta versión (criterio de caja, recargo de equivalencia y otros regímenes especiales requieren revisión).',
      owner: adviser,
      requirement: 'FIN-01',
    });
  }
  if (!fc.configApprovedAt) {
    issues.push({ code: 'CONFIG_UNAPPROVED', severity: 'block', message: 'La configuración fiscal (series, tipos impositivos y regímenes) no tiene aprobación del asesor.', owner: adviser, requirement: 'FIN-01' });
  }
  if (fc.sif.state === 'pending_review') {
    issues.push({ code: 'SIF_PENDING', severity: 'block', message: 'La decisión de aplicabilidad del RRSIF/SIF está pendiente de revisión.', owner: adviser, requirement: 'FIN-01' });
  }
  if (fc.sif.state === 'applicable' && fc.sifMode === 'undecided') {
    issues.push({ code: 'SIF_MODE', severity: 'block', message: 'No se ha decidido la modalidad del sistema (VERI*FACTU o no VERI*FACTU).', owner: adviser, requirement: 'FIN-01 · S03' });
  }

  if (!provider || provider.status === 'not_configured') {
    issues.push({ code: 'PROVIDER_MISSING', severity: 'block', message: 'No hay proveedor fiscal aprobado configurado.', owner: 'Responsable de integración', requirement: 'FIN-01 · FIN-03' });
  } else {
    if (provider.status === 'suspended') {
      issues.push({ code: 'PROVIDER_SUSPENDED', severity: 'block', message: 'El proveedor fiscal está suspendido.', owner: 'Responsable de integración', requirement: 'FIN-01' });
    }
    if (provider.status === 'expired' || (provider.authorisationExpires && provider.authorisationExpires < on)) {
      issues.push({ code: 'PROVIDER_AUTH_EXPIRED', severity: 'block', message: 'La autorización del proveedor fiscal ha caducado.', owner: 'Responsable de integración', requirement: 'FIN-01' });
    } else if (provider.authorisationExpires && diffDays(on, provider.authorisationExpires) <= 30) {
      issues.push({
        code: 'PROVIDER_AUTH_EXPIRING',
        severity: 'warn',
        message: `La autorización del proveedor caduca en ${diffDays(on, provider.authorisationExpires)} días.`,
        owner: 'Responsable de integración',
        requirement: 'INT-05',
      });
    }
    if (!provider.producerDeclaration) {
      issues.push({ code: 'NO_DECLARATION', severity: 'block', message: 'Falta la declaración responsable del productor para la versión instalada.', owner: 'Responsable de integración', requirement: 'FIN-08 · S04' });
    }
  }

  if (fc.b2b.state === 'pending_review') {
    issues.push({
      code: 'B2B_PENDING',
      severity: 'warn',
      message: 'La aplicabilidad de la factura electrónica B2B (RD 238/2026) está pendiente de revisión.',
      owner: adviser,
      requirement: 'FIN-09 (C)',
    });
  } else if (fc.b2b.state === 'applicable' && !fc.b2bConnectorValidated) {
    if (fc.b2b.deadline && fc.b2b.deadline <= on) {
      issues.push({
        code: 'B2B_IN_FORCE_NO_CONNECTOR',
        severity: 'block',
        message: 'La obligación de factura electrónica B2B es aplicable y no existe un conector de intercambio validado. Un flujo solo PDF no puede considerarse preparado para B2B.',
        owner: adviser,
        requirement: 'FIN-09 (C) · AC-FIN-04',
      });
    } else if (fc.b2b.deadline) {
      issues.push({
        code: 'B2B_UPCOMING',
        severity: 'warn',
        message: `Factura electrónica B2B obligatoria a partir del ${fc.b2b.deadline.split('-').reverse().join('/')} (${diffDays(on, fc.b2b.deadline)} días). Capacidad aún no validada.`,
        owner: adviser,
        requirement: 'FIN-09 (C)',
      });
    }
  }
  return issues;
}

export function isIssueBlocked(issues: GateIssue[]): boolean {
  return issues.some((i) => i.severity === 'block');
}
