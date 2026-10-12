/**
 * SIMULATED fiscal provider.
 *
 * Stands in for the approved third-party invoicing/SIF provider (BRD §18, D-03). It is
 * NOT connected to AEAT or any real provider, and its responses are not AEAT responses.
 *
 * It keeps its own "remote" state (separate storage key) so the app can reconcile against
 * it exactly as it would against a real provider: an operation key that was processed
 * remotely always returns the same result (idempotency, FIN-03 / INT-02).
 *
 * Replace with an HTTP client implementing the same interface when the provider is chosen.
 */
import { nowISO } from '../../domain/dates';
import type { ProviderScenario } from '../../domain/types';
import { SEED_PROVIDER_REMOTE } from '../../data/seed';
import { KEYS, readJSON, writeRaw } from '../../store/storage';
import { sleep } from '../context';

export interface RemoteRecord {
  processed: boolean;
  state: 'accepted' | 'accepted_with_errors' | 'rejected';
  providerInvoiceId: string | null;
  fiscalRecordId: string | null;
  number: string;
  processedAt: string;
  errors?: { code: string; message: string }[];
}

interface RemoteState {
  records: Record<string, RemoteRecord>;
}

export interface SubmitRequest {
  operationKey: string;
  number: string;
  issuerNif: string;
  /** Illustrative record payload (see buildFiscalPayload). */
  payload: unknown;
  scenario: ProviderScenario;
}

export interface ProviderResult extends RemoteRecord {
  requestId: string;
  responseCode: string;
  responseMessage: string;
  /** True when the provider recognised the operation key and returned the stored result. */
  duplicate: boolean;
}

export class ProviderTimeoutError extends Error {
  constructor() {
    super('Tiempo de espera agotado sin respuesta del proveedor (simulado). El resultado es incierto: concilie antes de reintentar.');
    this.name = 'ProviderTimeoutError';
  }
}
export class ProviderUnavailableError extends Error {
  constructor() {
    super('Proveedor fiscal no disponible (simulado). No se ha generado ningún registro.');
    this.name = 'ProviderUnavailableError';
  }
}

let mem: RemoteState | null = null;
function load(): RemoteState {
  if (mem) return mem;
  const stored = readJSON<RemoteState>(KEYS.provider);
  mem = stored && typeof stored === 'object' && stored.records ? stored : (JSON.parse(JSON.stringify(SEED_PROVIDER_REMOTE)) as RemoteState);
  save();
  return mem;
}
function save() {
  writeRaw(KEYS.provider, JSON.stringify(mem));
}
/** Test/reset hook. */
export function resetProviderState() {
  mem = null;
}

let delayMs: [number, number] = [450, 900];
export function setProviderDelay(min: number, max: number) {
  delayMs = [min, max];
}
const wait = () => (delayMs[1] === 0 ? Promise.resolve() : sleep(delayMs[0] + Math.random() * (delayMs[1] - delayMs[0])));

const rid = (p: string) => `${p}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4).toString(36).toUpperCase()}`;

function toResult(r: RemoteRecord, duplicate: boolean): ProviderResult {
  const codes = { accepted: 'Correcto', accepted_with_errors: 'AceptadoConErrores', rejected: 'Incorrecto' } as const;
  const messages = {
    accepted: 'Registro de facturación aceptado (respuesta SIMULADA; no procede de la AEAT).',
    accepted_with_errors: 'Registro aceptado con errores que deben subsanarse (SIMULADO).',
    rejected: 'Registro no aceptado (SIMULADO). Corrija y reenvíe.',
  };
  return {
    ...r,
    requestId: rid('REQ'),
    responseCode: codes[r.state],
    responseMessage: duplicate ? `Operación ya procesada con esta clave: se devuelve el resultado original. ${messages[r.state]}` : messages[r.state],
    duplicate,
  };
}

export async function submitRecord(req: SubmitRequest): Promise<ProviderResult> {
  const state = load();
  await wait();
  const existing = state.records[req.operationKey];
  if (existing?.processed) return toResult(existing, true);

  const base = {
    processed: true,
    number: req.number,
    processedAt: nowISO(),
    providerInvoiceId: rid(`PRV-${req.issuerNif.slice(-4)}`),
    fiscalRecordId: rid('SIM-RF'),
  };
  switch (req.scenario) {
    case 'outage':
      throw new ProviderUnavailableError();
    case 'timeout_not_processed':
      throw new ProviderTimeoutError();
    case 'timeout_processed': {
      state.records[req.operationKey] = { ...base, state: 'accepted' };
      save();
      throw new ProviderTimeoutError();
    }
    case 'reject': {
      const rec: RemoteRecord = {
        ...base,
        providerInvoiceId: null,
        fiscalRecordId: null,
        state: 'rejected',
        errors: [{ code: 'SIM-1105', message: 'SIMULADO — Error de validación en los datos del destinatario.' }],
      };
      state.records[req.operationKey] = rec;
      save();
      return toResult(rec, false);
    }
    case 'accept_with_errors': {
      const rec: RemoteRecord = { ...base, state: 'accepted_with_errors', errors: [{ code: 'SIM-2004', message: 'SIMULADO — Descripción de la operación incompleta; subsane en un nuevo registro.' }] };
      state.records[req.operationKey] = rec;
      save();
      return toResult(rec, false);
    }
    default: {
      const rec: RemoteRecord = { ...base, state: 'accepted' };
      state.records[req.operationKey] = rec;
      save();
      return toResult(rec, false);
    }
  }
}

/** Reconciliation query by operation key (INT-02/INT-03). */
export async function queryOperation(operationKey: string): Promise<(ProviderResult & { found: true }) | { found: false; processed: false }> {
  const state = load();
  await wait();
  const r = state.records[operationKey];
  if (!r) return { found: false, processed: false };
  return { ...toResult(r, true), found: true };
}

export async function healthCheck(): Promise<{ ok: boolean; at: string; latencyMs: number }> {
  const t0 = Date.now();
  await wait();
  return { ok: true, at: nowISO(), latencyMs: Date.now() - t0 };
}
