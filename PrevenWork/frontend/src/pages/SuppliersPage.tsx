import {
  Building,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createSupplier,
  updateSupplierAssessment,
  type SupplierInput,
} from '../services/supplierService';
import { SUPPLIER_ROLE } from '../domain/status';
import { formatDate } from '../domain/time';
import type {
  AgreementStatus,
  Supplier,
  SupplierAssessmentStatus,
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

const AGREEMENT_LABELS: Record<AgreementStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' }> = {
  signed: { label: 'Firmado (DPA en vigor)', tone: 'success' },
  pending_signature: { label: 'Pendiente de firma', tone: 'warning' },
  negotiating: { label: 'En negociación de cláusulas', tone: 'info' },
  missing: { label: 'Sin contrato formalizado', tone: 'danger' },
};

export function SuppliersPage() {
  const ctx = useCtx();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterAgreement, setFilterAgreement] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(searchParams.get('crear') === '1');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const [assessModalOpen, setAssessModalOpen] = useState(false);

  const suppliers = ctx.db.suppliers.filter((s) => s.companyId === ctx.company.id);

  const filtered = suppliers.filter((sup) => {
    if (filterRole !== 'all' && sup.assessedRole !== filterRole) return false;
    if (filterAgreement !== 'all' && sup.agreementStatus !== filterAgreement) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        sup.reference.toLowerCase().includes(q) ||
        sup.name.toLowerCase().includes(q) ||
        sup.serviceDescription.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const selectedSupplier = selectedId
    ? suppliers.find((s) => s.id === selectedId) ?? null
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Proveedores y Encargados de Tratamiento')}</h1>
          <p className="page-subtitle">
            {t(
              'Evaluación formal del rol según el Art. 28 RGPD (encargado, responsable independiente o corresponsable). Contratos DPA, subencargados y transferencias internacionales.'
            )}
          </p>
        </div>
        <div className="page-actions">
          {ctx.can('suppliers.manage') && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setSearchParams({ crear: '1' });
                setCreateOpen(true);
              }}
            >
              {t('Nuevo proveedor')}
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="row wrap gap-3 items-center">
          <div className="grow" style={{ minWidth: 240 }}>
            <Input
              placeholder={t('Buscar por nombre o servicio prestado…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ width: 220 }}>
            <Select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              aria-label={t('Filtrar por rol')}
            >
              <option value="all">{t('Todos los roles evaluados')}</option>
              {Object.entries(SUPPLIER_ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <div style={{ width: 200 }}>
            <Select
              value={filterAgreement}
              onChange={(e) => setFilterAgreement(e.target.value)}
              aria-label={t('Estado de contrato DPA')}
            >
              <option value="all">{t('Todos los estados DPA')}</option>
              {Object.entries(AGREEMENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          {(search || filterRole !== 'all' || filterAgreement !== 'all') && (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              onClick={() => {
                setSearch('');
                setFilterRole('all');
                setFilterAgreement('all');
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
              <th>{t('Ref.')}</th>
              <th>{t('Proveedor / Tercero')}</th>
              <th>{t('Servicio prestado')}</th>
              <th>{t('Rol evaluado (RGPD)')}</th>
              <th>{t('Contrato DPA (Art. 28)')}</th>
              <th>{t('Transf. Internacional')}</th>
              <th>{t('Próxima revisión')}</th>
              <th>{t('Acciones')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted">
                  <EmptyState icon={Building} title="Sin proveedores coincidentes">
                    {t('No constan proveedores con los criterios indicados.')}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered.map((sup) => {
                const roleMeta = SUPPLIER_ROLE[sup.assessedRole];
                const agreeMeta = AGREEMENT_LABELS[sup.agreementStatus];

                return (
                  <tr
                    key={sup.id}
                    className="clickable hover-surface"
                    onClick={() => {
                      setSelectedId(sup.id);
                      setSearchParams({ id: sup.id });
                    }}
                  >
                    <td>
                      <span className="font-mono font-semibold">{sup.reference}</span>
                    </td>
                    <td>
                      <div className="strong">{sup.name}</div>
                    </td>
                    <td>
                      <div className="tiny muted text-truncate" style={{ maxWidth: 220 }}>
                        {sup.serviceDescription}
                      </div>
                    </td>
                    <td>
                      <Badge tone={roleMeta.tone}>{roleMeta.label}</Badge>
                    </td>
                    <td>
                      <Badge tone={agreeMeta.tone}>{agreeMeta.label}</Badge>
                    </td>
                    <td>
                      {sup.internationalTransfer ? (
                        <span className="badge danger">
                          🌍 {sup.transferDestinationCountry ?? t('Tercer país')}
                        </span>
                      ) : (
                        <span className="tiny text-muted">{t('UE / EEE')}</span>
                      )}
                    </td>
                    <td>
                      <span className="tiny">{formatDate(sup.nextReviewDate)}</span>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(sup.id);
                          setSearchParams({ id: sup.id });
                        }}
                      >
                        {t('Evaluación')}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {/* Drawer: Supplier Detail View */}
      {selectedSupplier && (
        <Drawer
          title={`${selectedSupplier.reference} · ${selectedSupplier.name}`}
          subtitle={
            <div className="row items-center gap-2 mt-1">
              <Badge tone={SUPPLIER_ROLE[selectedSupplier.assessedRole].tone}>
                {SUPPLIER_ROLE[selectedSupplier.assessedRole].label}
              </Badge>
              <Badge tone={AGREEMENT_LABELS[selectedSupplier.agreementStatus].tone}>
                {AGREEMENT_LABELS[selectedSupplier.agreementStatus].label}
              </Badge>
            </div>
          }
          onClose={() => {
            setSelectedId(null);
            setSearchParams({});
          }}
          footer={
            <div className="row between items-center w-full">
              <div>
                {ctx.can('suppliers.manage') && (
                  <Button
                    variant="primary"
                    onClick={() => setAssessModalOpen(true)}
                  >
                    {t('Actualizar evaluación de rol')}
                  </Button>
                )}
              </div>
              <div>
                {selectedSupplier.agreementStatus !== 'signed' && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      toast.info(
                        t(
                          'Simulación: Solicitud formal de contrato DPA y cuestionario de seguridad remitida al proveedor.'
                        )
                      );
                    }}
                  >
                    📧 {t('Reclamar contrato DPA')}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-6">
            {/* Assessment Rationale Notice (Scenario 11) */}
            <div className="p-3 bg-surface-2 rounded border space-y-2 text-sm">
              <div className="strong">{t('Evaluación del rol según el RGPD')}</div>
              <p>{selectedSupplier.assessmentRationale}</p>
              {selectedSupplier.assessedRole === 'needs_professional_review' && (
                <div className="p-2 bg-warning-bg text-warning rounded text-xs mt-2">
                  ⚠️ {t(
                    'Se ha solicitado revisión profesional para determinar si actúa como encargado o responsable independiente. La plataforma no inventa automáticamente una relación de encargo.'
                  )}
                </div>
              )}
            </div>

            {/* Service & Personal Data Accessed */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('1. Servicio y Datos Personales')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Descripción de los servicios:')}</span>
                  <p>{selectedSupplier.serviceDescription}</p>
                </div>
                <div>
                  <span className="muted block tiny">{t('Datos a los que tiene acceso:')}</span>
                  <div className="row wrap gap-1 mt-1">
                    {selectedSupplier.personalDataAccessed.map((d, i) => (
                      <span key={i} className="badge neutral">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Agreement & Subprocessors */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('2. Contrato de Encargo y Subencargados')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div className="grid-2 gap-2">
                  <div>
                    <span className="muted block tiny">{t('Estado del contrato DPA:')}</span>
                    <span className="strong">{AGREEMENT_LABELS[selectedSupplier.agreementStatus].label}</span>
                  </div>
                  <div>
                    <span className="muted block tiny">{t('Fecha de firma:')}</span>
                    <span>{formatDate(selectedSupplier.agreementSignedDate)}</span>
                  </div>
                </div>
                <div>
                  <span className="muted block tiny">{t('Subencargados declarados:')}</span>
                  <p>{selectedSupplier.subprocessorsList || t('Ninguno declarado o autorizado expresamente')}</p>
                </div>
              </div>
            </div>

            {/* International Transfers & Security */}
            <div>
              <h4 className="font-semibold text-sm mb-2">{t('3. Transferencias Internacionales y Seguridad')}</h4>
              <div className="bg-surface-2 p-3 rounded space-y-2 text-sm">
                <div>
                  <span className="muted block tiny">{t('Transferencia internacional fuera de UE / EEE:')}</span>
                  <p>
                    {selectedSupplier.internationalTransfer
                      ? `Sí · Destino: ${selectedSupplier.transferDestinationCountry} · Salvaguarda: ${selectedSupplier.transferSafeguard?.toUpperCase()}`
                      : t('No (Servidores e infraestructuras alojadas íntegramente en la UE)')}
                  </p>
                </div>
                <div>
                  <span className="muted block tiny">{t('Revisión de medidas de seguridad:')}</span>
                  <p>{selectedSupplier.securityReviewNotes}</p>
                </div>
              </div>
            </div>
          </div>
        </Drawer>
      )}

      {/* Modal: Create Supplier */}
      {createOpen && (
        <CreateSupplierModal
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

      {/* Modal: Update Role Assessment (Scenario 11) */}
      {assessModalOpen && selectedSupplier && (
        <AssessSupplierModal
          supplier={selectedSupplier}
          onClose={() => setAssessModalOpen(false)}
          onSuccess={() => {
            setAssessModalOpen(false);
            toast.success(t('Evaluación del proveedor actualizada formalmente.'));
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Supplier Modals ───────────────────────────────

function CreateSupplierModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();

  const [name, setName] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [dataStr, setDataStr] = useState('Nombres, correos de contacto, facturación');
  const [assessedRole, setAssessedRole] = useState<SupplierAssessmentStatus>('in_progress');
  const [assessmentRationale, setAssessmentRationale] = useState(
    'Pendiente de análisis formal del clausulado de prestación de servicios.'
  );
  const [agreementStatus, setAgreementStatus] = useState<AgreementStatus>('pending_signature');
  const [internationalTransfer, setInternationalTransfer] = useState(false);
  const [securityNotes, setSecurityNotes] = useState('Cifrado TLS en tránsito, acceso con contraseñas seguras');
  const [nextReviewDate, setNextReviewDate] = useState('2027-01-15');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const input: SupplierInput = {
      name,
      serviceDescription,
      personalDataAccessed: dataStr.split(',').map((s) => s.trim()).filter(Boolean),
      assessedRole,
      assessmentRationale,
      linkedRopaIds: [],
      agreementStatus,
      subprocessorsListed: false,
      internationalTransfer,
      securityReviewNotes: securityNotes,
      nextReviewDate,
    };

    try {
      createSupplier(input);
      toast.success(t('Proveedor registrado en el libro de encargados.'));
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Alta de Proveedor / Tercero con Acceso a Datos')}
      description={t(
        'Art. 28 RGPD: No se presume que todo proveedor es encargado de tratamiento. Se evaluará la relación contractual y el destino de los datos.'
      )}
      onClose={onClose}
      maxWidth={620}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Nombre o razón social del proveedor" required>
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Asesoría Fiscal y Contable Mediterráneo, S.L."
          />
        </FormField>

        <FormField label="Servicio que presta a la empresa" required>
          <Textarea
            required
            rows={2}
            value={serviceDescription}
            onChange={(e) => setServiceDescription(e.target.value)}
            placeholder="e.g. Confección de impuestos trimestrales, balances y libros oficiales contables."
          />
        </FormField>

        <FormField label="Datos a los que accede" required hint="Separados por comas">
          <Input
            value={dataStr}
            onChange={(e) => setDataStr(e.target.value)}
          />
        </FormField>

        <div className="grid-2 gap-4">
          <FormField label="Rol evaluado en el tratamiento" required>
            <Select
              value={assessedRole}
              onChange={(e) => setAssessedRole(e.target.value as SupplierAssessmentStatus)}
            >
              {Object.entries(SUPPLIER_ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Estado del contrato de encargo DPA" required>
            <Select
              value={agreementStatus}
              onChange={(e) => setAgreementStatus(e.target.value as AgreementStatus)}
            >
              {Object.entries(AGREEMENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField label="Motivación jurídica de la evaluación de rol" required>
          <Textarea
            required
            rows={2}
            value={assessmentRationale}
            onChange={(e) => setAssessmentRationale(e.target.value)}
          />
        </FormField>

        <div className="p-3 bg-surface-2 rounded">
          <Checkbox
            label="Realiza transferencias internacionales fuera del EEE"
            checked={internationalTransfer}
            onChange={setInternationalTransfer}
          />
        </div>

        <FormField label="Medidas de seguridad revisadas" required>
          <Input
            required
            value={securityNotes}
            onChange={(e) => setSecurityNotes(e.target.value)}
          />
        </FormField>

        <FormField label="Fecha de próxima revisión anual" required>
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
            {t('Dar de alta proveedor')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AssessSupplierModal({
  supplier,
  onClose,
  onSuccess,
}: {
  supplier: Supplier;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [role, setRole] = useState<SupplierAssessmentStatus>(supplier.assessedRole);
  const [rationale, setRationale] = useState(supplier.assessmentRationale);
  const [agreementStatus, setAgreementStatus] = useState<AgreementStatus>(supplier.agreementStatus);
  const [internationalTransfer, setInternationalTransfer] = useState(supplier.internationalTransfer);
  const [transferCountry, setTransferCountry] = useState(supplier.transferDestinationCountry ?? '');
  const [transferSafeguard, setTransferSafeguard] = useState(supplier.transferSafeguard ?? 'scc');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      updateSupplierAssessment(supplier.id, {
        assessedRole: role,
        assessmentRationale: rationale,
        agreementStatus,
        internationalTransfer,
        transferDestinationCountry: internationalTransfer ? transferCountry : undefined,
        transferSafeguard: internationalTransfer ? (transferSafeguard as any) : undefined,
      });
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Actualizar Evaluación de Proveedor: {name}', { name: supplier.name })}
      description={t(
        'Puede marcar el proveedor para «Revisión técnica requerida» si existen dudas sin necesidad de imponer un encargo de tratamiento indebido.'
      )}
      onClose={onClose}
      maxWidth={580}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Rol asignado conforme al RGPD" required>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as SupplierAssessmentStatus)}
          >
            {Object.entries(SUPPLIER_ROLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Fundamentación y justificación del rol" required hint="Explique si el tercero determina fines de forma autónoma o solo procesa por cuenta de la empresa.">
          <Textarea
            required
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </FormField>

        <FormField label="Estado del contrato de encargo DPA (Art. 28)" required>
          <Select
            value={agreementStatus}
            onChange={(e) => setAgreementStatus(e.target.value as AgreementStatus)}
          >
            {Object.entries(AGREEMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="p-3 bg-surface-2 rounded space-y-2">
          <Checkbox
            label="Transferencias internacionales fuera del EEE"
            checked={internationalTransfer}
            onChange={setInternationalTransfer}
          />

          {internationalTransfer && (
            <div className="grid-2 gap-2 pt-2">
              <FormField label="País de destino">
                <Input
                  value={transferCountry}
                  onChange={(e) => setTransferCountry(e.target.value)}
                  placeholder="e.g. Estados Unidos"
                />
              </FormField>

              <FormField label="Mecanismo de garantía (Art. 46)">
                <Select
                  value={transferSafeguard}
                  onChange={(e) => setTransferSafeguard(e.target.value as any)}
                >
                  <option value="scc">{t('Cláusulas Contractuales Tipo (SCC)')}</option>
                  <option value="adequacy">{t('Decisión de Adecuación (DPF)')}</option>
                  <option value="bcr">{t('Normas Corporativas Vinculantes')}</option>
                  <option value="none">{t('Sin garantías (Pendiente subsanación)')}</option>
                </Select>
              </FormField>
            </div>
          )}
        </div>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Guardar dictamen')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
