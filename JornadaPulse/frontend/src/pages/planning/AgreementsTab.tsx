/**
 * "Convenios colectivos": references only (research P1–P5). The content of the agreements is
 * not loaded; rules are configured as policies after the payroll adviser's review.
 */
import { BookOpen, ExternalLink, PenLine } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Callout, Card, DateText, EmptyState, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import type { CollectiveAgreementReference } from '../../domain/types';
import { t } from '../../i18n';
import { updateAgreementReview } from '../../services/planningService';
import { useCtx } from '../../store/hooks';
import { REVIEW_STATUS } from './shared';

const STATUSES: CollectiveAgreementReference['reviewStatus'][] = ['reference_only', 'pending_review', 'adviser_reviewed'];

export function AgreementsTab() {
  const ctx = useCtx();
  const canManage = ctx.can('policies.manage');
  const [editing, setEditing] = useState<CollectiveAgreementReference | null>(null);
  const agreements = ctx.db.agreements.filter((a) => a.companyId === ctx.company.id).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const policiesFor = (id: string) => [...new Set(ctx.db.policies.filter((p) => p.companyId === ctx.company.id && p.agreementId === id).map((p) => p.name))];

  return (
    <div className="stack">
      <Callout tone="warning" title={t('Solo referencias: el contenido de los convenios no está cargado')}>
        <p>{t('JornadaPulse no lee ni interpreta los convenios. Las reglas que se deriven de ellos (pausas retribuidas, jornada diaria, trabajo nocturno, saldos de ausencias) se configuran como políticas después de la revisión de la asesoría laboral. Puntos pendientes de revisión profesional:')}</p>
        <ul>
          <li>{t('Convenio aplicable a cada empresa y colectivo.')}</li>
          <li>{t('Si la pausa de 15 minutos es retribuida.')}</li>
          <li>{t('Clasificación del trabajo nocturno y sus complementos.')}</li>
          <li>{t('Horas extraordinarias frente a horas complementarias en contratos a tiempo parcial (ET art. 12.5).')}</li>
          <li>{t('Saldos de ausencias: días naturales o laborables y arrastre.')}</li>
        </ul>
      </Callout>

      <Card flush title={t('Convenios colectivos de referencia')}>
        {agreements.length === 0 ? (
          <EmptyState icon={BookOpen} title={t('No hay convenios de referencia registrados')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('Convenio')}</th>
                  <th scope="col">{t('Ámbito')}</th>
                  <th scope="col">{t('Estado de revisión')}</th>
                  <th scope="col">{t('Revisado por')}</th>
                  <th scope="col">{t('Fecha de revisión')}</th>
                  <th scope="col">{t('Fuente')}</th>
                  <th scope="col">{t('Nota')}</th>
                  <th scope="col">{t('Políticas vinculadas')}</th>
                  {canManage && <th scope="col"><span className="sr-only">{t('Acciones')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {agreements.map((a) => {
                  const st = REVIEW_STATUS[a.reviewStatus];
                  const pols = policiesFor(a.id);
                  return (
                    <tr key={a.id}>
                      <td className="plan-wide-text">
                        <div className="strong">{a.name}</div>
                        <div className="tiny muted">{a.code ? t('Código {code}', { code: a.code }) : t('Código de convenio no indicado')}</div>
                      </td>
                      <td className="small">{a.scope}</td>
                      <td><Badge tone={st.tone} title={t(st.help)}>{t(st.label)}</Badge></td>
                      <td className="small">{a.reviewedBy ?? <span className="muted">—</span>}</td>
                      <td><DateText date={a.reviewedAt} /></td>
                      <td>
                        {a.sourceUrl ? (
                          <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="nowrap">
                            {t('REGCON')} <ExternalLink size={12} aria-hidden />
                            <span className="sr-only"> {t('(se abre en otra pestaña)')}</span>
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="small plan-wide-text">{a.note || <span className="muted">—</span>}</td>
                      <td className="small">{pols.length ? pols.join(', ') : <span className="muted">{t('Ninguna')}</span>}</td>
                      {canManage && (
                        <td>
                          <Button size="sm" icon={PenLine} onClick={() => setEditing(a)} aria-label={t('Actualizar revisión de {name}', { name: a.name })}>
                            {t('Actualizar revisión')}
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <ReviewModal agreement={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReviewModal({ agreement, onClose }: { agreement: CollectiveAgreementReference; onClose: () => void }) {
  const { run, pending } = useAction();
  const [status, setStatus] = useState(agreement.reviewStatus);
  const [reviewedBy, setReviewedBy] = useState(agreement.reviewedBy ?? '');
  const [note, setNote] = useState(agreement.note);
  const [touched, setTouched] = useState(false);
  const missingReviewer = status === 'adviser_reviewed' && !reviewedBy.trim();

  const submit = async () => {
    setTouched(true);
    if (missingReviewer) return;
    const r = await run(() => updateAgreementReview(agreement.id, status, reviewedBy, note), t('Estado de revisión del convenio actualizado.'));
    if (r) onClose();
  };

  return (
    <Modal
      title={t('Actualizar revisión del convenio')}
      description={agreement.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('Guardar')}</Button>
        </>
      }
    >
      <div className="stack">
        <SelectField label={t('Estado de revisión')} required value={status} onChange={(e) => setStatus(e.target.value as CollectiveAgreementReference['reviewStatus'])} hint={t(REVIEW_STATUS[status].help)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(REVIEW_STATUS[s].label)}</option>
          ))}
        </SelectField>
        <TextField
          label={t('Revisado por')}
          required={status === 'adviser_reviewed'}
          value={reviewedBy}
          onChange={(e) => setReviewedBy(e.target.value)}
          error={touched && missingReviewer ? t('Indique quién ha revisado el convenio.') : undefined}
          hint={t('Persona y asesoría que han revisado el convenio.')}
        />
        <TextAreaField label={t('Nota')} rows={3} value={note} onChange={(e) => setNote(e.target.value)} hint={t('Si la deja vacía se mantiene la nota actual.')} />
        <Callout tone="neutral">{t('Marcar el convenio como revisado solo registra quién lo revisó y cuándo. No carga su contenido, no cambia ninguna política y no certifica el cumplimiento.')}</Callout>
      </div>
    </Modal>
  );
}
