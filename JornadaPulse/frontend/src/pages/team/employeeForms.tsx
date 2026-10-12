/**
 * Form pieces shared by the team screens: employee identity fields and employment-relationship
 * fields (TIM-01). Validation always comes from the services (`validateEmployee`,
 * `validateRelationship`); this file only maps their messages to the fields they concern.
 *
 * Data minimisation: no national ID number, personal address, birth date or health data is
 * collected here. Those belong to the payroll system, not to the working-time record.
 */
import { addDays } from '../../domain/time';
import type { ContractType, Employee, EmploymentRelationship, ID, WorkdayType } from '../../domain/types';
import { CONTRACT_LABEL, WORKDAY_LABEL } from '../../domain/status';
import { t, locale } from '../../i18n';
import type { EmployeeInput, RelationshipInput } from '../../services/planningService';
import type { Ctx } from '../../services/context';
import { Checkbox, SelectField, TextAreaField, TextField } from '../../components/ui';
import { XCircle } from 'lucide-react';

// ─────────────────────────────── Number formatting ───────────────────────────────

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(n);
}

// ─────────────────────────────── Identity ───────────────────────────────

export interface IdentityState {
  code: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  departmentId: ID;
  primaryWorksiteId: ID;
  worksiteIds: ID[];
  managerEmployeeId: ID;
  jobTitle: string;
  hireDate: string;
}

export function identityFromEmployee(e: Employee): IdentityState {
  return {
    code: e.code,
    firstName: e.firstName,
    lastName: e.lastName,
    workEmail: e.workEmail,
    departmentId: e.departmentId,
    primaryWorksiteId: e.primaryWorksiteId,
    worksiteIds: [...e.worksiteIds],
    managerEmployeeId: e.managerEmployeeId ?? '',
    jobTitle: e.jobTitle,
    hireDate: e.hireDate,
  };
}

/** Next free internal code with the company's usual prefix ("EMP-019"). */
export function suggestCode(ctx: Ctx): string {
  const codes = ctx.db.employees.filter((e) => e.companyId === ctx.company.id).map((e) => /^([A-Z]{2,4})-(\d{3,})$/.exec(e.code)).filter((m): m is RegExpExecArray => !!m);
  const prefix = codes[0]?.[1] ?? 'EMP';
  const max = codes.filter((m) => m[1] === prefix).reduce((acc, m) => Math.max(acc, Number(m[2])), 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export function emptyIdentity(ctx: Ctx): IdentityState {
  return { code: suggestCode(ctx), firstName: '', lastName: '', workEmail: '', departmentId: '', primaryWorksiteId: '', worksiteIds: [], managerEmployeeId: '', jobTitle: '', hireDate: ctx.today };
}

export function toEmployeeInput(s: IdentityState): EmployeeInput {
  return {
    code: s.code.trim().toUpperCase(),
    firstName: s.firstName.trim(),
    lastName: s.lastName.trim(),
    workEmail: s.workEmail.trim(),
    departmentId: s.departmentId,
    primaryWorksiteId: s.primaryWorksiteId,
    worksiteIds: s.worksiteIds,
    managerEmployeeId: s.managerEmployeeId || null,
    jobTitle: s.jobTitle.trim(),
    hireDate: s.hireDate,
  };
}

// ─────────────────────────────── Employment relationship ───────────────────────────────

export interface RelState {
  effectiveFrom: string;
  contractType: ContractType;
  workdayType: WorkdayType;
  weeklyHours: string;
  partTimePct: string;
  agreementId: ID;
  policyKey: string;
  reduced: boolean;
  reducedPct: string;
  reducedBasis: string;
  remoteAllowed: boolean;
  note: string;
}

export function emptyRel(ctx: Ctx): RelState {
  return { effectiveFrom: ctx.today, contractType: 'indefinido', workdayType: 'full_time', weeklyHours: '40', partTimePct: '', agreementId: '', policyKey: '', reduced: false, reducedPct: '', reducedBasis: '', remoteAllowed: false, note: '' };
}

export function relFromRelationship(r: EmploymentRelationship, effectiveFrom: string): RelState {
  return {
    effectiveFrom,
    contractType: r.contractType,
    workdayType: r.workdayType,
    weeklyHours: String(r.weeklyHours),
    partTimePct: r.partTimePct === null ? '' : String(r.partTimePct),
    agreementId: r.agreementId,
    policyKey: r.policyKey,
    reduced: !!r.reducedHours,
    reducedPct: r.reducedHours ? String(r.reducedHours.pct) : '',
    reducedBasis: r.reducedHours?.basis ?? '',
    remoteAllowed: r.remoteAllowed,
    note: '',
  };
}

const num = (s: string): number => {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || Number.isNaN(n) ? NaN : n;
};

export function toRelationshipInput(s: RelState): RelationshipInput {
  const pct = num(s.partTimePct);
  return {
    effectiveFrom: s.effectiveFrom,
    contractType: s.contractType,
    workdayType: s.workdayType,
    weeklyHours: num(s.weeklyHours),
    partTimePct: s.workdayType === 'part_time' ? (Number.isNaN(pct) ? null : pct) : null,
    agreementId: s.agreementId,
    policyKey: s.policyKey,
    reducedHours: s.reduced ? { pct: num(s.reducedPct), basis: s.reducedBasis.trim() } : null,
    remoteAllowed: s.remoteAllowed,
    note: s.note.trim(),
  };
}

/** Policy families of the company (one entry per key, named after the latest version). */
export function policyKeys(ctx: Ctx): { key: string; name: string }[] {
  const out = new Map<string, { key: string; name: string; v: number }>();
  for (const p of ctx.db.policies.filter((x) => x.companyId === ctx.company.id)) {
    const prev = out.get(p.key);
    if (!prev || p.version > prev.v) out.set(p.key, { key: p.key, name: p.name, v: p.version });
  }
  return [...out.values()].map(({ key, name }) => ({ key, name }));
}

// ─────────────────────────────── Service message → field ───────────────────────────────

/** Fields that service validation messages refer to (exact Spanish text from planningService). */
const FIELD_OF: Record<string, string> = {
  'Nombre y apellidos son obligatorios.': 'firstName',
  'El código debe tener el formato ABC-001.': 'code',
  'Ya existe un empleado con ese código.': 'code',
  'Indique un correo de trabajo válido.': 'workEmail',
  'Ese correo ya está asignado a otro empleado.': 'workEmail',
  'Seleccione un departamento.': 'departmentId',
  'Asigne al menos un centro de trabajo.': 'worksiteIds',
  'El centro principal debe estar entre los centros asignados.': 'primaryWorksiteId',
  'Indique la fecha de alta.': 'hireDate',
  'Un empleado no puede ser su propio responsable.': 'managerEmployeeId',
  'Indique la fecha de efecto.': 'effectiveFrom',
  'Las horas semanales deben estar entre 1 y 40 (jornada máxima ordinaria, ET art. 34.1).': 'weeklyHours',
  'Indique el porcentaje de parcialidad.': 'partTimePct',
  'Una jornada a tiempo completo no tiene porcentaje de parcialidad.': 'partTimePct',
  'Seleccione el convenio de referencia.': 'agreementId',
  'Seleccione la política de jornada.': 'policyKey',
  'Indique el porcentaje y la base de la reducción de jornada.': 'reduced',
};

export type FieldErrors = Record<string, string>;

/** Splits service messages into per-field errors (translated) and general ones. */
export function mapErrors(messages: string[], extra: Record<string, string> = {}): { fields: FieldErrors; general: string[] } {
  const fields: FieldErrors = {};
  const general: string[] = [];
  for (const m of messages) {
    const f = extra[m] ?? FIELD_OF[m];
    if (f && !fields[f]) fields[f] = t(m);
    else if (!f) general.push(m);
  }
  return { fields, general };
}

export function GeneralErrors({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="callout danger" role="alert">
      <XCircle size={16} aria-hidden />
      <div className="grow">
        <div className="title">{t('Revise los datos indicados')}</div>
        <ul>
          {items.map((m, i) => (
            <li key={i}>{t(m)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────── Field groups ───────────────────────────────

export function IdentityFields({ ctx, value, onChange, errors, selfId }: { ctx: Ctx; value: IdentityState; onChange: (v: IdentityState) => void; errors: FieldErrors; selfId: ID | null }) {
  const set = <K extends keyof IdentityState>(k: K, v: IdentityState[K]) => onChange({ ...value, [k]: v });
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id);
  const sites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && (w.active || value.worksiteIds.includes(w.id)));
  const managers = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.id !== selfId && (e.status === 'active' || e.id === value.managerEmployeeId)).sort((a, b) => a.firstName.localeCompare(b.firstName, 'es'));
  const toggleSite = (id: ID, on: boolean) => {
    const ids = on ? [...value.worksiteIds, id] : value.worksiteIds.filter((x) => x !== id);
    const primary = ids.includes(value.primaryWorksiteId) ? value.primaryWorksiteId : ids[0] ?? '';
    onChange({ ...value, worksiteIds: ids, primaryWorksiteId: primary });
  };
  return (
    <div className="form-grid">
      <TextField label={t('Código interno')} required value={value.code} onChange={(e) => set('code', e.target.value)} error={errors.code} hint={t('Formato ABC-001. No use el DNI/NIE como código.')} autoComplete="off" />
      <TextField label={t('Nombre')} required value={value.firstName} onChange={(e) => set('firstName', e.target.value)} error={errors.firstName} autoComplete="off" />
      <TextField label={t('Apellidos')} required value={value.lastName} onChange={(e) => set('lastName', e.target.value)} autoComplete="off" />
      <TextField label={t('Correo de trabajo')} required type="email" value={value.workEmail} onChange={(e) => set('workEmail', e.target.value)} error={errors.workEmail} hint={t('Solo el correo corporativo; no se recogen datos de contacto personales.')} autoComplete="off" />
      <SelectField label={t('Departamento')} required value={value.departmentId} onChange={(e) => set('departmentId', e.target.value)} error={errors.departmentId}>
        <option value="">{t('Seleccione…')}</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </SelectField>
      <TextField label={t('Puesto')} value={value.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} autoComplete="off" />
      <SelectField label={t('Responsable directo')} value={value.managerEmployeeId} onChange={(e) => set('managerEmployeeId', e.target.value)} error={errors.managerEmployeeId} hint={t('Determina qué supervisor revisa sus registros, correcciones y ausencias.')}>
        <option value="">{t('Sin responsable asignado')}</option>
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.firstName} {m.lastName} · {m.code}
          </option>
        ))}
      </SelectField>
      <TextField label={t('Fecha de alta')} required type="date" value={value.hireDate} onChange={(e) => set('hireDate', e.target.value)} error={errors.hireDate} />
      <fieldset className="span-all team-sites" aria-invalid={!!errors.worksiteIds || undefined}>
        <legend>
          {t('Centros de trabajo donde puede registrar')}
          <span className="req" aria-hidden>*</span>
        </legend>
        <div className="team-sites-grid">
          {sites.map((w) => (
            <Checkbox key={w.id} label={w.name} hint={w.kind === 'customer' ? t('Centro de cliente') : t('Centro propio')} checked={value.worksiteIds.includes(w.id)} onChange={(on) => toggleSite(w.id, on)} />
          ))}
        </div>
        {errors.worksiteIds && (
          <span className="error team-error" role="alert">
            <XCircle size={12} aria-hidden /> {errors.worksiteIds}
          </span>
        )}
      </fieldset>
      <SelectField label={t('Centro principal')} required value={value.primaryWorksiteId} onChange={(e) => set('primaryWorksiteId', e.target.value)} error={errors.primaryWorksiteId} disabled={!value.worksiteIds.length} hint={t('Debe ser uno de los centros asignados.')}>
        <option value="">{t('Seleccione…')}</option>
        {sites
          .filter((w) => value.worksiteIds.includes(w.id))
          .map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
      </SelectField>
    </div>
  );
}

export function RelationshipFields({ ctx, value, onChange, errors, showEffectiveFrom, minEffectiveFrom, requireNote }: { ctx: Ctx; value: RelState; onChange: (v: RelState) => void; errors: FieldErrors; showEffectiveFrom: boolean; minEffectiveFrom?: string; requireNote?: boolean }) {
  const set = <K extends keyof RelState>(k: K, v: RelState[K]) => onChange({ ...value, [k]: v });
  const agreements = ctx.db.agreements.filter((a) => a.companyId === ctx.company.id);
  const keys = policyKeys(ctx);
  return (
    <div className="form-grid">
      {showEffectiveFrom && <TextField label={t('Fecha de efecto')} required type="date" min={minEffectiveFrom} value={value.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} error={errors.effectiveFrom} hint={t('Hoy o posterior. Nunca se aplica con efecto retroactivo.')} />}
      <SelectField label={t('Tipo de contrato')} required value={value.contractType} onChange={(e) => set('contractType', e.target.value as ContractType)}>
        {(Object.keys(CONTRACT_LABEL) as ContractType[]).map((k) => (
          <option key={k} value={k}>{t(CONTRACT_LABEL[k])}</option>
        ))}
      </SelectField>
      <SelectField
        label={t('Tipo de jornada')}
        required
        value={value.workdayType}
        onChange={(e) => {
          const w = e.target.value as WorkdayType;
          onChange({ ...value, workdayType: w, partTimePct: w === 'full_time' ? '' : value.partTimePct });
        }}
      >
        {(Object.keys(WORKDAY_LABEL) as WorkdayType[]).map((k) => (
          <option key={k} value={k}>{t(WORKDAY_LABEL[k])}</option>
        ))}
      </SelectField>
      <TextField label={t('Horas semanales contratadas')} required type="number" inputMode="decimal" min={1} max={40} step={0.5} value={value.weeklyHours} onChange={(e) => set('weeklyHours', e.target.value)} error={errors.weeklyHours} />
      <TextField label={t('Porcentaje de parcialidad (%)')} required={value.workdayType === 'part_time'} type="number" inputMode="decimal" min={1} max={99} step={0.5} value={value.partTimePct} onChange={(e) => set('partTimePct', e.target.value)} error={errors.partTimePct} disabled={value.workdayType !== 'part_time'} hint={t('Respecto de la jornada a tiempo completo comparable.')} />
      <SelectField label={t('Convenio de referencia')} required value={value.agreementId} onChange={(e) => set('agreementId', e.target.value)} error={errors.agreementId}>
        <option value="">{t('Seleccione…')}</option>
        {agreements.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </SelectField>
      <SelectField label={t('Política de jornada')} required value={value.policyKey} onChange={(e) => set('policyKey', e.target.value)} error={errors.policyKey} hint={t('La versión aplicable se elige por la fecha de cada registro.')}>
        <option value="">{t('Seleccione…')}</option>
        {keys.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name} ({p.key})
          </option>
        ))}
      </SelectField>
      <div className="span-all stack-sm">
        <Checkbox label={t('Teletrabajo permitido')} hint={t('Permite registrar la modalidad «a distancia».')} checked={value.remoteAllowed} onChange={(v) => set('remoteAllowed', v)} />
        <Checkbox label={t('Reducción de jornada (ET art. 37.6)')} hint={t('Se guarda como dato; la aplicación no calcula salario ni derechos a partir de ella.')} checked={value.reduced} onChange={(v) => set('reduced', v)} />
      </div>
      {value.reduced && (
        <>
          <TextField label={t('Porcentaje de reducción (%)')} required type="number" inputMode="decimal" min={1} max={99} step={0.5} value={value.reducedPct} onChange={(e) => set('reducedPct', e.target.value)} error={errors.reduced} />
          <TextField className="span-2" label={t('Base de la reducción')} required value={value.reducedBasis} onChange={(e) => set('reducedBasis', e.target.value)} hint={t('Por ejemplo: cuidado de menor de 12 años. Sin datos de salud ni de familiares.')} />
        </>
      )}
      {(showEffectiveFrom || requireNote) && <TextAreaField className="span-all" label={t('Motivo del cambio')} required={requireNote} rows={2} value={value.note} onChange={(e) => set('note', e.target.value)} error={errors.note} hint={t('Queda registrado en la auditoría.')} />}
    </div>
  );
}

/** Earliest allowed date for a new version: today, and after the start of the latest version. */
export function minVersionDate(today: string, latestFrom: string | undefined): string {
  if (!latestFrom) return today;
  const after = addDays(latestFrom, 1);
  return after > today ? after : today;
}
