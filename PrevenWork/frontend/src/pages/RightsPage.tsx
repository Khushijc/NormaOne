import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarMonthBadge } from '../components/CalendarMonthBadge';
import {
  approveExtension,
  closeRightsRequest,
  decideRetentionConflict,
  reassignRightsRequest,
  recordResponseSent,
  registerRightsRequest,
  saveResponseDraft,
  verifyIdentity,
  type RightsRequestInput,
} from '../services/rightsService';
import { RIGHT_STATUS, RIGHT_TYPE } from '../domain/status';
import { formatDate, formatInstant, nowInstant } from '../domain/time';
import type { IntakeChannel, RightsRequest, RightType } from '../domain/types';
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

export function RightsPage() {
  const ctx = useCtx();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterConflict, setFilterConflict] = useState<boolean | null>(null);

  const [createOpen, setCreateOpen] = useState(searchParams.get('crear') === '1');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));

  // Action modals state
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);
  const [retentionModalOpen, setRetentionModalOpen] = useState(false);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [closureModalOpen, setClosureModalOpen] = useState(false);

  const requests = ctx.db.rightsRequests.filter((r) => r.companyId === ctx.company.id);

  const filtered = requests.filter((r) => {
    if (filterType !== 'all' && r.rightType !== filterType) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterConflict !== null && r.retentionConflict?.conflictDetected !== filterConflict) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        r.reference.toLowerCase().includes(q) ||
        r.requesterName.toLowerCase().includes(q) ||
        r.requesterEmail.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const selectedCase = selectedId
    ? requests.find((r) => r.id === selectedId) ?? null
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Solicitudes de Derechos de Interesados')}</h1>
          <p className="page-subtitle">
            {t(
              'Gestión de derechos ARCO-POL (Acceso, Rectificación, Supresión, Limitación, Portabilidad y Oposición - Art. 12-22 RGPD). Plazo de 1 mes natural, verificación de identidad y bloqueo de datos.'
            )}
          </p>
        </div>
        <div className="page-actions">
          {ctx.can('rights.manage') && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setSearchParams({ crear: '1' });
                setCreateOpen(true);
              }}
            >
              {t('Registrar solicitud')}
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="row wrap gap-3 items-center">
          <div className="grow" style={{ minWidth: 240 }}>
            <Input
              placeholder={t('Buscar por ref, solicitante o texto de petición…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ width: 170 }}>
            <Select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              aria-label={t('Tipo de derecho')}
            >
              <option value="all">{t('Todos los derechos')}</option>
              {Object.entries(RIGHT_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <div style={{ width: 170 }}>
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label={t('Estado de tramitación')}
            >
              <option value="all">{t('Todos los estados')}</option>
              {Object.entries(RIGHT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="row gap-2 items-center">
            <Button
              size="sm"
              variant={filterConflict === true ? 'primary' : 'ghost'}
              onClick={() => setFilterConflict((v) => (v === true ? null : true))}
            >
              {t('Conflicto retención')}
            </Button>
            {(search || filterType !== 'all' || filterStatus !== 'all' || filterConflict !== null) && (
              <Button
                size="sm"
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  setSearch('');
                  setFilterType('all');
                  setFilterStatus('all');
                  setFilterConflict(null);
                }}
              >
                {t('Limpiar')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <thead>
            <tr>
              <th>{t('Ref. Caso')}</th>
              <th>{t('Derecho solicitado')}</th>
              <th>{t('Solicitante')}</th>
              <th>{t('Fecha recepción')}</th>
              <th>{t('Plazo legal (Mes natural)')}</th>
              <th>{t('Identidad')}</th>
              <th>{t('Responsable')}</th>
              <th>{t('Estado')}</th>
              <th>{t('Acciones')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted">
                  <EmptyState icon={UserCheck} title="Sin solicitudes coincidentes">
                    {t('No se encontraron solicitudes con los criterios de búsqueda.')}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered.map((req) => {
                const rightMeta = RIGHT_TYPE[req.rightType];
                const statusMeta = RIGHT_STATUS[req.status];
                const owner = ctx.db.users.find((u) => u.id === req.assignedOwnerId);
                const isClosed = ['closed', 'rejected', 'withdrawn'].includes(req.status);

                return (
                  <tr
                    key={req.id}
                    className="clickable hover-surface"
                    onClick={() => {
                      setSelectedId(req.id);
                      setSearchParams({ id: req.id });
                    }}
                  >
                    <td>
                      <span className="font-mono font-semibold">{req.reference}</span>
                    </td>
                    <td>
                      <Badge tone="info">{rightMeta?.label ?? req.rightType}</Badge>
                      {req.retentionConflict?.conflictDetected && (
                        <span className="d-block tiny text-warning mt-1 font-semibold">
                          ⚠️ {t('Conflicto retención')}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="strong">{req.requesterName}</div>
                      <div className="tiny muted">{req.requesterEmail}</div>
                    </td>
                    <td>
                      <span className="tiny">{formatInstant(req.receiptTimestamp)}</span>
                    </td>
                    <td>
                      <CalendarMonthBadge
                        effectiveDeadline={req.effectiveDeadline}
                        isClosed={isClosed}
                        hasExtension={!!req.extension}
                      />
                    </td>
                    <td>
                      {req.identityCheck?.verified ? (
                        <Badge tone="success" icon={ShieldCheck}>
                          {t('Cotejada')}
                        </Badge>
                      ) : (
                        <Badge tone="warning">
                          {t('Pendiente')}
                        </Badge>
                      )}
                    </td>
                    <td>
                      <span className="tiny">{owner?.name ?? req.assignedOwnerId}</span>
                    </td>
                    <td>
                      <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(req.id);
                          setSearchParams({ id: req.id });
                        }}
                      >
                        {t('Tramitar')}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {/* Case Drawer Detail */}
      {selectedCase && (
        <Drawer
          title={`${selectedCase.reference} · ${RIGHT_TYPE[selectedCase.rightType]?.label}`}
          subtitle={
            <div className="row items-center gap-2 mt-1">
              <Badge tone={RIGHT_STATUS[selectedCase.status].tone}>
                {RIGHT_STATUS[selectedCase.status].label}
              </Badge>
              <CalendarMonthBadge
                effectiveDeadline={selectedCase.effectiveDeadline}
                isClosed={['closed', 'rejected', 'withdrawn'].includes(selectedCase.status)}
                hasExtension={!!selectedCase.extension}
              />
            </div>
          }
          onClose={() => {
            setSelectedId(null);
            setSearchParams({});
          }}
          footer={
            <div className="row between items-center w-full">
              <div className="row gap-2">
                {ctx.can('rights.manage') && !['closed', 'rejected'].includes(selectedCase.status) && (
                  <Button
                    variant="secondary"
                    icon={Users}
                    onClick={() => setReassignModalOpen(true)}
                  >
                    {t('Reasignar')}
                  </Button>
                )}

                {ctx.can('rights.decide_extension') && !selectedCase.extension && !['closed', 'rejected'].includes(selectedCase.status) && (
                  <Button
                    variant="secondary"
                    icon={Clock}
                    onClick={() => setExtensionModalOpen(true)}
                  >
                    {t('Prorrogar (+2m)')}
                  </Button>
                )}

                {ctx.can('rights.manage') && !['closed', 'rejected'].includes(selectedCase.status) && (
                  <Button
                    variant="primary"
                    icon={Send}
                    onClick={() => setResponseModalOpen(true)}
                  >
                    {t('Redactar / Enviar respuesta')}
                  </Button>
                )}
              </div>

              <div>
                {!['closed', 'rejected', 'withdrawn'].includes(selectedCase.status) && (
                  <Button
                    variant="ghost"
                    onClick={() => setClosureModalOpen(true)}
                  >
                    {t('Cerrar / Resolver caso')}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-6">
            {/* Legal Deadline Summary (Never resets upon reassignment!) */}
            <div className="p-3 bg-surface-2 rounded border space-y-2">
              <div className="row between items-center">
                <span className="strong text-sm">{t('Cómputo de Plazos (Art. 12.3 RGPD)')}</span>
                <span className="tiny text-muted">
                  {t('Canal:')} {selectedCase.intakeChannel}
                </span>
              </div>
              <div className="grid-2 gap-2 text-sm pt-1">
                <div>
                  <span className="muted block tiny">{t('Fecha/hora recepción inmutable:')}</span>
                  <span className="font-mono strong">{formatInstant(selectedCase.receiptTimestamp)}</span>
                </div>
                <div>
                  <span className="muted block tiny">{t('Plazo inicial de 1 mes natural:')}</span>
                  <span className="font-mono">{formatDate(selectedCase.standardDeadline)}</span>
                </div>
                <div>
                  <span className="muted block tiny">{t('Prórroga legal extraordinaria:')}</span>
                  <span>
                    {selectedCase.extension
                      ? `+${selectedCase.extension.monthsGranted} meses (Hasta ${formatDate(selectedCase.effectiveDeadline)})`
                      : t('No aplicada')}
                  </span>
                </div>
                <div>
                  <span className="muted block tiny">{t('Plazo de respuesta efectivo:')}</span>
                  <span className="font-mono strong text-info">
                    {formatDate(selectedCase.effectiveDeadline)}
                  </span>
                </div>
              </div>
            </div>

            {/* Requester Identity & Verification */}
            <div>
              <div className="row between items-center mb-2">
                <h4 className="font-semibold text-sm">{t('1. Acreditación de Identidad del Interesado')}</h4>
                {ctx.can('rights.manage') && !selectedCase.identityCheck?.verified && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={ShieldCheck}
                    onClick={() => {
                      verifyIdentity(
                        selectedCase.id,
                        'DNI/NIE y firma electrónica cotejados favorablemente.',
                        'Certificado digital / DNI'
                      );
                      toast.success(t('Identidad verificada formalmente.'));
                    }}
                  >
                    {t('Marcar identidad verificada')}
                  </Button>
                )}
              </div>

              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div className="grid-2 gap-2">
                  <div>
                    <span className="muted block tiny">{t('Nombre:')}</span>
                    <span>{selectedCase.requesterName}</span>
                  </div>
                  <div>
                    <span className="muted block tiny">{t('Email de contacto:')}</span>
                    <span>{selectedCase.requesterEmail}</span>
                  </div>
                  <div>
                    <span className="muted block tiny">{t('Documento DNI/NIE:')}</span>
                    <span>{selectedCase.requesterDocNumber ?? t('No aportado inicialmente')}</span>
                  </div>
                  <div>
                    <span className="muted block tiny">{t('Estado de cotejo:')}</span>
                    <Badge tone={selectedCase.identityCheck?.verified ? 'success' : 'warning'}>
                      {selectedCase.identityCheck?.verified
                        ? `${t('Acreditado')} (${selectedCase.identityCheck.method})`
                        : t('Pendiente de verificación')}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Scope & Description */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('2. Petición y Alcance en Sistemas')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Contenido de la solicitud:')}</span>
                  <p className="mt-1 bg-surface-1 p-2 rounded border text-sm">{selectedCase.description}</p>
                </div>
                <div>
                  <span className="muted block tiny">{t('Sistemas implicados:')}</span>
                  <div className="row wrap gap-1 mt-1">
                    {selectedCase.affectedSystems.map((s, idx) => (
                      <span key={idx} className="badge neutral">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Retention Conflict Safeguards (Scenario 5) */}
            {selectedCase.rightType === 'erasure' && (
              <div className="p-3 bg-warning-bg rounded border border-warning space-y-3">
                <div className="row between items-center">
                  <div className="strong row items-center gap-1 text-warning">
                    <AlertTriangle size={16} />
                    <span>{t('Salvaguarda legal de conservación / Bloqueo (Art. 32 LOPDGDD)')}</span>
                  </div>
                  {ctx.can('rights.decide_retention') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRetentionModalOpen(true)}
                    >
                      {t('Formalizar decisión de retención')}
                    </Button>
                  )}
                </div>

                <div className="text-sm">
                  {t(
                    'La solicitud de supresión («derecho al olvido») afecta a sistemas con posible obligación de retención legal (facturación, contabilidad, Seguridad Social). No se permite el borrado indiscriminado sin análisis previo.'
                  )}
                </div>

                <div className="bg-surface-1 p-2 rounded text-xs space-y-1">
                  <div>
                    <span className="strong">{t('Dictamen del revisor:')}</span>{' '}
                    {selectedCase.retentionConflict?.reviewerDecision === 'pending'
                      ? t('Pendiente de decisión motivada')
                      : selectedCase.retentionConflict?.reviewerDecision === 'restrict_block'
                      ? t('BLOQUEO DE DATOS (Art. 32 LOPDGDD): Los datos se conservan inaccesibles a disposición exclusiva de Administraciones Públicas y Tribunales.')
                      : selectedCase.retentionConflict?.reviewerDecision === 'retain_and_refuse'
                      ? t('DENEGACIÓN MOTIVADA: Los datos deben mantenerse por imperativo del Código de Comercio y LGT.')
                      : t('SUPRESIÓN FÍSICA AUTORIZADA.')}
                  </div>
                  {selectedCase.retentionConflict?.rationale && (
                    <div>
                      <span className="strong">{t('Fundamentación:')}</span> {selectedCase.retentionConflict.rationale}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Extension Information */}
            {selectedCase.extension && (
              <div className="p-3 bg-surface-2 rounded border space-y-1 text-sm">
                <div className="strong text-info">{t('Prórroga formalizada (+{n} meses)', { n: selectedCase.extension.monthsGranted })}</div>
                <div className="tiny">
                  <span className="strong">{t('Motivación:')}</span> {selectedCase.extension.grounds}
                </div>
                <div className="tiny">
                  <span className="strong">{t('Constancia de comunicación al interesado:')}</span>{' '}
                  {selectedCase.extension.communicationEvidence}
                </div>
              </div>
            )}

            {/* Response & Evidence */}
            {selectedCase.responseSentAt && (
              <div className="p-3 bg-success-bg text-success rounded border border-success space-y-1 text-sm">
                <div className="strong row items-center gap-1">
                  <CheckCircle2 size={16} />
                  <span>{t('Respuesta formal enviada')}</span>
                </div>
                <div className="tiny">
                  {t('Fecha de remisión:')} {formatInstant(selectedCase.responseSentAt)}
                </div>
                <div className="tiny">
                  <span className="strong">{t('Constancia de envío:')}</span> {selectedCase.responseEvidence}
                </div>
              </div>
            )}
          </div>
        </Drawer>
      )}

      {/* Modal: Register Rights Request (Scenario 2) */}
      {createOpen && (
        <CreateRightsRequestModal
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

      {/* Modal: Reassign Request (Scenario 3 - preserves deadline!) */}
      {reassignModalOpen && selectedCase && (
        <ReassignModal
          request={selectedCase}
          onClose={() => setReassignModalOpen(false)}
          onSuccess={() => {
            setReassignModalOpen(false);
            toast.success(t('Caso reasignado. El plazo legal original se mantiene inalterado.'));
          }}
        />
      )}

      {/* Modal: Decide Extension (Scenario 4) */}
      {extensionModalOpen && selectedCase && (
        <ExtensionModal
          request={selectedCase}
          onClose={() => setExtensionModalOpen(false)}
          onSuccess={() => {
            setExtensionModalOpen(false);
            toast.success(t('Prórroga formalizada con acreditación de comunicación.'));
          }}
        />
      )}

      {/* Modal: Retention Conflict Decision (Scenario 5) */}
      {retentionModalOpen && selectedCase && (
        <RetentionDecisionModal
          request={selectedCase}
          onClose={() => setRetentionModalOpen(false)}
          onSuccess={() => {
            setRetentionModalOpen(false);
            toast.success(t('Decisión de conservación y bloqueo registrada formalmente.'));
          }}
        />
      )}

      {/* Modal: Draft & Send Response */}
      {responseModalOpen && selectedCase && (
        <ResponseModal
          request={selectedCase}
          onClose={() => setResponseModalOpen(false)}
          onSuccess={() => {
            setResponseModalOpen(false);
            toast.success(t('Respuesta formal enviada y registrada en auditoría.'));
          }}
        />
      )}

      {/* Modal: Closure */}
      {closureModalOpen && selectedCase && (
        <ClosureModal
          request={selectedCase}
          onClose={() => setClosureModalOpen(false)}
          onSuccess={() => {
            setClosureModalOpen(false);
            toast.success(t('Caso cerrado formalmente.'));
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Sub-Modals ───────────────────────────────

function CreateRightsRequestModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = useCtx();
  const toast = useToast();

  const [rightType, setRightType] = useState<RightType>('erasure');
  const [intakeChannel, setIntakeChannel] = useState<IntakeChannel>('email');
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [requesterDocNumber, setRequesterDocNumber] = useState('');
  const [description, setDescription] = useState('');
  const [assignedOwnerId, setAssignedOwnerId] = useState(ctx.user.id);
  const [affectedSystemsStr, setAffectedSystemsStr] = useState('ERP Facturación, Servidor correo');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const input: RightsRequestInput = {
      rightType,
      intakeChannel,
      receiptTimestamp: nowInstant(),
      requesterName,
      requesterEmail,
      requesterDocNumber: requesterDocNumber.trim() || undefined,
      description,
      assignedOwnerId,
      affectedSystems: affectedSystemsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    try {
      const created = registerRightsRequest(input);
      toast.success(
        t('Solicitud registrada ({ref}). Plazo calculado por regla de mes natural: {date}', {
          ref: created.reference,
          date: formatDate(created.standardDeadline),
        })
      );
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Nueva Solicitud de Derechos')}
      description={t(
        'El plazo de 1 mes natural se calcula desde la fecha de recepción conforme al Art. 12.3 RGPD.'
      )}
      onClose={onClose}
      maxWidth={640}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid-2 gap-4">
          <FormField label="Tipo de derecho" required>
            <Select
              value={rightType}
              onChange={(e) => setRightType(e.target.value as RightType)}
            >
              {Object.entries(RIGHT_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label} ({v.article})
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Canal de entrada" required>
            <Select
              value={intakeChannel}
              onChange={(e) => setIntakeChannel(e.target.value as IntakeChannel)}
            >
              <option value="email">{t('Correo electrónico')}</option>
              <option value="web_form">{t('Formulario web')}</option>
              <option value="postal">{t('Correo postal / burofax')}</option>
              <option value="in_person">{t('Presencial en sede')}</option>
            </Select>
          </FormField>
        </div>

        <div className="grid-2 gap-4">
          <FormField label="Nombre y apellidos del solicitante" required>
            <Input
              required
              value={requesterName}
              onChange={(e) => setRequesterName(e.target.value)}
              placeholder="e.g. Vicente Morales Belda"
            />
          </FormField>

          <FormField label="Correo electrónico del solicitante" required>
            <Input
              required
              type="email"
              value={requesterEmail}
              onChange={(e) => setRequesterEmail(e.target.value)}
              placeholder="e.g. vicente.morales@correo.es"
            />
          </FormField>
        </div>

        <FormField label="DNI / NIE (acceso restringido)" hint="Opcional en la recepción inicial; se cotejará antes de facilitar datos.">
          <Input
            value={requesterDocNumber}
            onChange={(e) => setRequesterDocNumber(e.target.value)}
            placeholder="e.g. 48123456K"
          />
        </FormField>

        <FormField label="Petición del interesado" required hint="Detalle los datos solicitados, rectificaciones o supresiones requeridas.">
          <Textarea
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Solicito la supresión completa de todos mis datos personales de sus bases de datos."
          />
        </FormField>

        <div className="grid-2 gap-4">
          <FormField label="Sistemas afectados" required hint="Separados por comas">
            <Input
              value={affectedSystemsStr}
              onChange={(e) => setAffectedSystemsStr(e.target.value)}
              placeholder="ERP Facturación, CRM, Correo"
            />
          </FormField>

          <FormField label="Tramitador asignado" required>
            <Select
              value={assignedOwnerId}
              onChange={(e) => setAssignedOwnerId(e.target.value)}
            >
              {ctx.db.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.organisation})
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="modal-footer row end gap-2 pt-4">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Registrar solicitud')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReassignModal({
  request,
  onClose,
  onSuccess,
}: {
  request: RightsRequest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const ctx = useCtx();
  const toast = useToast();
  const [newOwnerId, setNewOwnerId] = useState(request.assignedOwnerId);
  const [reason, setReason] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      reassignRightsRequest(request.id, newOwnerId, reason);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Reasignar caso: {ref}', { ref: request.reference })}
      description={t(
        'La reasignación de un expediente NUNCA reinicia el plazo legal mensual del interesado (Art. 12.3 RGPD).'
      )}
      onClose={onClose}
      maxWidth={480}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-2 bg-surface-2 rounded text-xs space-y-1">
          <div>
            <span className="strong">{t('Plazo legal inmutable:')}</span> {formatDate(request.effectiveDeadline)}
          </div>
          <div>
            <span className="strong">{t('Fecha de recepción:')}</span> {formatInstant(request.receiptTimestamp)}
          </div>
        </div>

        <FormField label="Nuevo responsable de tramitación" required>
          <Select value={newOwnerId} onChange={(e) => setNewOwnerId(e.target.value)}>
            {ctx.db.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.organisation})
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Motivo del cambio de asignación" required>
          <Input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Asignación al responsable del departamento contable"
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Confirmar reasignación')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ExtensionModal({
  request,
  onClose,
  onSuccess,
}: {
  request: RightsRequest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [months, setMonths] = useState<number>(2);
  const [grounds, setGrounds] = useState('');
  const [communicationEvidence, setCommunicationEvidence] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      approveExtension(request.id, months, grounds, communicationEvidence);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Formalizar prórroga legal: {ref}', { ref: request.reference })}
      description={t(
        'Art. 12.3 RGPD: El plazo de un mes podrá prorrogarse otros dos meses teniendo en cuenta la complejidad y el número de solicitudes. Debe comunicarse al interesado en el primer mes con expresión de los motivos.'
      )}
      onClose={onClose}
      maxWidth={520}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Meses de ampliación (Máximo 2)" required>
          <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={1}>{t('1 mes adicional')}</option>
            <option value={2}>{t('2 meses adicionales (máximo RGPD)')}</option>
          </Select>
        </FormField>

        <FormField label="Motivación legal de la complejidad" required hint="Requerido por ley; no cabe ampliación discrecional.">
          <Textarea
            required
            rows={2}
            value={grounds}
            onChange={(e) => setGrounds(e.target.value)}
            placeholder="e.g. Elevada dispersión de los registros en servidores locales históricos y copias de archivo papel."
          />
        </FormField>

        <FormField label="Constancia de aviso al interesado" required hint="Referencia del email o notificación remitida informándole en plazo.">
          <Input
            required
            value={communicationEvidence}
            onChange={(e) => setCommunicationEvidence(e.target.value)}
            placeholder="e.g. Email remitido el 28/01 con acuse técnico ref: EXT-NOTIF-091"
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Aprobar prórroga')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RetentionDecisionModal({
  request,
  onClose,
  onSuccess,
}: {
  request: RightsRequest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [decision, setDecision] = useState<'restrict_block' | 'retain_and_refuse' | 'erase'>('restrict_block');
  const [rationale, setRationale] = useState(
    'Conforme al Art. 32 LOPDGDD y Art. 30 CCom, se bloquean los datos para responder de posibles responsabilidades tributarias y mercantiles durante 6 años.'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      decideRetentionConflict(request.id, decision, rationale);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Decisión de Conservación y Bloqueo (Art. 32 LOPDGDD)')}
      description={t(
        'Dictamine si procede el borrado íntegro, el bloqueo de datos o la denegación motivada por obligaciones tributarias o mercantiles.'
      )}
      onClose={onClose}
      maxWidth={560}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Decisión formal del revisor" required>
          <Select
            value={decision}
            onChange={(e) =>
              setDecision(e.target.value as 'restrict_block' | 'retain_and_refuse' | 'erase')
            }
          >
            <option value="restrict_block">
              {t('BLOQUEO DE DATOS (Art. 32 LOPDGDD) — Retención cautelar inaccesible')}
            </option>
            <option value="retain_and_refuse">
              {t('DENEGACIÓN MOTIVADA — Obligación legal imperativa (LGT / CCom)')}
            </option>
            <option value="erase">
              {t('SUPRESIÓN FÍSICA INMEDIATA (Sin obligaciones legales pendientes)')}
            </option>
          </Select>
        </FormField>

        <FormField label="Fundamentación jurídica y justificación" required>
          <Textarea
            required
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Formalizar dictamen')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResponseModal({
  request,
  onClose,
  onSuccess,
}: {
  request: RightsRequest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(
    request.responseDraft ??
      `Estimado/a ${request.requesterName}:\n\nEn respuesta a su solicitud de ${RIGHT_TYPE[request.rightType].label} recibida con fecha ${formatInstant(request.receiptTimestamp)}, le informamos de que hemos tramitado su petición conforme al Reglamento (UE) 2016/679.\n\nAtentamente,\nResponsable de Privacidad`
  );
  const [evidence, setEvidence] = useState(
    'Envío de correo certificado ref: RES-POSTAL-2026-08'
  );

  const handleSaveDraft = () => {
    try {
      saveResponseDraft(request.id, draft);
      toast.info(t('Borrador de respuesta guardado.'));
    } catch (e) {
      toast.error(e);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      recordResponseSent(request.id, evidence);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Respuesta formal al interesado: {ref}', { ref: request.reference })}
      onClose={onClose}
      maxWidth={620}
    >
      <form onSubmit={handleSend} className="space-y-4">
        <FormField label="Texto de la comunicación / resolución" required>
          <Textarea
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </FormField>

        <div className="row end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={handleSaveDraft}>
            {t('Guardar borrador')}
          </Button>
        </div>

        <FormField label="Constancia técnica de envío / Registro de salida" required hint="Burofax, email certificado, firma presencial, o justificante del canal utilizado.">
          <Input
            required
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="e.g. Registro de salida número REG-SAL-2026-042 remitido por correo certificado"
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Registrar respuesta enviada')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ClosureModal({
  request,
  onClose,
  onSuccess,
}: {
  request: RightsRequest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [closureReason, setClosureReason] = useState(
    'Respuesta formal remitida en plazo y actuaciones técnicas ejecutadas en los sistemas.'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      closeRightsRequest(request.id, closureReason);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Cerrar expediente: {ref}', { ref: request.reference })}
      description={t(
        'El cierre archiva el caso en estado completado manteniendo todo el historial inmutable para inspecciones de la AEPD.'
      )}
      onClose={onClose}
      maxWidth={480}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Motivo y justificación de cierre" required>
          <Textarea
            required
            rows={3}
            value={closureReason}
            onChange={(e) => setClosureReason(e.target.value)}
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Cerrar caso')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
