/**
 * Append-only Audit Chain for PrevenWork.
 */
import { demoHash } from './ids';
import type { AuditEvent } from './types';

export const GENESIS_HASH = '0000000000000000';

export function chainAuditEvent(
  prev: AuditEvent | null,
  raw: Omit<AuditEvent, 'seq' | 'prevHash' | 'hash'>
): AuditEvent {
  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? GENESIS_HASH;
  const payload = [
    seq,
    prevHash,
    raw.id,
    raw.at,
    raw.actor.userId,
    raw.actor.role,
    raw.companyId,
    raw.action,
    raw.entityType,
    raw.entityId,
    raw.summary,
    raw.restricted ? '1' : '0',
  ].join('|');
  const hash = demoHash(payload);
  return { ...raw, seq, prevHash, hash };
}

export function verifyChain(events: AuditEvent[]): boolean {
  for (let i = 0; i < events.length; i++) {
    const prev = i === 0 ? null : events[i - 1];
    const prevHash = prev?.hash ?? GENESIS_HASH;
    if (events[i].prevHash !== prevHash) return false;
    if (events[i].seq !== i + 1) return false;
  }
  return true;
}

export function verifyAuditChain(events: AuditEvent[]): { valid: boolean; totalEvents: number } {
  return {
    valid: verifyChain(events),
    totalEvents: events.length,
  };
}

