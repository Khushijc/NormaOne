import { X } from 'lucide-react';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { visibleEmployeeIds } from '../services/context';
import type { Filters } from '../services/reportService';
import { Button } from './ui';

/**
 * Shared filter row for records, reports and exceptions. Employee options are limited to the
 * caller's scope; worksite and department lists come from the active company only.
 */
export function FilterBar({ value, onChange, show = ['dates', 'department', 'worksite', 'employee', 'search'], statusOptions }: { value: Filters; onChange: (f: Filters) => void; show?: ('dates' | 'department' | 'worksite' | 'employee' | 'search' | 'status')[]; statusOptions?: { value: string; label: string }[] }) {
  const ctx = useCtx();
  const visible = visibleEmployeeIds(ctx);
  const employees = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && visible.has(e.id)).sort((a, b) => a.firstName.localeCompare(b.firstName));
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const active = Object.entries(value).some(([k, v]) => (k === 'search' ? !!String(v).trim() : v !== null));
  return (
    <div className="toolbar" role="search" aria-label={t('Filtros')}>
      {show.includes('search') && (
        <div className="field search">
          <label htmlFor="fb-q">{t('Buscar')}</label>
          <input id="fb-q" className="input" placeholder={t('Nombre o código')} value={value.search} onChange={(e) => set({ search: e.target.value })} />
        </div>
      )}
      {show.includes('dates') && (
        <>
          <div className="field">
            <label htmlFor="fb-from">{t('Desde')}</label>
            <input id="fb-from" type="date" className="input" value={value.from ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
          </div>
          <div className="field">
            <label htmlFor="fb-to">{t('Hasta')}</label>
            <input id="fb-to" type="date" className="input" value={value.to ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
          </div>
        </>
      )}
      {show.includes('department') && (
        <div className="field">
          <label htmlFor="fb-dep">{t('Departamento')}</label>
          <select id="fb-dep" className="select" value={value.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || null })}>
            <option value="">{t('Todos')}</option>
            {ctx.db.departments.filter((d) => d.companyId === ctx.company.id).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}
      {show.includes('worksite') && (
        <div className="field">
          <label htmlFor="fb-ws">{t('Centro')}</label>
          <select id="fb-ws" className="select" value={value.worksiteId ?? ''} onChange={(e) => set({ worksiteId: e.target.value || null })}>
            <option value="">{t('Todos')}</option>
            {ctx.db.worksites.filter((w) => w.companyId === ctx.company.id).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      )}
      {show.includes('employee') && employees.length > 1 && (
        <div className="field">
          <label htmlFor="fb-emp">{t('Empleado')}</label>
          <select id="fb-emp" className="select" value={value.employeeId ?? ''} onChange={(e) => set({ employeeId: e.target.value || null })}>
            <option value="">{t('Todos')}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.firstName} {e.lastName} · {e.code}</option>
            ))}
          </select>
        </div>
      )}
      {show.includes('status') && statusOptions && (
        <div className="field">
          <label htmlFor="fb-st">{t('Estado')}</label>
          <select id="fb-st" className="select" value={value.status ?? ''} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">{t('Todos')}</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>{t(o.label)}</option>
            ))}
          </select>
        </div>
      )}
      {active && (
        <Button variant="ghost" icon={X} onClick={() => onChange({ from: null, to: null, departmentId: null, worksiteId: null, employeeId: null, status: null, search: '' })}>
          {t('Limpiar filtros')}
        </Button>
      )}
    </div>
  );
}
