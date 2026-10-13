import {
  Lock,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock72h } from '../components/Clock72h';
import {
  closeIncident,
  decideAuthorityNotification,
  decideSubjectNotification,
  evaluateIncidentRisk,
  registerIncident,
  viewSensitiveIncident,
  type IncidentInput,
} from '../services/incidentService';
import {
  AUTHORITY_STATUS,
  INCIDENT_CATEGORY,
  INCIDENT_RISK,
  INCIDENT_STATUS,
  SUBJECT_STATUS,
} from '../domain/status';
import { formatInstant, nowInstant } from '../domain/time';
import type {
  AuthorityNotificationStatus,
  IncidentCategory,
  IncidentRiskLevel,
  PersonalDataIncident,
  SubjectNotificationStatus,
} from '../domain/types';
import { useCtx } from '../store/hooks';
import {
  Badge,
  Button,
  Card,
  Checkbox,
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

export function IncidentsPage() {
  const ctx = useCtx();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(searchParams.get('crear') === '1');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));

  // Modals inside drawer
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [authorityModalOpen, setAuthorityModalOpen] = useState(false);
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [closureModalOpen, setClosureModalOpen] = useState(false);

  const canViewRestricted = ctx.can('incidents.view_restricted');
  const allIncidents = ctx.db.incidents.filter((i) => i.companyId === ctx.company.id);

  const filtered = allIncidents.filter((inc) => {
    if (filterCategory !== 'all' && inc.category !== filterCategory) return false;
    if (filterRisk !== 'all' && inc.riskLevel !== filterRisk) return false;
    if (filterStatus !== 'all' && inc.status !== filterStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        inc.reference.toLowerCase().includes(q) ||
        (canViewRestricted && inc.title.toLowerCase().includes(q)) ||
        (canViewRestricted && inc.description.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  // Safe accessor checking permissions (Scenario 8)
  let activeIncident: PersonalDataIncident | null = null;
  let accessDeniedMessage: string | null = null;

  if (selectedId) {
    const candidate = allIncidents.find((i) => i.id === selectedId);
    if (candidate) {
      if (candidate.restricted && !canViewRestricted) {
        // Enforce restriction & trigger audit
        try {
          viewSensitiveIncident(selectedId);
        } catch (e: any) {
          accessDeniedMessage = e.message;
        }
      } else {
        activeIncident = candidate;
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Registro de Incidentes de Datos y Brechas')}</h1>
          <p className="page-subtitle">
            {t(
              'Gestión de brechas de seguridad (Art. 33 y 34 RGPD). Reloj continuo de 72 horas para notificación a la AEPD desde el conocimiento organizativo, evaluación de riesgo e información a personas afectadas.'
            )}
          </p>
        </div>
        <div className="page-actions">
          {ctx.can('incidents.manage') && (
            <Button
              variant="danger"
              icon={ShieldAlert}
              onClick={() => {
                setSearchParams({ crear: '1' });
                setCreateOpen(true);
              }}
            >
              {t('Registrar incidente')}
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="row wrap gap-3 items-center">
          <div className="grow" style={{ minWidth: 240 }}>
            <Input
              placeholder={
                canViewRestricted
                  ? t('Buscar por referencia, título o detalles técnicos…')
                  : t('Buscar por referencia…')
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ width: 180 }}>
            <Select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              aria-label={t('Categoría del incidente')}
            >
              <option value="all">{t('Todas las categorías')}</option>
              {Object.entries(INCIDENT_CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <div style={{ width: 170 }}>
            <Select
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value)}
              aria-label={t('Nivel de riesgo')}
            >
              <option value="all">{t('Todos los riesgos')}</option>
              {Object.entries(INCIDENT_RISK).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <div style={{ width: 160 }}>
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label={t('Estado de tramitación')}
            >
              <option value="all">{t('Todos los estados')}</option>
              {Object.entries(INCIDENT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          {(search || filterCategory !== 'all' || filterRisk !== 'all' || filterStatus !== 'all') && (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              onClick={() => {
                setSearch('');
                setFilterCategory('all');
                setFilterRisk('all');
                setFilterStatus('all');
              }}
            >
              {t('Limpiar')}
            </Button>
          )}
        </div>
      </Card>

      {/* Incidents Table */}
      <Card>
        <Table>
          <thead>
            <tr>
              <th>{t('Referencia')}</th>
              <th>{t('Título del incidente')}</th>
              <th>{t('Categoría')}</th>
              <th>{t('Conocimiento organizativo')}</th>
              <th>{t('Reloj continuo 72h')}</th>
              <th>{t('Riesgo')}</th>
              <th>{t('Notificación AEPD')}</th>
              <th>{t('Afectados')}</th>
              <th>{t('Acciones')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted">
                  <EmptyState icon={ShieldAlert} title="Sin incidentes registrados">
                    {t('No constan brechas de seguridad con los filtros actuales.')}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered.map((inc) => {
                const catMeta = INCIDENT_CATEGORY[inc.category];
                const riskMeta = INCIDENT_RISK[inc.riskLevel];
                const authMeta = AUTHORITY_STATUS[inc.authorityStatus];
                const subjMeta = SUBJECT_STATUS[inc.subjectStatus];

                return (
                  <tr
                    key={inc.id}
                    className="clickable hover-surface"
                    onClick={() => {
                      setSelectedId(inc.id);
                      setSearchParams({ id: inc.id });
                    }}
                  >
                    <td>
                      <span className="font-mono font-semibold">{inc.reference}</span>
                      {inc.restricted && (
                        <span className="badge-confidential ml-1" title={t('Confidencial')}>
                          <Lock size={10} />
                        </span>
                      )}
                    </td>
                    <td>
                      {canViewRestricted ? (
                        <div className="strong">{inc.title}</div>
                      ) : (
                        <span className="muted italic">
                          <Lock size={12} className="inline mr-1" />
                          [Detalle confidencial restringido]
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="tiny">{catMeta?.label ?? inc.category}</span>
                    </td>
                    <td>
                      <span className="tiny font-mono">{formatInstant(inc.awarenessTimestamp)}</span>
                    </td>
                    <td>
                      <Clock72h
                        awarenessTimestamp={inc.awarenessTimestamp}
                        authorityNotified={inc.authorityStatus === 'submitted'}
                      />
                    </td>
                    <td>
                      <Badge tone={riskMeta.tone}>{riskMeta.label}</Badge>
                    </td>
                    <td>
                      <Badge tone={authMeta.tone}>{authMeta.label}</Badge>
                    </td>
                    <td>
                      <Badge tone={subjMeta.tone}>{subjMeta.label}</Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(inc.id);
                          setSearchParams({ id: inc.id });
                        }}
                      >
                        {t('Ver caso')}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {/* Access Denied Modal when an ordinary user attempts to open sensitive incident (Scenario 8) */}
      {accessDeniedMessage && (
        <Modal
          title={t('Acceso Restringido · Detalle Confidencial')}
          description={t('Art. 33.5 RGPD — Secreto profesional y protección de evidencias')}
          onClose={() => {
            setSelectedId(null);
            setSearchParams({});
          }}
          maxWidth={500}
        >
          <div className="space-y-4">
            <div className="p-3 bg-danger-bg text-danger rounded border border-danger text-sm">
              <div className="strong row items-center gap-1 mb-1">
                <Lock size={16} />
                <span>{t('Permiso insuficiente para inspeccionar este incidente')}</span>
              </div>
              <p>{accessDeniedMessage}</p>
            </div>

            <p className="tiny muted">
              {t(
                'El detalle técnico de las brechas de datos contiene vulnerabilidades de red, sistemas comprometidos y categorías de datos expuestos. Para prevenir accesos indebidos, solo el Responsable de Privacidad y el DPO pueden consultar la descripción completa. Este intento de apertura ha sido registrado en la auditoría inmutable.'
              )}
            </p>

            <div className="modal-footer row end pt-2">
              <Button
                variant="primary"
                onClick={() => {
                  setSelectedId(null);
                  setSearchParams({});
                }}
              >
                {t('Entendido')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Incident Drawer: Complete Case Lifecycle */}
      {activeIncident && (
        <Drawer
          title={`${activeIncident.reference} · ${activeIncident.title}`}
          subtitle={
            <div className="row items-center gap-2 mt-1">
              <Badge tone={INCIDENT_STATUS[activeIncident.status].tone}>
                {INCIDENT_STATUS[activeIncident.status].label}
              </Badge>
              <Clock72h
                awarenessTimestamp={activeIncident.awarenessTimestamp}
                authorityNotified={activeIncident.authorityStatus === 'submitted'}
              />
              <Badge tone={INCIDENT_RISK[activeIncident.riskLevel].tone}>
                {INCIDENT_RISK[activeIncident.riskLevel].label}
              </Badge>
            </div>
          }
          onClose={() => {
            setSelectedId(null);
            setSearchParams({});
          }}
          footer={
            <div className="row between items-center w-full">
              <div className="row gap-2">
                {ctx.can('incidents.manage') && activeIncident.status !== 'closed' && (
                  <Button
                    variant="secondary"
                    icon={ShieldCheck}
                    onClick={() => setRiskModalOpen(true)}
                  >
                    {t('Evaluar riesgo')}
                  </Button>
                )}

                {ctx.can('incidents.decide_notification') && activeIncident.status !== 'closed' && (
                  <>
                    <Button
                      variant="primary"
                      icon={Send}
                      onClick={() => setAuthorityModalOpen(true)}
                    >
                      {t('Decisión AEPD')}
                    </Button>

                    <Button
                      variant="secondary"
                      icon={Users}
                      onClick={() => setSubjectModalOpen(true)}
                    >
                      {t('Aviso a afectados')}
                    </Button>
                  </>
                )}
              </div>

              <div>
                {ctx.can('incidents.close') && activeIncident.status !== 'closed' && (
                  <Button
                    variant="ghost"
                    onClick={() => setClosureModalOpen(true)}
                  >
                    {t('Cerrar incidente')}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-6">
            {/* 72-Hour Clock Notice Box (Scenario 6) */}
            <div className="p-3 bg-surface-2 rounded border space-y-2">
              <div className="row between items-center">
                <span className="strong text-sm">{t('Cómputo Ininterrumpido de 72 Horas (Art. 33 RGPD)')}</span>
                <Clock72h
                  awarenessTimestamp={activeIncident.awarenessTimestamp}
                  authorityNotified={activeIncident.authorityStatus === 'submitted'}
                />
              </div>
              <div className="grid-2 gap-2 text-sm pt-1">
                <div>
                  <span className="muted block tiny">{t('Detección técnica inicial:')}</span>
                  <span className="font-mono">{formatInstant(activeIncident.detectionTimestamp)}</span>
                </div>
                <div>
                  <span className="muted block tiny">{t('CONOCIMIENTO ORGANIZATIVO (dispara el reloj):')}</span>
                  <span className="font-mono strong text-danger">
                    {formatInstant(activeIncident.awarenessTimestamp)}
                  </span>
                </div>
              </div>
              <div className="tiny muted pt-1 border-t">
                {t(
                  'El reloj computa de forma continua a partir de la toma de razón organizativa, incluidos fines de semana y festivos. No se reinicia al reasignar el caso.'
                )}
              </div>
            </div>

            {/* Incident Technical Description */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('1. Descripción y Sistemas Comprometidos')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Detalle del evento de seguridad:')}</span>
                  <p className="mt-1 bg-surface-1 p-2 rounded border">{activeIncident.description}</p>
                </div>
                <div className="grid-2 gap-2 pt-1">
                  <div>
                    <span className="muted block tiny">{t('Sistemas y servidores afectados:')}</span>
                    <span>{activeIncident.affectedSystems.join(', ')}</span>
                  </div>
                  <div>
                    <span className="muted block tiny">{t('Categorías de datos personales:')}</span>
                    <span>{activeIncident.affectedDataCategories.join(', ')}</span>
                  </div>
                  <div>
                    <span className="muted block tiny">{t('Registros aproximados expuestos:')}</span>
                    <span className="strong">{activeIncident.approximateVolume}</span>
                  </div>
                  <div>
                    <span className="muted block tiny">{t('Personas físicas afectadas:')}</span>
                    <span className="strong">{activeIncident.approximateSubjects}</span>
                  </div>
                </div>
                {activeIncident.specialCategoryInvolved && (
                  <div className="p-2 bg-danger-bg text-danger rounded border border-danger tiny">
                    ⚠️ {t('Datos de categoría especial (salud, biometría o afiliados) involucrados en la brecha.')}
                  </div>
                )}
              </div>
            </div>

            {/* Containment Measures */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('2. Medidas de Contención Aplicadas')}</h4>
              <div className="bg-surface-2 p-3 rounded text-sm">
                <p>{activeIncident.containmentActions}</p>
              </div>
            </div>

            {/* Independent Status Tracking: AEPD vs Subjects (Scenario 7) */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('3. Resoluciones de Notificación (Art. 33 y 34)')}</h4>
              <div className="grid-2 gap-4">
                {/* AEPD Notification Box */}
                <div className="p-3 bg-surface-2 rounded border space-y-2 text-sm">
                  <div className="row between items-center">
                    <span className="strong">{t('Autoridad de Control (AEPD)')}</span>
                    <Badge tone={AUTHORITY_STATUS[activeIncident.authorityStatus].tone}>
                      {AUTHORITY_STATUS[activeIncident.authorityStatus].label}
                    </Badge>
                  </div>
                  {activeIncident.authoritySubmissionRef ? (
                    <div className="tiny">
                      <span className="strong">{t('Nº Registro AEPD:')}</span>{' '}
                      <span className="font-mono">{activeIncident.authoritySubmissionRef}</span>
                      <div className="muted">{formatInstant(activeIncident.authoritySubmittedAt)}</div>
                    </div>
                  ) : (
                    <div className="tiny text-muted">
                      {activeIncident.authorityStatus === 'not_applicable'
                        ? t('Evaluación motivada: Sin riesgo apreciable para derechos.')
                        : t('Pendiente de presentación formal en sede electrónica.')}
                    </div>
                  )}
                </div>

                {/* Subject Notification Box */}
                <div className="p-3 bg-surface-2 rounded border space-y-2 text-sm">
                  <div className="row between items-center">
                    <span className="strong">{t('Personas Afectadas')}</span>
                    <Badge tone={SUBJECT_STATUS[activeIncident.subjectStatus].tone}>
                      {SUBJECT_STATUS[activeIncident.subjectStatus].label}
                    </Badge>
                  </div>
                  {activeIncident.subjectCommunicationEvidence ? (
                    <div className="tiny">
                      <span className="strong">{t('Constancia de aviso:')}</span>{' '}
                      <span>{activeIncident.subjectCommunicationEvidence}</span>
                      <div className="muted">{formatInstant(activeIncident.subjectCommunicatedAt)}</div>
                    </div>
                  ) : (
                    <div className="tiny text-muted">
                      {activeIncident.subjectStatus === 'not_required'
                        ? t('No concurre alto riesgo para las personas afectadas.')
                        : t('En fase de evaluación de impacto personal.')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Corrective Actions & Closure Evidence (Scenario 9) */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('4. Medidas Correctoras y Aprendizaje')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Medidas correctoras implantadas:')}</span>
                  <p>{activeIncident.correctiveActions}</p>
                </div>
                {activeIncident.lessonsLearned && (
                  <div>
                    <span className="muted block tiny">{t('Lecciones aprendidas:')}</span>
                    <p>{activeIncident.lessonsLearned}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Drawer>
      )}

      {/* Modal: Register Incident */}
      {createOpen && (
        <CreateIncidentModal
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

      {/* Modal: Risk Evaluation */}
      {riskModalOpen && activeIncident && (
        <RiskModal
          incident={activeIncident}
          onClose={() => setRiskModalOpen(false)}
          onSuccess={() => {
            setRiskModalOpen(false);
            toast.success(t('Evaluación de riesgo formalizada.'));
          }}
        />
      )}

      {/* Modal: Authority Notification Decision */}
      {authorityModalOpen && activeIncident && (
        <AuthorityNotificationModal
          incident={activeIncident}
          onClose={() => setAuthorityModalOpen(false)}
          onSuccess={() => {
            setAuthorityModalOpen(false);
            toast.success(t('Resolución de notificación AEPD registrada.'));
          }}
        />
      )}

      {/* Modal: Subject Notification Decision */}
      {subjectModalOpen && activeIncident && (
        <SubjectNotificationModal
          incident={activeIncident}
          onClose={() => setSubjectModalOpen(false)}
          onSuccess={() => {
            setSubjectModalOpen(false);
            toast.success(t('Resolución de comunicación a afectados registrada.'));
          }}
        />
      )}

      {/* Modal: Incident Closure (Scenario 9) */}
      {closureModalOpen && activeIncident && (
        <ClosureIncidentModal
          incident={activeIncident}
          onClose={() => setClosureModalOpen(false)}
          onSuccess={() => {
            setClosureModalOpen(false);
            toast.success(t('Incidente de seguridad cerrado y formalizado en el libro de brechas.'));
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Action Sub-Modals ───────────────────────────────

function CreateIncidentModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = useCtx();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [detectionTimestamp, setDetectionTimestamp] = useState(nowInstant().slice(0, 16));
  const [awarenessTimestamp, setAwarenessTimestamp] = useState(nowInstant().slice(0, 16));
  const [reportedBy, setReportedBy] = useState(ctx.user.name);
  const [category, setCategory] = useState<IncidentCategory>('unauthorized_access');
  const [description, setDescription] = useState('');
  const [affectedSystemsStr, setAffectedSystemsStr] = useState('Servidor web, Base de datos CRM');
  const [affectedDataStr, setAffectedDataStr] = useState('Nombres, correos, contraseñas hash');
  const [specialCategoryInvolved, setSpecialCategoryInvolved] = useState(false);
  const [approximateVolume, setApproximateVolume] = useState<number>(150);
  const [approximateSubjects, setApproximateSubjects] = useState<number>(120);
  const [containmentActions, setContainmentActions] = useState(
    'Aislamiento de la máquina afectada de la red y revocación de credenciales.'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const input: IncidentInput = {
      title,
      detectionTimestamp: new Date(detectionTimestamp).toISOString(),
      awarenessTimestamp: new Date(awarenessTimestamp).toISOString(),
      reportedBy,
      category,
      description,
      affectedSystems: affectedSystemsStr.split(',').map((s) => s.trim()).filter(Boolean),
      affectedDataCategories: affectedDataStr.split(',').map((s) => s.trim()).filter(Boolean),
      specialCategoryInvolved,
      approximateVolume: Number(approximateVolume),
      approximateSubjects: Number(approximateSubjects),
      containmentActions,
      incidentOwnerId: ctx.user.id,
      privacyReviewerId: ctx.user.id,
    };

    try {
      const created = registerIncident(input);
      toast.success(
        t('Incidente {ref} registrado. Reloj legal 72h activado.', { ref: created.reference })
      );
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Notificar Incidente de Seguridad / Brecha de Datos')}
      description={t(
        'El reloj legal de 72 horas (Art. 33 RGPD) computa desde la fecha/hora de conocimiento organizativo de forma continua.'
      )}
      onClose={onClose}
      maxWidth={680}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Título descriptivo del incidente" required>
          <Input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Filtración accidental de base de datos de clientes por endpoint público"
          />
        </FormField>

        <div className="grid-2 gap-4">
          <FormField label="Fecha/hora de detección técnica" required>
            <Input
              required
              type="datetime-local"
              value={detectionTimestamp}
              onChange={(e) => setDetectionTimestamp(e.target.value)}
            />
          </FormField>

          <FormField label="CONOCIMIENTO ORGANIZATIVO (dispara reloj 72h)" required hint="Momento en que la empresa tuvo constancia formal.">
            <Input
              required
              type="datetime-local"
              value={awarenessTimestamp}
              onChange={(e) => setAwarenessTimestamp(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid-2 gap-4">
          <FormField label="Categoría de la brecha" required>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as IncidentCategory)}
            >
              {Object.entries(INCIDENT_CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Notificado por" required>
            <Input
              required
              value={reportedBy}
              onChange={(e) => setReportedBy(e.target.value)}
              placeholder="e.g. Responsable de Sistemas / SOC"
            />
          </FormField>
        </div>

        <FormField label="Descripción sensible de los hechos (acceso restringido)" required hint="Detalles técnicos reservados a Responsable de Privacidad y DPO.">
          <Textarea
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Se detectó una petición anómala procedente de IP externa extrayendo una copia de la tabla clientes_crm.db..."
          />
        </FormField>

        <div className="grid-2 gap-4">
          <FormField label="Sistemas afectados" required hint="Separados por comas">
            <Input
              value={affectedSystemsStr}
              onChange={(e) => setAffectedSystemsStr(e.target.value)}
            />
          </FormField>

          <FormField label="Categorías de datos expuestas" required hint="Separadas por comas">
            <Input
              value={affectedDataStr}
              onChange={(e) => setAffectedDataStr(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid-2 gap-4">
          <FormField label="Registros aproximados expuestos" required>
            <Input
              required
              type="number"
              min={0}
              value={approximateVolume}
              onChange={(e) => setApproximateVolume(Number(e.target.value))}
            />
          </FormField>

          <FormField label="Personas afectadas aproximadas" required>
            <Input
              required
              type="number"
              min={0}
              value={approximateSubjects}
              onChange={(e) => setApproximateSubjects(Number(e.target.value))}
            />
          </FormField>
        </div>

        <div className="p-3 bg-surface-2 rounded">
          <Checkbox
            label="Involucra datos de categoría especial (Art. 9 RGPD)"
            hint="Salud, biometría, afiliación sindical, origen étnico."
            checked={specialCategoryInvolved}
            onChange={setSpecialCategoryInvolved}
          />
        </div>

        <FormField label="Medidas de contención inmediata" required>
          <Textarea
            required
            rows={2}
            value={containmentActions}
            onChange={(e) => setContainmentActions(e.target.value)}
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="danger" type="submit">
            {t('Registrar incidente y activar reloj 72h')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RiskModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: PersonalDataIncident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [level, setLevel] = useState<IncidentRiskLevel>(incident.riskLevel);
  const [rationale, setRationale] = useState(incident.riskRationale);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      evaluateIncidentRisk(incident.id, level, rationale);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Evaluación de Riesgo para Derechos y Libertades')}
      description={t(
        'Dictamine el impacto potencial sobre las personas afectadas conforme al Art. 33 y 34 RGPD.'
      )}
      onClose={onClose}
      maxWidth={520}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Calificación del nivel de riesgo" required>
          <Select
            value={level}
            onChange={(e) => setLevel(e.target.value as IncidentRiskLevel)}
          >
            {Object.entries(INCIDENT_RISK).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label} — {v.help}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Fundamentación motivada del riesgo" required hint="Explique si concurre riesgo de usurpación, fraude, daño moral o perjuicio económico.">
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
            {t('Formalizar evaluación')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AuthorityNotificationModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: PersonalDataIncident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<AuthorityNotificationStatus>(
    incident.authorityStatus === 'assessing' ? 'submitted' : incident.authorityStatus
  );
  const [submissionRef, setSubmissionRef] = useState(
    incident.authoritySubmissionRef ?? 'AEPD-REG-2026-00481'
  );
  const [lateJustification, setLateJustification] = useState(incident.lateJustification ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      decideAuthorityNotification(
        incident.id,
        status,
        status === 'submitted' || status === 'justified_late' ? submissionRef : undefined,
        lateJustification.trim() || undefined
      );
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Decisión de Notificación a la AEPD (Art. 33 RGPD)')}
      description={t(
        'Para marcar como «Notificada a la AEPD», es OBLIGATORIO consignar el número de registro telemático de entrada en la sede electrónica.'
      )}
      onClose={onClose}
      maxWidth={540}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Estado de la notificación ante la autoridad" required>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as AuthorityNotificationStatus)}
          >
            {Object.entries(AUTHORITY_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label} ({v.help})
              </option>
            ))}
          </Select>
        </FormField>

        {(status === 'submitted' || status === 'justified_late') && (
          <FormField label="Número de registro de entrada en la AEPD" required hint="Obligatorio para acreditar la presentación legal.">
            <Input
              required
              value={submissionRef}
              onChange={(e) => setSubmissionRef(e.target.value)}
              placeholder="e.g. AEPD-REG-2026-00892"
            />
          </FormField>
        )}

        {status === 'justified_late' && (
          <FormField label="Justificación motivada del retraso tras 72h (Art. 33.1)" required>
            <Textarea
              required
              rows={2}
              value={lateJustification}
              onChange={(e) => setLateJustification(e.target.value)}
              placeholder="e.g. Dilatación en la identificación del vector de intrusión forense."
            />
          </FormField>
        )}

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Guardar resolución')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SubjectNotificationModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: PersonalDataIncident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<SubjectNotificationStatus>(
    incident.subjectStatus === 'evaluating' ? 'communicated' : incident.subjectStatus
  );
  const [evidence, setEvidence] = useState(
    incident.subjectCommunicationEvidence ?? 'Remitida comunicación individual por email certificado con recomendaciones de cambio de contraseña.'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      decideSubjectNotification(
        incident.id,
        status,
        status === 'communicated' ? evidence : undefined
      );
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Comunicación a los Afectados (Art. 34 RGPD)')}
      description={t(
        'Obligatoria sin dilación indebida cuando la violación entrañe un alto riesgo para los derechos y libertades.'
      )}
      onClose={onClose}
      maxWidth={520}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Estado de comunicación a afectados" required>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as SubjectNotificationStatus)}
          >
            {Object.entries(SUBJECT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label} ({v.help})
              </option>
            ))}
          </Select>
        </FormField>

        {status === 'communicated' && (
          <FormField label="Constancia técnica de aviso individual remitido" required>
            <Textarea
              required
              rows={3}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </FormField>
        )}

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Guardar resolución')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ClosureIncidentModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: PersonalDataIncident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [correctiveActions, setCorrectiveActions] = useState(
    incident.correctiveActions || 'Reconfiguración de reglas perimetrales del cortafuegos y rotación global de claves.'
  );
  const [lessonsLearned, setLessonsLearned] = useState(
    incident.lessonsLearned || 'Implantar revisión trimestral de accesos privilegiados y auditoría de logs.'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      closeIncident(incident.id, correctiveActions, lessonsLearned);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Cierre Autorizado de Incidente: {ref}', { ref: incident.reference })}
      description={t(
        'Art. 33.5 RGPD: El responsable documentará cualquier violación de la seguridad, sus efectos y las medidas correctoras. Si la brecha entraña riesgo, no puede cerrarse sin constancia de registro en la AEPD.'
      )}
      onClose={onClose}
      maxWidth={560}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Medidas correctoras ejecutadas" required>
          <Textarea
            required
            rows={2}
            value={correctiveActions}
            onChange={(e) => setCorrectiveActions(e.target.value)}
          />
        </FormField>

        <FormField label="Lecciones aprendidas e informe de mejora" required>
          <Textarea
            required
            rows={2}
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="danger" type="submit">
            {t('Aprobar cierre de la brecha')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
