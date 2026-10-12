/**
 * Lookup indexes built once per database snapshot (the store replaces the Database object on
 * every committed change, so a WeakMap keyed by it is always consistent).
 */
import type { AttendanceEvent, CorrectionRequest, Database, Employee, ID, WorkSession } from './types';

export interface DbIndex {
  eventById: Map<ID, AttendanceEvent>;
  eventsBySession: Map<ID, AttendanceEvent[]>;
  sessionById: Map<ID, WorkSession>;
  sessionsByEmployee: Map<ID, WorkSession[]>;
  correctionById: Map<ID, CorrectionRequest>;
  employeeById: Map<ID, Employee>;
}

const cache = new WeakMap<Database, DbIndex>();

export function index(db: Database): DbIndex {
  let ix = cache.get(db);
  if (ix) return ix;
  const eventById = new Map<ID, AttendanceEvent>();
  const eventsBySession = new Map<ID, AttendanceEvent[]>();
  for (const e of db.events) {
    eventById.set(e.id, e);
    const list = eventsBySession.get(e.sessionId);
    if (list) list.push(e);
    else eventsBySession.set(e.sessionId, [e]);
  }
  const sessionById = new Map<ID, WorkSession>();
  const sessionsByEmployee = new Map<ID, WorkSession[]>();
  for (const s of db.sessions) {
    sessionById.set(s.id, s);
    const list = sessionsByEmployee.get(s.employeeId);
    if (list) list.push(s);
    else sessionsByEmployee.set(s.employeeId, [s]);
  }
  ix = {
    eventById,
    eventsBySession,
    sessionById,
    sessionsByEmployee,
    correctionById: new Map(db.corrections.map((c) => [c.id, c])),
    employeeById: new Map(db.employees.map((e) => [e.id, e])),
  };
  cache.set(db, ix);
  return ix;
}
