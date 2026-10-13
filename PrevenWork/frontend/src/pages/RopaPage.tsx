import {
  AlertTriangle,
  Edit,
  FileSpreadsheet,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createProcessingActivity,
  requestSpecialistReview,
  updateProcessingActivity,
  updateRopaStatus,
  type RopaInput,
} from '../services/ropaService';
import {
  GDPR_ROLE,
  LEGAL_BASIS,
  ROPA_STATUS,
} from '../domain/status';
import { formatDate } from '../domain/time';
import type {
  GdprRole,
  LegalBasis,
  ProcessingActivity,
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

export function RopaPage() {
  const ctx = useCtx();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterSpecial, setFilterSpecial] = useState<boolean | null>(null);

  const [createOpen, setCreateOpen] = useState(searchParams.get('crear') === '1');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const [editItem, setEditItem] = useState<ProcessingActivity | null>(null);

  const activities = ctx.db.ropaActivities.filter((r) => r.companyId === ctx.company.id);

  const filtered = activities.filter((act) => {
    if (filterStatus !== 'all' && act.status !== filterStatus) return false;
    if (filterRole !== 'all' && act.role !== filterRole) return false;
    if (filterSpecial !== null && act.specialCategories !== filterSpecial) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        act.code.toLowerCase().includes(q) ||
        act.name.toLowerCase().includes(q) ||
        act.purpose.toLowerCase().includes(q) ||
        act.systems.some((s) => s.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const selectedActivity = selectedId
    ? activities.find((a) => a.id === selectedId) ?? null
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Registro de Actividades de Tratamiento (RAT)')}</h1>
          <p className="page-subtitle">
            {t(
              'Inventario legal de operaciones de tratamiento conforme al Art. 30 RGPD. Bases jurídicas, categorías de datos, destinatarios, medidas de seguridad y plazos de conservación.'
            )}
          </p>
        </div>
        <div className="page-actions">
          {ctx.can('ropa.manage') && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setSearchParams({ crear: '1' });
                setCreateOpen(true);
              }}
            >
              {t('Nueva actividad')}
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="row wrap gap-3 items-center">
          <div className="grow" style={{ minWidth: 240 }}>
            <div className="relative">
              <Input
                placeholder={t('Buscar por código, nombre, finalidad o sistema…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div style={{ width: 170 }}>
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label={t('Filtrar por estado')}
            >
              <option value="all">{t('Todos los estados')}</option>
              {Object.entries(ROPA_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <div style={{ width: 160 }}>
            <Select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              aria-label={t('Filtrar por rol')}
            >
              <option value="all">{t('Todos los roles')}</option>
              {Object.entries(GDPR_ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="row gap-2 items-center">
            <Button
              size="sm"
              variant={filterSpecial === true ? 'primary' : 'ghost'}
              onClick={() => setFilterSpecial((v) => (v === true ? null : true))}
            >
              {t('Art. 9 Datos Especiales')}
            </Button>
            {(search || filterStatus !== 'all' || filterRole !== 'all' || filterSpecial !== null) && (
              <Button
                size="sm"
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  setSearch('');
                  setFilterStatus('all');
                  setFilterRole('all');
                  setFilterSpecial(null);
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
              <th>{t('Código')}</th>
              <th>{t('Nombre del tratamiento')}</th>
              <th>{t('Rol')}</th>
              <th>{t('Base jurídica')}</th>
              <th>{t('Datos especiales')}</th>
              <th>{t('Próxima revisión')}</th>
              <th>{t('Estado')}</th>
              <th>{t('Acciones')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted">
                  <EmptyState icon={FileSpreadsheet} title="Sin tratamientos coincidentes">
                    {t('No se encontraron actividades con los filtros seleccionados.')}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered.map((act) => {
                const statusMeta = ROPA_STATUS[act.status];
                const roleMeta = GDPR_ROLE[act.role];
                const basisMeta = LEGAL_BASIS[act.legalBasis];
                const hasWarnings = act.missingFieldsWarning && act.missingFieldsWarning.length > 0;

                return (
                  <tr
                    key={act.id}
                    className="clickable hover-surface"
                    onClick={() => {
                      setSelectedId(act.id);
                      setSearchParams({ id: act.id });
                    }}
                  >
                    <td>
                      <span className="font-mono font-semibold">{act.code}</span>
                    </td>
                    <td>
                      <div className="strong">{act.name}</div>
                      <div className="tiny muted text-truncate" style={{ maxWidth: 280 }}>
                        {act.purpose}
                      </div>
                      {hasWarnings && (
                        <div className="tiny text-warning mt-1">
                          ⚠️ {act.missingFieldsWarning![0]}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`role-pill ${act.role}`}>
                        {roleMeta.label}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm">{basisMeta.label}</div>
                      <div className="tiny muted">{basisMeta.article}</div>
                    </td>
                    <td>
                      {act.specialCategories ? (
                        <span className="special-category-badge" title={act.specialCategoryNotes}>
                          ⚠️ Art. 9
                        </span>
                      ) : (
                        <span className="tiny text-muted">{t('Ordinarios')}</span>
                      )}
                    </td>
                    <td>
                      <span className="tiny">{formatDate(act.nextReviewDate)}</span>
                    </td>
                    <td>
                      <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                      {act.specialistReviewFlag && (
                        <Badge tone="warning" className="ml-1" title={t('Revisión por DPO solicitada')}>
                          ⚖️ DPO
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(act.id);
                          setSearchParams({ id: act.id });
                        }}
                      >
                        {t('Detalle')}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {/* Drawer: Detailed Record View */}
      {selectedActivity && (
        <Drawer
          title={`${selectedActivity.code} · ${selectedActivity.name}`}
          subtitle={
            <div className="row items-center gap-2 mt-1">
              <Badge tone={ROPA_STATUS[selectedActivity.status].tone}>
                {ROPA_STATUS[selectedActivity.status].label}
              </Badge>
              <span className={`role-pill ${selectedActivity.role}`}>
                {GDPR_ROLE[selectedActivity.role].label}
              </span>
              {selectedActivity.specialCategories && (
                <span className="special-category-badge">⚠️ Art. 9 Especial</span>
              )}
            </div>
          }
          onClose={() => {
            setSelectedId(null);
            setSearchParams({});
          }}
          footer={
            <div className="row between items-center w-full">
              <div className="row gap-2">
                {ctx.can('ropa.review') && selectedActivity.status !== 'approved' && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      try {
                        updateRopaStatus(selectedActivity.id, 'approved');
                        toast.success(t('Actividad de tratamiento aprobada formalmente.'));
                      } catch (e) {
                        toast.error(e);
                      }
                    }}
                  >
                    {t('Aprobar RAT')}
                  </Button>
                )}
                {ctx.can('ropa.manage') && selectedActivity.status === 'in_review' && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      try {
                        updateRopaStatus(selectedActivity.id, 'changes_required');
                        toast.warning(t('Marcado: requiere cambios por el titular.'));
                      } catch (e) {
                        toast.error(e);
                      }
                    }}
                  >
                    {t('Solicitar cambios')}
                  </Button>
                )}
                {ctx.can('ropa.manage') && (
                  <Button
                    variant="ghost"
                    icon={Edit}
                    onClick={() => setEditItem(selectedActivity)}
                  >
                    {t('Editar')}
                  </Button>
                )}
              </div>

              <div className="row gap-2">
                {!selectedActivity.specialistReviewFlag && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      try {
                        requestSpecialistReview(
                          selectedActivity.id,
                          'Revisión especializada de base jurídica y medidas técnicas solicitada.'
                        );
                        toast.success(t('Solicitado dictamen profesional al DPO/Asesor.'));
                      } catch (e) {
                        toast.error(e);
                      }
                    }}
                  >
                    ⚖️ {t('Solicitar dictamen DPO')}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-6">
            {/* Missing Fields Warning Banner (Scenario 1) */}
            {selectedActivity.missingFieldsWarning && selectedActivity.missingFieldsWarning.length > 0 && (
              <div className="p-3 bg-warning-bg text-warning rounded border border-warning">
                <div className="strong row items-center gap-1 mb-1">
                  <AlertTriangle size={16} />
                  <span>{t('Campos pendientes o revisión técnica aconsejable')}</span>
                </div>
                <div className="tiny">
                  {t(
                    'El sistema identifica información incompleta según el estándar del Art. 30 RGPD. Esto no declara automáticamente una infracción legal pero requiere subsanación antes de la aprobación definitiva:'
                  )}
                </div>
                <ul className="tiny mt-2 pl-4 list-disc space-y-1">
                  {selectedActivity.missingFieldsWarning.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Purpose & Legal Basis */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('1. Finalidad y Base Jurídica')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Finalidad del tratamiento:')}</span>
                  <p className="mt-0.5">{selectedActivity.purpose}</p>
                </div>
                <div className="row gap-4 pt-2 border-t">
                  <div className="grow">
                    <span className="muted block tiny">{t('Base de legitimación (Art. 6 RGPD):')}</span>
                    <span className="strong">
                      {LEGAL_BASIS[selectedActivity.legalBasis].label} ({LEGAL_BASIS[selectedActivity.legalBasis].article})
                    </span>
                  </div>
                  <div>
                    <span className="muted block tiny">{t('Estado de validación legal:')}</span>
                    <Badge
                      tone={
                        selectedActivity.legalBasisReviewStatus === 'confirmed'
                          ? 'success'
                          : selectedActivity.legalBasisReviewStatus === 'expert_justification_needed'
                          ? 'danger'
                          : 'warning'
                      }
                    >
                      {selectedActivity.legalBasisReviewStatus === 'confirmed'
                        ? t('Confirmada')
                        : selectedActivity.legalBasisReviewStatus === 'expert_justification_needed'
                        ? t('Dictamen requerido')
                        : t('Pendiente revisión')}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Data Subjects and Categories */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('2. Interesados y Categorías de Datos')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-3 text-sm">
                <div>
                  <span className="muted block tiny">{t('Categorías de interesados:')}</span>
                  <div className="row wrap gap-1 mt-1">
                    {selectedActivity.dataSubjects.map((s, idx) => (
                      <span key={idx} className="badge neutral">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="muted block tiny">{t('Categorías de datos personales:')}</span>
                  <div className="row wrap gap-1 mt-1">
                    {selectedActivity.dataCategories.map((c, idx) => (
                      <span key={idx} className="badge neutral">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                {selectedActivity.specialCategories && (
                  <div className="p-2 bg-danger-bg text-danger rounded border border-danger tiny">
                    <div className="strong">⚠️ {t('Categoría Especial de Datos (Art. 9 RGPD)')}</div>
                    <div>{selectedActivity.specialCategoryNotes || t('Salud, biometría o afiliación sindical.')}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Systems, Recipients & Transfers */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('3. Sistemas y Cesiones a Terceros')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Sistemas y soportes de almacenamiento:')}</span>
                  <p>{selectedActivity.systems.join(', ')}</p>
                </div>
                <div>
                  <span className="muted block tiny">{t('Destinatarios o cesiones:')}</span>
                  <p>{selectedActivity.recipients.join(', ') || t('Ninguno comunicado')}</p>
                </div>
                <div>
                  <span className="muted block tiny">{t('Transferencias internacionales (Art. 44+):')}</span>
                  <p>
                    {selectedActivity.internationalTransfers
                      ? `Sí · Garantías: ${selectedActivity.transferSafeguards || 'En evaluación'}`
                      : t('No (Tratamiento íntegro en territorio UE / EEE)')}
                  </p>
                </div>
              </div>
            </div>

            {/* Retention & Security */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('4. Plazos de Conservación y Seguridad')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Plazo de conservación:')}</span>
                  <p className="strong">{selectedActivity.retentionRule}</p>
                </div>
                <div>
                  <span className="muted block tiny">{t('Medidas técnicas y organizativas (Art. 32):')}</span>
                  <p>{selectedActivity.securityMeasures}</p>
                </div>
              </div>
            </div>

            {/* Governance */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('5. Gobernanza y Calendario')}</h4>
              <div className="bg-surface-2 p-3 rounded grid-2 gap-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Responsable interno de área:')}</span>
                  <span>{selectedActivity.businessOwner}</span>
                </div>
                <div>
                  <span className="muted block tiny">{t('Próxima revisión anual:')}</span>
                  <span>{formatDate(selectedActivity.nextReviewDate)}</span>
                </div>
                <div>
                  <span className="muted block tiny">{t('Última revisión formal:')}</span>
                  <span>{formatDate(selectedActivity.lastReviewDate)}</span>
                </div>
                <div>
                  <span className="muted block tiny">{t('EIPD / DPIA obligatoria:')}</span>
                  <span>{selectedActivity.dpiaRequired ? t('Sí (Art. 35)') : t('No')}</span>
                </div>
              </div>
            </div>
          </div>
        </Drawer>
      )}

      {/* Modal: Create / Edit Processing Activity */}
      {(createOpen || editItem) && (
        <RopaFormModal
          initial={editItem ?? undefined}
          onClose={() => {
            setCreateOpen(false);
            setEditItem(null);
            setSearchParams({});
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditItem(null);
            setSearchParams({});
          }}
        />
      )}
    </div>
  );
}

function RopaFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: ProcessingActivity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = useCtx();
  const toast = useToast();

  const [name, setName] = useState(initial?.name ?? '');
  const [purpose, setPurpose] = useState(initial?.purpose ?? '');
  const [role, setRole] = useState<GdprRole>(initial?.role ?? 'controller');
  const [legalBasis, setLegalBasis] = useState<LegalBasis>(initial?.legalBasis ?? 'contract');
  const [legalBasisReviewStatus, setLegalBasisReviewStatus] = useState(
    initial?.legalBasisReviewStatus ?? 'pending_review'
  );
  const [dataSubjectsStr, setDataSubjectsStr] = useState(
    initial?.dataSubjects.join(', ') ?? 'Clientes, Empleados'
  );
  const [dataCategoriesStr, setDataCategoriesStr] = useState(
    initial?.dataCategories.join(', ') ?? 'Identificativos, Económicos'
  );
  const [specialCategories, setSpecialCategories] = useState(initial?.specialCategories ?? false);
  const [specialCategoryNotes, setSpecialCategoryNotes] = useState(initial?.specialCategoryNotes ?? '');
  const [systemsStr, setSystemsStr] = useState(initial?.systems.join(', ') ?? 'ERP, Correo');
  const [recipientsStr, setRecipientsStr] = useState(initial?.recipients.join(', ') ?? 'Asesoría');
  const [internationalTransfers, setInternationalTransfers] = useState(
    initial?.internationalTransfers ?? false
  );
  const [transferSafeguards, setTransferSafeguards] = useState(initial?.transferSafeguards ?? '');
  const [retentionRule, setRetentionRule] = useState(
    initial?.retentionRule ?? '5 años desde extinción contractual (Art. 1964 CC)'
  );
  const [securityMeasures, setSecurityMeasures] = useState(
    initial?.securityMeasures ?? 'Control de acceso individual, copias de seguridad cifradas'
  );
  const [businessOwner, setBusinessOwner] = useState(initial?.businessOwner ?? ctx.user.name);
  const [nextReviewDate, setNextReviewDate] = useState(
    initial?.nextReviewDate ?? '2027-01-15'
  );
  const [specialistReviewFlag, setSpecialistReviewFlag] = useState(
    initial?.specialistReviewFlag ?? false
  );
  const [dpiaRequired, setDpiaRequired] = useState(initial?.dpiaRequired ?? false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const input: RopaInput = {
      name,
      purpose,
      role,
      legalBasis,
      legalBasisReviewStatus,
      dataSubjects: dataSubjectsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      dataCategories: dataCategoriesStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      specialCategories,
      specialCategoryNotes: specialCategories ? specialCategoryNotes : undefined,
      systems: systemsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      recipients: recipientsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      internationalTransfers,
      transferSafeguards: internationalTransfers ? transferSafeguards : undefined,
      retentionRule,
      securityMeasures,
      businessOwner,
      privacyReviewerId: ctx.user.id,
      nextReviewDate,
      specialistReviewFlag,
      dpiaRequired,
    };

    try {
      if (initial) {
        updateProcessingActivity(initial.id, input);
        toast.success(t('Actividad de tratamiento actualizada.'));
      } else {
        const created = createProcessingActivity(input);
        if (created.missingFieldsWarning && created.missingFieldsWarning.length > 0) {
          toast.warning(
            t('Actividad creada con advertencias de campos incompletos.'),
            created.missingFieldsWarning
          );
        } else {
          toast.success(t('Actividad de tratamiento creada con éxito.'));
        }
      }
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={initial ? t('Editar actividad RAT') : t('Nueva actividad de tratamiento (RAT)')}
      description={t(
        'El registro no se considera conforme solo por rellenar los campos; el asesor o DPO revisará la adecuación.'
      )}
      onClose={onClose}
      maxWidth={720}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid-2 gap-4">
          <FormField label="Nombre de la actividad" required>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Gestión de Nóminas y Personal"
            />
          </FormField>

          <FormField label="Rol según el RGPD" required>
            <Select value={role} onChange={(e) => setRole(e.target.value as GdprRole)}>
              {Object.entries(GDPR_ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label} ({v.help})
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField label="Finalidad concreta del tratamiento" required hint="Explique detalladamente para qué se recaban y tratan los datos.">
          <Textarea
            required
            rows={2}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Tramitación de nóminas, afiliación y cotizaciones a la Seguridad Social y retenciones IRPF."
          />
        </FormField>

        <div className="grid-2 gap-4">
          <FormField label="Base de legitimación (Art. 6 RGPD)" required>
            <Select
              value={legalBasis}
              onChange={(e) => setLegalBasis(e.target.value as LegalBasis)}
            >
              {Object.entries(LEGAL_BASIS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label} ({v.article})
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Estado de revisión de la base">
            <Select
              value={legalBasisReviewStatus}
              onChange={(e) =>
                setLegalBasisReviewStatus(
                  e.target.value as 'confirmed' | 'pending_review' | 'expert_justification_needed'
                )
              }
            >
              <option value="pending_review">{t('Pendiente de confirmación')}</option>
              <option value="confirmed">{t('Confirmada formalmente')}</option>
              <option value="expert_justification_needed">{t('Requiere informe del DPO')}</option>
            </Select>
          </FormField>
        </div>

        <div className="grid-2 gap-4">
          <FormField label="Categorías de interesados" required hint="Separadas por comas">
            <Input
              value={dataSubjectsStr}
              onChange={(e) => setDataSubjectsStr(e.target.value)}
              placeholder="Empleados, Candidatos, Clientes"
            />
          </FormField>

          <FormField label="Categorías de datos" required hint="Separadas por comas">
            <Input
              value={dataCategoriesStr}
              onChange={(e) => setDataCategoriesStr(e.target.value)}
              placeholder="Identificativos, Económicos, Profesionales"
            />
          </FormField>
        </div>

        <div className="p-3 bg-surface-2 rounded space-y-2">
          <Checkbox
            label="Trata datos de categoría especial (Art. 9 RGPD)"
            hint="Salud, datos biométricos, afiliación sindical, religión, etc."
            checked={specialCategories}
            onChange={setSpecialCategories}
          />

          {specialCategories && (
            <FormField label="Excepción aplicable y justificación Art. 9" required>
              <Input
                required
                value={specialCategoryNotes}
                onChange={(e) => setSpecialCategoryNotes(e.target.value)}
                placeholder="e.g. Art. 9.2.b: Obligaciones en materia de prevención de riesgos y derecho laboral."
              />
            </FormField>
          )}
        </div>

        <div className="grid-2 gap-4">
          <FormField label="Sistemas y ubicaciones de almacenamiento" required hint="Separados por comas">
            <Input
              value={systemsStr}
              onChange={(e) => setSystemsStr(e.target.value)}
              placeholder="ERP SAGE, Servidor local, Archivo en papel"
            />
          </FormField>

          <FormField label="Destinatarios / Cesiones previstas" hint="Separados por comas">
            <Input
              value={recipientsStr}
              onChange={(e) => setRecipientsStr(e.target.value)}
              placeholder="AEAT, TGSS, Mutua laboral, Banco"
            />
          </FormField>
        </div>

        <div className="grid-2 gap-4">
          <FormField label="Criterio o plazo de conservación" required>
            <Input
              required
              value={retentionRule}
              onChange={(e) => setRetentionRule(e.target.value)}
              placeholder="e.g. 4 años (Art. 66 LGT) / 5 años (Art. 4 LISOS)"
            />
          </FormField>

          <FormField label="Responsable interno de área" required>
            <Input
              required
              value={businessOwner}
              onChange={(e) => setBusinessOwner(e.target.value)}
              placeholder="Director RRHH / Administración"
            />
          </FormField>
        </div>

        <FormField label="Medidas de seguridad técnicas y organizativas" required>
          <Input
            required
            value={securityMeasures}
            onChange={(e) => setSecurityMeasures(e.target.value)}
            placeholder="Cifrado AES-256 en reposo, 2FA, copias diarias desconectadas"
          />
        </FormField>

        <FormField label="Fecha prevista para la próxima revisión anual" required>
          <Input
            required
            type="date"
            value={nextReviewDate}
            onChange={(e) => setNextReviewDate(e.target.value)}
          />
        </FormField>

        <div className="grid-3 gap-3">
          <Checkbox
            label="Transf. internacionales"
            checked={internationalTransfers}
            onChange={setInternationalTransfers}
          />
          <Checkbox
            label="Solicitar dictamen DPO"
            checked={specialistReviewFlag}
            onChange={setSpecialistReviewFlag}
          />
          <Checkbox
            label="EIPD / DPIA obligatoria"
            checked={dpiaRequired}
            onChange={setDpiaRequired}
          />
        </div>

        {internationalTransfers && (
          <FormField label="Garantías adecuadas para la transferencia (Art. 46)">
            <Input
              value={transferSafeguards}
              onChange={(e) => setTransferSafeguards(e.target.value)}
              placeholder="e.g. Cláusulas contractuales tipo (SCC) adoptadas por la Comisión"
            />
          </FormField>
        )}


        <div className="modal-footer row end gap-2 pt-4">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {initial ? t('Guardar cambios') : t('Crear actividad')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
