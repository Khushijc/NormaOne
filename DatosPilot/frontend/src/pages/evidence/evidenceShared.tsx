/**
 * Small helpers shared by the Documentación and Formación screens (evidence area only).
 */
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Callout, Modal, TextAreaField, TextField, useAction, useToast } from '../../components/ui';
import { KindDate } from '../../components/bits';
import { latestVersion, versionOn } from '../../domain/requirements';
import type { Database, DocumentVersion, ID, ISODate, RequirementCategory } from '../../domain/types';
import { t } from '../../i18n';
import { downloadDocument, requestEvidence } from '../../services/evidenceService';
import { employeeName } from '../../services/context';
import { useCtx } from '../../store/hooks';

/** Template code and the name of the version in force (or the latest one). */
export function templateInfo(db: Database, templateId: ID | null | undefined, date: ISODate): { code: string; name: string } | null {
  if (!templateId) return null;
  const tpl = db.templates.find((x) => x.id === templateId);
  if (!tpl) return null;
  const v = versionOn(db, templateId, date) ?? latestVersion(db, templateId);
  return { code: tpl.code, name: v?.name ?? '' };
}

/** Link to the requirement (plain text for users without requirement access). */
export function RequirementRef({ templateId, compact }: { templateId: ID | null | undefined; compact?: boolean }) {
  const ctx = useCtx();
  const info = templateInfo(ctx.db, templateId, ctx.today);
  if (!info) return <span className="muted">{t('Sin requisito vinculado')}</span>;
  const code = ctx.can('requirements.view') ? <Link to={`/requisitos/${templateId}`}>{info.code}</Link> : <span className="strong">{info.code}</span>;
  if (compact) return <span>{code} <span className="muted">· {info.name}</span></span>;
  return (
    <span>
      {code}
      <span className="sub" style={{ display: 'block' }}>{info.name}</span>
    </span>
  );
}

/** Legal expiry of a version: date, «Sin caducidad» (issuer states none) or «No indicada» (review needed). */
export function LegalExpiry({ v }: { v: Pick<DocumentVersion, 'expiryMode' | 'legalExpiryDate'> }) {
  const ctx = useCtx();
  if (v.expiryMode === 'unknown') {
    return (
      <Badge tone="warning" title={t('El emisor no indica la caducidad: revisión necesaria. No se inventa ninguna fecha.')}>
        {t('No indicada')}
      </Badge>
    );
  }
  return <KindDate kind="legal" date={v.legalExpiryDate} noExpiry={v.expiryMode === 'none'} today={ctx.today} />;
}

/** «Archivo de demostración» label for a version's file. */
export function DemoFileLabel({ v }: { v: DocumentVersion }) {
  if (!v.file) return <span className="muted small">{t('Sin archivo (solo metadatos)')}</span>;
  return (
    <span className="ev-file small">
      <FileText size={13} aria-hidden />
      <span className="ev-file-name">{v.file.name}</span>
      <span className="muted">
        · {t('Archivo de demostración')}
        {v.file.dataUrl ? '' : ` (${t('sin contenido almacenado')})`}
      </span>
    </span>
  );
}

/** Demo download: triggers a browser download when content is stored, otherwise explains it is metadata only. */
export function useDownload() {
  const toast = useToast();
  const { run, pending } = useAction();
  const download = async (versionId: ID) => {
    const f = await run(() => downloadDocument(versionId));
    if (!f) return;
    if (f.dataUrl) {
      const a = document.createElement('a');
      a.href = f.dataUrl;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(t('Descarga iniciada: {name}', { name: f.name }));
    } else {
      toast.info(t('Archivo de demostración sin contenido almacenado (solo metadatos)'));
    }
  };
  return { download, pending };
}

/** Document category suggested from the requirement category (the user can change it). */
export function suggestedCategory(cat: RequirementCategory): string {
  switch (cat) {
    case 'training':
      return 'cert_formacion';
    case 'authorisation':
      return 'autorizacion';
    case 'employee_document':
      return 'doc_empleado';
    case 'provider_document':
      return 'doc_spa';
    case 'coordination':
      return 'coordinacion';
    case 'information':
      return 'info_riesgos';
    case 'site_instruction':
      return 'instruccion_centro';
    default:
      return 'otros';
  }
}

/** Request (replacement) evidence from an employee for a requirement: internal follow-up date, never a legal deadline. */
export function RequestEvidenceModal({ employeeId, templateId, worksiteId, onClose, onDone }: { employeeId: ID; templateId: ID; worksiteId?: ID | null; onClose: () => void; onDone?: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [followUp, setFollowUp] = useState('');
  const [note, setNote] = useState('');
  const info = templateInfo(ctx.db, templateId, ctx.today);
  const open = ctx.db.requests.some((r) => r.status === 'open' && r.employeeId === employeeId && r.templateId === templateId && (r.worksiteId ?? null) === (worksiteId ?? null));
  const submit = async () => {
    const r = await run(() => requestEvidence({ employeeId, templateId, worksiteId: worksiteId ?? null, followUpDate: followUp || null, note }), t('Solicitud de evidencia registrada'));
    if (r) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal
      title={t('Solicitar evidencia')}
      description={`${employeeName(ctx.db, employeeId)} · ${info ? `${info.code} · ${info.name}` : '—'}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={open}>
            {t('Registrar solicitud')}
          </Button>
        </>
      }
    >
      {open && <Callout tone="warning">{t('Ya existe una solicitud abierta para este requisito; no se duplica.')}</Callout>}
      <TextField label={t('Seguimiento interno (opcional)')} type="date" min={ctx.today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} hint={t('Fecha interna para hacer seguimiento. No es un plazo legal.')} />
      <TextAreaField label={t('Nota para la persona trabajadora')} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="small muted">{t('La persona recibirá un aviso. La solicitud se cierra cuando se presente un documento para este requisito; presentar no implica aprobación.')}</p>
    </Modal>
  );
}
