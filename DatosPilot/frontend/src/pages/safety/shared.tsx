/**
 * Small helpers shared by the safety screens (EPI, risk assessments, preventive actions).
 * Pure presentation: every business action goes through the services.
 */
import { CalendarClock } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Badge, Callout } from '../../components/ui';
import { isMembershipActive } from '../../domain/permissions';
import { formatDate } from '../../domain/time';
import type { ActionNote, ID, PreventiveAction, ReviewRule } from '../../domain/types';
import { t, tKey } from '../../i18n';
import type { Ctx } from '../../services/context';

export type ActionSourceKind = PreventiveAction['source']['kind'];

/** Where a preventive action comes from (labels for the source kind). */
export const ACTION_SOURCE_LABEL: Record<ActionSourceKind, string> = {
  requirement_gap: tKey('Requisito sin evidencia'),
  review_finding: tKey('Hallazgo de una revisión'),
  risk_assessment: tKey('Evaluación de riesgos'),
  cae: tKey('Coordinación CAE'),
  provider_review: tKey('Visita o informe del servicio de prevención'),
  incident: tKey('Incidente o daño a la salud'),
  other: tKey('Otro origen'),
};
export const ACTION_SOURCE_KINDS = Object.keys(ACTION_SOURCE_LABEL) as ActionSourceKind[];

export const NOTE_KIND_LABEL: Record<ActionNote['kind'], string> = {
  created: tKey('Acción creada'),
  assigned: tKey('Responsable asignado'),
  progress: tKey('Avance registrado'),
  submitted: tKey('Enviada a revisión'),
  accepted: tKey('Resolución aceptada'),
  rejected: tKey('Resolución rechazada'),
  reopened: tKey('Acción reabierta'),
};

/** Unresolved action whose real target date has passed (no invented deadline). */
export function isOverdue(a: PreventiveAction, today: string): boolean {
  return !!a.targetDate && a.targetDate < today && a.status !== 'resolved';
}

/** Users with an active membership in the active company (candidate owners). */
export function companyUsers(ctx: Ctx): { id: ID; name: string }[] {
  const ids = new Set(ctx.db.memberships.filter((m) => m.companyId === ctx.company.id && isMembershipActive(m, ctx.today)).map((m) => m.userId));
  return ctx.db.users.filter((u) => ids.has(u.id)).map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Inspection / replacement schedule of a catalogue item, shown only as configured. */
export function PpeSchedule({ rule }: { rule: ReviewRule }) {
  if (rule.kind === 'interval' && rule.months) {
    return (
      <span className="stack-sm" style={{ gap: 0 }}>
        <span>{t('Cada {n} meses', { n: rule.months })}</span>
        <span className="tiny muted">{t('Fuente: {source}', { source: rule.setBy ?? '—' })}</span>
      </span>
    );
  }
  if (rule.kind === 'per_document') {
    return (
      <span className="stack-sm" style={{ gap: 0 }}>
        <span>{t('Según el folleto informativo del fabricante')}</span>
        {rule.setBy && <span className="tiny muted">{rule.setBy}</span>}
      </span>
    );
  }
  if (rule.kind === 'not_determined') return <Badge tone="warning">{t('Pendiente de que lo determine un profesional')}</Badge>;
  return <span className="muted small">{t('Sin calendario configurado')}</span>;
}

/** Scheduled review / replacement of one issue (only when it was set). */
export function ScheduledDate({ date, today }: { date: string | null; today: string }) {
  if (!date) return <span className="muted small">{t('No establecida')}</span>;
  const overdue = date < today;
  return (
    <span className="nowrap">
      <CalendarClock size={12} aria-hidden style={{ verticalAlign: -1, marginRight: 4, color: overdue ? 'var(--danger)' : 'var(--text-3)' }} />
      <span style={overdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{formatDate(date)}</span>
      {overdue && <span className="sr-only"> ({t('vencida [revisión programada]')})</span>}
    </span>
  );
}

/** Validation messages (Spanish service text, translated on display). */
export function ErrorList({ errors, title }: { errors: string[]; title?: string }) {
  if (!errors.length) return null;
  return (
    <Callout tone="danger" title={title ?? t('Revise los datos antes de continuar')}>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{t(e)}</li>
        ))}
      </ul>
    </Callout>
  );
}

/** Accessible multi-select as a scrollable list of checkboxes inside a fieldset. */
export function MultiCheck({ legend, options, value, onChange, hint, emptyText }: { legend: string; options: { id: string; label: ReactNode }[]; value: string[]; onChange: (v: string[]) => void; hint?: ReactNode; emptyText?: string }) {
  const hintId = useId();
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((x) => x !== id));
  return (
    <fieldset className="sf-multicheck" aria-describedby={hint ? hintId : undefined}>
      <legend>
        {legend}
        {value.length > 0 && <span className="tiny muted"> · {t('{n} seleccionados', { n: value.length })}</span>}
      </legend>
      {options.length === 0 ? (
        <p className="small muted">{emptyText ?? t('No hay opciones disponibles.')}</p>
      ) : (
        <div className="sf-multicheck-list">
          {options.map((o) => (
            <label key={o.id} className="checkbox">
              <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
      {hint && (
        <p id={hintId} className="tiny muted" style={{ margin: '6px 0 0' }}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}

/** Clickable KPI tile that toggles a list filter. */
export function KpiButton({ label, value, meta, tone, pressed, onClick }: { label: string; value: number; meta?: string; tone?: 'danger' | 'warning'; pressed?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`kpi ${tone ? `tone-${tone}` : ''} ${pressed ? 'sf-kpi-on' : ''}`} aria-pressed={onClick ? !!pressed : undefined} onClick={onClick}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {meta && <span className="meta">{meta}</span>}
    </button>
  );
}

/** Comma-separated names, or a muted dash. */
export function NameList({ names }: { names: string[] }) {
  if (!names.length) return <span className="muted">—</span>;
  return <span>{names.join(', ')}</span>;
}
