import { AlertTriangle, Briefcase, Pencil, Plus, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Callout, Card, Checkbox, EmptyState, Field, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { assignmentOn } from '../../domain/requirements';
import type { ID, JobRole } from '../../domain/types';
import { t } from '../../i18n';
import { saveJobRole } from '../../services/opsService';
import { getDb } from '../../store/db';
import { shown, stored } from '../../components/localizedForm';
import { useCtx } from '../../store/hooks';

/** Job roles (tasks and risk tags drive requirement applicability) and the read-only risk tag catalogue. */
export function SettingsRolesTab() {
  const ctx = useCtx();
  const [editing, setEditing] = useState<ID | 'new' | null>(null);
  const [lastReviews, setLastReviews] = useState<{ role: string; reviews: number } | null>(null);
  const canEdit = ctx.can('settings.manage');

  const roles = ctx.db.jobRoles.filter((r) => r.companyId === ctx.company.id).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id);
  const tagLabel = (id: string) => tags.find((x) => x.id === id)?.label ?? id;
  const people = useMemo(() => {
    const map = new Map<ID, number>();
    for (const e of ctx.db.employees.filter((x) => x.companyId === ctx.company.id && x.status === 'active')) {
      const a = assignmentOn(ctx.db, e.id, ctx.today);
      if (a) map.set(a.jobRoleId, (map.get(a.jobRoleId) ?? 0) + 1);
    }
    return map;
  }, [ctx]);
  const deptName = (id: ID) => ctx.db.departments.find((d) => d.id === id)?.name ?? '—';

  return (
    <div className="stack">
      <Callout tone="info" title={t('Los riesgos del puesto los determina la evaluación de riesgos')}>
        {t('DatosPilot no evalúa riesgos. Las etiquetas de riesgo de cada puesto deben reflejar la evaluación vigente del servicio de prevención y deciden qué requisitos aplican a las personas del puesto.')}
      </Callout>

      {lastReviews && (
        <Callout tone={lastReviews.reviews > 0 ? 'warning' : 'success'} title={t('Puesto guardado: {role}', { role: lastReviews.role })}>
          {lastReviews.reviews > 0 ? (
            <>
              {lastReviews.reviews === 1
                ? t('Se ha abierto 1 revisión de requisitos para una persona del puesto. La coordinación de PRL debe revisarla.')
                : t('Se han abierto {n} revisiones de requisitos para las personas del puesto. La coordinación de PRL debe revisarlas.', { n: lastReviews.reviews })}{' '}
              <Link to="/incidencias?tipo=change_review">{t('Ver revisiones pendientes')}</Link>
            </>
          ) : (
            t('No se ha abierto ninguna revisión de requisitos.')
          )}
        </Callout>
      )}

      <Card
        flush
        title={<h2 className="row"><Briefcase size={16} aria-hidden /> {t('Puestos de trabajo')}</h2>}
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              {t('Nuevo puesto')}
            </Button>
          )
        }
      >
        {roles.length === 0 ? (
          <EmptyState icon={Briefcase} title={t('No hay puestos definidos')} action={canEdit ? <Button icon={Plus} onClick={() => setEditing('new')}>{t('Nuevo puesto')}</Button> : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Puestos de trabajo')}</caption>
              <thead>
                <tr>
                  <th>{t('Puesto')}</th>
                  <th>{t('Departamento')}</th>
                  <th>{t('Tareas')}</th>
                  <th>{t('Riesgos')}</th>
                  <th className="num">{t('Personas [puesto]')}</th>
                  {canEdit && <th><span className="sr-only">{t('Acciones')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="strong">{r.name}</span>
                      {!r.active && <div><Badge tone="neutral">{t('Inactivo')}</Badge></div>}
                    </td>
                    <td className="small">{deptName(r.departmentId)}</td>
                    <td className="small control-audit-text">{r.tasks || <span className="muted">—</span>}</td>
                    <td>
                      {r.riskTags.length === 0 ? (
                        <span className="muted small">{t('Sin riesgos etiquetados')}</span>
                      ) : (
                        <div className="status-stack">
                          {r.riskTags.map((tag) => (
                            <Badge key={tag} tone="neutral" icon={false}>
                              {tagLabel(tag)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="num">{people.get(r.id) ?? 0}</td>
                    {canEdit && (
                      <td>
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(r.id)} aria-label={t('Editar el puesto {name}', { name: r.name })}>
                          {t('Editar')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card flush title={<h2 className="row"><Tags size={16} aria-hidden /> {t('Catálogo de etiquetas de riesgo')}</h2>}>
        {tags.length === 0 ? (
          <EmptyState icon={Tags} title={t('No hay etiquetas de riesgo')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Catálogo de etiquetas de riesgo')}</caption>
              <thead>
                <tr>
                  <th>{t('Etiqueta [riesgo]')}</th>
                  <th>{t('Código')}</th>
                  <th>{t('Alcance')}</th>
                  <th className="num">{t('Puestos que la usan')}</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.id}>
                    <td>{tag.label}</td>
                    <td className="small mono">{tag.id}</td>
                    <td>
                      {tag.specialist ? (
                        <Badge tone="warning" icon={AlertTriangle}>{t('Fuera del alcance inicial [riesgo]')}</Badge>
                      ) : (
                        <span className="small muted">{t('Incluida')}</span>
                      )}
                    </td>
                    <td className="num">{roles.filter((r) => r.riskTags.includes(tag.id)).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer tiny muted">
          {t('Catálogo de solo lectura en esta fase. Las etiquetas de alcance especializado (obras de construcción, espacios confinados…) requieren gestión profesional específica y no se pueden asignar a puestos.')}
        </div>
      </Card>

      {editing && (
        <JobRoleModal
          id={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(role, reviews) => {
            setEditing(null);
            setLastReviews({ role: role.name, reviews });
          }}
        />
      )}
    </div>
  );
}

function JobRoleModal({ id, onClose, onSaved }: { id: ID | null; onClose: () => void; onSaved: (role: JobRole, reviews: number) => void }) {
  const ctx = useCtx();
  // Texts are shown in the interface language; unchanged ones are saved back as the stored Spanish.
  const existing = id ? getDb().jobRoles.find((r) => r.id === id && r.companyId === ctx.company.id) ?? null : null;
  const [name, setName] = useState(shown(existing?.name));
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? '');
  const [tasks, setTasks] = useState(shown(existing?.tasks));
  const [riskTags, setRiskTags] = useState<string[]>(existing?.riskTags ?? []);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();

  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id);
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id);
  const riskChanged = !!existing && [...existing.riskTags].sort().join() !== [...riskTags].sort().join();
  const affected = useMemo(
    () => (existing ? ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active' && assignmentOn(ctx.db, e.id, ctx.today)?.jobRoleId === existing.id).length : 0),
    [ctx, existing],
  );
  const errors = {
    name: !name.trim() ? t('Obligatorio.') : undefined,
    department: !departmentId ? t('Obligatorio.') : undefined,
    reason: riskChanged && !reason.trim() ? t('Indique el motivo del cambio de riesgos.') : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);

  const toggle = (tag: string, on: boolean) => setRiskTags((xs) => (on ? [...xs, tag] : xs.filter((x) => x !== tag)));

  const save = async () => {
    setTouched(true);
    if (invalid) return;
    const r = await run(
      () => saveJobRole({ name: stored(name, existing?.name), departmentId, tasks: stored(tasks.trim(), existing?.tasks), riskTags }, id, reason),
      (res) => (res.reviews === 1 ? t('Puesto guardado; 1 revisión de requisitos abierta') : res.reviews > 1 ? t('Puesto guardado; {n} revisiones de requisitos abiertas', { n: res.reviews }) : t('Puesto guardado')),
    );
    if (r) onSaved(r.role, r.reviews);
  };

  return (
    <Modal
      wide
      title={existing ? t('Editar puesto') : t('Nuevo puesto')}
      description={existing ? shown(existing.name) : undefined}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={save}>
            {t('Guardar')}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <TextField label={t('Nombre del puesto')} required value={name} onChange={(e) => setName(e.target.value)} error={touched ? errors.name : undefined} />
          <SelectField label={t('Departamento')} required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} error={touched ? errors.department : undefined}>
            <option value="">{t('Seleccione… [opción]')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        </div>
        <TextAreaField label={t('Tareas')} rows={3} value={tasks} onChange={(e) => setTasks(e.target.value)} hint={t('Descripción breve de las tareas, tal como figura en la evaluación de riesgos.')} />
        <Field label={t('Etiquetas de riesgo')} hint={t('Según la evaluación de riesgos vigente. Deciden qué requisitos aplican a las personas del puesto.')}>
          <div className="control-tag-grid" role="group" aria-label={t('Etiquetas de riesgo')}>
            {tags.map((tag) => (
              <Checkbox
                key={tag.id}
                label={tag.label}
                checked={riskTags.includes(tag.id)}
                disabled={tag.specialist && !riskTags.includes(tag.id)}
                hint={tag.specialist ? t('Fuera del alcance inicial: no se puede asignar.') : undefined}
                onChange={(on) => toggle(tag.id, on)}
              />
            ))}
          </div>
        </Field>
        {riskChanged && (
          <>
            <Callout tone="warning" title={t('Cambio de riesgos del puesto')}>
              {t('Al guardar se recalculan los requisitos de las {n} personas asignadas hoy al puesto y se abre una revisión de cambios para cada persona afectada.', { n: affected })}
            </Callout>
            <TextAreaField
              label={t('Motivo del cambio de riesgos')}
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={touched ? errors.reason : undefined}
              hint={t('Normalmente, la evaluación de riesgos revisada (código y versión). Queda en la auditoría.')}
            />
          </>
        )}
        {!riskChanged && existing && (
          <TextAreaField label={t('Motivo del cambio (opcional)')} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
      </form>
    </Modal>
  );
}
