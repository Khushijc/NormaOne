/**
 * New correction request (employee) or company-initiated correction (HR).
 *
 * The original record is never edited: the form sends the requested values to the service,
 * which stores them as a request (or proposal) that is reviewed and, if approved, applied as
 * a traced layer over the original events (TIM-04, AC-TIM-01; draft RD art. 4.b for proposals).
 */
import { Info, Send, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TimeText, ValuesView } from '../../components/bits';
import { stateFromValues, toValues, ValuesEditor, type EditorState } from '../../components/ValuesEditor';
import { Button, Callout, Modal, SelectField, TextAreaField, useAction } from '../../components/ui';
import { effectiveValues, recordStatus, relationshipOn } from '../../domain/records';
import { CORRECTION_KIND_LABEL, EVENT_TYPE_LABEL, RECORD_STATUS } from '../../domain/status';
import { addDays, formatDate, localDate, localTime } from '../../domain/time';
import type { CorrectionKind, CorrectionRequest, Employee, FailedAttempt, ID, SessionValues, WorkSession } from '../../domain/types';
import { t } from '../../i18n';
import { visibleEmployeeIds } from '../../services/context';
import { checkValues, proposeCorrection, requestCorrection, type CorrectionInput, type ValuesCheck } from '../../services/correctionService';
import { failedAttemptsFor } from '../../services/timeService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { sameValues, worksiteNamer } from './correctionBits';

export interface NewCorrectionInitial {
  sessionId: ID | null;
  failedId: ID | null;
  employeeId: ID | null;
  /** Opened from a link meaning "a day I worked but did not record". */
  missing: boolean;
}

type Mode = 'own' | 'hr';
type HrChoice = 'proposal' | 'on_behalf';

const RECENT_DAYS = 45;
const MIN_EXPLANATION = 10;
const ALL_KINDS = Object.keys(CORRECTION_KIND_LABEL) as CorrectionKind[];
const NO_SESSION_KINDS: CorrectionKind[] = ['missing_session', 'connectivity'];

interface Target {
  key: string;
  session: WorkSession | null;
  failed: FailedAttempt | null;
}

/** Session whose effective span contains the instant (used to link a failed clock-out to its session). */
function sessionAt(ctx: UiCtx, employeeId: ID, instant: string): WorkSession | null {
  return (
    ctx.db.sessions.find((s) => {
      if (s.companyId !== ctx.company.id || s.employeeId !== employeeId) return false;
      const v = effectiveValues(ctx.db, s);
      return !!v.start && v.start <= instant && (!v.end || v.end >= instant);
    }) ?? null
  );
}

function resolveTarget(ctx: UiCtx, employeeId: ID, key: string): Target {
  if (key.startsWith('ses:')) {
    const s = ctx.db.sessions.find((x) => x.id === key.slice(4) && x.companyId === ctx.company.id && x.employeeId === employeeId) ?? null;
    return { key, session: s, failed: null };
  }
  if (key.startsWith('fat:')) {
    const f = ctx.db.failedAttempts.find((x) => x.id === key.slice(4) && x.companyId === ctx.company.id && x.employeeId === employeeId) ?? null;
    const linked = f && f.action !== 'clock_in' ? sessionAt(ctx, employeeId, f.attemptedAt) : null;
    return { key, session: linked, failed: f };
  }
  return { key, session: null, failed: null };
}

function prefill(ctx: UiCtx, emp: Employee | undefined, target: Target): { state: EditorState | null; kind: CorrectionKind } {
  const tz = target.session?.timezone ?? ctx.company.timezone;
  const fallbackSite = emp?.primaryWorksiteId ?? '';
  const { session, failed } = target;
  if (failed) {
    const site = failed.worksiteId;
    let values: SessionValues;
    if (session) {
      const v = effectiveValues(ctx.db, session);
      values = { ...v, breaks: [...v.breaks] };
      if (failed.action === 'clock_out') values.end = failed.attemptedAt;
      else if (failed.action === 'break_start') values.breaks.push({ start: failed.attemptedAt, end: null, kind: 'rest' });
      else if (failed.action === 'break_end') {
        const open = values.breaks.findIndex((b) => !b.end);
        if (open >= 0) values.breaks[open] = { ...values.breaks[open], end: failed.attemptedAt };
      }
    } else if (failed.action === 'clock_out') {
      values = { start: null, end: failed.attemptedAt, breaks: [], worksiteId: site, mode: 'onsite' };
    } else {
      values = { start: failed.attemptedAt, end: null, breaks: [], worksiteId: site, mode: 'onsite' };
    }
    return { state: stateFromValues(values, localDate(failed.attemptedAt, tz), tz, site), kind: 'connectivity' };
  }
  if (session) {
    const v = effectiveValues(ctx.db, session);
    return { state: stateFromValues(v, session.date, tz, session.worksiteId), kind: v.end ? 'wrong_end' : 'missing_clock_out' };
  }
  if (target.key === 'new') {
    return { state: stateFromValues(null, addDays(ctx.today, -1), tz, fallbackSite), kind: 'missing_session' };
  }
  return { state: null, kind: 'other' };
}

export function NewCorrectionDialog({ initial, onClose, onCreated }: { initial: NewCorrectionInitial; onClose: () => void; onCreated: (c: CorrectionRequest) => void }) {
  const ctx = useCtx();
  const db = ctx.db;
  const me = ctx.employee;
  const canOwn = ctx.can('corrections.request_own') && !!me;
  const canPropose = ctx.can('corrections.propose');
  const visible = visibleEmployeeIds(ctx);
  const nameOf = worksiteNamer(db);
  const { run, pending } = useAction();

  const initSession = initial.sessionId ? db.sessions.find((s) => s.id === initial.sessionId && s.companyId === ctx.company.id) : undefined;
  const initFailed = initial.failedId ? db.failedAttempts.find((f) => f.id === initial.failedId && f.companyId === ctx.company.id) : undefined;
  const initEmp = initial.employeeId ?? initSession?.employeeId ?? initFailed?.employeeId ?? null;
  const wantsOther = !!initEmp && initEmp !== me?.id;
  const otherBlocked = wantsOther && !canPropose;

  const initialMode: Mode = wantsOther && canPropose ? 'hr' : canOwn ? 'own' : 'hr';
  const employeesForHr = useMemo(
    () => db.employees.filter((e) => e.companyId === ctx.company.id && visible.has(e.id) && e.id !== me?.id).sort((a, b) => a.firstName.localeCompare(b.firstName, 'es')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, ctx.company.id, me?.id],
  );

  const initialEmployee = (m: Mode): ID => {
    if (m === 'own') return me?.id ?? '';
    return wantsOther && initEmp && visible.has(initEmp) ? initEmp : '';
  };
  const initialTargetKey = (m: Mode, empId: ID): string => {
    if (!empId) return '';
    if (initFailed && initFailed.employeeId === empId) return `fat:${initFailed.id}`;
    if (initSession && initSession.employeeId === empId) return `ses:${initSession.id}`;
    if (initial.missing && (m === 'own' || initial.employeeId === empId)) return 'new';
    return '';
  };

  const [mode, setMode] = useState<Mode>(initialMode);
  const [employeeId, setEmployeeId] = useState<ID>(() => initialEmployee(initialMode));
  const [targetKey, setTargetKey] = useState<string>(() => initialTargetKey(initialMode, initialEmployee(initialMode)));
  const firstPrefill = useMemo(() => prefill(ctx, db.employees.find((e) => e.id === employeeId), resolveTarget(ctx, employeeId, targetKey)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [editor, setEditor] = useState<EditorState | null>(firstPrefill.state);
  const [kind, setKind] = useState<CorrectionKind>(firstPrefill.kind);
  const [explanation, setExplanation] = useState('');
  const [hrChoice, setHrChoice] = useState<HrChoice>(() => (db.employees.find((e) => e.id === initialEmployee(initialMode))?.userId ? 'proposal' : 'on_behalf'));
  const [tried, setTried] = useState(false);

  const employee = db.employees.find((e) => e.id === employeeId);
  const target = resolveTarget(ctx, employeeId, targetKey);
  const session = target.session;
  const failed = target.failed;
  const tz = session?.timezone ?? ctx.company.timezone;

  const selectTarget = (key: string, empId: ID = employeeId) => {
    setTargetKey(key);
    const p = prefill(ctx, db.employees.find((e) => e.id === empId), resolveTarget(ctx, empId, key));
    setEditor(p.state);
    setKind(p.kind);
    setTried(false);
  };
  const selectEmployee = (empId: ID) => {
    setEmployeeId(empId);
    setHrChoice(db.employees.find((e) => e.id === empId)?.userId ? 'proposal' : 'on_behalf');
    selectTarget('', empId);
  };
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    selectEmployee(m === 'own' ? me?.id ?? '' : '');
  };

  // ── Options ──
  const sessions = useMemo(() => {
    if (!employeeId) return [];
    const from = addDays(ctx.today, -RECENT_DAYS);
    return db.sessions
      .filter((s) => s.companyId === ctx.company.id && s.employeeId === employeeId && (s.date >= from || s.id === initial.sessionId))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [db, ctx.company.id, ctx.today, employeeId, initial.sessionId]);
  const failedList = useMemo(() => (employeeId ? failedAttemptsFor(ctx, employeeId).filter((f) => !f.correctionId || f.id === initial.failedId) : []), [ctx, employeeId, initial.failedId]);

  const sessionLabel = (s: WorkSession) => {
    const v = effectiveValues(db, s);
    const span = v.start ? `${localTime(v.start, s.timezone)}–${v.end ? localTime(v.end, s.timezone) : t('sin salida')}` : '—';
    return `${formatDate(s.date)} · ${span} · ${t(RECORD_STATUS[recordStatus(db, s)].label)}`;
  };
  const failedLabel = (f: FailedAttempt) => `${t('«No registrado»')} · ${formatDate(localDate(f.attemptedAt, ctx.company.timezone))} ${localTime(f.attemptedAt, ctx.company.timezone)} · ${t(EVENT_TYPE_LABEL[f.action])}`;

  const kindOptions = session ? ALL_KINDS.filter((k) => k !== 'missing_session') : targetKey ? NO_SESSION_KINDS : ALL_KINDS;

  // ── Validation (the service repeats every check) ──
  const activeCorrection = session ? db.corrections.find((c) => c.sessionId === session.id && (c.status === 'pending' || c.status === 'pending_employee')) : undefined;
  const failedTaken = failed?.correctionId ? db.corrections.find((c) => c.id === failed.correctionId) : undefined;
  const original = session ? effectiveValues(db, session) : null;
  const conv = editor ? toValues(editor, tz) : null;
  let check: ValuesCheck = { errors: [], warnings: [] };
  if (conv && employeeId) {
    try {
      check = checkValues(ctx, employeeId, conv.values, session?.id ?? null);
    } catch {
      check = { errors: ['Empleado no disponible.'], warnings: [] };
    }
  }
  const errors: string[] = [];
  if (!targetKey) errors.push(t('Seleccione el registro que desea corregir.'));
  if (conv) errors.push(...conv.errors, ...check.errors.map((e) => t(e)));
  if (conv && original && sameValues(original, conv.values)) errors.push(t('Los valores solicitados son iguales a los actuales.'));
  if (activeCorrection) errors.push(t('Ya hay una corrección en curso para este registro. Espere a su resolución o retírela.'));
  if (failedTaken) errors.push(t('Este fichaje no registrado ya tiene una solicitud de corrección.'));
  if (mode === 'hr' && !employeeId) errors.push(t('Seleccione el empleado.'));
  const explanationShort = explanation.trim().length < MIN_EXPLANATION;
  const noAccessProposal = mode === 'hr' && hrChoice === 'proposal' && !!employee && !employee.userId;

  const submit = async () => {
    setTried(true);
    if (pending || errors.length || explanationShort || !conv || !editor) return;
    const input: CorrectionInput = {
      employeeId,
      sessionId: session?.id ?? null,
      failedAttemptId: failed?.id ?? null,
      date: session?.date ?? editor.date,
      kind,
      requested: conv.values,
      explanation: explanation.trim(),
    };
    const created = await run(
      () => (mode === 'own' ? requestCorrection(input) : proposeCorrection(input, hrChoice === 'on_behalf')),
      (c) => (c.status === 'pending_employee' ? t('Propuesta registrada: queda pendiente de la conformidad del empleado.') : t('Solicitud registrada: queda pendiente de revisión.')),
    );
    if (created) onCreated(created);
  };

  if (!canOwn && !canPropose) {
    return (
      <Modal title={t('Nueva solicitud de corrección')} onClose={onClose} footer={<Button onClick={onClose}>{t('Cerrar')}</Button>}>
        <Callout tone="info" title={t('Su rol no permite solicitar ni proponer correcciones')}>
          {t('Solo las personas con registro de jornada propio pueden solicitar correcciones, y RR. HH. puede proponerlas. El servidor también rechazaría la acción.')}
        </Callout>
      </Modal>
    );
  }

  const allowRemote = !!employee && !!editor && (relationshipOn(db, employee.id, editor.date)?.remoteAllowed ?? false);
  const worksites = db.worksites.filter((w) => w.companyId === ctx.company.id);

  return (
    <Modal
      wide
      title={mode === 'own' ? t('Nueva solicitud de corrección') : t('Corrección iniciada por RR. HH.')}
      description={t('El registro original no se modifica: la corrección se revisa y, si se aprueba, queda como una capa trazada.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon={Send} onClick={submit} loading={pending} disabled={pending}>
            {mode === 'own' ? t('Enviar solicitud') : hrChoice === 'proposal' ? t('Enviar propuesta al empleado') : t('Registrar solicitud')}
          </Button>
        </>
      }
    >
      <div className="stack corr-form">
        {canOwn && canPropose && (
          <div className="segmented" role="group" aria-label={t('Para quién es la corrección')}>
            <button type="button" aria-pressed={mode === 'own'} onClick={() => switchMode('own')}>
              {t('Mis registros')}
            </button>
            <button type="button" aria-pressed={mode === 'hr'} onClick={() => switchMode('hr')}>
              {t('Registros de otro empleado')}
            </button>
          </div>
        )}
        {otherBlocked && (
          <Callout tone="warning" title={t('Solo RR. HH. puede iniciar correcciones de otros empleados')}>
            {t('Puede solicitar correcciones de sus propios registros. Para un registro de su equipo, pida al empleado que la solicite o contacte con RR. HH.')}
          </Callout>
        )}

        {mode === 'hr' && (
          <div className="stack">
            <SelectField label={t('Empleado')} required value={employeeId} onChange={(e) => selectEmployee(e.target.value)} error={tried && !employeeId ? t('Seleccione el empleado.') : undefined}>
              <option value="">{t('Seleccione…')}</option>
              {employeesForHr.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} · {e.code}
                  {e.status === 'inactive' ? ` (${t('inactivo')})` : ''}
                </option>
              ))}
            </SelectField>
            <fieldset className="corr-choice">
              <legend className="strong small">{t('Tipo de corrección iniciada por RR. HH.')}</legend>
              <label className="corr-radio">
                <input type="radio" name="hr-choice" checked={hrChoice === 'proposal'} onChange={() => setHrChoice('proposal')} />
                <span>
                  <span className="strong">{t('Propuesta de la empresa (requiere conformidad del empleado)')}</span>
                  <span className="tiny muted" style={{ display: 'block' }}>
                    {t('Queda «Pendiente de conformidad» hasta que el empleado la acepte o deje constancia de su discrepancia.')}
                  </span>
                </span>
              </label>
              <label className="corr-radio">
                <input type="radio" name="hr-choice" checked={hrChoice === 'on_behalf'} onChange={() => setHrChoice('on_behalf')} />
                <span>
                  <span className="strong">{t('Registrar a petición del empleado (empleado sin acceso a la aplicación)')}</span>
                  <span className="tiny muted" style={{ display: 'block' }}>
                    {t('Se registra como solicitud del empleado y pasa a revisión por la persona supervisora o RR. HH.')}
                  </span>
                </span>
              </label>
            </fieldset>
            {noAccessProposal && (
              <Callout tone="warning" title={t('Este empleado no tiene acceso a la aplicación')}>
                {t('No podrá dar su conformidad en la aplicación. Si la corrección la pide el propio empleado, use «Registrar a petición del empleado».')}
              </Callout>
            )}
            {hrChoice === 'on_behalf' && employee?.userId && (
              <Callout tone="info">{t('Este empleado tiene acceso a la aplicación: lo habitual es que presente la solicitud él mismo.')}</Callout>
            )}
          </div>
        )}

        {employeeId && (
          <div className="grid-2">
            <SelectField label={t('Registro afectado')} required value={targetKey} onChange={(e) => selectTarget(e.target.value)} hint={t('Sesiones de los últimos {n} días con sus valores vigentes y su estado.', { n: RECENT_DAYS })} error={tried && !targetKey ? t('Seleccione el registro que desea corregir.') : undefined}>
              <option value="">{t('Seleccione…')}</option>
              <option value="new">{t('Jornada trabajada sin registrar')}</option>
              {failedList.length > 0 && (
                <optgroup label={t('Fichajes «No registrado»')}>
                  {failedList.map((f) => (
                    <option key={f.id} value={`fat:${f.id}`}>
                      {failedLabel(f)}
                    </option>
                  ))}
                </optgroup>
              )}
              {sessions.length > 0 && (
                <optgroup label={t('Sesiones registradas')}>
                  {sessions.map((s) => (
                    <option key={s.id} value={`ses:${s.id}`}>
                      {sessionLabel(s)}
                    </option>
                  ))}
                </optgroup>
              )}
            </SelectField>
            <SelectField label={t('Tipo de corrección')} required value={kind} onChange={(e) => setKind(e.target.value as CorrectionKind)} disabled={!targetKey}>
              {(kindOptions.includes(kind) ? kindOptions : [kind, ...kindOptions]).map((k) => (
                <option key={k} value={k}>
                  {t(CORRECTION_KIND_LABEL[k])}
                </option>
              ))}
            </SelectField>
          </div>
        )}

        {activeCorrection && (
          <Callout tone="warning" title={t('Ya hay una corrección en curso para este registro')}>
            <Link to={`/correcciones/${activeCorrection.id}`}>{t('Ver la solicitud en curso')}</Link>
          </Callout>
        )}
        {failedTaken && (
          <Callout tone="warning" title={t('Este fichaje no registrado ya tiene una solicitud de corrección.')}>
            <Link to={`/correcciones/${failedTaken.id}`}>{t('Ver la solicitud en curso')}</Link>
          </Callout>
        )}

        {editor && employee && (
          <div className="corr-form-grid">
            <div className="stack">
              <div className="strong">{t('Valores solicitados')}</div>
              <ValuesEditor state={editor} onChange={setEditor} tz={tz} employee={employee} worksites={worksites} allowRemote={allowRemote} disabledDate={!!session} />
            </div>
            <aside className="corr-original" aria-label={t('Valores actuales del registro')}>
              {failed && (
                <div className="stack-sm">
                  <div className="row" style={{ gap: 6 }}>
                    <WifiOff size={15} aria-hidden />
                    <span className="strong">{t('Fichaje «No registrado»')}</span>
                  </div>
                  <div className="small">
                    {t(EVENT_TYPE_LABEL[failed.action])} · {formatDate(localDate(failed.attemptedAt, tz))} <TimeText at={failed.attemptedAt} tz={tz} />
                  </div>
                  <div className="tiny muted">
                    {nameOf(failed.worksiteId)} · {t(failed.reason)}
                  </div>
                  <div className="tiny muted">{t('El intento no generó ningún registro. La corrección lo añade una vez revisada.')}</div>
                </div>
              )}
              <div className="stack-sm">
                <div className="strong">{session ? t('Valores actuales (solo lectura)') : t('Sin registro original')}</div>
                {session ? (
                  <>
                    <ValuesView values={original} tz={tz} worksiteName={(id) => nameOf(id)} />
                    <Link className="tiny" to={`/registros/${session.id}`}>
                      {t('Abrir el registro')}
                    </Link>
                  </>
                ) : (
                  <div className="tiny muted">{t('Jornada no registrada: si se aprueba, se crea una sesión marcada como procedente de una corrección.')}</div>
                )}
              </div>
            </aside>
          </div>
        )}

        {targetKey && (
          <TextAreaField
            label={t('Explicación')}
            required
            rows={3}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder={t('Qué ocurrió y cómo se puede comprobar (parte de trabajo, cliente, etc.).')}
            error={tried && explanationShort ? t('La explicación es obligatoria (al menos 10 caracteres).') : undefined}
            hint={t('{n} caracteres (mínimo {min})', { n: explanation.trim().length, min: MIN_EXPLANATION })}
          />
        )}

        <Callout tone="info" icon={Info} title={t('El registro original no se modifica')}>
          {mode === 'hr' && hrChoice === 'proposal'
            ? t('La propuesta se notifica al empleado. Si da su conformidad se aplica; si manifiesta discrepancia, queda constancia y RR. HH. decide si la retira o la aplica informando a la representación legal de los trabajadores.')
            : t('Una persona autorizada (supervisor o RR. HH.) revisa la solicitud. Si se aprueba, los valores aprobados quedan como una capa trazada sobre los fichajes originales, que se conservan. El resultado se notifica al empleado.')}
        </Callout>

        {check.warnings.length > 0 && (
          <Callout tone="warning" title={t('Avisos para la revisión')}>
            <ul>
              {check.warnings.map((w, i) => (
                <li key={i}>{t(w)}</li>
              ))}
            </ul>
          </Callout>
        )}
        {tried && (errors.length > 0 || explanationShort) && (
          <Callout tone="danger" title={t('Revise la solicitud antes de enviarla')}>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {explanationShort && <li>{t('La explicación es obligatoria (al menos 10 caracteres).')}</li>}
            </ul>
          </Callout>
        )}
      </div>
    </Modal>
  );
}
