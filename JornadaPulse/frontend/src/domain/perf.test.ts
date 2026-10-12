/** Guards the demo dataset against growing beyond what localStorage and the UI handle well. */
import { describe, expect, it } from 'vitest';
import { buildSeedDatabase } from '../data/seed';
import { listAnomalies } from './anomalies';

describe('seed size and detection cost', () => {
  it('stays well under the localStorage quota and detects anomalies quickly', () => {
    const anchor = new Date('2026-10-14T13:30:00.000Z');
    const db = buildSeedDatabase(anchor);
    const bytes = JSON.stringify(db).length;
    const t0 = performance.now();
    const list = listAnomalies(db, 'cmp_levante', anchor.toISOString());
    const ms = performance.now() - t0;
    console.log(`seed: ${(bytes / 1024).toFixed(0)} KB · events ${db.events.length} · sessions ${db.sessions.length} · shifts ${db.shifts.length} · audit ${db.audit.length} · anomalies ${list.length} in ${ms.toFixed(0)} ms`);
    expect(bytes).toBeLessThan(2_500_000);
    expect(ms).toBeLessThan(400);
  });
});
