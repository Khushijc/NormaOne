/**
 * Presentation helpers shared by the correction screens (list, form, detail).
 * Pure UI: every business action still goes through services/correctionService.
 */
import { Building2, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DurationText, TimeText } from '../../components/bits';
import { Badge, Button, Modal, TextAreaField } from '../../components/ui';
import { computeDurations } from '../../domain/records';
import { BREAK_KIND_LABEL, MODE_LABEL } from '../../domain/status';
import { localDate } from '../../domain/time';
import type { BreakKind, CorrectionRequest, Database, ID, SessionValues } from '../../domain/types';
import { t, tKey } from '../../i18n';

// ─────────────────────────────── Value comparison ───────────────────────────────

export type FieldKey = 'start' | 'end' | 'breaks' | 'worksite' | 'mode';

const sameInstant = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null) || (!!a && !!b && Date.parse(a) === Date.parse(b));

function sameBreaks(a: SessionValues['breaks'], b: SessionValues['breaks']): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x.start.localeCompare(y.start));
  const sb = [...b].sort((x, y) => x.start.localeCompare(y.start));
  return sa.every((x, i) => sameInstant(x.start, sb[i].start) && sameInstant(x.end, sb[i].end) && x.kind === sb[i].kind);
}

/** Fields of `b` that differ from `a` (all fields when `a` is missing). */
export function diffFields(a: SessionValues | null | undefined, b: SessionValues | null | undefined): Set<FieldKey> {
  const out = new Set<FieldKey>();
  if (!b) return out;
  if (!a) return new Set<FieldKey>(['start', 'end', 'breaks', 'worksite', 'mode']);
  if (!sameInstant(a.start, b.start)) out.add('start');
  if (!sameInstant(a.end, b.end)) out.add('end');
  if (!sameBreaks(a.breaks, b.breaks)) out.add('breaks');
  if ((a.worksiteId ?? null) !== (b.worksiteId ?? null)) out.add('worksite');
  if (a.mode !== b.mode) out.add('mode');
  return out;
}

export function sameValues(a: SessionValues | null | undefined, b: SessionValues | null | undefined): boolean {
  return !!a && !!b && diffFields(a, b).size === 0;
}

export function worksiteNamer(db: Database) {
  return (id: ID | null | undefined) => (id ? db.worksites.find((w) => w.id === id)?.name ?? '—' : '—');
}

// ─────────────────────────────── Labels ───────────────────────────────

export const HISTORY_ACTION_LABEL: Record<string, string> = {
  requested: tKey('Solicitud registrada'),
  proposed: tKey('Propuesta de la empresa'),
  approved: tKey('Aprobada por el revisor'),
  rejected: tKey('Rechazada por el revisor'),
  employee_agreed: tKey('Conformidad del empleado'),
  employee_disagreed: tKey('Discrepancia del empleado'),
  applied_with_disagreement: tKey('Aplicada con discrepancia registrada'),
  withdrawn: tKey('Retirada'),
};

/** "Empleado" / "Empresa" badge, with the on-behalf case made explicit. */
export function InitiatedBadge({ c, onBehalf, compact }: { c: CorrectionRequest; onBehalf?: boolean; compact?: boolean }) {
  if (compact && onBehalf && c.initiatedBy === 'employee') {
    return (
      <span className="stack-sm" style={{ gap: 2 }}>
        <InitiatedBadge c={c} />
        <span className="tiny muted nowrap">{t('vía RR. HH.')}</span>
      </span>
    );
  }
  if (c.initiatedBy === 'company') {
    return (
      <Badge tone="accent" icon={Building2} title={t('Propuesta por la empresa: requiere la conformidad del empleado o deja constancia de su discrepancia.')}>
        {t('Empresa')}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon={UserRound} title={onBehalf ? t('Registrada por RR. HH. a petición del empleado (sin acceso a la aplicación).') : t('Solicitada por el propio empleado.')}>
      {onBehalf ? t('Empleado (vía RR. HH.)') : t('Empleado')}
    </Badge>
  );
}

/** Compact "08:00–15:34 · 1 pausa" summary with unambiguous time tooltips. */
export function SpanSummary({ values, tz }: { values: SessionValues | null | undefined; tz: string }) {
  if (!values || !values.start) return <span className="muted">—</span>;
  const base = localDate(values.start, tz);
  const n = values.breaks.length;
  return (
    <span className="nowrap">
      <TimeText at={values.start} tz={tz} baseDate={base} />–{values.end ? <TimeText at={values.end} tz={tz} baseDate={base} /> : <span className="muted">{t('sin salida')}</span>}
      {n > 0 && <span className="tiny muted"> · {n === 1 ? t('1 pausa') : t('{n} pausas', { n })}</span>}
    </span>
  );
}

// ─────────────────────────────── Values with per-field highlighting ───────────────────────────────

/**
 * Field-by-field view of one set of session values. Fields that differ from `compareTo` are
 * highlighted (colour + text marker, never colour alone).
 */
export function ValuesFields({
  values,
  tz,
  compareTo,
  changedLabel,
  secondCompare,
  secondLabel,
  worksiteName,
  paidBreakKinds,
  empty,
}: {
  values: SessionValues | null;
  tz: string;
  compareTo?: SessionValues | null;
  changedLabel?: string;
  secondCompare?: SessionValues | null;
  secondLabel?: string;
  worksiteName: (id: ID | null) => string;
  paidBreakKinds: BreakKind[];
  empty: ReactNode;
}) {
  if (!values) return <div className="muted small">{empty}</div>;
  const changed = compareTo !== undefined ? diffFields(compareTo, values) : new Set<FieldKey>();
  const changed2 = secondCompare ? diffFields(secondCompare, values) : new Set<FieldKey>();
  const base = values.start ? localDate(values.start, tz) : undefined;
  const d = computeDurations(values, paidBreakKinds);
  const row = (key: FieldKey | null, label: string, content: ReactNode) => {
    const hit = key !== null && changed.has(key);
    const hit2 = key !== null && changed2.has(key);
    return (
      <div className={`corr-field ${hit ? 'is-changed' : ''} ${hit2 ? 'is-adjusted' : ''}`}>
        <dt>{label}</dt>
        <dd>
          {content}
          {hit && <span className="corr-mark">{changedLabel ?? t('modificado')}</span>}
          {hit2 && secondLabel && <span className="corr-mark adjusted">{secondLabel}</span>}
        </dd>
      </div>
    );
  };
  return (
    <dl className="corr-fields">
      {row('start', t('Entrada'), <TimeText at={values.start} tz={tz} baseDate={base} />)}
      {row('end', t('Salida'), values.end ? <TimeText at={values.end} tz={tz} baseDate={base} /> : <Badge tone="danger">{t('Sin salida')}</Badge>)}
      {row(
        'breaks',
        t('Pausas'),
        values.breaks.length === 0 ? (
          <span className="muted">{t('Sin pausas registradas')}</span>
        ) : (
          <span className="stack-sm" style={{ gap: 2 }}>
            {values.breaks.map((b, i) => (
              <span key={i} className="nowrap">
                {t(BREAK_KIND_LABEL[b.kind])}: <TimeText at={b.start} tz={tz} baseDate={base} />–<TimeText at={b.end} tz={tz} baseDate={base} />
              </span>
            ))}
          </span>
        ),
      )}
      {row('worksite', t('Centro'), worksiteName(values.worksiteId))}
      {row('mode', t('Modalidad'), t(MODE_LABEL[values.mode]))}
      {row(null, t('Duración bruta'), <DurationText minutes={values.end ? d.grossMinutes : null} />)}
    </dl>
  );
}

// ─────────────────────────────── Note / reason dialog ───────────────────────────────

/**
 * Confirmation with a note. `minLength` 0 makes the note optional; otherwise it is mandatory and
 * the counter and inline error explain the minimum (the service re-checks it).
 */
export function NoteDialog({
  title,
  message,
  label,
  minLength = 0,
  confirmLabel,
  danger,
  hint,
  placeholder,
  initialNote = '',
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message?: ReactNode;
  label: string;
  minLength?: number;
  confirmLabel: string;
  danger?: boolean;
  hint?: string;
  placeholder?: string;
  initialNote?: string;
  onConfirm: (note: string) => Promise<boolean>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const len = note.trim().length;
  const short = minLength > 0 && len < minLength;
  const submit = async () => {
    setTried(true);
    if (short || busy) return;
    setBusy(true);
    try {
      const ok = await onConfirm(note.trim());
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };
  const counter = minLength > 0 ? t('{n} caracteres (mínimo {min})', { n: len, min: minLength }) : t('{n} caracteres', { n: len });
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('Cancelar')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={submit} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <div>{message}</div>}
        {children}
        <TextAreaField
          label={label}
          required={minLength > 0}
          value={note}
          rows={4}
          placeholder={placeholder}
          onChange={(e) => setNote(e.target.value)}
          error={tried && short ? t('Escriba al menos {min} caracteres.', { min: minLength }) : undefined}
          hint={hint ? `${hint} · ${counter}` : counter}
        />
      </div>
    </Modal>
  );
}
