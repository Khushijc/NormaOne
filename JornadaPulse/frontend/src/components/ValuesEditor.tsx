/**
 * Editor for session values (start, end, breaks, worksite, mode) used by correction requests,
 * company proposals and reviewer adjustments.
 *
 * Inputs are local wall-clock times in the workplace zone; they are converted to unambiguous
 * instants. An end (or break) time earlier than the start rolls to the next day (overnight).
 * A time inside the spring-forward gap is an error; a time inside the repeated autumn hour asks
 * the user to choose which occurrence (UTC offset) is meant.
 */
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addDays, formatOffset, localDate, localTime, localToInstant } from '../domain/time';
import type { BreakKind, Employee, ISODate, SessionValues, WorkMode, Worksite } from '../domain/types';
import { BREAK_KIND_LABEL, MODE_LABEL } from '../domain/status';
import { t } from '../i18n';
import { Button, Field, SelectField } from './ui';

interface BreakRow {
  start: string;
  end: string;
  kind: BreakKind;
  startPick: number;
  endPick: number;
}

export interface EditorState {
  date: ISODate;
  start: string;
  end: string;
  startPick: number;
  endPick: number;
  breaks: BreakRow[];
  worksiteId: string;
  mode: WorkMode;
}

export function stateFromValues(values: SessionValues | null, date: ISODate, tz: string, fallbackWorksite: string): EditorState {
  return {
    date: values?.start ? localDate(values.start, tz) : date,
    start: values?.start ? localTime(values.start, tz) : '',
    end: values?.end ? localTime(values.end, tz) : '',
    startPick: 0,
    endPick: 0,
    breaks: (values?.breaks ?? []).map((b) => ({ start: localTime(b.start, tz), end: b.end ? localTime(b.end, tz) : '', kind: b.kind, startPick: 0, endPick: 0 })),
    worksiteId: values?.worksiteId ?? fallbackWorksite,
    mode: values?.mode ?? 'onsite',
  };
}

interface Resolved {
  instant: string | null;
  error: string | null;
  options: string[] | null;
}

function resolve(date: ISODate, time: string, tz: string, pick: number): Resolved {
  if (!time) return { instant: null, error: null, options: null };
  const r = localToInstant(date, time, tz);
  if (r.kind === 'ok') return { instant: r.instant, error: null, options: null };
  if (r.kind === 'gap') return { instant: null, error: t('La hora {time} no existe el {date} por el cambio de hora (adelanto).', { time, date }), options: null };
  if (r.kind === 'ambiguous') return { instant: r.options[Math.min(pick, 1)], error: null, options: r.options };
  return { instant: null, error: t('Hora no válida.'), options: null };
}

export interface EditorResult {
  values: SessionValues;
  errors: string[];
}

/** Converts the editor state to SessionValues (with local validation messages). */
export function toValues(s: EditorState, tz: string): EditorResult {
  const errors: string[] = [];
  const start = resolve(s.date, s.start, tz, s.startPick);
  // The end is on the next day when its wall time is not after the start (overnight session).
  const endDate = s.end && s.start && s.end <= s.start ? addDays(s.date, 1) : s.date;
  const end = resolve(endDate, s.end, tz, s.endPick);
  [start, end].forEach((r) => r.error && errors.push(r.error));
  const onDay = (time: string) => (s.start && time < s.start ? addDays(s.date, 1) : s.date);
  const breaks = s.breaks.map((b) => {
    const bs = resolve(onDay(b.start), b.start, tz, b.startPick);
    const be = resolve(onDay(b.end), b.end, tz, b.endPick);
    [bs, be].forEach((r) => r.error && errors.push(r.error));
    if (!b.start) errors.push(t('Indique la hora de inicio de cada pausa.'));
    return { start: bs.instant ?? '', end: be.instant, kind: b.kind };
  });
  return { values: { start: start.instant, end: end.instant, breaks: breaks.filter((b) => b.start), worksiteId: s.worksiteId || null, mode: s.mode }, errors };
}

export function ValuesEditor({ state, onChange, tz, employee, worksites, allowRemote, disabledDate }: { state: EditorState; onChange: (s: EditorState) => void; tz: string; employee: Employee; worksites: Worksite[]; allowRemote: boolean; disabledDate?: boolean }) {
  const set = (patch: Partial<EditorState>) => onChange({ ...state, ...patch });
  const endDate = state.end && state.start && state.end <= state.start ? addDays(state.date, 1) : state.date;
  const startR = useMemo(() => resolve(state.date, state.start, tz, state.startPick), [state.date, state.start, tz, state.startPick]);
  const endR = useMemo(() => resolve(endDate, state.end, tz, state.endPick), [endDate, state.end, tz, state.endPick]);
  const allowedSites = worksites.filter((w) => employee.worksiteIds.includes(w.id));

  return (
    <div className="stack">
      <div className="grid-3">
        <Field label={t('Fecha de la jornada')} required htmlFor="ve-date">
          <input id="ve-date" type="date" className="input" value={state.date} disabled={disabledDate} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label={t('Entrada (hora local)')} required htmlFor="ve-start" error={startR.error ?? undefined} hint={startR.instant ? formatOffset(startR.instant, tz) : undefined}>
          <input id="ve-start" type="time" className="input" value={state.start} onChange={(e) => set({ start: e.target.value, startPick: 0 })} />
        </Field>
        <Field label={t('Salida (hora local)')} required htmlFor="ve-end" error={endR.error ?? undefined} hint={endR.instant ? `${formatOffset(endR.instant, tz)}${endDate !== state.date ? ` · ${t('día siguiente')}` : ''}` : undefined}>
          <input id="ve-end" type="time" className="input" value={state.end} onChange={(e) => set({ end: e.target.value, endPick: 0 })} />
        </Field>
      </div>
      <AmbiguityChooser r={startR} label={t('La hora de entrada se repite por el cambio de hora. ¿Cuál es?')} pick={state.startPick} onPick={(p) => set({ startPick: p })} tz={tz} />
      <AmbiguityChooser r={endR} label={t('La hora de salida se repite por el cambio de hora. ¿Cuál es?')} pick={state.endPick} onPick={(p) => set({ endPick: p })} tz={tz} />

      <div className="grid-2">
        <SelectField label={t('Centro de trabajo')} value={state.worksiteId} onChange={(e) => set({ worksiteId: e.target.value })}>
          {allowedSites.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('Modalidad')} value={state.mode} onChange={(e) => set({ mode: e.target.value as WorkMode })}>
          <option value="onsite">{t(MODE_LABEL.onsite)}</option>
          {(allowRemote || state.mode === 'remote') && <option value="remote">{t(MODE_LABEL.remote)}</option>}
        </SelectField>
      </div>

      <div className="stack-sm">
        <div className="row between">
          <span className="strong">{t('Pausas')}</span>
          <Button size="sm" icon={Plus} onClick={() => set({ breaks: [...state.breaks, { start: '', end: '', kind: 'rest', startPick: 0, endPick: 0 }] })}>
            {t('Añadir pausa')}
          </Button>
        </div>
        {state.breaks.length === 0 && <div className="tiny muted">{t('Sin pausas. No se descuenta ninguna pausa automáticamente.')}</div>}
        {state.breaks.map((b, i) => (
          <div key={i} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('Inicio de pausa {n}', { n: i + 1 })} htmlFor={`ve-bs-${i}`}>
              <input id={`ve-bs-${i}`} type="time" className="input" value={b.start} onChange={(e) => set({ breaks: state.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value, startPick: 0 } : x)) })} />
            </Field>
            <Field label={t('Fin de pausa {n}', { n: i + 1 })} htmlFor={`ve-be-${i}`}>
              <input id={`ve-be-${i}`} type="time" className="input" value={b.end} onChange={(e) => set({ breaks: state.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value, endPick: 0 } : x)) })} />
            </Field>
            <Field label={t('Tipo')} htmlFor={`ve-bk-${i}`}>
              <select id={`ve-bk-${i}`} className="select" value={b.kind} onChange={(e) => set({ breaks: state.breaks.map((x, j) => (j === i ? { ...x, kind: e.target.value as BreakKind } : x)) })}>
                {(Object.keys(BREAK_KIND_LABEL) as BreakKind[]).map((k) => (
                  <option key={k} value={k}>
                    {t(BREAK_KIND_LABEL[k])}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="ghost" iconOnly icon={Trash2} aria-label={t('Quitar pausa {n}', { n: i + 1 })} onClick={() => set({ breaks: state.breaks.filter((_, j) => j !== i) })} />
          </div>
        ))}
      </div>
      <div className="tiny muted">{t('Zona horaria del centro: {tz}. Las horas se guardan como instantes inequívocos.', { tz })}</div>
    </div>
  );
}

function AmbiguityChooser({ r, label, pick, onPick, tz }: { r: Resolved; label: string; pick: number; onPick: (p: number) => void; tz: string }) {
  if (!r.options) return null;
  return (
    <fieldset className="callout warning" style={{ margin: 0 }}>
      <legend className="strong">{label}</legend>
      <div className="row" style={{ gap: 16 }}>
        {r.options.map((o, i) => (
          <label key={o} className="row" style={{ gap: 6 }}>
            <input type="radio" checked={pick === i} onChange={() => onPick(i)} />
            {i === 0 ? t('Primera vez (horario de verano, {off})', { off: formatOffset(o, tz) }) : t('Segunda vez (horario de invierno, {off})', { off: formatOffset(o, tz) })}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Small hook to keep editor state with a reset when the source changes. */
export function useEditorState(initial: () => EditorState, deps: unknown[]) {
  const [state, setState] = useState<EditorState>(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setState(initial()), deps);
  return [state, setState] as const;
}
