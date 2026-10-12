/**
 * ILLUSTRATIVE invoice-record payload, shaped after the "registro de alta" structure in
 * Orden HAC/1177/2024 (Annex) and the AEAT web-service description. It exists to show
 * which data the backend/provider integration will need. It is not a valid AEAT
 * submission: no XML schema, signature, chaining hash (Huella) or certificate is produced.
 */
import type { Company, Invoice, TaxCode } from './types';

export function buildFiscalPayload(inv: Invoice, company: Company, taxCodes: TaxCode[], number: string, issueDate: string, original?: Invoice) {
  const tipoFactura = inv.kind === 'rectifying' ? inv.rectification?.reasonCode ?? 'R4' : 'F1';
  const cust = inv.customerSnapshot;
  return {
    _aviso: 'ILUSTRATIVO — estructura inspirada en el registro de alta (Orden HAC/1177/2024). No válido para la AEAT.',
    IDFactura: { IDEmisorFactura: company.nif, NumSerieFactura: number, FechaExpedicionFactura: issueDate.split('-').reverse().join('-') },
    NombreRazonEmisor: company.legalName,
    TipoFactura: tipoFactura,
    ...(inv.kind === 'rectifying'
      ? {
          TipoRectificativa: inv.rectification?.method === 'substitution' ? 'S' : 'I',
          FacturasRectificadas: original ? [{ IDEmisorFactura: company.nif, NumSerieFactura: original.number, FechaExpedicionFactura: original.issueDate?.split('-').reverse().join('-') }] : [],
        }
      : {}),
    FechaOperacion: inv.operationDate ? inv.operationDate.split('-').reverse().join('-') : undefined,
    DescripcionOperacion: inv.lines.map((l) => l.description).join('; ').slice(0, 500),
    Destinatarios: cust ? [{ NombreRazon: cust.legalName, NIF: cust.idType === 'NIF' ? cust.idNumber : undefined, IDOtro: cust.idType !== 'NIF' ? { IDType: cust.idType, ID: cust.idNumber } : undefined }] : [],
    Desglose: inv.totals.breakdown.map((b) => {
      const tc = taxCodes.find((t) => t.code === b.taxCode);
      const exempt = tc?.kind === 'exempt';
      return {
        Impuesto: '01',
        ClaveRegimen: '01',
        ...(exempt ? { OperacionExenta: tc?.qualification } : { CalificacionOperacion: tc?.qualification ?? 'S1' }),
        TipoImpositivo: exempt ? undefined : b.ratePct.toFixed(2),
        BaseImponibleOimporteNoSujeto: (b.baseCents / 100).toFixed(2),
        CuotaRepercutida: exempt ? undefined : (b.taxCents / 100).toFixed(2),
      };
    }),
    CuotaTotal: (inv.totals.taxCents / 100).toFixed(2),
    ImporteTotal: (inv.totals.totalCents / 100).toFixed(2),
    Encadenamiento: '— calculado por el SIF del proveedor (no simulado) —',
    SistemaInformatico: '— datos del SIF del proveedor —',
    TipoHuella: '01 (SHA-256) — no calculado en el prototipo',
  };
}
