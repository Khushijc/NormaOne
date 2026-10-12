/**
 * Dialogs of Formación e información: course catalogue entry, assignment, scheduling, attendance
 * and completion. Each one calls trainingService; attendance, completion and evidence acceptance
 * remain separate facts.
 */
import { useMemo, useState } from 'react';
import { Button, Callout, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import type { ID, TrainingAssignment, TrainingCourse } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { assignTraining, recordAttendance, recordCompletion, saveCourse, scheduleTraining, validateCourse, type CourseInput } from '../../services/trainingService';
import { employeeName, visibleEmployeeIds } from '../../services/context';
import { getDb } from '../../store/db';
import { shown, stored, storedFields } from '../../components/localizedForm';
import { useCtx } from '../../store/hooks';

export const MODALITY: Record<TrainingCourse['modality'], string> = {
  presencial: tKey('Presencial'),
  online: tKey('En línea'),
  mixta: tKey('Mixta'),
};

/** Human description of a course refresher rule: never a universal default interval. */
export function refresherText(r: TrainingCourse['refresher']): string {
  switch (r.kind) {
    case 'interval':
      return t('Cada {months} meses (fijado por {who})', { months: r.months ?? '—', who: r.setBy ?? '—' });
    case 'not_determined':
      return t('No determinado: requiere decisión profesional');
    case 'per_document':
      return t('Según la fecha indicada en cada certificado');
    default:
      return t('Sin reciclaje establecido');
  }
}

const EMPTY_COURSE: CourseInput = { title: '', providerName: '', modality: 'presencial', durationHours: null, contentSummary: '', riskTags: [], refresher: { kind: 'none', months: null, setBy: null } };

export function CourseModal({ courseId, onClose }: { courseId?: ID | null; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  // Texts are shown in the interface language; unchanged ones are saved back as the stored Spanish.
  const rec = courseId ? getDb().courses.find((c) => c.id === courseId && c.companyId === ctx.company.id) : undefined;
  const [form, setForm] = useState<CourseInput>(() => (rec ? { title: shown(rec.title), providerName: rec.providerName, modality: rec.modality, durationHours: rec.durationHours, contentSummary: shown(rec.contentSummary), riskTags: [...rec.riskTags], refresher: { ...rec.refresher, setBy: rec.refresher.setBy && shown(rec.refresher.setBy) } } : EMPTY_COURSE));
  const [hours, setHours] = useState(rec?.durationHours != null ? String(rec.durationHours) : '');
  const [errors, setErrors] = useState<string[]>([]);
  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id);
  const set = <K extends keyof CourseInput>(k: K, v: CourseInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const parsed = hours.trim() ? Number(hours.replace(',', '.')) : null;
    const refresherSetBy = form.refresher.setBy ? stored(form.refresher.setBy, rec?.refresher.setBy) : form.refresher.setBy;
    const input: CourseInput = { ...storedFields(form, rec, ['title', 'contentSummary']), durationHours: parsed !== null && Number.isFinite(parsed) ? parsed : null, refresher: form.refresher.kind === 'interval' ? { ...form.refresher, setBy: refresherSetBy } : { kind: form.refresher.kind, months: null, setBy: null } };
    const local = hours.trim() && (parsed === null || !Number.isFinite(parsed)) ? [tKey('Duración: número de horas no válido.')] : [];
    const all = [...local, ...validateCourse(input)];
    setErrors(all);
    if (all.length) return;
    const r = await run(() => saveCourse(input, courseId ?? undefined), rec ? t('Curso actualizado') : t('Curso añadido al catálogo'));
    if (r) onClose();
  };
  const err = (prefix: string) => {
    const m = errors.find((e) => e.startsWith(prefix));
    return m ? t(m) : undefined;
  };

  return (
    <Modal
      wide
      title={rec ? t('Editar curso {code}', { code: rec.code }) : t('Nuevo curso')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Guardar curso')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label={t('Título')} required className="span-2" value={form.title} onChange={(e) => set('title', e.target.value)} error={err('Título')} />
        <TextField label={t('Proveedor')} required value={form.providerName} onChange={(e) => set('providerName', e.target.value)} error={err('Proveedor')} />
        <SelectField label={t('Modalidad')} value={form.modality} onChange={(e) => set('modality', e.target.value as TrainingCourse['modality'])}>
          {(Object.keys(MODALITY) as TrainingCourse['modality'][]).map((m) => (
            <option key={m} value={m}>
              {t(MODALITY[m])}
            </option>
          ))}
        </SelectField>
        <TextField label={t('Duración (horas)')} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} error={err('Duración')} />
        <TextAreaField label={t('Contenido')} className="span-all" rows={2} value={form.contentSummary} onChange={(e) => set('contentSummary', e.target.value)} />
      </div>
      <fieldset className="ev-fieldset">
        <legend>{t('Riesgos relacionados')}</legend>
        {tags.length === 0 ? (
          <p className="small muted">{t('No hay etiquetas de riesgo configuradas.')}</p>
        ) : (
          <div className="ev-tag-grid">
            {tags.map((tag) => (
              <label key={tag.id} className="checkbox">
                <input type="checkbox" checked={form.riskTags.includes(tag.id)} onChange={(e) => set('riskTags', e.target.checked ? [...form.riskTags, tag.id] : form.riskTags.filter((x) => x !== tag.id))} />
                <span>{tag.label}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset className="ev-fieldset">
        <legend>{t('Reciclaje o actualización')}</legend>
        <div className="stack">
          <Callout tone="info">{t('No se aplica ninguna periodicidad por defecto (por ejemplo, anual). Indique solo la que haya fijado el proveedor, una norma o la evaluación de riesgos, y quién la fijó.')}</Callout>
          <div className="form-grid">
            <SelectField label={t('Regla de reciclaje')} value={form.refresher.kind} onChange={(e) => set('refresher', { ...form.refresher, kind: e.target.value as TrainingCourse['refresher']['kind'] })} error={err('Reciclaje')}>
              <option value="none">{t('Sin reciclaje establecido')}</option>
              <option value="interval">{t('Periodicidad fijada por el proveedor o una norma')}</option>
              <option value="not_determined">{t('No determinado: requiere decisión profesional')}</option>
            </SelectField>
            {form.refresher.kind === 'interval' && (
              <>
                <TextField label={t('Meses')} required inputMode="numeric" value={form.refresher.months ?? ''} onChange={(e) => set('refresher', { ...form.refresher, months: e.target.value ? Number(e.target.value) || null : null })} />
                <TextField label={t('Fijada por')} required className="span-2" value={form.refresher.setBy ?? ''} onChange={(e) => set('refresher', { ...form.refresher, setBy: e.target.value })} hint={t('Proveedor, norma o evaluación que establece la periodicidad.')} />
              </>
            )}
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}

/** Assign a course to an employee, optionally linked to the training requirement it serves. */
export function AssignModal({ initialEmployeeId, initialCourseId, initialTemplateId, onClose }: { initialEmployeeId?: ID; initialCourseId?: ID; initialTemplateId?: ID | null; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [employeeId, setEmployeeId] = useState<ID>(initialEmployeeId ?? '');
  const [courseId, setCourseId] = useState<ID>(initialCourseId ?? '');
  const [templateId, setTemplateId] = useState<ID>(initialTemplateId ?? '');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const employees = useMemo(() => {
    const ids = visibleEmployeeIds(ctx);
    return ctx.db.employees.filter((e) => ids.has(e.id) && e.status === 'active').sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es'));
  }, [ctx]);
  const courses = ctx.db.courses.filter((c) => c.companyId === ctx.company.id && c.active);
  const trainingTemplates = useMemo(() => {
    const seen = new Set<ID>();
    return ctx.db.versions
      .filter((v) => v.companyId === ctx.company.id && v.evidenceMode === 'training' && (v.status === 'active' || v.status === 'scheduled'))
      .filter((v) => !seen.has(v.templateId) && !!seen.add(v.templateId))
      .map((v) => ({ id: v.templateId, code: ctx.db.templates.find((x) => x.id === v.templateId)?.code ?? '', name: v.name, courseId: v.courseId }));
  }, [ctx]);
  const chooseCourse = (id: ID) => {
    setCourseId(id);
    if (!templateId) {
      const match = trainingTemplates.find((x) => x.courseId === id);
      if (match) setTemplateId(match.id);
    }
  };
  const submit = async () => {
    setTouched(true);
    if (!employeeId || !courseId) return;
    const r = await run(() => assignTraining({ employeeId, courseId, templateId: templateId || null, scheduledDate: date || null, note }), t('Formación asignada a {name}', { name: employeeName(ctx.db, employeeId) }));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Asignar formación')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Asignar')}
          </Button>
        </>
      }
    >
      <SelectField label={t('Persona trabajadora')} required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} error={touched && !employeeId ? t('Obligatorio.') : undefined}>
        <option value="">{t('Seleccione…')}</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.firstName} {e.lastName}
          </option>
        ))}
      </SelectField>
      <SelectField label={t('Curso')} required value={courseId} onChange={(e) => chooseCourse(e.target.value)} error={touched && !courseId ? t('Obligatorio.') : undefined}>
        <option value="">{t('Seleccione…')}</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.title}
          </option>
        ))}
      </SelectField>
      <SelectField label={t('Requisito vinculado')} value={templateId} onChange={(e) => setTemplateId(e.target.value)} hint={t('El requisito se cumple solo cuando se acepte la evidencia, no con la asistencia ni con la finalización.')}>
        <option value="">{t('Sin requisito vinculado')}</option>
        {trainingTemplates.map((x) => (
          <option key={x.id} value={x.id}>
            {x.code} · {x.name}
          </option>
        ))}
      </SelectField>
      <TextField label={t('Fecha prevista (opcional)')} type="date" min={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} />
      <TextAreaField label={t('Nota')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

const DATE_DIALOG = {
  schedule: { title: tKey('Programar formación'), label: tKey('Fecha prevista'), ok: tKey('Formación programada'), button: tKey('Programar') },
  attendance: { title: tKey('Registrar asistencia'), label: tKey('Fecha de asistencia'), ok: tKey('Asistencia registrada. No acredita la finalización ni sustituye a la evidencia.'), button: tKey('Registrar asistencia') },
  completion: { title: tKey('Registrar finalización'), label: tKey('Fecha de finalización'), ok: tKey('Finalización registrada. El requisito se cumple solo cuando se acepte la evidencia.'), button: tKey('Registrar finalización') },
} as const;

/** Schedule, attendance or completion of an assignment (separate facts, each with its own date). */
export function TrainingDateModal({ training, kind, onClose }: { training: TrainingAssignment; kind: keyof typeof DATE_DIALOG; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const course = ctx.db.courses.find((c) => c.id === training.courseId);
  const [date, setDate] = useState(kind === 'schedule' ? training.scheduledDate ?? '' : kind === 'attendance' ? (training.scheduledDate && training.scheduledDate <= ctx.today ? training.scheduledDate : '') : '');
  const [hours, setHours] = useState(course?.durationHours != null ? String(course.durationHours) : '');
  const [touched, setTouched] = useState(false);
  const d = DATE_DIALOG[kind];
  const submit = async () => {
    setTouched(true);
    if (!date) return;
    const h = hours.trim() ? Number(hours.replace(',', '.')) : null;
    const r = await run(
      () => (kind === 'schedule' ? scheduleTraining(training.id, date) : kind === 'attendance' ? recordAttendance(training.id, date) : recordCompletion(training.id, date, h !== null && Number.isFinite(h) ? h : null)),
      t(d.ok),
    );
    if (r) onClose();
  };
  return (
    <Modal
      title={t(d.title)}
      description={`${employeeName(ctx.db, training.employeeId)} · ${course ? `${course.code} · ${course.title}` : training.courseId}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t(d.button)}
          </Button>
        </>
      }
    >
      {kind === 'attendance' && <Callout tone="info">{t('La asistencia es un hecho distinto de la finalización y de la aceptación de la evidencia.')}</Callout>}
      {kind === 'completion' && <Callout tone="info">{t('La finalización no cumple el requisito por sí sola: después hay que aportar la evidencia y que la autoridad de revisión la acepte.')}</Callout>}
      <TextField
        label={t(d.label)}
        type="date"
        required
        min={kind === 'schedule' ? ctx.today : kind === 'completion' ? training.attendanceDate ?? undefined : undefined}
        max={kind === 'schedule' ? undefined : ctx.today}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        error={touched && !date ? t('Obligatorio.') : undefined}
      />
      {kind === 'completion' && <TextField label={t('Horas realizadas (opcional)')} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />}
    </Modal>
  );
}
