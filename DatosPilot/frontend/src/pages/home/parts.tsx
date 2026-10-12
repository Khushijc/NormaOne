/** Small building blocks shared by the Inicio and Mis tareas screens. */
import {
  BookOpenCheck,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  FileSearch,
  FileText,
  GraduationCap,
  Handshake,
  HardHat,
  Inbox,
  ListChecks,
  Lock,
  RefreshCcw,
  ShieldAlert,
  Stethoscope,
  TriangleAlert,
  Upload,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { KindDate, type DateKind } from '../../components/bits';
import { Card, EmptyState } from '../../components/ui';
import { formatDate } from '../../domain/time';
import { t, tKey } from '../../i18n';
import { canSeeHealth } from '../../services/context';
import { myTasks, openCount, visibleExceptions, type Task } from '../../services/opsService';
import type { UiCtx } from '../../store/hooks';

export function Kpi({ label, value, meta, to, tone, icon: Icon }: { label: string; value: ReactNode; meta?: ReactNode; to: string | null; tone?: 'danger' | 'warning'; icon?: LucideIcon }) {
  const cls = `kpi ${tone ? `tone-${tone}` : ''}`;
  const body = (
    <>
      <span className="label">
        {Icon && <Icon size={14} aria-hidden />}
        {label}
      </span>
      <span className="value">{value}</span>
      {meta && <span className="meta">{meta}</span>}
    </>
  );
  return to ? (
    <Link className={cls} to={to}>
      {body}
    </Link>
  ) : (
    <div className={`${cls} home-kpi-static`}>{body}</div>
  );
}

export type TaskKind = Task['kind'];

export const TASK_KIND: Record<TaskKind, { label: string; icon: LucideIcon; group: 'own' | 'review' }> = {
  acknowledge: { label: tKey('Confirmar información recibida'), icon: BookOpenCheck, group: 'own' },
  submit: { label: tKey('Aportar evidencia'), icon: Upload, group: 'own' },
  resubmit: { label: tKey('Evidencia rechazada'), icon: RefreshCcw, group: 'own' },
  ppe_ack: { label: tKey('Confirmar recepción de equipos'), icon: HardHat, group: 'own' },
  training: { label: tKey('Formación pendiente'), icon: GraduationCap, group: 'own' },
  action_owner: { label: tKey('Acciones preventivas a su cargo'), icon: ClipboardList, group: 'own' },
  review_document: { label: tKey('Documentos por revisar'), icon: FileSearch, group: 'review' },
  approve_requirement: { label: tKey('Requisitos pendientes de aprobación'), icon: ClipboardCheck, group: 'review' },
  review_action: { label: tKey('Resoluciones de acciones por revisar'), icon: ListChecks, group: 'review' },
  review_change: { label: tKey('Cambios de puesto o centro por revisar'), icon: UserCog, group: 'review' },
  review_assessment: { label: tKey('Evaluaciones de riesgos por revisar'), icon: TriangleAlert, group: 'review' },
  cae_followup: { label: tKey('Seguimiento de coordinación CAE'), icon: Handshake, group: 'review' },
  health: { label: tKey('Área de salud'), icon: Stethoscope, group: 'review' },
  quarantine: { label: tKey('Documentos en cuarentena'), icon: Lock, group: 'review' },
};

export const TASK_ORDER: TaskKind[] = ['acknowledge', 'ppe_ack', 'submit', 'resubmit', 'training', 'action_owner', 'review_document', 'approve_requirement', 'review_action', 'review_change', 'review_assessment', 'cae_followup', 'health', 'quarantine'];

/** Which kind of date a task's due date is (never mixed up: see BUILD brief rule 6). */
const DUE_KIND: Partial<Record<TaskKind, DateKind>> = {
  submit: 'internal',
  action_owner: 'target',
  review_action: 'target',
  review_assessment: 'assessment',
  cae_followup: 'internal',
};

export function TaskDue({ task, today }: { task: Task; today: string }) {
  if (!task.due) return <span className="muted small">{t('Sin fecha')}</span>;
  const kind = DUE_KIND[task.kind];
  if (kind) return <KindDate kind={kind} date={task.due} today={today} />;
  return (
    <span className="nowrap small" title={t('Fecha prevista')}>
      <span className="sr-only">{t('Fecha prevista')}: </span>
      {formatDate(task.due)}
    </span>
  );
}

export const DUE_LABEL: Partial<Record<TaskKind, string>> = {
  submit: tKey('Seguimiento interno'),
  action_owner: tKey('Fecha objetivo'),
  review_action: tKey('Fecha objetivo'),
  review_assessment: tKey('Revisión fijada por el evaluador'),
  cae_followup: tKey('Próximo seguimiento'),
  training: tKey('Fecha prevista'),
};

/** "Who must act next": the caller's own task inbox, summarised. */
export function TasksSummary({ ctx, limit = 5 }: { ctx: UiCtx; limit?: number }) {
  const tasks = myTasks(ctx);
  const sorted = [...tasks].sort((a, b) => TASK_ORDER.indexOf(a.kind) - TASK_ORDER.indexOf(b.kind) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  return (
    <Card
      title={
        <h2 className="row">
          <Inbox size={16} aria-hidden /> {t('Mis tareas')} <span className="tag">{tasks.length}</span>
        </h2>
      }
      actions={<Link to="/mis-tareas" className="btn ghost sm">{t('Ver todas')}</Link>}
      flush
    >
      {tasks.length === 0 ? (
        <EmptyState icon={Inbox} title={t('No tiene tareas pendientes')}>
          {t('Cuando le asignen una revisión, una confirmación o una evidencia, aparecerá aquí.')}
        </EmptyState>
      ) : (
        <ul className="home-list">
          {sorted.slice(0, limit).map((task) => {
            const meta = TASK_KIND[task.kind];
            const Icon = meta.icon;
            return (
              <li key={task.id}>
                <Icon size={15} aria-hidden className="home-list-icon" />
                <div className="grow home-min0">
                  <Link to={task.link} className="strong">{t(task.title)}</Link>
                  <div className="tiny muted home-ellipsis">{t(task.detail)}</div>
                </div>
                {task.due && <TaskDue task={task} today={ctx.today} />}
              </li>
            );
          })}
        </ul>
      )}
      {tasks.length > limit && (
        <div className="home-more tiny muted">{t('Y {n} más en «Mis tareas».', { n: tasks.length - limit })}</div>
      )}
    </Card>
  );
}

/** Health-area summary: counts only, never names or clinical information. */
export function HealthSummary({ ctx }: { ctx: UiCtx }) {
  if (!canSeeHealth(ctx)) return null;
  const restricted = visibleExceptions(ctx).filter((e) => e.restricted);
  const pending = openCount(restricted.filter((e) => e.type === 'health_pending'));
  const quarantine = ctx.can('health.manage') ? openCount(restricted.filter((e) => e.type === 'quarantine')) : null;
  return (
    <Card
      className="home-health"
      title={
        <h2 className="row">
          <Stethoscope size={16} aria-hidden /> {t('Área de salud (restringida)')}
        </h2>
      }
      actions={<Link to="/salud" className="btn sm">{t('Abrir el área de salud')}</Link>}
    >
      <div className="stack-sm">
        <div className="home-health-grid">
          <Link to="/salud?tab=conclusiones" className="home-health-figure">
            <span className="value">{pending}</span>
            <span className="small">{t('Ofertas, conclusiones o medidas pendientes')}</span>
          </Link>
          {quarantine !== null && (
            <Link to="/salud?tab=cuarentena" className="home-health-figure">
              <span className={`value ${quarantine ? 'home-danger' : ''}`}>{quarantine}</span>
              <span className="small">{t('Documentos en cuarentena')}</span>
            </Link>
          )}
        </div>
        <p className="tiny muted">
          <ShieldAlert size={12} aria-hidden style={{ verticalAlign: -2, marginRight: 4 }} />
          {t('Solo recuentos. Las conclusiones de aptitud se consultan en el área restringida; el portal no almacena informes clínicos.')}
        </p>
      </div>
    </Card>
  );
}

/** Shortcuts, shown only when the caller holds the permission for the target action. */
export function QuickActions({ ctx, reviewable }: { ctx: UiCtx; reviewable: number }) {
  const links: { to: string; label: string; icon: LucideIcon; meta?: string }[] = [];
  if (ctx.can('requirements.draft')) links.push({ to: '/requisitos?nuevo=1', label: tKey('Añadir un requisito'), icon: ClipboardCheck });
  if (ctx.can('evidence.request') || ctx.can('evidence.upload')) links.push({ to: '/documentacion?nuevo=1', label: tKey('Solicitar o asignar evidencia'), icon: FilePlus2 });
  else if (ctx.can('own.submit')) links.push({ to: '/documentacion?nuevo=1', label: tKey('Aportar documentación'), icon: Upload });
  if (ctx.can('evidence.review')) links.push({ to: '/documentacion?revision=1', label: tKey('Revisar un documento'), icon: FileText, meta: reviewable ? t('{n} esperan su decisión', { n: reviewable }) : t('Nada pendiente de su decisión') });
  if (!links.length) return null;
  return (
    <nav className="home-quick" aria-label={t('Acciones rápidas')}>
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="home-quick-link">
          <l.icon size={16} aria-hidden />
          <span className="grow">
            <span className="strong">{t(l.label)}</span>
            {l.meta && <span className="tiny muted home-block">{l.meta}</span>}
          </span>
        </Link>
      ))}
    </nav>
  );
}
