/**
 * Small helpers shared by the worksite and CAE screens (local to this page folder).
 * Pure read helpers over the context; every mutation goes through the services.
 */
import { AlertOctagon, Clock, FileQuestion, Hourglass, ShieldCheck, Stethoscope, type LucideIcon } from 'lucide-react';
import { Badge, StatusBadge } from '../../components/ui';
import { isMembershipActive } from '../../domain/permissions';
import { versionOn } from '../../domain/requirements';
import { READINESS, READINESS_ORDER, type StatusMeta, type Tone } from '../../domain/status';
import type { CaeCase, CaeParticipant, ID, ReadinessState, RequirementTemplate, RequirementVersion, RoleId, User, Worksite } from '../../domain/types';
import { t, tKey } from '../../i18n';
import type { Ctx } from '../../services/context';
import type { casePending } from '../../services/caeService';

const READINESS_ICON: Record<ReadinessState, LucideIcon> = {
  ready: ShieldCheck,
  in_review: Clock,
  incomplete: FileQuestion,
  professional_review: Stethoscope,
  pending_evaluation: Hourglass,
  blocked: AlertOctagon,
};

/** Compact readiness counts (icon + number, full label as tooltip and for screen readers). */
export function ReadinessCounts({ counts, empty }: { counts: Record<string, number>; empty?: string }) {
  const states = READINESS_ORDER.filter((s) => (counts[s] ?? 0) > 0);
  if (!states.length) return <span className="muted small">{empty ?? t('Sin personas asignadas')}</span>;
  return (
    <span className="readiness-mini">
      {states.map((s) => (
        <Badge key={s} tone={READINESS[s].tone} icon={READINESS_ICON[s]} title={t(READINESS[s].label)}>
          <span className="sr-only">{t(READINESS[s].label)}: </span>
          {counts[s]}
        </Badge>
      ))}
    </span>
  );
}

/** Readiness counts with full labels (detail pages): one row per state that has people. */
export function ReadinessBreakdown({ counts }: { counts: Record<string, number> }) {
  const states = READINESS_ORDER.filter((s) => (counts[s] ?? 0) > 0);
  if (!states.length) return <span className="muted small">{t('Sin personas asignadas')}</span>;
  return (
    <ul className="readiness-breakdown" aria-label={t('Disponibilidad por estado')}>
      {states.map((s) => (
        <li key={s}>
          <Badge tone={READINESS[s].tone} icon={READINESS_ICON[s]} title={t(READINESS[s].help)}>
            {t(READINESS[s].label)}
          </Badge>
          <span className="strong">{counts[s]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Legend for the compact counts (icons explained once, with text). */
export function ReadinessLegend() {
  return (
    <div className="readiness-legend" aria-label={t('Leyenda de disponibilidad')}>
      {[...READINESS_ORDER].reverse().map((s) => {
        const Icon = READINESS_ICON[s];
        return (
          <span key={s} className="tiny">
            <Icon size={12} aria-hidden /> {t(READINESS[s].label)}
          </span>
        );
      })}
    </div>
  );
}

// ─────────────────────────────── Worksites ───────────────────────────────

export function riskLabel(ctx: Ctx, id: string): string {
  return ctx.db.riskTags.find((r) => r.id === id && r.companyId === ctx.company.id)?.label ?? id;
}

export function isSpecialistTag(ctx: Ctx, id: string): boolean {
  return !!ctx.db.riskTags.find((r) => r.id === id && r.companyId === ctx.company.id)?.specialist;
}

export function RiskTags({ ctx, tags }: { ctx: Ctx; tags: string[] }) {
  if (!tags.length) return <span className="muted small">{t('Sin riesgos específicos registrados')}</span>;
  return (
    <span className="ws-tags">
      {tags.map((id) => (
        <span key={id} className={`ws-tag ${isSpecialistTag(ctx, id) ? 'specialist' : ''}`}>
          {riskLabel(ctx, id)}
        </span>
      ))}
    </span>
  );
}

export function customerName(ctx: Ctx, id: ID | null): string {
  return (id && ctx.db.customers.find((c) => c.id === id && c.companyId === ctx.company.id)?.name) || '—';
}

export interface SiteTemplateRow {
  template: RequirementTemplate;
  version: RequirementVersion;
  via: string[];
}

/** Current requirement versions whose scope (or an explicit assignment) targets this worksite. */
export function siteTemplates(ctx: Ctx, ws: Worksite): SiteTemplateRow[] {
  const out: SiteTemplateRow[] = [];
  for (const tpl of ctx.db.templates) {
    if (tpl.companyId !== ctx.company.id || tpl.retiredAt) continue;
    const v = versionOn(ctx.db, tpl.id, ctx.today);
    if (!v || v.requirementType === 'not_applicable') continue;
    const via: string[] = [];
    if (v.scope.worksiteIds.includes(ws.id)) via.push(tKey('Ámbito del centro'));
    const tags = v.scope.riskTags.filter((x) => ws.riskTags.includes(x));
    if (tags.length) via.push(tKey('Riesgo del centro'));
    if (v.perWorksite && !v.scope.worksiteIds.length && !v.scope.riskTags.length) via.push(tKey('Requisito por centro'));
    const assigned = ctx.db.requirementAssignments.some((a) => a.companyId === ctx.company.id && a.templateId === tpl.id && a.target.kind === 'worksite' && a.target.id === ws.id && a.effectiveFrom <= ctx.today && (!a.effectiveTo || a.effectiveTo >= ctx.today));
    if (assigned) via.push(tKey('Asignado al centro'));
    if (via.length) out.push({ template: tpl, version: v, via });
  }
  return out.sort((a, b) => a.template.code.localeCompare(b.template.code));
}

// ─────────────────────────────── CAE ───────────────────────────────

export const CASE_STATUS: Record<CaeCase['status'], StatusMeta> = {
  open: { label: tKey('Abierto'), tone: 'warning', help: tKey('Caso creado; todavía sin intercambios registrados.') },
  active: { label: tKey('En curso'), tone: 'info', help: tKey('Coordinación en marcha con intercambios registrados.') },
  closed: { label: tKey('Cerrado'), tone: 'neutral', help: tKey('Caso cerrado con motivo; los enlaces se revocaron y el historial se conserva.') },
};

export const CaseStatusBadge = ({ status }: { status: CaeCase['status'] }) => <StatusBadge meta={CASE_STATUS[status]} />;

export function participantOf(c: CaeCase, id: ID | null | undefined): CaeParticipant | undefined {
  return c.participants.find((p) => p.id === id);
}

export function participantName(c: CaeCase, id: ID | null | undefined): string {
  return participantOf(c, id)?.organisation ?? '—';
}

type Pending = ReturnType<typeof casePending>;

/** Open coordination points of a case as labelled items (count + text, never colour alone). */
export function pendingItems(p: Pending): { key: string; text: string; tone: Tone }[] {
  const out: { key: string; text: string; tone: Tone }[] = [];
  if (p.notSent) out.push({ key: 'notSent', text: t('{n} sin enviar', { n: p.notSent }), tone: 'warning' });
  if (p.noReceipt) out.push({ key: 'noReceipt', text: t('{n} sin confirmación de recepción', { n: p.noReceipt }), tone: 'warning' });
  if (p.noAck) out.push({ key: 'noAck', text: t('{n} sin acuse del destinatario', { n: p.noAck }), tone: 'info' });
  if (p.toReview) out.push({ key: 'toReview', text: t('{n} recibidos por revisar', { n: p.toReview }), tone: 'accent' });
  if (p.followUpOverdue) out.push({ key: 'followUp', text: t('Seguimiento vencido'), tone: 'danger' });
  return out;
}

export const pendingTotal = (p: Pending) => p.notSent + p.noReceipt + p.noAck + p.toReview + (p.followUpOverdue ? 1 : 0);

export function PendingBadges({ p }: { p: Pending }) {
  const items = pendingItems(p);
  if (!items.length) return <span className="muted small">{t('Sin puntos abiertos')}</span>;
  return (
    <span className="status-stack">
      {items.map((i) => (
        <Badge key={i.key} tone={i.tone}>
          {i.text}
        </Badge>
      ))}
    </span>
  );
}

const STAFF_ROLES: RoleId[] = ['owner', 'company_admin', 'prl_coordinator', 'supervisor'];

/** Company users who can own a CAE follow-up (active internal roles). */
export function followUpUsers(ctx: Ctx): User[] {
  const ids = new Set(ctx.db.memberships.filter((m) => m.companyId === ctx.company.id && isMembershipActive(m, ctx.today) && m.roles.some((r) => STAFF_ROLES.includes(r))).map((m) => m.userId));
  return ctx.db.users.filter((u) => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
