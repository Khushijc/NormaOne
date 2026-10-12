/**
 * SIMULATED outbound channels and document extraction. Nothing leaves the browser.
 * Replace with real e-mail / B2B exchange / OCR integrations behind the same functions.
 */
import { sleep } from '../context';

export interface DeliveryResult {
  status: 'delivered' | 'failed';
  detail: string;
}

/** Simulated e-mail delivery. Addresses containing "rebote" or ending in ".invalid" bounce. */
export async function sendEmail(to: string, _subject: string): Promise<DeliveryResult> {
  await sleep(300 + Math.random() * 400);
  if (!to || /rebote|\.invalid$/i.test(to)) return { status: 'failed', detail: 'Rebote: buzón inexistente (550 5.1.1) — simulado.' };
  return { status: 'delivered', detail: 'Entrega confirmada por el servidor de correo (simulado). No implica aceptación ni pago.' };
}

export interface ExtractionSuggestion {
  documentNumber?: string;
  documentDate?: string;
  baseCents?: number;
  vatRatePct?: number;
  merchantName?: string;
  confidence: number;
}

/**
 * Simulated document recognition (future capability, BRD FIN-06). Returns SUGGESTIONS only;
 * it never approves an expense nor determines its tax treatment.
 */
export async function extractFromDocument(fileName: string, sizeBytes: number): Promise<ExtractionSuggestion> {
  await sleep(700 + Math.random() * 500);
  const seed = Array.from(fileName).reduce((s, c) => s + c.charCodeAt(0), sizeBytes % 997);
  const base = 1500 + (seed % 40000);
  const numMatch = fileName.match(/([A-Z]{1,4}[-/]?\d{2,}[-/]?\d*)/i);
  return {
    documentNumber: numMatch ? numMatch[1].toUpperCase() : `T-${(seed * 37) % 100000}`,
    baseCents: base,
    vatRatePct: seed % 3 === 0 ? 10 : 21,
    confidence: 0.55 + (seed % 40) / 100,
  };
}
