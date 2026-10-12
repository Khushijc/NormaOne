/**
 * Puestos y centros tab: current effective-dated assignment, history (never overwritten), the
 * role / worksite change with a live requirement delta preview (PRL-02, AC-PRL-01) and the
 * supervisor change. A change never invalidates unrelated accepted evidence.
 */
import { ArrowRightLeft, UserCog } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ITEM_STATUS, type ItemStatus } from '../../domain/status';
import { formatDate, isValidISODate } from '../../domain/time';
import type { DeltaItem, Employee, RequirementDelta } from '../../domain/types';
import { t } from '../../i18n';
import { canSeeHealth, employeeName, roleName, userName, visibleWorksiteIds, worksiteName } from '../../services/context';
import { changeAssignment, currentShape, previewChange, updateEmployee, validateShape } from '../../services/peopleService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { RestrictedNote, WorksiteLink } from '../../components/bits';
import { Badge, Button, Callout, Card, Checkbox, DateText, DateTimeText, EmptyState, KV, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { DELTA_GROUPS, departmentName, displayAssignment } from './peopleData';

export function AssignmentTab({ emp }: { emp: Employee }) {
  const ctx = useCtx();
  const [dialog, setDialog] = useState<'change' | 'manager' | null>(null);
  const current = displayAssignment(ctx.db, emp.id, ctx.today);
  const history = ctx.db.assignments.filter((a) => a.employeeId === emp.id && a.companyId === ctx.company.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const scheduled = history.find((a) => a.effectiveFrom > ctx.today);
  const canManage = ctx.can('employees.manage');
  const live = !!current && current.effectiveFrom <= ctx.today && (!current.effectiveTo || current.effectiveTo >= ctx.today);
  const changeBlocked = emp.status !== 'active' ? t('La persona no está activa.') : !live ? t('No hay una asignación vigente.') : scheduled ? t('Ya hay un cambio programado con efecto {date}.', { date: formatDate(scheduled.effectiveFrom) }) : null;

  return (
    <div className="stack">
      <Card
        title={t('Asignación vigente')}
        actions={
          canManage ? (
            <>
              <Button size="sm" icon={ArrowRightLeft} disabled={!!changeBlocked} title={changeBlocked ?? undefined} onClick={() => setDialog('change')}>
                {t('Cambiar puesto o centros')}
              </Button>
              <Button size="sm" icon={UserCog} disabled={emp.status !== 'active'} onClick={() => setDialog('manager')}>
                {t('Cambiar supervisor/a')}
              </Button>
            </>
          ) : undefined
        }
      >
        {current ? (
          <div className="stack-sm">
            <KV
              items={[
                [t('Puesto'), roleName(ctx.db, current.jobRoleId)],
                [t('Departamento'), departmentName(ctx.db, current.departmentId)],
                [
                  t('Centros de trabajo'),
                  <ul className="plain-list" key="ws">
                    {current.worksiteIds.map((w) => (
                      <li key={w}>
                        <WorksiteLink id={w} />
                        {!ctx.db.worksites.find((x) => x.id === w)?.active && <Badge tone="neutral">{t('Centro inactivo')}</Badge>}
                      </li>
                    ))}
                  </ul>,
                ],
                [t('En vigor desde'), <DateText key="f" date={current.effectiveFrom} />],
                [t('En vigor hasta'), current.effectiveTo ? <DateText key="t" date={current.effectiveTo} /> : <span key="t" className="muted">{t('Sin fecha de fin')}</span>],
                [t('Motivo de la asignación'), current.changeReason || '—'],
                [t('Supervisor/a'), employeeName(ctx.db, emp.managerEmployeeId)],
                [t('Fecha de alta'), <DateText key="h" date={emp.hireDate} />],
              ]}
            />
            {changeBlocked && canManage && emp.status === 'active' && <p className="tiny muted">{changeBlocked}</p>}
            {scheduled && (
              <Callout tone="info" title={t('Cambio programado con efecto {date}', { date: formatDate(scheduled.effectiveFrom) })}>
                {roleName(ctx.db, scheduled.jobRoleId)} · {scheduled.worksiteIds.map((w) => worksiteName(ctx.db, w)).join(', ')}
              </Callout>
            )}
          </div>
        ) : (
          <EmptyState title={t('Sin asignación registrada')} />
        )}
      </Card>

      <Card title={t('Historial de asignaciones')} flush>
        {history.length === 0 ? (
          <EmptyState title={t('Sin asignaciones registradas')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('En vigor desde')}</th>
                  <th>{t('En vigor hasta')}</th>
                  <th>{t('Puesto')}</th>
                  <th>{t('Departamento')}</th>
                  <th>{t('Centros')}</th>
                  <th>{t('Motivo')}</th>
                  <th>{t('Registrado por')}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <DateText date={a.effectiveFrom} />
                      {a.effectiveFrom > ctx.today && <div><Badge tone="info">{t('Programado [asignación]')}</Badge></div>}
                      {a.id === current?.id && live && <div><Badge tone="success">{t('Vigente [decisión]')}</Badge></div>}
                    </td>
                    <td>{a.effectiveTo ? <DateText date={a.effectiveTo} /> : <span className="muted">—</span>}</td>
                    <td>{roleName(ctx.db, a.jobRoleId)}</td>
                    <td>{departmentName(ctx.db, a.departmentId)}</td>
                    <td className="small">{a.worksiteIds.map((w) => worksiteName(ctx.db, w)).join(', ')}</td>
                    <td className="small">{a.changeReason || '—'}</td>
                    <td>
                      {userName(ctx.db, a.createdBy)}
                      <div className="sub"><DateTimeText at={a.createdAt} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog === 'change' && current && <ChangeAssignmentModal emp={emp} onClose={() => setDialog(null)} />}
      {dialog === 'manager' && <ManagerModal emp={emp} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ─────────────────────────────── Change form with delta preview ───────────────────────────────

function ChangeAssignmentModal({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const before = currentShape(ctx, emp.id)!;
  const [roleId, setRoleId] = useState(before.jobRoleId);
  const [departmentId, setDepartmentId] = useState(before.departmentId);
  const [sites, setSites] = useState<string[]>(before.worksiteIds);
  const [date, setDate] = useState(ctx.today);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const roles = ctx.db.jobRoles.filter((r) => r.companyId === ctx.company.id && (r.active || r.id === before.jobRoleId));
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id);
  const visible = visibleWorksiteIds(ctx);
  const worksites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && w.active && visible.has(w.id)).sort((a, b) => a.code.localeCompare(b.code));

  const after = useMemo(() => ({ jobRoleId: roleId, departmentId, worksiteIds: sites }), [roleId, departmentId, sites]);
  const shapeErrors = validateShape(ctx, after);
  const same = before.jobRoleId === roleId && before.departmentId === departmentId && [...before.worksiteIds].sort().join() === [...sites].sort().join();
  const dateError = !isValidISODate(date) ? t('Fecha no válida.') : date < ctx.today ? t('No se admiten fechas pasadas: elija hoy o una fecha posterior.') : undefined;
  const delta = useMemo(() => (shapeErrors.length || !isValidISODate(date) || same ? null : previewChange(ctx, emp.id, after, date)), [ctx, emp.id, after, date, shapeErrors.length, same]);

  const onRole = (id: string) => {
    setRoleId(id);
    const dep = ctx.db.jobRoles.find((r) => r.id === id)?.departmentId;
    if (dep) setDepartmentId(dep);
  };

  const submit = async () => {
    setTouched(true);
    if (shapeErrors.length || dateError || !reason.trim() || same) return;
    const ok = await run(() => changeAssignment(emp.id, after, date, reason), (c) => t('Cambio registrado: {n} requisitos nuevos; revisión de cambios pendiente', { n: c.delta.newlyRequired.length }));
    if (ok) onClose();
  };

  return (
    <Modal
      wide
      title={t('Cambiar puesto o centros')}
      description={`${emp.firstName} ${emp.lastName} · ${emp.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={same}>
            {t('Confirmar el cambio')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <SelectField label={t('Puesto')} required value={roleId} onChange={(e) => onRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </SelectField>
          <SelectField label={t('Departamento')} required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </SelectField>
          <TextField label={t('Fecha de efecto')} type="date" required min={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} error={touched || date ? dateError : undefined} hint={t('Hoy o una fecha posterior; el cambio nunca es retroactivo.')} />
        </div>
        <fieldset className="plain-fieldset">
          <legend className="field-legend">
            {t('Centros de trabajo')}
            <span className="req" aria-hidden>*</span>
          </legend>
          <div className="site-checks">
            {worksites.map((w) => (
              <Checkbox key={w.id} label={`${w.code} · ${w.name}`} checked={sites.includes(w.id)} onChange={(v) => setSites((s) => (v ? [...s, w.id] : s.filter((x) => x !== w.id)))} />
            ))}
          </div>
        </fieldset>
        <TextAreaField label={t('Motivo del cambio')} required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={touched && !reason.trim() ? t('Obligatorio.') : undefined} />
        {touched && shapeErrors.length > 0 && (
          <Callout tone="danger" title={t('Corrija los datos del cambio')}>
            <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
              {shapeErrors.map((e) => (
                <li key={e}>{t(e)}</li>
              ))}
            </ul>
          </Callout>
        )}

        <section aria-live="polite" className="stack-sm">
          <h3 className="section-title">{t('Vista previa de requisitos')}</h3>
          <Callout tone="info">{t('Las evidencias aceptadas no relacionadas no se invalidan. El cambio abre una revisión de cambios para la coordinación de PRL.')}</Callout>
          {same ? (
            <p className="small muted">{t('Sin cambios respecto a la asignación vigente.')}</p>
          ) : !delta ? (
            <p className="small muted">{t('Complete el puesto, el departamento, al menos un centro y una fecha válida para ver el efecto en los requisitos.')}</p>
          ) : (
            <DeltaView delta={delta} ctx={ctx} employeeId={emp.id} />
          )}
        </section>
      </div>
    </Modal>
  );
}

/** Delta lists. Evidence status of health items is masked for viewers without health access. */
export function DeltaView({ delta, ctx, employeeId, compact }: { delta: RequirementDelta; ctx: UiCtx; employeeId: string; compact?: boolean }) {
  const health = canSeeHealth(ctx) || ctx.employee?.id === employeeId;
  const restricted = (d: DeltaItem) => ctx.db.versions.find((v) => v.id === d.versionId)?.category === 'health_surveillance';
  return (
    <div className={`delta-grid ${compact ? 'compact' : ''}`}>
      {DELTA_GROUPS.map((g) => {
        const list = delta[g.key];
        return (
          <div key={g.key} className={`delta-group ${g.key === 'newCriticalUnresolved' && list.length ? 'is-danger' : ''}`}>
            <div className="row between">
              <span className="small strong">{t(g.label)}</span>
              <span className="badge tone-neutral">{list.length}</span>
            </div>
            <div className="tiny muted">{t(g.help)}</div>
            {list.length > 0 && (
              <ul className="delta-list">
                {list.map((d) => (
                  <li key={`${d.templateId}|${d.worksiteId ?? '*'}`}>
                    <span className="small">{d.name}</span>
                    {d.worksiteId && <span className="tiny muted"> · {worksiteName(ctx.db, d.worksiteId)}</span>}
                    <span className="row-wrap" style={{ gap: 4 }}>
                      {d.critical && <Badge tone="danger">{t('Crítico')}</Badge>}
                      {restricted(d) && !health ? <RestrictedNote /> : ITEM_STATUS[d.evidence as ItemStatus] ? <span className="tiny muted">{t(ITEM_STATUS[d.evidence as ItemStatus].label)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────── Supervisor ───────────────────────────────

function ManagerModal({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [manager, setManager] = useState(emp.managerEmployeeId ?? '');
  const options = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active' && e.id !== emp.id).sort((a, b) => a.firstName.localeCompare(b.firstName, 'es'));
  const submit = async () => {
    const ok = await run(() => updateEmployee(emp.id, { managerEmployeeId: manager || null }), t('Supervisor/a actualizado'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('Cambiar supervisor/a')}
      description={`${emp.firstName} ${emp.lastName} · ${emp.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={(emp.managerEmployeeId ?? '') === manager}>
            {t('Guardar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <SelectField label={t('Supervisor/a')} value={manager} onChange={(e) => setManager(e.target.value)} hint={t('La persona supervisora ve la disponibilidad mínima necesaria de su equipo, no el contenido de los documentos.')}>
          <option value="">{t('Sin supervisor/a')}</option>
          {options.map((e) => (
            <option key={e.id} value={e.id}>{e.firstName} {e.lastName} · {e.code}</option>
          ))}
        </SelectField>
      </div>
    </Modal>
  );
}
