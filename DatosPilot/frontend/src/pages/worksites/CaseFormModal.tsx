/**
 * New CAE case (createCase, with participants) or edit of an existing one (updateCase).
 * The own company is prefilled as a participant; at least one other organisation is required.
 */
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Callout, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { CAE_ROLE_LABEL } from '../../domain/status';
import type { CaeCase, CaeParticipant, CaeRole, ID } from '../../domain/types';
import { t } from '../../i18n';
import { createCase, updateCase, type CaseInput } from '../../services/caeService';
import { visibleWorksiteIds } from '../../services/context';
import { getDb } from '../../store/db';
import { useCtx } from '../../store/hooks';
import { stored } from '../../components/localizedForm';
import { followUpUsers, isSpecialistTag } from './worksiteShared';

type DraftParticipant = Omit<CaeParticipant, 'id'>;

const ROLES = Object.keys(CAE_ROLE_LABEL) as CaeRole[];

export function CaseFormModal({ kase, initialWorksiteId, onClose, onSaved }: { kase: CaeCase | null; initialWorksiteId?: ID; onClose: () => void; onSaved: (c: CaeCase) => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const sites = visibleWorksiteIds(ctx);
  const worksites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && sites.has(w.id) && (w.active || w.id === kase?.worksiteId));
  const owners = followUpUsers(ctx);

  const customerParticipant = (wsId: ID): DraftParticipant | null => {
    const ws = ctx.db.worksites.find((w) => w.id === wsId);
    const cus = ws?.customerId ? ctx.db.customers.find((c) => c.id === ws.customerId) : null;
    return cus ? { organisation: cus.name, role: 'titular', contactName: cus.contactName, contactEmail: cus.contactEmail, isOwnCompany: false } : null;
  };

  const startWs = kase?.worksiteId ?? (initialWorksiteId && worksites.some((w) => w.id === initialWorksiteId) ? initialWorksiteId : '');
  const startSite = !kase && startWs ? ctx.db.worksites.find((w) => w.id === startWs) : undefined;
  const [form, setForm] = useState<CaseInput>(() =>
    kase
      ? { worksiteId: kase.worksiteId, title: kase.title, activities: kase.activities, risksSummary: kase.risksSummary, coordinationMeans: kase.coordinationMeans, followUpOwnerId: kase.followUpOwnerId, nextFollowUp: kase.nextFollowUp, openQuestions: kase.openQuestions }
      : { worksiteId: startWs, title: startSite ? 'Coordinación en ' + startSite.name : '', activities: startSite?.activities ?? '', risksSummary: '', coordinationMeans: '', followUpOwnerId: ctx.user.id && owners.some((u) => u.id === ctx.user.id) ? ctx.user.id : null, nextFollowUp: null, openQuestions: '' },
  );
  const [participants, setParticipants] = useState<DraftParticipant[]>(() => {
    const own: DraftParticipant = { organisation: ctx.company.legalName, role: 'contratista', contactName: ctx.user.name, contactEmail: ctx.user.email, isOwnCompany: true };
    const cus = startWs ? customerParticipant(startWs) : null;
    return cus ? [own, cus] : [own, { organisation: '', role: 'titular', contactName: '', contactEmail: '', isOwnCompany: false }];
  });
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof CaseInput>(k: K, v: CaseInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setP = (i: number, patch: Partial<DraftParticipant>) => setParticipants((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const onWorksite = (id: ID) => {
    set('worksiteId', id);
    if (kase) return;
    const ws = ctx.db.worksites.find((w) => w.id === id);
    if (ws && !form.title.trim()) set('title', 'Coordinación en ' + ws.name);
    if (ws && !form.activities.trim()) set('activities', ws.activities);
    const cus = customerParticipant(id);
    // Prefill the site holder only when the second row is still empty.
    if (cus && participants.length >= 2 && !participants[1].organisation.trim() && !participants[1].contactName.trim()) setP(1, cus);
  };

  const site = ctx.db.worksites.find((w) => w.id === form.worksiteId);
  const specialist = !!site && site.riskTags.some((x) => isSpecialistTag(ctx, x));

  const errors: Record<string, string> = {};
  if (!form.worksiteId) errors.worksiteId = t('Obligatorio.');
  if (!form.title.trim()) errors.title = t('Obligatorio.');
  if (form.nextFollowUp && form.nextFollowUp < ctx.today) errors.nextFollowUp = t('No puede estar en el pasado.');
  if (form.nextFollowUp && !form.followUpOwnerId) errors.followUpOwnerId = t('Indique quién hace el seguimiento.');
  if (specialist) errors.worksiteId = t('Centro con riesgos de alcance especializado: la CAE específica queda fuera del alcance inicial.');
  if (!kase) {
    if (!participants.some((p) => !p.isOwnCompany)) errors.participants = t('Añada al menos otra empresa participante.');
    participants.forEach((p, i) => {
      if (!p.organisation.trim()) errors[`org${i}`] = t('Obligatorio.');
      if (!p.contactName.trim()) errors[`contact${i}`] = t('Obligatorio.');
    });
  }
  const valid = Object.keys(errors).length === 0;
  const err = (k: string) => (touched ? errors[k] : undefined);

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    // The form shows translated texts; unchanged ones are saved back as the stored Spanish.
    const raw = kase ? getDb().caeCases.find((c) => c.id === kase.id) : null;
    const input: CaseInput = { ...form, title: stored(form.title.trim(), raw?.title), activities: stored(form.activities.trim(), raw?.activities), risksSummary: stored(form.risksSummary.trim(), raw?.risksSummary), coordinationMeans: stored(form.coordinationMeans.trim(), raw?.coordinationMeans), openQuestions: stored(form.openQuestions.trim(), raw?.openQuestions), nextFollowUp: form.nextFollowUp || null };
    const r = kase
      ? await run(() => updateCase(kase.id, input), t('Caso actualizado'))
      : await run(() => createCase(input, participants.map((p) => ({ ...p, organisation: p.organisation.trim(), contactName: p.contactName.trim(), contactEmail: p.contactEmail.trim() }))), (c) => t('Caso {code} creado', { code: c.code }));
    if (r) onSaved(r);
  };

  return (
    <Modal
      wide
      title={kase ? t('Editar caso {code}', { code: kase.code }) : t('Nuevo caso de coordinación CAE')}
      description={t('Un caso CAE registra la coordinación con las demás empresas del centro: participantes, información intercambiada y seguimiento.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {kase ? t('Guardar cambios') : t('Crear caso')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <SelectField label={t('Centro de trabajo')} required value={form.worksiteId} onChange={(e) => onWorksite(e.target.value)} disabled={!!kase} error={err('worksiteId')} hint={kase ? t('El centro de un caso no se cambia.') : undefined}>
            <option value="">{t('Seleccione…')}</option>
            {worksites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t('Título')} required value={form.title} onChange={(e) => set('title', e.target.value)} error={err('title')} className="span-2" />
          <TextAreaField label={t('Actividades concurrentes')} value={form.activities} onChange={(e) => set('activities', e.target.value)} rows={2} className="span-all" />
          <TextAreaField label={t('Resumen de riesgos que se coordinan')} hint={t('Riesgos del titular, de nuestra actividad y de las empresas concurrentes.')} value={form.risksSummary} onChange={(e) => set('risksSummary', e.target.value)} rows={2} className="span-all" />
          <TextAreaField label={t('Medios de coordinación')} hint={t('Por ejemplo: intercambio de información por escrito, instrucciones del titular, reuniones.')} value={form.coordinationMeans} onChange={(e) => set('coordinationMeans', e.target.value)} rows={2} className="span-all" />
          <SelectField label={t('Responsable del seguimiento')} value={form.followUpOwnerId ?? ''} onChange={(e) => set('followUpOwnerId', e.target.value || null)} error={err('followUpOwnerId')}>
            <option value="">{t('Sin asignar')}</option>
            {owners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t('Próximo seguimiento')} type="date" min={ctx.today} value={form.nextFollowUp ?? ''} onChange={(e) => set('nextFollowUp', e.target.value || null)} error={err('nextFollowUp')} hint={t('Fecha interna de seguimiento, no un plazo legal.')} />
          <TextAreaField label={t('Preguntas abiertas e información pendiente')} value={form.openQuestions} onChange={(e) => set('openQuestions', e.target.value)} rows={2} className="span-all" />
        </div>

        {!kase && (
          <fieldset>
            <legend className="small strong">{t('Empresas participantes')}</legend>
            <div className="stack">
              {participants.map((p, i) => (
                <div key={i} className="cae-participant-row">
                  <TextField label={t('Organización')} required value={p.organisation} onChange={(e) => setP(i, { organisation: e.target.value })} error={err(`org${i}`)} disabled={p.isOwnCompany} />
                  <SelectField label={t('Papel')} value={p.role} onChange={(e) => setP(i, { role: e.target.value as CaeRole })}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(CAE_ROLE_LABEL[r])}
                      </option>
                    ))}
                  </SelectField>
                  <TextField label={t('Persona de contacto')} required value={p.contactName} onChange={(e) => setP(i, { contactName: e.target.value })} error={err(`contact${i}`)} />
                  <TextField label={t('Correo de contacto')} type="email" value={p.contactEmail} onChange={(e) => setP(i, { contactEmail: e.target.value })} />
                  <div className="cae-participant-actions">
                    {p.isOwnCompany ? (
                      <Badge tone="neutral">{t('Propia empresa')}</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" iconOnly icon={Trash2} aria-label={t('Quitar participante {n}', { n: i + 1 })} onClick={() => setParticipants((ps) => ps.filter((_, j) => j !== i))} />
                    )}
                  </div>
                </div>
              ))}
              {err('participants') && (
                <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
                  {err('participants')}
                </p>
              )}
              <div>
                <Button size="sm" icon={Plus} onClick={() => setParticipants((ps) => [...ps, { organisation: '', role: 'concurrente', contactName: '', contactEmail: '', isOwnCompany: false }])}>
                  {t('Añadir participante')}
                </Button>
              </div>
            </div>
          </fieldset>
        )}

        {specialist && (
          <Callout tone="warning" title={t('Fuera del alcance inicial')}>
            {t('La CAE específica de obras de construcción (RD 1627/1997) y de otros riesgos especializados queda fuera del alcance inicial del producto.')}
          </Callout>
        )}
      </div>
    </Modal>
  );
}
