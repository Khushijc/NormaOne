/**
 * Cambios tab: requirement delta reviews opened by role / worksite changes (PRL-02). Completing a
 * review is recorded with a note and can request the evidence of the newly required items.
 */
import { ArrowRight, GitCompareArrows } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../domain/time';
import type { AssignmentChange, Employee } from '../../domain/types';
import { t } from '../../i18n';
import { roleName, userName, worksiteName } from '../../services/context';
import { changesFor, reviewChange } from '../../services/peopleService';
import { useCtx } from '../../store/hooks';
import { Badge, Button, Callout, Card, Checkbox, DateTimeText, EmptyState, Modal, TextAreaField, useAction } from '../../components/ui';
import { DeltaView } from './AssignmentTab';
import { CHANGE_STATUS, departmentName, TRIGGER_LABEL } from './peopleData';

export function ChangesTab({ emp }: { emp: Employee }) {
  const ctx = useCtx();
  const [reviewing, setReviewing] = useState<AssignmentChange | null>(null);
  const changes = changesFor(ctx, emp.id);
  const canReview = ctx.can('changes.review');
  const shape = (s: AssignmentChange['before']) => (
    <div className="stack-sm" style={{ gap: 2 }}>
      <span className="small strong">{roleName(ctx.db, s.jobRoleId)}</span>
      <span className="tiny muted">{departmentName(ctx.db, s.departmentId)}</span>
      <span className="tiny">{s.worksiteIds.map((w) => worksiteName(ctx.db, w)).join(', ') || '—'}</span>
    </div>
  );

  if (!changes.length) {
    return (
      <Card>
        <EmptyState icon={GitCompareArrows} title={t('Sin revisiones de cambios')}>
          {t('Cada cambio de puesto o de centros, o un cambio en los riesgos de un centro asignado, abre aquí una revisión de requisitos.')}
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="stack">
      {changes.map((c) => {
        const st = CHANGE_STATUS[c.status];
        const sameShape = c.trigger !== 'employee_change';
        return (
          <Card
            key={c.id}
            title={
              <div className="stack-sm" style={{ gap: 4 }}>
                <h2>{t(TRIGGER_LABEL[c.trigger])}</h2>
                <div className="row-wrap">
                  <Badge tone={st.tone}>{t(st.label)}</Badge>
                  <span className="tiny muted">{t('Con efecto {date}', { date: formatDate(c.effectiveFrom) })}</span>
                </div>
              </div>
            }
            actions={
              canReview && c.status === 'pending_review' ? (
                <Button size="sm" variant="primary" onClick={() => setReviewing(c)}>
                  {t('Completar revisión')}
                </Button>
              ) : undefined
            }
          >
            <div className="stack">
              {sameShape ? (
                <p className="small">{t('Asignación sin cambios; han cambiado los requisitos del centro.')}</p>
              ) : (
                <div className="before-after">
                  <div>
                    <div className="tiny muted">{t('Antes')}</div>
                    {shape(c.before)}
                  </div>
                  <ArrowRight size={16} aria-hidden className="ba-arrow" />
                  <div>
                    <div className="tiny muted">{t('Después')}</div>
                    {shape(c.after)}
                  </div>
                </div>
              )}
              <div className="small">
                <span className="muted">{t('Motivo')}:</span> {c.reason}
              </div>
              {c.focusWorksiteIds.length > 0 && c.status === 'pending_review' && (
                <p className="tiny muted">{t('La disponibilidad en {sites} queda pendiente de evaluación hasta completar la revisión.', { sites: c.focusWorksiteIds.map((w) => worksiteName(ctx.db, w)).join(', ') })}</p>
              )}
              <DeltaView delta={c.delta} ctx={ctx} employeeId={emp.id} compact />
              <div className="tiny muted">
                {t('Registrado por {user}', { user: userName(ctx.db, c.createdBy) })} · <DateTimeText at={c.createdAt} />
              </div>
              {c.status === 'reviewed' && (
                <Callout tone="success" title={t('Revisión completada')}>
                  <div className="small">{c.reviewNote}</div>
                  <div className="tiny muted">
                    {userName(ctx.db, c.reviewedBy)} · <DateTimeText at={c.reviewedAt} />
                  </div>
                </Callout>
              )}
            </div>
          </Card>
        );
      })}
      {reviewing && <ReviewModal change={reviewing} emp={emp} onClose={() => setReviewing(null)} />}
    </div>
  );
}

function ReviewModal({ change, emp, onClose }: { change: AssignmentChange; emp: Employee; onClose: () => void }) {
  const { run, pending } = useAction();
  const [note, setNote] = useState('');
  const [requestNew, setRequestNew] = useState(change.delta.newlyRequired.length > 0);
  const [touched, setTouched] = useState(false);
  const submit = async () => {
    setTouched(true);
    if (!note.trim()) return;
    const ok = await run(() => reviewChange(change.id, note, requestNew), t('Revisión completada y registrada'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('Completar revisión')}
      description={`${emp.firstName} ${emp.lastName} · ${t(TRIGGER_LABEL[change.trigger])}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Completar revisión')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="small">
          {t('{n} requisitos nuevos · {c} críticos sin resolver · {x} ya no aplicables', { n: change.delta.newlyRequired.length, c: change.delta.newCriticalUnresolved.length, x: change.delta.noLongerApplicable.length })}
        </p>
        <TextAreaField label={t('Nota de revisión')} required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={touched && !note.trim() ? t('Obligatorio.') : undefined} />
        <Checkbox
          label={t('Solicitar la evidencia de los requisitos nuevos')}
          hint={t('Crea solicitudes para los requisitos nuevos de documento o formación sin evidencia y sin solicitud abierta.')}
          checked={requestNew}
          onChange={setRequestNew}
          disabled={!change.delta.newlyRequired.length}
        />
        <p className="tiny muted">{t('Las evidencias aceptadas no relacionadas no se invalidan.')}</p>
      </div>
    </Modal>
  );
}
