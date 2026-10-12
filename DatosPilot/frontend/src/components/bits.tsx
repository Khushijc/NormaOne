/**
 * Small shared pieces for DatosPilot screens: message rendering, status badges, entity links,
 * date labels (legal expiry / provider review / internal follow-up are always labelled), and the
 * readiness legend used by charts.
 */
import { AlertOctagon, CalendarClock, CheckCircle2, Clock, FileQuestion, Hourglass, Lock, ShieldCheck, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ACCESS_CLASS, DOC_STATUS, ITEM_STATUS, READINESS, type ItemStatus } from '../domain/status';
import { formatDate } from '../domain/time';
import type { AccessClass, DocStatus, ID, Msg, ReadinessState } from '../domain/types';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { employeeName, worksiteName } from '../services/context';
import { Badge, StatusBadge } from './ui';
import type { StackSegment } from './charts';

/** Renders a domain message (Spanish source + params) in the interface language. String params are translated too. */
export function msg(m: Msg | null | undefined): string {
  if (!m) return '';
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(m.params ?? {})) params[k] = typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? t(v) : typeof v === 'string' ? formatDate(v) : v;
  return t(m.text, params);
}

/**
 * Stored audit text (summary, reason, change values): translated whole, or part by part for
 * comma-separated lists such as risk labels; stored ISO dates are shown in the local format.
 */
export function auditText(s: string | null | undefined): string {
  if (!s) return '';
  let out = t(s);
  if (out === s && s.includes(', ')) out = s.split(', ').map((p) => t(p)).join(', ');
  return out.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => formatDate(d));
}

/** Export/report scope is stored in Spanish as "Centro: X · Estado: Y"; translate each part for display. */
export function scopeLabel(scope: string): string {
  return scope ? scope.split(' · ').map((p) => t(p)).join(' · ') : '';
}

const READINESS_ICON: Record<ReadinessState, typeof CheckCircle2> = {
  ready: ShieldCheck,
  in_review: Clock,
  incomplete: FileQuestion,
  professional_review: Stethoscope,
  pending_evaluation: Hourglass,
  blocked: AlertOctagon,
};

export function ReadinessBadge({ state }: { state: ReadinessState }) {
  const meta = READINESS[state];
  return (
    <Badge tone={meta.tone} icon={READINESS_ICON[state]} title={t(meta.help)}>
      {t(meta.label)}
    </Badge>
  );
}

export const ItemStatusBadge = ({ status }: { status: ItemStatus }) => <StatusBadge meta={ITEM_STATUS[status]} />;
export const DocStatusBadge = ({ status }: { status: DocStatus }) => <StatusBadge meta={DOC_STATUS[status]} />;
export const AccessBadge = ({ cls }: { cls: AccessClass }) => (cls === 'ordinary' ? null : <Badge tone={ACCESS_CLASS[cls].tone} icon={Lock} title={t(ACCESS_CLASS[cls].help)}>{t(ACCESS_CLASS[cls].label)}</Badge>);

/** Chart segments for readiness, in the validated palette order. */
export const READINESS_SEGMENTS: (StackSegment & { key: ReadinessState })[] = [
  { key: 'ready', label: READINESS.ready.label, color: 'var(--st-ready)' },
  { key: 'in_review', label: READINESS.in_review.label, color: 'var(--st-review)' },
  { key: 'incomplete', label: READINESS.incomplete.label, color: 'var(--st-incomplete)' },
  { key: 'professional_review', label: READINESS.professional_review.label, color: 'var(--st-professional)' },
  { key: 'pending_evaluation', label: READINESS.pending_evaluation.label, color: 'var(--st-pending)' },
  { key: 'blocked', label: READINESS.blocked.label, color: 'var(--st-blocked)' },
];

export function EmployeeLink({ id }: { id: ID | null | undefined }) {
  const ctx = useCtx();
  if (!id) return <span className="muted">—</span>;
  return <Link to={`/empleados/${id}`}>{employeeName(ctx.db, id)}</Link>;
}

export function WorksiteLink({ id }: { id: ID | null | undefined }) {
  const ctx = useCtx();
  if (!id) return <span className="muted">—</span>;
  return ctx.can('worksites.view') || ctx.can('team.view') ? <Link to={`/centros/${id}`}>{worksiteName(ctx.db, id)}</Link> : <span>{worksiteName(ctx.db, id)}</span>;
}

export type DateKind = 'legal' | 'provider' | 'internal' | 'target' | 'assessment';

const DATE_KIND: Record<DateKind, string> = {
  legal: 'Caducidad legal',
  provider: 'Revisión del proveedor',
  internal: 'Seguimiento interno',
  target: 'Fecha objetivo',
  assessment: 'Revisión fijada por el evaluador',
};

/**
 * A date with its kind. A missing date is shown as such (never replaced by an invented one):
 * "Sin caducidad" for documents whose issuer states none, otherwise "No establecida".
 */
export function KindDate({ kind, date, noExpiry, today }: { kind: DateKind; date: string | null | undefined; noExpiry?: boolean; today?: string }) {
  if (!date) return <span className="muted small">{kind === 'legal' && noExpiry ? t('Sin caducidad') : t('No establecida')}</span>;
  const overdue = !!today && date < today;
  return (
    <span className="nowrap" title={t(DATE_KIND[kind])}>
      <CalendarClock size={12} aria-hidden style={{ verticalAlign: -1, marginRight: 4, color: overdue ? 'var(--danger)' : 'var(--text-3)' }} />
      <span className="sr-only">{t(DATE_KIND[kind])}: </span>
      <span style={overdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{formatDate(date)}</span>
    </span>
  );
}

/** Standard reminder that evidence readiness is not a professional safety approval. */
export function ReadinessDisclaimer() {
  return <p className="readiness-note">{t('La disponibilidad indica que la evidencia configurada está aceptada. No es una aprobación profesional de seguridad ni certifica el cumplimiento legal.')}</p>;
}

export function RestrictedNote({ children }: { children?: string }) {
  return (
    <span className="restricted-tag">
      <Lock size={12} aria-hidden />
      {children ?? t('Detalle restringido')}
    </span>
  );
}
