import {
  BookCopy,
  History,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  approveDocumentVersion,
  createDocument,
  createNewDocumentVersion,
} from '../services/documentService';
import { DOC_STATUS } from '../domain/status';
import { formatDate, formatInstant, today } from '../domain/time';
import type {
  DocumentType,
  PrivacyDocument,
} from '../domain/types';
import { useCtx } from '../store/hooks';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  FormField,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  useToast,
} from '../components/ui';
import { t } from '../i18n';

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  privacy_notice: 'Cláusula / Aviso de privacidad web',
  internal_policy: 'Política interna de protección de datos',
  dpa_processor_contract: 'Contrato de encargo (Art. 28 RGPD)',
  procedure: 'Procedimiento de gestión de brechas / derechos',
  retention_schedule: 'Cuadro de conservación y plazos',
  security_instruction: 'Normativa de uso de dispositivos y claves',
  other_evidence: 'Otra evidencia o protocolo de cumplimiento',
};

export function DocumentsPage() {
  const ctx = useCtx();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(searchParams.get('crear') === '1');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(searchParams.get('id'));
  const [newVersionDoc, setNewVersionDoc] = useState<PrivacyDocument | null>(null);

  const documents = ctx.db.documents.filter((d) => d.companyId === ctx.company.id);

  const filtered = documents.filter((doc) => {
    if (filterType !== 'all' && doc.type !== filterType) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        doc.reference.toLowerCase().includes(q) ||
        doc.title.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const selectedDoc = selectedDocId
    ? documents.find((d) => d.id === selectedDocId) ?? null
    : null;

  const versionsOfSelected = selectedDoc
    ? ctx.db.documentVersions
        .filter((v) => v.documentId === selectedDoc.id)
        .sort((a, b) => b.version - a.version)
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Documentos, Políticas y Contratos DPA')}</h1>
          <p className="page-subtitle">
            {t(
              'Repositorio formal de políticas internas, contratos de encargo de tratamiento (Art. 28), cláusulas informativas y procedimientos de privacidad con control estricto de versiones inmutables.'
            )}
          </p>
        </div>
        <div className="page-actions">
          {ctx.can('documents.manage') && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setSearchParams({ crear: '1' });
                setCreateOpen(true);
              }}
            >
              {t('Nuevo documento')}
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="row wrap gap-3 items-center">
          <div className="grow" style={{ minWidth: 240 }}>
            <Input
              placeholder={t('Buscar documento por código o título…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ width: 240 }}>
            <Select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              aria-label={t('Tipo de documento')}
            >
              <option value="all">{t('Todos los tipos de documentos')}</option>
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>

          {(search || filterType !== 'all') && (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              onClick={() => {
                setSearch('');
                setFilterType('all');
              }}
            >
              {t('Limpiar')}
            </Button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <thead>
            <tr>
              <th>{t('Referencia')}</th>
              <th>{t('Título del documento')}</th>
              <th>{t('Tipo')}</th>
              <th>{t('Versión vigente')}</th>
              <th>{t('Última revisión')}</th>
              <th>{t('Próxima revisión')}</th>
              <th>{t('Acciones')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted">
                  <EmptyState icon={BookCopy} title="Sin documentos coincidentes">
                    {t('No se encontraron políticas o contratos con los filtros indicados.')}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered.map((doc) => {
                const latestVer = ctx.db.documentVersions.find(
                  (v) => v.documentId === doc.id && v.version === doc.currentVersion
                );

                return (
                  <tr
                    key={doc.id}
                    className="clickable hover-surface"
                    onClick={() => {
                      setSelectedDocId(doc.id);
                      setSearchParams({ id: doc.id });
                    }}
                  >
                    <td>
                      <span className="font-mono font-semibold">{doc.reference}</span>
                    </td>
                    <td>
                      <div className="strong">{doc.title}</div>
                      <div className="tiny muted">{DOC_TYPE_LABELS[doc.type]}</div>
                    </td>
                    <td>
                      <Badge tone="info">{doc.type}</Badge>
                    </td>
                    <td>
                      <div className="row items-center gap-1">
                        <span className="font-mono strong">v{doc.currentVersion}</span>
                        {latestVer && (
                          <Badge tone={DOC_STATUS[latestVer.status].tone}>
                            {DOC_STATUS[latestVer.status].label}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="tiny">{formatDate(doc.lastReviewDate)}</span>
                    </td>
                    <td>
                      <span className="tiny">{formatDate(doc.nextReviewDate)}</span>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDocId(doc.id);
                          setSearchParams({ id: doc.id });
                        }}
                      >
                        {t('Historial y versiones')}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {/* Drawer: Document Details & Version History (Scenario 10) */}
      {selectedDoc && (
        <Drawer
          title={`${selectedDoc.reference} · ${selectedDoc.title}`}
          subtitle={
            <div className="row items-center gap-2 mt-1">
              <Badge tone="info">{DOC_TYPE_LABELS[selectedDoc.type]}</Badge>
              <span className="tiny muted">
                {t('Versión actual:')} v{selectedDoc.currentVersion}
              </span>
            </div>
          }
          onClose={() => {
            setSelectedDocId(null);
            setSearchParams({});
          }}
          footer={
            <div className="row between items-center w-full">
              <div>
                {ctx.can('documents.manage') && (
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() => setNewVersionDoc(selectedDoc)}
                  >
                    {t('Crear nueva versión')}
                  </Button>
                )}
              </div>
              <div className="tiny muted">
                {t('Las versiones aprobadas son inmutables para auditoría.')}
              </div>
            </div>
          }
        >
          <div className="space-y-6">
            <div className="p-3 bg-surface-2 rounded text-sm grid-2 gap-2">
              <div>
                <span className="muted block tiny">{t('Código del documento:')}</span>
                <span className="font-mono strong">{selectedDoc.reference}</span>
              </div>
              <div>
                <span className="muted block tiny">{t('Fecha próxima revisión:')}</span>
                <span>{formatDate(selectedDoc.nextReviewDate)}</span>
              </div>
              <div>
                <span className="muted block tiny">{t('Tratamientos RAT vinculados:')}</span>
                <span>{selectedDoc.linkedRopaIds.length ? selectedDoc.linkedRopaIds.join(', ') : t('General corporativo')}</span>
              </div>
              <div>
                <span className="muted block tiny">{t('Fecha creación inicial:')}</span>
                <span>{formatInstant(selectedDoc.createdAt)}</span>
              </div>
            </div>

            {/* Version History Timeline (Scenario 10) */}
            <div>
              <h4 className="font-semibold text-sm mb-3 row items-center gap-1">
                <History size={16} />
                <span>{t('Historial cronológico de versiones')}</span>
              </h4>

              <div className="space-y-3">
                {versionsOfSelected.map((ver) => {
                  const statusMeta = DOC_STATUS[ver.status];
                  return (
                    <div
                      key={ver.id}
                      className="p-3 border rounded bg-surface-1 space-y-2 hover-surface"
                    >
                      <div className="row between items-center">
                        <div className="row items-center gap-2">
                          <span className="font-mono strong text-base">v{ver.version}</span>
                          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                          {ver.version === selectedDoc.currentVersion && (
                            <span className="tiny text-info font-semibold">
                              ({t('Versión en vigor')})
                            </span>
                          )}
                        </div>
                        <span className="tiny muted font-mono">
                          {formatDate(ver.effectiveDate)}
                        </span>
                      </div>

                      <div className="text-sm">
                        <span className="strong tiny muted d-block">{t('Resumen de cambios:')}</span>
                        <p className="mt-0.5">{ver.summaryOfChanges}</p>
                      </div>

                      <div className="pt-2 border-t row between items-center text-xs text-muted">
                        <div>
                          <span>
                            📄 {ver.fileMetadata.fileName} ({(ver.fileMetadata.sizeBytes / 1024).toFixed(0)} KB)
                          </span>
                          {ver.approvedAt && (
                            <span className="ml-2">
                              ✓ {t('Aprobado el')} {formatInstant(ver.approvedAt)}
                            </span>
                          )}
                        </div>

                        {ctx.can('documents.approve') && ver.status === 'in_review' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              try {
                                approveDocumentVersion(ver.id);
                                toast.success(
                                  t('Versión v{v} aprobada formalmente. La versión anterior queda preservada.', { v: ver.version })
                                );
                              } catch (e) {
                                toast.error(e);
                              }
                            }}
                          >
                            {t('Aprobar versión v{v}', { v: ver.version })}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Simulated file download notice */}
            <div className="p-3 bg-surface-2 rounded text-xs text-muted">
              {t(
                'Nota de demostración: Los archivos PDF y evidencias se representan mediante metadatos seguros de demostración en localStorage sin transferencia de documentos reales.'
              )}
            </div>
          </div>
        </Drawer>
      )}

      {/* Modal: Create Document */}
      {createOpen && (
        <CreateDocumentModal
          onClose={() => {
            setCreateOpen(false);
            setSearchParams({});
          }}
          onSaved={() => {
            setCreateOpen(false);
            setSearchParams({});
          }}
        />
      )}

      {/* Modal: Create New Version (Scenario 10) */}
      {newVersionDoc && (
        <NewVersionModal
          document={newVersionDoc}
          onClose={() => setNewVersionDoc(null)}
          onSuccess={() => {
            setNewVersionDoc(null);
            toast.success(
              t('Nueva versión v{v} creada en revisión. La versión previa aprobada se mantiene intacta en el historial.', {
                v: newVersionDoc.currentVersion + 1,
              })
            );
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Document Modals ───────────────────────────────

function CreateDocumentModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = useCtx();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<DocumentType>('internal_policy');
  const [nextReviewDate, setNextReviewDate] = useState('2027-01-15');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      createDocument(
        title,
        type,
        ctx.user.id,
        ctx.user.id,
        nextReviewDate,
        []
      );
      toast.success(t('Documento creado en borrador (v1).'));
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Nuevo Documento o Política de Privacidad')}
      onClose={onClose}
      maxWidth={520}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Título formal del documento" required>
          <Input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Política de Privacidad y Cookies en Web Corporativa"
          />
        </FormField>

        <FormField label="Tipo de documento" required>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as DocumentType)}
          >
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Fecha prevista para la próxima revisión" required>
          <Input
            required
            type="date"
            value={nextReviewDate}
            onChange={(e) => setNextReviewDate(e.target.value)}
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Crear documento')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NewVersionModal({
  document,
  onClose,
  onSuccess,
}: {
  document: PrivacyDocument;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const nextVer = document.currentVersion + 1;
  const [summary, setSummary] = useState(
    'Actualización de cláusulas conforme a las directrices de la AEPD sobre transferencias y cookies.'
  );
  const [effectiveDate, setEffectiveDate] = useState(today());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      createNewDocumentVersion(document.id, summary, effectiveDate);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Crear Versión v{v}: {ref}', { v: nextVer, ref: document.reference })}
      description={t(
        'Al crear una nueva versión, la versión v{v} anterior aprobada se conserva íntegramente en el archivo histórico sin sobrescribirse.',
        { v: document.currentVersion }
      )}
      onClose={onClose}
      maxWidth={520}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Resumen y motivación de los cambios" required hint="Explique qué apartados se han modificado o adaptado.">
          <Textarea
            required
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </FormField>

        <FormField label="Fecha de entrada en vigor" required>
          <Input
            required
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Generar versión v{v} (en revisión)', { v: nextVer })}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
