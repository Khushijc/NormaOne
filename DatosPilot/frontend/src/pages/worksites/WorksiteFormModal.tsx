/**
 * Create / edit a worksite (perm worksites.manage). A change of risks or activities requires a
 * reason; a change of risks opens requirement delta reviews for the assigned people (the
 * service returns how many). Specialist risk tags are outside the initial scope.
 */
import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Callout, Checkbox, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import type { Worksite } from '../../domain/types';
import { t } from '../../i18n';
import { employeeName } from '../../services/context';
import { employeesAt, saveWorksite, type WorksiteInput } from '../../services/peopleService';
import { getDb } from '../../store/db';
import { useCtx } from '../../store/hooks';
import { stored } from '../../components/localizedForm';

const EMPTY: WorksiteInput = {
  name: '',
  kind: 'customer',
  address: '',
  municipality: '',
  customerId: null,
  siteContactName: '',
  siteContactPhone: '',
  coordinatorEmployeeId: null,
  activities: '',
  riskTags: [],
  sharedWorkplace: false,
};

const sameTags = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

export function WorksiteFormModal({ worksite, onClose, onSaved }: { worksite: Worksite | null; onClose: () => void; onSaved: (w: Worksite) => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [form, setForm] = useState<WorksiteInput>(() =>
    worksite
      ? {
          name: worksite.name,
          kind: worksite.kind,
          address: worksite.address,
          municipality: worksite.municipality,
          customerId: worksite.customerId,
          siteContactName: worksite.siteContactName,
          siteContactPhone: worksite.siteContactPhone,
          coordinatorEmployeeId: worksite.coordinatorEmployeeId,
          activities: worksite.activities,
          riskTags: [...worksite.riskTags],
          sharedWorkplace: worksite.sharedWorkplace,
        }
      : EMPTY,
  );
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof WorksiteInput>(k: K, v: WorksiteInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const customers = ctx.db.customers.filter((c) => c.companyId === ctx.company.id).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const employees = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active').sort((a, b) => employeeName(ctx.db, a.id).localeCompare(employeeName(ctx.db, b.id), 'es'));
  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id);
  const assigned = useMemo(() => (worksite ? employeesAt(ctx, worksite.id).length : 0), [ctx, worksite]);

  const riskChanged = !!worksite && !sameTags(worksite.riskTags, form.riskTags);
  const activitiesChanged = !!worksite && worksite.activities !== form.activities;
  const needsReason = riskChanged || activitiesChanged;
  const specialistSelected = form.riskTags.filter((id) => tags.find((r) => r.id === id)?.specialist);

  const errors: Partial<Record<'name' | 'address' | 'municipality' | 'customerId' | 'riskTags' | 'reason', string>> = {};
  if (!form.name.trim()) errors.name = t('Obligatorio.');
  if (!form.address.trim()) errors.address = t('Obligatorio.');
  if (!form.municipality.trim()) errors.municipality = t('Obligatorio.');
  if (form.kind === 'customer' && !form.customerId) errors.customerId = t('Indique la organización cliente.');
  if (specialistSelected.length) errors.riskTags = t('Riesgos de alcance especializado: fuera del alcance inicial. Quítelos para guardar.');
  if (needsReason && !reason.trim()) errors.reason = t('Obligatorio: se revisarán los requisitos del personal asignado.');
  const valid = Object.keys(errors).length === 0;

  const toggleTag = (id: string, on: boolean) => set('riskTags', on ? [...form.riskTags, id] : form.riskTags.filter((x) => x !== id));

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    // The form shows translated texts; unchanged ones are saved back as the stored Spanish.
    const raw = worksite ? getDb().worksites.find((w) => w.id === worksite.id) : null;
    const input: WorksiteInput = {
      ...form,
      name: stored(form.name.trim(), raw?.name),
      address: stored(form.address.trim(), raw?.address),
      municipality: stored(form.municipality.trim(), raw?.municipality),
      siteContactName: form.siteContactName.trim(),
      siteContactPhone: form.siteContactPhone.trim(),
      activities: stored(form.activities.trim(), raw?.activities),
      customerId: form.kind === 'customer' ? form.customerId : null,
    };
    const r = await run(
      () => saveWorksite(input, worksite?.id, reason.trim()),
      (res) => (worksite ? (res.reviews ? t('Centro actualizado: {n} revisiones de requisitos abiertas', { n: res.reviews }) : t('Centro actualizado')) : t('Centro creado')),
    );
    if (r) onSaved(r.worksite);
  };

  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  return (
    <Modal
      wide
      title={worksite ? t('Editar centro {code}', { code: worksite.code }) : t('Nuevo centro de trabajo')}
      description={t('Los riesgos y actividades del centro determinan qué requisitos aplican al personal asignado.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {worksite ? t('Guardar cambios') : t('Crear centro')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <TextField label={t('Nombre')} required value={form.name} onChange={(e) => set('name', e.target.value)} error={err('name')} className="span-2" />
          <SelectField label={t('Tipo de centro')} value={form.kind} onChange={(e) => set('kind', e.target.value as WorksiteInput['kind'])}>
            <option value="own">{t('Centro propio')}</option>
            <option value="customer">{t('Centro de un cliente')}</option>
          </SelectField>
          {form.kind === 'customer' && (
            <SelectField label={t('Organización cliente')} required value={form.customerId ?? ''} onChange={(e) => set('customerId', e.target.value || null)} error={err('customerId')}>
              <option value="">{t('Seleccione…')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          )}
          <TextField label={t('Dirección')} required value={form.address} onChange={(e) => set('address', e.target.value)} error={err('address')} className="span-2" />
          <TextField label={t('Municipio')} required value={form.municipality} onChange={(e) => set('municipality', e.target.value)} error={err('municipality')} />
          <TextField label={t('Contacto en el centro')} value={form.siteContactName} onChange={(e) => set('siteContactName', e.target.value)} />
          <TextField label={t('Teléfono del contacto')} type="tel" value={form.siteContactPhone} onChange={(e) => set('siteContactPhone', e.target.value)} />
          <SelectField label={t('Coordinación interna')} hint={t('Empleado/a responsable del centro')} value={form.coordinatorEmployeeId ?? ''} onChange={(e) => set('coordinatorEmployeeId', e.target.value || null)}>
            <option value="">{t('Sin asignar')}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {employeeName(ctx.db, e.id)}
              </option>
            ))}
          </SelectField>
          <TextAreaField label={t('Actividades en el centro')} value={form.activities} onChange={(e) => set('activities', e.target.value)} rows={2} className="span-all" />
        </div>

        <fieldset>
          <legend className="small strong">{t('Riesgos del centro')}</legend>
          <p className="tiny muted" style={{ margin: '0 0 8px' }}>
            {t('No todos los centros tienen los mismos riesgos: marque solo los que constan en la evaluación o en la información del titular.')}
          </p>
          <div className="ws-risk-grid">
            {tags.map((r) => {
              const on = form.riskTags.includes(r.id);
              return (
                <Checkbox
                  key={r.id}
                  label={
                    <>
                      {r.label}{' '}
                      {r.specialist && (
                        <Badge tone="warning" icon={AlertTriangle}>
                          {t('fuera del alcance inicial')}
                        </Badge>
                      )}
                    </>
                  }
                  checked={on}
                  disabled={r.specialist && !on}
                  onChange={(v) => toggleTag(r.id, v)}
                />
              );
            })}
          </div>
          {err('riskTags') && (
            <p className="small" role="alert" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>
              {err('riskTags')}
            </p>
          )}
        </fieldset>

        <Checkbox
          label={t('Lugar de trabajo compartido con otras empresas')}
          hint={t('Si concurren trabajadores de otras empresas, puede proceder la coordinación de actividades (CAE). La decisión es profesional.')}
          checked={form.sharedWorkplace}
          onChange={(v) => set('sharedWorkplace', v)}
        />

        {needsReason && (
          <>
            <Callout tone="warning" title={t('Cambio de riesgos o actividades')}>
              {riskChanged
                ? t('Hay {n} personas asignadas. Al guardar se abrirá una revisión de requisitos para cada persona cuyo conjunto de requisitos cambie. Las evidencias existentes no se invalidan.', { n: assigned })
                : t('El cambio de actividades queda registrado con su motivo. Revise si la evaluación de riesgos del centro debe actualizarse.')}
            </Callout>
            <TextAreaField label={t('Motivo del cambio')} required value={reason} onChange={(e) => setReason(e.target.value)} error={err('reason')} rows={2} />
          </>
        )}
      </div>
    </Modal>
  );
}
