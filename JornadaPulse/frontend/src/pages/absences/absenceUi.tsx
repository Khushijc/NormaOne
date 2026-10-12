/**
 * Small presentation helpers shared by the absence screens (list, detail, form).
 * Pure functions and labels only: every business action goes through absenceService.
 */
import { ExternalLink, FileText } from 'lucide-react';
import { canReview, canSeeAbsenceDetail } from '../../services/context';
import type { AbsenceRequest, AbsenceType, Attachment } from '../../domain/types';
import { locale, t, tKey } from '../../i18n';
import type { UiCtx } from '../../store/hooks';
import { Button, DateTimeText, EmptyState } from '../../components/ui';

/** Labels of the history actions written by absenceService and the seed. */
export const HISTORY_LABEL: Record<string, string> = {
  submitted: tKey('Solicitud enviada'),
  registered: tKey('Registrada sin aprobación'),
  approved: tKey('Aprobada'),
  rejected: tKey('Rechazada'),
  withdrawn: tKey('Retirada'),
  cancel_requested: tKey('Cancelación solicitada'),
  cancelled: tKey('Cancelada'),
  cancel_denied: tKey('Cancelación denegada'),
};

export const PAID_LABEL: Record<AbsenceType['paid'], string> = {
  paid: tKey('Retribuida'),
  unpaid: tKey('No retribuida'),
  depends: tKey('Depende del caso (lo determina la asesoría)'),
};

export const EVIDENCE_LABEL: Record<AbsenceType['evidence'], string> = {
  none: tKey('No se admite justificante'),
  optional: tKey('Justificante opcional'),
  required: tKey('Justificante obligatorio'),
};

/** Conflict codes produced by conflictsFor (stored in acknowledgedConflicts). */
export const CONFLICT_LABEL: Record<string, string> = {
  planned_shifts: tKey('Turnos planificados en esas fechas'),
  recorded_work: tKey('Registros de trabajo en esas fechas'),
  team_coverage: tKey('Cobertura del equipo'),
  holidays: tKey('Festivos en el rango'),
};

export const MASKED_NOTE = tKey('Oculto: categoría reservada');

export function typeOf(ctx: UiCtx, a: AbsenceRequest): AbsenceType | undefined {
  return ctx.db.absenceTypes.find((x) => x.id === a.typeId);
}

/** Whether the viewer may see the category, note, legal basis, decision text and evidence names. */
export function seesDetail(ctx: UiCtx, a: AbsenceRequest): boolean {
  return canSeeAbsenceDetail(ctx, a, typeOf(ctx, a));
}

/** Evidence files can be opened only by the employee and by people who review the request. */
export function canOpenEvidence(ctx: UiCtx, a: AbsenceRequest): boolean {
  if (!seesDetail(ctx, a)) return false;
  return ctx.employee?.id === a.employeeId || canReview(ctx, a.employeeId, 'absences');
}

export function formatBytes(n: number): string {
  const nf = new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 });
  if (n < 1024) return `${nf.format(n)} B`;
  if (n < 1024 * 1024) return `${nf.format(n / 1024)} KB`;
  return `${nf.format(n / (1024 * 1024))} MB`;
}

/** Opens a data URL in a new tab through a Blob URL (browsers block top-level data: navigation). */
export function openDataUrl(dataUrl: string) {
  const [head, body] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = head.includes(';base64') ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('No se ha podido leer el archivo.'));
    r.readAsDataURL(file);
  });
}

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const EVIDENCE_TYPES = /^(application\/pdf|image\/(png|jpeg))$/;

/** Attachment list (names and sizes). "Ver" only when the viewer may open evidence and the demo kept the file. */
export function AttachmentList({ items, canOpen, tz }: { items: Attachment[]; canOpen: boolean; tz: string }) {
  if (!items.length) return <EmptyState icon={FileText} title={t('Sin justificantes adjuntos')} />;
  return (
    <ul className="abs-files">
      {items.map((f) => (
        <li key={f.id}>
          <FileText size={16} aria-hidden />
          <div className="grow">
            <div className="strong abs-break">{f.fileName}</div>
            <div className="tiny muted">
              {formatBytes(f.sizeBytes)} · <DateTimeText at={f.uploadedAt} tz={tz} /> · {t('Acceso restringido')}
            </div>
          </div>
          {canOpen && f.dataUrl && (
            <Button size="sm" icon={ExternalLink} onClick={() => openDataUrl(f.dataUrl!)} aria-label={t('Ver {file} en una pestaña nueva', { file: f.fileName })}>
              {t('Ver')}
            </Button>
          )}
          {canOpen && !f.dataUrl && <span className="tiny muted">{t('Archivo no conservado en la demostración (más de 350 KB)')}</span>}
        </li>
      ))}
    </ul>
  );
}
