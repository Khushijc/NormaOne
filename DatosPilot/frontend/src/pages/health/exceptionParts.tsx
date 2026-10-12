/** Pieces of the exceptions queue: severity, target date, review history and the review dialog. */
import { AlertOctagon, AlertTriangle, ExternalLink, History, Info, MessageSquare, Minus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmployeeLink, KindDate, msg, WorksiteLink, type DateKind } from '../../components/bits';
import { Badge, Button, Callout, DateTimeText, KV, Modal, SelectField, StatusBadge, TextAreaField, useAction } from '../../components/ui';
import { EXCEPTION_TYPE_LABEL, type ExceptionType, type ExceptionView } from '../../domain/exceptions';
import { activeRoles, isMembershipActive, permissionsFor, ROLES } from '../../domain/permissions';
import { EXCEPTION_STATUS, type Tone } from '../../domain/status';
import type { ExceptionHistory, ID } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { userName } from '../../services/context';
import { ACTION_LABEL, canManageException, updateException, type ExceptionAction } from '../../services/opsService';
import { useCtx, type UiCtx } from '../../store/hooks';

export type Severity = ExceptionView['severity'];

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: tKey('Severidad alta'),
  medium: tKey('Severidad media'),
  low: tKey('Severidad baja'),
};
const SEVERITY_TONE: Record<Severity, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };
const SEVERITY_ICON = { high: AlertOctagon, medium: AlertTriangle, low: Minus };
export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export function SeverityBadge({ s }: { s: Severity }) {
  return (
    <Badge tone={SEVERITY_TONE[s]} icon={SEVERITY_ICON[s]} title={t('Severidad derivada de la regla: orienta el orden de revisión.')}>
      {t(SEVERITY_LABEL[s])}
    </Badge>
  );
}

/** Which kind of date each exception type carries (never mixed: legal expiry ≠ provider review ≠ internal follow-up). */
const DATE_KIND_BY_TYPE: Partial<Record<ExceptionType, DateKind>> = {
  expired_document: 'legal',
  expiring_document: 'legal',
  provider_review: 'provider',
  assessment_review: 'assessment',
  action_open: 'target',
  missing_evidence: 'internal',
  cae_pending: 'internal',
};

export function ExceptionTargetDate({ e }: { e: ExceptionView }) {
  const ctx = useCtx();
  if (!e.targetDate) return <span className="muted small nowrap">{t('Sin fecha establecida')}</span>;
  return <KindDate kind={DATE_KIND_BY_TYPE[e.type] ?? 'target'} date={e.targetDate} today={ctx.today} />;
}

export const lastReview = (e: ExceptionView): ExceptionHistory | null => {
  const h = e.review?.history ?? [];
  return h.length ? h[h.length - 1] : null;
};

/** Which review steps make sense from each status (the service re-checks resolved/reopen). */
function available(e: ExceptionView): ExceptionAction[] {
  if (e.status === 'resolved') return ['reopen'];
  const out: ExceptionAction[] = ['assign'];
  if (e.status === 'open' || e.status === 'reopened' || e.status === 'assigned') out.push('acknowledge');
  if (e.status !== 'investigating') out.push('investigate');
  out.push('resolve');
  return out;
}

const SUCCESS: Record<ExceptionAction, string> = {
  assign: tKey('Incidencia asignada'),
  acknowledge: tKey('Incidencia marcada como vista'),
  investigate: tKey('Incidencia en investigación'),
  resolve: tKey('Incidencia marcada como resuelta'),
  reopen: tKey('Incidencia reabierta'),
};

/** Active users of the company who may own the exception (restricted ones: health-authorised users only). */
function eligibleOwners(ctx: UiCtx, e: ExceptionView): { id: ID; label: string }[] {
  return ctx.db.memberships
    .filter((m) => m.companyId === ctx.company.id && isMembershipActive(m, ctx.today))
    .filter((m) => {
      if (!e.restricted) return true;
      const p = permissionsFor(m, ctx.today);
      return p.has('health.manage') || (e.type === 'health_pending' && p.has('health.view_conclusions'));
    })
    .map((m) => ({ id: m.userId, label: `${userName(ctx.db, m.userId)} · ${activeRoles(m, ctx.today).map((r) => t(ROLES[r].label)).join(', ')}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function ExceptionDetail({ e, onClose }: { e: ExceptionView; onClose: () => void }) {
  const ctx = useCtx();
  const manage = canManageException(ctx, e);
  const actions = available(e);
  const [action, setAction] = useState<ExceptionAction | null>(null);
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState<ID>(e.ownerUserId ?? '');
  const [touched, setTouched] = useState(false);
  const { runOk, pending } = useAction();
  const owners = useMemo(() => eligibleOwners(ctx, e), [ctx, e]);
  const history = [...(e.review?.history ?? [])].reverse();

  const noteError = !note.trim() ? t('Indique una nota: queda en el historial de la incidencia y en la auditoría.') : undefined;
  const ownerError = action === 'assign' && !owner ? t('Seleccione un responsable con acceso vigente.') : undefined;
  const reset = () => {
    setAction(null);
    setNote('');
    setTouched(false);
  };
  const submit = async () => {
    if (!action) return;
    setTouched(true);
    if (noteError || ownerError) return;
    const ok = await runOk(() => updateException(e.key, action, note, action === 'assign' ? owner : undefined), t(SUCCESS[action]));
    if (ok) reset();
  };

  return (
    <Modal wide title={t(EXCEPTION_TYPE_LABEL[e.type])} description={msg(e.source)} onClose={onClose} footer={<Button onClick={onClose}>{t('Cerrar')}</Button>}>
      <KV
        items={[
          [t('Estado'), <StatusBadge key="s" meta={EXCEPTION_STATUS[e.status]} />],
          [t('Severidad'), <SeverityBadge key="v" s={e.severity} />],
          ...(e.employeeId ? ([[t('Empleado'), <EmployeeLink key="e" id={e.employeeId} />]] as [string, ReactNode][]) : []),
          ...(e.worksiteId ? ([[t('Centro de trabajo'), <WorksiteLink key="w" id={e.worksiteId} />]] as [string, ReactNode][]) : []),
          [t('Requisito u origen'), msg(e.source)],
          [t('Motivo'), msg(e.reason)],
          [t('Responsable'), e.ownerUserId ? userName(ctx.db, e.ownerUserId) : t('Sin responsable')],
          [t('Fecha objetivo'), <ExceptionTargetDate key="d" e={e} />],
          [t('Siguiente paso'), msg(e.nextAction)],
          [
            t('Registro relacionado'),
            <Link key="l" to={e.link}>
              {t('Ir al registro')} <ExternalLink size={12} aria-hidden />
            </Link>,
          ],
        ]}
      />
      {e.status === 'resolved' && (
        <Callout tone="info" icon={Info} title={t('Resuelta, pero la causa sigue detectándose')}>
          {t('La incidencia se marcó como resuelta con una nota, pero la regla todavía detecta la causa. Se mantiene en la lista como «Resuelta» para que quede visible; desaparecerá cuando los datos cambien. Si el problema no está realmente resuelto, reábrala.')}
        </Callout>
      )}
      {e.restricted && (
        <Callout tone="neutral" title={t('Incidencia del área restringida')}>
          {t('Solo la ven los usuarios con acceso al área de salud. Gestione el detalle en «Aptitud y vigilancia de la salud».')}
        </Callout>
      )}

      <section aria-labelledby="exc-hist" className="stack-sm">
        <h3 id="exc-hist" className="health-h3 row">
          <History size={15} aria-hidden /> {t('Historial de revisión')}
        </h3>
        {history.length === 0 ? (
          <p className="small muted">{t('Detectada por las reglas; todavía no tiene pasos de revisión.')}</p>
        ) : (
          <ol className="timeline">
            {history.map((h, i) => (
              <li key={i}>
                <div className="row between" style={{ gap: 8 }}>
                  <StatusBadge meta={EXCEPTION_STATUS[h.status]} />
                  <span className="tiny muted nowrap">
                    <DateTimeText at={h.at} tz={ctx.company.timezone} />
                  </span>
                </div>
                <div className="tiny muted">{userName(ctx.db, h.by)}</div>
                {h.note && <div className="small">{h.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {manage ? (
        <section aria-labelledby="exc-act" className="stack-sm">
          <h3 id="exc-act" className="health-h3 row">
            <MessageSquare size={15} aria-hidden /> {t('Registrar un paso de revisión')}
          </h3>
          <div className="row-wrap" role="group" aria-label={t('Pasos de revisión disponibles')}>
            {actions.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={action === a ? 'primary' : 'secondary'}
                aria-pressed={action === a}
                onClick={() => {
                  setAction(a);
                  setTouched(false);
                }}
              >
                {t(ACTION_LABEL[a])}
              </Button>
            ))}
          </div>
          {action && (
            <div className="stack-sm exc-form">
              {action === 'assign' && (
                <SelectField label={t('Nuevo responsable')} required value={owner} onChange={(ev) => setOwner(ev.target.value)} error={touched ? ownerError : undefined} hint={e.restricted ? t('Solo personas con acceso al área de salud.') : t('Personas con acceso vigente a la empresa.')}>
                  <option value="">{t('Seleccione…')}</option>
                  {owners.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </SelectField>
              )}
              {action === 'resolve' && (
                <p className="small muted">{t('Resolver no corrige los datos: si la causa persiste, la incidencia seguirá en la lista como «Resuelta».')}</p>
              )}
              <TextAreaField label={t('Nota')} required rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} error={touched ? noteError : undefined} hint={t('Queda en el historial de la incidencia y en la auditoría.')} />
              <div className="row-wrap">
                <Button variant="primary" loading={pending} onClick={submit}>
                  {t(ACTION_LABEL[action])}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  {t('Cancelar')}
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <p className="small muted">{t('Su rol permite consultar esta incidencia, no gestionarla.')}</p>
      )}
    </Modal>
  );
}
