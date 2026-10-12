/**
 * Shared pieces of the restricted health area: labels, small badges and the per-employee history
 * dialog. Nothing here may be imported by screens outside `/salud`.
 */
import { FileLock2 } from 'lucide-react';
import { useState } from 'react';
import { latestVersion } from '../../domain/requirements';
import { FITNESS_LABEL, type Tone } from '../../domain/status';
import { formatDate } from '../../domain/time';
import type { HealthConclusion, HealthOffer, ID } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { employeeName, userName } from '../../services/context';
import { healthRows, openClinicalAttachment } from '../../services/healthService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { Badge, Button, Callout, DateText, DateTimeText, EmptyState, Modal, StatusBadge, useToast } from '../../components/ui';
import { PermissionError } from '../../domain/permissions';

export type HealthRow = ReturnType<typeof healthRows>[number];

export const BASIS_LABEL: Record<HealthOffer['basis'], string> = {
  voluntary: tKey('Voluntaria'),
  mandatory_exception: tKey('Obligatoria (excepción del art. 22.1 LPRL)'),
};

export const BASIS_HELP: Record<HealthOffer['basis'], string> = {
  voluntary: tKey('Oferta que la persona trabajadora puede aceptar o no. No aceptarla no es un incumplimiento.'),
  mandatory_exception: tKey('Reconocimiento obligatorio por una excepción del art. 22.1 LPRL confirmada profesionalmente, con informe previo de la representación.'),
};

export const RESPONSE_META: Record<HealthOffer['response'], { label: string; tone: Tone; help: string }> = {
  pending: { label: tKey('Pendiente de respuesta'), tone: 'warning', help: tKey('La persona trabajadora todavía no ha respondido a la oferta.') },
  accepted: { label: tKey('Aceptada'), tone: 'success', help: tKey('La persona trabajadora aceptó la oferta; queda pendiente la conclusión del servicio médico.') },
  declined: { label: tKey('No aceptada (no es un incumplimiento)'), tone: 'neutral', help: tKey('La vigilancia de la salud es voluntaria salvo excepción del art. 22.1 LPRL: no aceptarla no es un incumplimiento.') },
};

export function BasisBadge({ basis }: { basis: HealthOffer['basis'] }) {
  return (
    <Badge tone={basis === 'voluntary' ? 'neutral' : 'accent'} icon={false} title={t(BASIS_HELP[basis])}>
      {t(BASIS_LABEL[basis])}
    </Badge>
  );
}

export function ResponseBadge({ response }: { response: HealthOffer['response'] }) {
  const meta = RESPONSE_META[response];
  return <StatusBadge meta={meta} />;
}

export const FitnessBadge = ({ c }: { c: HealthConclusion['conclusion'] }) => <StatusBadge meta={FITNESS_LABEL[c]} />;

/** Code and name of the requirement an offer refers to (or a dash). */
export function requirementLabel(ctx: UiCtx, templateId: ID | null): string {
  if (!templateId) return t('Sin requisito vinculado');
  const tpl = ctx.db.templates.find((x) => x.id === templateId);
  const v = latestVersion(ctx.db, templateId);
  return tpl ? `${tpl.code} · ${v?.name ?? ''}` : '—';
}

/** Button that asks the service for the external clinical-record reference (denied + audited for non-medical roles). */
export function ClinicalReferenceButton({ employeeId }: { employeeId: ID }) {
  const ctx = useCtx();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const medical = ctx.can('health.manage');
  const open = async () => {
    setPending(true);
    try {
      setReference(await openClinicalAttachment(employeeId));
    } catch (e) {
      // A denial is expected for non-medical roles: say clearly that the attempt was audited.
      if (e instanceof PermissionError) toast.warning(t('Referencia clínica no disponible para su rol'), [t('El intento de acceso ha quedado registrado en la auditoría restringida. Solo el personal sanitario puede consultar dónde se custodia la historia clínico-laboral.')]);
      else toast.error(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={FileLock2}
        loading={pending}
        onClick={open}
        title={medical ? t('Muestra la referencia externa; el informe clínico no está en el portal.') : t('Solo el personal sanitario puede consultarla. Un intento desde otro rol se deniega y queda registrado.')}
        aria-label={t('Referencia del expediente clínico de {name}', { name: employeeName(ctx.db, employeeId) })}
      >
        {t('Referencia del expediente clínico')}
      </Button>
      {reference !== null && (
        <Modal
          title={t('Referencia del expediente clínico')}
          description={employeeName(ctx.db, employeeId)}
          onClose={() => setReference(null)}
          footer={<Button onClick={() => setReference(null)}>{t('Cerrar')}</Button>}
        >
          <Callout tone="info" title={t('El informe clínico no está en el portal')}>
            {t('La historia clínico-laboral la custodia el servicio médico. Use esta referencia para localizarla en su sistema. La consulta ha quedado registrada en la auditoría restringida.')}
          </Callout>
          <p className="health-reference">{reference}</p>
        </Modal>
      )}
    </>
  );
}

/** All offers and conclusions (current and superseded) of one employee. */
export function HealthHistoryModal({ row, onClose }: { row: HealthRow; onClose: () => void }) {
  const ctx = useCtx();
  return (
    <Modal wide title={t('Historial de vigilancia de la salud')} description={employeeName(ctx.db, row.employee.id)} onClose={onClose} footer={<Button onClick={onClose}>{t('Cerrar')}</Button>}>
      <section className="stack-sm" aria-labelledby="hh-conc">
        <h3 id="hh-conc" className="health-h3">{t('Conclusiones de aptitud')}</h3>
        {row.conclusions.length === 0 ? (
          <EmptyState title={t('Sin conclusiones registradas')} />
        ) : (
          <ol className="timeline">
            {row.conclusions.map((c) => (
              <li key={c.id}>
                <div className="row-wrap between">
                  <span className="row-wrap">
                    <FitnessBadge c={c.conclusion} />
                    {c.status === 'current' ? <Badge tone="info" icon={false}>{t('Conclusión vigente')}</Badge> : <Badge tone="neutral" icon={false}>{t('Conclusión sustituida')}</Badge>}
                  </span>
                  <span className="tiny muted nowrap">
                    <DateText date={c.conclusionDate} />
                  </span>
                </div>
                <div className="small">{t('Ámbito')}: {c.scope}</div>
                <div className="small">
                  {t('Medidas operativas')}: {c.measures || <span className="muted">{t('Sin medidas indicadas')}</span>}
                </div>
                <div className="tiny muted">
                  {t('Próxima revisión')}: {c.nextReviewDate ? <DateText date={c.nextReviewDate} /> : t('No indicada por el servicio médico')}
                  {' · '}
                  {t('Registrada por {name}', { name: userName(ctx.db, c.recordedBy) })}
                </div>
                {c.measuresConfirmedAt && (
                  <div className="tiny muted">
                    {t('Medidas aplicadas, confirmadas por {name}', { name: userName(ctx.db, c.measuresConfirmedBy) })} · <DateTimeText at={c.measuresConfirmedAt} tz={ctx.company.timezone} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="stack-sm" aria-labelledby="hh-off">
        <h3 id="hh-off" className="health-h3">{t('Ofertas y respuestas')}</h3>
        {row.offers.length === 0 ? (
          <EmptyState title={t('Sin ofertas registradas')} />
        ) : (
          <ol className="timeline">
            {row.offers.map((o) => (
              <li key={o.id}>
                <div className="row-wrap between">
                  <span className="row-wrap">
                    <BasisBadge basis={o.basis} />
                    <ResponseBadge response={o.response} />
                  </span>
                  <span className="tiny muted nowrap">
                    <DateText date={o.offeredAt} />
                  </span>
                </div>
                <div className="tiny muted">
                  {requirementLabel(ctx, o.templateId)} · {t('Ofrecida por {name}', { name: userName(ctx.db, o.offeredBy) })}
                  {o.respondedAt && (
                    <>
                      {' · '}
                      {t('Respuesta del {date}', { date: formatDate(o.respondedAt) })}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Modal>
  );
}
