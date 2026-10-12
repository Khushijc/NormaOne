import { useState } from 'react';
import { Button, Callout, Checkbox, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { validateNif } from '../../domain/nif';
import type { Customer, IdType, PartyKind, Supplier } from '../../domain/types';
import { validateCustomer, validateSupplier } from '../../domain/validation';
import { t, tKey } from '../../i18n';
import { EXPENSE_CATEGORIES } from '../../services/expenseService';
import { saveCustomer, saveSupplier, type CustomerInput, type SupplierInput } from '../../services/partyService';
import { BusinessRuleError } from '../../domain/permissions';
import { useCtx } from '../../store/hooks';

/** Spanish labels (translated at render time with t()). */
export const PARTY_KIND_LABEL: Record<PartyKind, string> = {
  company: tKey('Empresa / entidad'),
  self_employed: tKey('Autónomo/a o profesional'),
  individual: tKey('Particular (consumidor)'),
  public_admin: tKey('Administración pública'),
};
export const ID_TYPE_LABEL: Record<IdType, string> = {
  NIF: tKey('NIF español'),
  NIF_IVA: tKey('NIF-IVA (otro Estado UE)'),
  PASSPORT: tKey('Pasaporte'),
  FOREIGN_ID: tKey('Documento oficial extranjero'),
  OTHER: tKey('Otro documento'),
  NONE: tKey('Sin identificación'),
};

type Kind = 'customer' | 'supplier';

export function PartyFormModal({ kind, existing, onClose, onSaved }: { kind: Kind; existing?: Customer | Supplier; onClose: () => void; onSaved?: (p: Customer | Supplier) => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const base = existing ?? null;
  const [f, setF] = useState({
    kind: base?.kind ?? ('company' as PartyKind),
    legalName: base?.legalName ?? '',
    tradeName: base?.tradeName ?? '',
    idType: base?.idType ?? ('NIF' as IdType),
    idNumber: base?.idNumber ?? '',
    street: base?.address.street ?? '',
    postalCode: base?.address.postalCode ?? '',
    city: base?.address.city ?? '',
    province: base?.address.province ?? '',
    country: base?.address.country ?? 'ES',
    email: base?.email ?? '',
    phone: base?.phone ?? '',
    contactName: base?.contactName ?? '',
    notes: base?.notes ?? '',
    paymentTermsDays: String((base as Customer | undefined)?.paymentTermsDays ?? ctx.finance.defaultPaymentTermsDays),
    deliveryChannel: (base as Customer | undefined)?.deliveryChannel ?? ('email' as 'email' | 'manual'),
    defaultTaxCode: (base as Customer | undefined)?.defaultTaxCode ?? ctx.finance.approvedTaxCodes[0] ?? 'IVA21',
    defaultCategory: (base as Supplier | undefined)?.defaultCategory ?? 'materiales',
    ibanMasked: (base as Supplier | undefined)?.ibanMasked ?? '',
  });
  const [touched, setTouched] = useState(false);
  const [ack, setAck] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const address = { street: f.street, postalCode: f.postalCode, city: f.city, province: f.province, country: f.country.toUpperCase() };
  const common = { kind: f.kind, legalName: f.legalName, tradeName: f.tradeName, idType: f.idType, idNumber: f.idNumber, address, email: f.email, phone: f.phone, contactName: f.contactName, notes: f.notes };
  const custInput: CustomerInput = { ...common, paymentTermsDays: Number(f.paymentTermsDays), deliveryChannel: f.deliveryChannel, defaultTaxCode: f.defaultTaxCode };
  const suppInput: SupplierInput = { ...common, defaultCategory: f.defaultCategory, ibanMasked: f.ibanMasked, paymentTermsDays: Number(f.paymentTermsDays) };
  const v = kind === 'customer'
    ? validateCustomer(custInput, ctx.db.customers.filter((c) => c.companyId === ctx.company.id), existing?.id)
    : validateSupplier(suppInput, ctx.db.suppliers.filter((c) => c.companyId === ctx.company.id), existing?.id);
  const e = (k: string) => (touched && v.errors[k] ? t(v.errors[k]) : undefined);
  const nifInfo = f.idType === 'NIF' && f.idNumber.length >= 8 ? validateNif(f.idNumber) : null;

  const submit = async () => {
    setTouched(true);
    if (Object.keys(v.errors).length) return;
    if (v.warnings.length && !ack) return;
    const saved = await run<Customer | Supplier>(() => (kind === 'customer' ? saveCustomer(existing?.id ?? null, custInput, true) : saveSupplier(existing?.id ?? null, suppInput, true)), existing ? t('Cambios guardados y registrados en la auditoría') : kind === 'customer' ? t('Cliente creado') : t('Proveedor creado'));
    if (saved) {
      onSaved?.(saved);
      onClose();
    }
  };
  void BusinessRuleError;

  const title = existing ? (kind === 'customer' ? t('Editar cliente') : t('Editar proveedor')) : kind === 'customer' ? t('Nuevo cliente') : t('Nuevo proveedor');

  return (
    <Modal
      wide
      title={title}
      description={t('Solo se recogen los datos necesarios para facturar y gestionar el cobro o pago (minimización, RGPD art. 5.1.c).')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={touched && v.warnings.length > 0 && !ack && Object.keys(v.errors).length === 0}>
            {t('Guardar')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <SelectField label={t('Tipo')} required value={f.kind} onChange={(ev) => set('kind', ev.target.value)}>
          {Object.entries(PARTY_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </SelectField>
        <TextField label={t('Razón social o nombre completo')} required className="span-2" value={f.legalName} onChange={(ev) => set('legalName', ev.target.value)} error={e('legalName')} />
        <TextField label={t('Nombre comercial')} value={f.tradeName} onChange={(ev) => set('tradeName', ev.target.value)} />
        <SelectField label={t('Tipo de identificación')} value={f.idType} onChange={(ev) => set('idType', ev.target.value)}>
          {Object.entries(ID_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </SelectField>
        <TextField
          label={t('Número de identificación')}
          required={f.kind !== 'individual'}
          value={f.idNumber}
          onChange={(ev) => set('idNumber', ev.target.value.toUpperCase())}
          error={e('idNumber')}
          hint={nifInfo ? t(nifInfo.message) : t('Formato y carácter de control. La existencia en el censo AEAT se verificará en el backend (no conectado).')}
          disabled={f.idType === 'NONE'}
        />
        <TextField label={t('Domicilio')} required={f.kind !== 'individual'} className="span-2" value={f.street} onChange={(ev) => set('street', ev.target.value)} error={e('address.street')} />
        <TextField label={t('Código postal')} value={f.postalCode} onChange={(ev) => set('postalCode', ev.target.value)} error={e('address.postalCode')} inputMode="numeric" />
        <TextField label={t('Población')} required={f.kind !== 'individual'} value={f.city} onChange={(ev) => set('city', ev.target.value)} error={e('address.city')} />
        <TextField label={t('Provincia')} value={f.province} onChange={(ev) => set('province', ev.target.value)} />
        <TextField label={t('País (ISO)')} value={f.country} onChange={(ev) => set('country', ev.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
        <TextField label={t('Correo electrónico')} type="email" value={f.email} onChange={(ev) => set('email', ev.target.value)} error={e('email')} />
        <TextField label={t('Teléfono')} value={f.phone} onChange={(ev) => set('phone', ev.target.value)} />
        <TextField label={t('Persona de contacto')} value={f.contactName} onChange={(ev) => set('contactName', ev.target.value)} />
        <TextField label={t('Plazo de pago (días)')} type="number" min={0} value={f.paymentTermsDays} onChange={(ev) => set('paymentTermsDays', ev.target.value)} error={e('paymentTermsDays')} hint={t('Entre empresas: 30 días por defecto, máximo 60 pactados (Ley 3/2004).')} />
        {kind === 'customer' ? (
          <>
            <SelectField label={t('Canal de envío')} value={f.deliveryChannel} onChange={(ev) => set('deliveryChannel', ev.target.value)}>
              <option value="email">{t('Correo electrónico (simulado)')}</option>
              <option value="manual">{t('Entrega manual')}</option>
            </SelectField>
            <SelectField label={t('Tratamiento fiscal por defecto')} value={f.defaultTaxCode} onChange={(ev) => set('defaultTaxCode', ev.target.value)} hint={t('Solo propone el tipo; se valida en cada línea.')}>
              {ctx.db.taxCodes.filter((tc) => tc.supportStatus !== 'unsupported').map((tc) => <option key={tc.code} value={tc.code}>{t(tc.label)}</option>)}
            </SelectField>
          </>
        ) : (
          <>
            <SelectField label={t('Categoría de gasto por defecto')} value={f.defaultCategory} onChange={(ev) => set('defaultCategory', ev.target.value)}>
              {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </SelectField>
            <TextField label={t('IBAN (enmascarado)')} value={f.ibanMasked} onChange={(ev) => set('ibanMasked', ev.target.value.toUpperCase())} error={e('ibanMasked')} hint={t('El prototipo guarda solo los últimos dígitos.')} />
          </>
        )}
        <TextAreaField label={t('Notas internas')} className="span-all" value={f.notes} onChange={(ev) => set('notes', ev.target.value)} rows={2} />
      </div>
      {v.warnings.length > 0 && (
        <Callout tone="warning" title={t('Revise estos avisos antes de guardar')}>
          <ul>{v.warnings.map((w, i) => <li key={i}>{t(w)}</li>)}</ul>
          <div style={{ marginTop: 8 }}>
            <Checkbox label={t('He revisado los avisos y quiero continuar (quedará registrado en la auditoría)')} checked={ack} onChange={setAck} />
          </div>
        </Callout>
      )}
      {existing && <p className="small muted">{t('Las facturas ya emitidas conservan los datos del cliente vigentes en el momento de su emisión.')}</p>}
    </Modal>
  );
}
