/**
 * Dialogs of the EPI screen: catalogue item, issue / replacement, return or loss, and the issue
 * detail with its history. All writes go through trainingService / evidenceService.
 */
import { CheckCircle2, ClipboardCheck, FileText, RefreshCw, Undo2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { EmployeeLink, WorksiteLink } from '../../components/bits';
import { Badge, Button, Callout, Checkbox, DateText, DateTimeText, KV, Modal, SelectField, StatusBadge, TextAreaField, TextField, useAction } from '../../components/ui';
import { assignmentOn } from '../../domain/requirements';
import { ISSUE_STATUS } from '../../domain/status';
import { formatDate, isValidISODate } from '../../domain/time';
import type { Acknowledgement, EquipmentIssue, EquipmentItem, ReviewRule } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { roleName, visibleEmployeeIds, worksiteName } from '../../services/context';
import { issueEquipment, closeIssue, saveEquipment, suggestedReplacement, validateIssue, type EquipmentInput, type IssueInput } from '../../services/trainingService';
import { getDb } from '../../store/db';
import { shown, stored, storedFields } from '../../components/localizedForm';
import { useCtx } from '../../store/hooks';
import { ErrorList, MultiCheck, PpeSchedule, ScheduledDate } from './shared';

export const ACK_METHOD_LABEL: Record<Acknowledgement['method'], string> = {
  in_app: tKey('Confirmada en la aplicación'),
  paper_recorded: tKey('Firmada en papel y registrada por la empresa'),
};

const SCHEDULE_KIND_LABEL: Record<ReviewRule['kind'], string> = {
  none: tKey('Sin calendario configurado'),
  interval: tKey('Periodicidad fijada por el fabricante o el servicio de prevención'),
  per_document: tKey('Según el folleto informativo del fabricante'),
  not_determined: tKey('Pendiente de que lo determine un profesional'),
};

// ─────────────────────────────── Catalogue item ───────────────────────────────

const EMPTY_ITEM: EquipmentInput = { name: '', type: '', description: '', jobRoleIds: [], riskTags: [], worksiteIds: [], replacement: { kind: 'none', months: null, setBy: null }, identifierRequired: false };

export function EquipmentDialog({ item, onClose }: { item: EquipmentItem | null; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  // Texts are shown in the interface language; unchanged ones are saved back as the stored Spanish.
  const [raw] = useState(() => (item ? getDb().equipment.find((x) => x.id === item.id) ?? item : null));
  const [f, setF] = useState<EquipmentInput>(() =>
    raw ? { name: shown(raw.name), type: shown(raw.type), description: shown(raw.description), jobRoleIds: [...raw.jobRoleIds], riskTags: [...raw.riskTags], worksiteIds: [...raw.worksiteIds], replacement: { ...raw.replacement, setBy: raw.replacement.setBy && shown(raw.replacement.setBy) }, identifierRequired: raw.identifierRequired } : EMPTY_ITEM,
  );
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<EquipmentInput>) => setF((p) => ({ ...p, ...patch }));
  const setRule = (patch: Partial<ReviewRule>) => setF((p) => ({ ...p, replacement: { ...p.replacement, ...patch } }));
  const roles = ctx.db.jobRoles.filter((r) => r.companyId === ctx.company.id && r.active);
  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id);
  const sites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && w.active);
  const months = f.replacement.months;
  const errs = {
    name: !f.name.trim() ? t('Obligatorio.') : undefined,
    type: !f.type.trim() ? t('Obligatorio.') : undefined,
    months: f.replacement.kind === 'interval' && !(months && months > 0) ? t('Indique los meses.') : undefined,
    setBy: f.replacement.kind === 'interval' && !f.replacement.setBy?.trim() ? t('Indique la fuente de la periodicidad.') : undefined,
  };
  const save = async () => {
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    const setBy = f.replacement.setBy ? stored(f.replacement.setBy, raw?.replacement.setBy) : f.replacement.setBy;
    const input: EquipmentInput = {
      ...storedFields(f, raw, ['name', 'type', 'description']),
      replacement: f.replacement.kind === 'interval' ? { ...f.replacement, setBy } : f.replacement.kind === 'per_document' ? { kind: 'per_document', months: null, setBy: setBy?.trim() || null } : { kind: f.replacement.kind, months: null, setBy: null },
    };
    const r = await run(() => saveEquipment(input, item?.id), item ? t('Equipo actualizado en el catálogo') : t('Equipo añadido al catálogo'));
    if (r) onClose();
  };
  return (
    <Modal
      wide
      title={item ? t('Editar equipo {code}', { code: item.code }) : t('Nuevo equipo de protección')}
      description={t('El catálogo describe equipos de ejemplo. La evaluación de riesgos y la política preventiva deciden qué equipo es necesario.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={save}>
            {item ? t('Guardar cambios') : t('Añadir al catálogo')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <TextField label={t('Nombre')} required value={f.name} onChange={(e) => set({ name: e.target.value })} error={touched ? errs.name : undefined} />
          <TextField label={t('Tipo de protección')} required value={f.type} onChange={(e) => set({ type: e.target.value })} error={touched ? errs.type : undefined} placeholder={t('Por ejemplo, protección de manos')} />
          <TextAreaField className="span-all" label={t('Descripción')} rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="grid-3">
          <MultiCheck legend={t('Puestos a los que se aplica')} options={roles.map((r) => ({ id: r.id, label: r.name }))} value={f.jobRoleIds} onChange={(v) => set({ jobRoleIds: v })} />
          <MultiCheck legend={t('Riesgos relacionados')} options={tags.map((r) => ({ id: r.id, label: r.label }))} value={f.riskTags} onChange={(v) => set({ riskTags: v })} />
          <MultiCheck legend={t('Centros de trabajo')} options={sites.map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` }))} value={f.worksiteIds} onChange={(v) => set({ worksiteIds: v })} hint={t('Déjelo vacío si no depende del centro.')} />
        </div>
        <fieldset>
          <legend>{t('Inspección o sustitución')}</legend>
          <div className="form-grid">
            <SelectField label={t('Calendario [EPI]')} value={f.replacement.kind} onChange={(e) => setRule({ kind: e.target.value as ReviewRule['kind'] })}>
              {(Object.keys(SCHEDULE_KIND_LABEL) as ReviewRule['kind'][]).map((k) => (
                <option key={k} value={k}>
                  {t(SCHEDULE_KIND_LABEL[k])}
                </option>
              ))}
            </SelectField>
            {f.replacement.kind === 'interval' && (
              <>
                <TextField label={t('Meses')} required type="number" min={1} max={240} inputMode="numeric" value={months ?? ''} onChange={(e) => setRule({ months: e.target.value ? Number(e.target.value) : null })} error={touched ? errs.months : undefined} />
                <TextField label={t('Fuente de la periodicidad')} required value={f.replacement.setBy ?? ''} onChange={(e) => setRule({ setBy: e.target.value })} error={touched ? errs.setBy : undefined} hint={t('Fabricante (folleto informativo) o servicio de prevención.')} />
              </>
            )}
            {f.replacement.kind === 'per_document' && <TextField label={t('Referencia del folleto')} value={f.replacement.setBy ?? ''} onChange={(e) => setRule({ setBy: e.target.value })} />}
          </div>
          <p className="tiny muted" style={{ margin: '8px 0 0' }}>
            {t('No se aplica ninguna periodicidad por defecto. Si nadie la ha fijado, elija «Sin calendario configurado» o «Pendiente de que lo determine un profesional».')}
          </p>
        </fieldset>
        <Checkbox label={t('Requiere identificador (número de serie o lote) en cada entrega')} checked={f.identifierRequired} onChange={(v) => set({ identifierRequired: v })} />
      </div>
    </Modal>
  );
}

// ─────────────────────────────── Issue / replacement ───────────────────────────────

export function IssueDialog({ replacing, onClose }: { replacing: EquipmentIssue | null; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const visible = visibleEmployeeIds(ctx);
  const employees = ctx.db.employees
    .filter((e) => e.companyId === ctx.company.id && e.status === 'active' && visible.has(e.id))
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'es'));
  const items = ctx.db.equipment.filter((x) => x.companyId === ctx.company.id && (x.active || x.id === replacing?.itemId));
  const [f, setF] = useState<IssueInput>(() => {
    const itemId = replacing?.itemId ?? '';
    return { employeeId: replacing?.employeeId ?? '', itemId, identifier: '', size: replacing?.size ?? '', worksiteId: replacing?.worksiteId ?? null, issuedAt: ctx.today, replacementDue: suggestedReplacement(items.find((i) => i.id === itemId), ctx.today), note: '' };
  });
  const [dueTouched, setDueTouched] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const item = items.find((i) => i.id === f.itemId);
  const suggestion = isValidISODate(f.issuedAt) ? suggestedReplacement(item, f.issuedAt) : null;

  const update = (patch: Partial<IssueInput>) =>
    setF((prev) => {
      const next = { ...prev, ...patch };
      if (!dueTouched && ('itemId' in patch || 'issuedAt' in patch)) next.replacementDue = isValidISODate(next.issuedAt) ? suggestedReplacement(items.find((i) => i.id === next.itemId), next.issuedAt) : null;
      if ('employeeId' in patch) next.worksiteId = null;
      return next;
    });
  const sites = f.employeeId ? assignmentOn(ctx.db, f.employeeId, ctx.today)?.worksiteIds ?? [] : [];

  const submit = async () => {
    const errs = [...(f.employeeId ? [] : [tKey('Persona trabajadora: obligatoria.')]), ...validateIssue(ctx, f)];
    setErrors(errs);
    if (errs.length) return;
    const r = await run(() => issueEquipment(f, replacing?.id), t('Entrega registrada. Queda pendiente la confirmación de recepción.'));
    if (r) onClose();
  };

  return (
    <Modal
      wide
      title={replacing ? t('Sustituir equipo entregado') : t('Registrar entrega de equipo')}
      description={t('La entrega, la confirmación de recepción y el documento de soporte se registran por separado.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {replacing ? t('Registrar sustitución') : t('Registrar entrega')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {replacing && (
          <Callout tone="info">
            {replacing.status === 'lost'
              ? t('Nueva entrega para reponer el equipo perdido o dañado (entregado el {date}). La entrega anterior se conserva como perdida.', { date: formatDate(replacing.issuedAt) })
              : t('Sustituye la entrega del {date}. La entrega anterior quedará como sustituida y se conserva en el historial.', { date: formatDate(replacing.issuedAt) })}
          </Callout>
        )}
        <ErrorList errors={errors} />
        <div className="form-grid">
          <SelectField label={t('Persona trabajadora')} required value={f.employeeId} disabled={!!replacing} onChange={(e) => update({ employeeId: e.target.value })}>
            <option value="">{t('Seleccione…')}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName} · {e.code}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Equipo [EPI]')} required value={f.itemId} onChange={(e) => update({ itemId: e.target.value })}>
            <option value="">{t('Seleccione…')}</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} · {i.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t('Identificador (serie o lote)')} required={!!item?.identifierRequired} value={f.identifier} onChange={(e) => update({ identifier: e.target.value })} hint={item?.identifierRequired ? t('Este equipo requiere identificador.') : t('Opcional para este equipo.')} />
          <TextField label={t('Talla')} value={f.size} onChange={(e) => update({ size: e.target.value })} />
          <SelectField label={t('Centro de trabajo')} value={f.worksiteId ?? ''} onChange={(e) => update({ worksiteId: e.target.value || null })} hint={f.employeeId && !sites.length ? t('La persona no tiene centros asignados hoy.') : undefined}>
            <option value="">{t('Sin centro concreto')}</option>
            {sites.map((w) => (
              <option key={w} value={w}>
                {worksiteName(ctx.db, w)}
              </option>
            ))}
          </SelectField>
          <TextField label={t('Fecha de entrega')} required type="date" max={ctx.today} value={f.issuedAt} onChange={(e) => update({ issuedAt: e.target.value })} />
          <TextField
            label={t('Revisión o sustitución programada')}
            type="date"
            value={f.replacementDue ?? ''}
            onChange={(e) => {
              setDueTouched(true);
              update({ replacementDue: e.target.value || null });
            }}
            hint={!item ? undefined : suggestion ? t('Propuesta según la periodicidad configurada en el catálogo. Puede cambiarla o dejarla vacía.') : t('El equipo no tiene periodicidad configurada: no se propone ninguna fecha.')}
          />
          <TextAreaField className="span-all" label={t('Nota')} rows={2} value={f.note} onChange={(e) => update({ note: e.target.value })} />
        </div>
        {item && (
          <div className="sf-item-summary small">
            <div className="strong">{item.name}</div>
            {item.description && <div className="muted">{item.description}</div>}
            <div className="row-wrap" style={{ marginTop: 4 }}>
              <span className="muted">{t('Calendario [EPI]')}:</span> <PpeSchedule rule={item.replacement} />
            </div>
          </div>
        )}
        <Callout tone="neutral">{t('Registrar la entrega no decide que el equipo sea adecuado o suficiente: eso corresponde a la evaluación de riesgos. La persona trabajadora deberá confirmar la recepción.')}</Callout>
      </div>
    </Modal>
  );
}

// ─────────────────────────────── Return / loss ───────────────────────────────

export function CloseIssueDialog({ issue, onClose }: { issue: EquipmentIssue; onClose: () => void }) {
  const ctx = useCtx();
  const { runOk, pending } = useAction();
  const [status, setStatus] = useState<'returned' | 'lost'>('returned');
  const [date, setDate] = useState(ctx.today);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const item = ctx.db.equipment.find((x) => x.id === issue.itemId);
  const dateErr = !isValidISODate(date) ? t('Fecha no válida.') : date > ctx.today || date < issue.issuedAt ? t('La fecha debe estar entre la entrega y hoy.') : undefined;
  const reasonErr = !reason.trim() ? t('Obligatorio.') : undefined;
  const submit = async () => {
    setTouched(true);
    if (dateErr || reasonErr) return;
    const ok = await runOk(() => closeIssue(issue.id, status, date, reason), status === 'returned' ? t('Devolución registrada') : t('Pérdida o daño registrado: requiere una nueva entrega'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('Cerrar entrega')}
      description={`${item?.name ?? issue.itemId}${issue.identifier ? ` · ${issue.identifier}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant={status === 'lost' ? 'danger' : 'primary'} loading={pending} onClick={submit}>
            {status === 'returned' ? t('Registrar devolución') : t('Registrar pérdida o daño')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <fieldset>
          <legend>{t('Motivo del cierre')}</legend>
          <div className="stack-sm">
            <label className="checkbox">
              <input type="radio" name="close-kind" checked={status === 'returned'} onChange={() => setStatus('returned')} />
              <span>{t('Devuelto por la persona trabajadora')}</span>
            </label>
            <label className="checkbox">
              <input type="radio" name="close-kind" checked={status === 'lost'} onChange={() => setStatus('lost')} />
              <span>{t('Perdido o dañado (requiere una nueva entrega)')}</span>
            </label>
          </div>
        </fieldset>
        <TextField label={t('Fecha')} required type="date" min={issue.issuedAt} max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} error={touched ? dateErr : undefined} />
        <TextAreaField label={t('Motivo (queda registrado en la auditoría)')} required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={touched ? reasonErr : undefined} />
      </div>
    </Modal>
  );
}

// ─────────────────────────────── Issue detail ───────────────────────────────

/** One-line history of an issue (replacement chain, return, loss). */
export function issueHistoryText(issue: EquipmentIssue, all: EquipmentIssue[]): string | null {
  const fmt = (d: string | null) => (d ? formatDate(d) : '—');
  const next = issue.replacedById ? all.find((x) => x.id === issue.replacedById) : undefined;
  const prev = all.find((x) => x.replacedById === issue.id);
  if (issue.status === 'replaced') return t('Sustituido por la entrega del {date}', { date: fmt(next?.issuedAt ?? null) });
  if (issue.status === 'returned') return t('Devuelto el {date}', { date: fmt(issue.returnedAt) });
  if (issue.status === 'lost') return next ? t('Perdido o dañado el {date}; repuesto el {next}', { date: fmt(issue.returnedAt), next: fmt(next.issuedAt) }) : t('Perdido o dañado el {date}; sin reponer', { date: fmt(issue.returnedAt) });
  if (prev) return t('Sustituye a la entrega del {date}', { date: fmt(prev.issuedAt) });
  return null;
}

export function IssueDetailDialog({ issue, ack, onClose, onReplace, onCloseIssue, onPaperAck }: { issue: EquipmentIssue; ack: Acknowledgement | undefined; onClose: () => void; onReplace: () => void; onCloseIssue: () => void; onPaperAck: () => void }) {
  const ctx = useCtx();
  const item = ctx.db.equipment.find((x) => x.id === issue.itemId);
  const all = ctx.db.issues.filter((x) => x.companyId === ctx.company.id);
  const chain = all.filter((x) => x.id === issue.replacedById || x.replacedById === issue.id);
  const manage = ctx.can('ppe.manage');
  const doc = issue.documentId ? ctx.db.documents.find((d) => d.id === issue.documentId) : undefined;
  const role = assignmentOn(ctx.db, issue.employeeId, ctx.today)?.jobRoleId;
  return (
    <Modal wide title={t('Entrega de equipo')} description={`${item?.code ?? ''} · ${item?.name ?? issue.itemId}`} onClose={onClose} footer={<Button onClick={onClose}>{t('Cerrar')}</Button>}>
      <div className="stack">
        {manage && (issue.status === 'issued' || (issue.status === 'lost' && !issue.replacedById)) && (
          <div className="row-wrap">
            {issue.status === 'issued' && !ack && (
              <Button icon={ClipboardCheck} onClick={onPaperAck}>
                {t('Registrar confirmación en papel')}
              </Button>
            )}
            <Button icon={RefreshCw} onClick={onReplace}>
              {issue.status === 'lost' ? t('Nueva entrega') : t('Sustituir')}
            </Button>
            {issue.status === 'issued' && (
              <Button icon={Undo2} onClick={onCloseIssue}>
                {t('Devolución o pérdida')}
              </Button>
            )}
          </div>
        )}
        <div className="sf-kv">
          <KV
            items={[
              [t('Persona trabajadora'), <EmployeeLink id={issue.employeeId} />],
              [t('Puesto actual'), role ? roleName(ctx.db, role) : '—'],
              [t('Equipo [EPI]'), item ? `${item.code} · ${item.name}` : issue.itemId],
              [t('Identificador'), issue.identifier || <span className="muted">—</span>],
              [t('Talla'), issue.size || <span className="muted">—</span>],
              [t('Centro de trabajo'), issue.worksiteId ? <WorksiteLink id={issue.worksiteId} /> : <span className="muted">{t('Sin centro concreto')}</span>],
              [t('Fecha de entrega'), <DateText date={issue.issuedAt} />],
              [t('Estado'), <StatusBadge meta={ISSUE_STATUS[issue.status]} />],
              [
                t('Confirmación de recepción'),
                ack ? (
                  <span className="stack-sm" style={{ gap: 0 }}>
                    <span>
                      <CheckCircle2 size={13} aria-hidden style={{ verticalAlign: -2, color: 'var(--success)' }} /> <DateTimeText at={ack.acknowledgedAt} />
                    </span>
                    <span className="tiny muted">{t(ACK_METHOD_LABEL[ack.method])}</span>
                  </span>
                ) : issue.status === 'issued' ? (
                  <Badge tone="warning">{t('Pendiente')}</Badge>
                ) : (
                  <span className="muted">{t('Sin confirmación registrada')}</span>
                ),
              ],
              [t('Revisión o sustitución programada'), <ScheduledDate date={issue.replacementDue} today={ctx.today} />],
              [t('Documento de soporte'), doc ? <Link to={`/documentacion/${doc.id}`}><FileText size={13} aria-hidden style={{ verticalAlign: -2 }} /> {doc.code} · {doc.title}</Link> : <span className="muted">{t('Sin documento vinculado')}</span>],
              [t('Nota'), issue.note || <span className="muted">—</span>],
            ]}
          />
        </div>
        {(issue.status === 'lost' || issue.status === 'returned') && (
          <Callout tone={issue.status === 'lost' ? 'warning' : 'neutral'} icon={issue.status === 'lost' ? XCircle : undefined}>
            {issueHistoryText(issue, all)}
          </Callout>
        )}
        {chain.length > 0 && (
          <div>
            <h3 className="sf-h3">{t('Entregas relacionadas')}</h3>
            <ul className="sf-plain-list">
              {chain.map((c) => (
                <li key={c.id} className="row-wrap">
                  <DateText date={c.issuedAt} /> <StatusBadge meta={ISSUE_STATUS[c.status]} /> <span className="small muted">{c.identifier || ''}</span>
                  <span className="small">{c.id === issue.replacedById ? t('Entrega posterior') : t('Entrega anterior')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h3 className="sf-h3">{t('Historial de auditoría')}</h3>
          <AuditList filter={(e) => e.entityId === issue.id || (e.entityType === 'ppe' && chain.some((c) => c.id === e.entityId))} limit={20} />
        </div>
      </div>
    </Modal>
  );
}
