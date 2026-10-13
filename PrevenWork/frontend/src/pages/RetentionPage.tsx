import {
  Archive,
  Lock,
  Plus,
  Unlock,
} from 'lucide-react';
import { useState } from 'react';
import {
  createRetentionPolicy,
  processDeletionReview,
  setLegalHold,
} from '../services/retentionService';
import { formatDate } from '../domain/time';
import type { DeletionReviewItem, RetentionPolicy } from '../domain/types';
import { useCtx } from '../store/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  Modal,
  Select,
  Table,
  Tabs,
  Textarea,
  useToast,
} from '../components/ui';
import { t } from '../i18n';

export function RetentionPage() {
  const ctx = useCtx();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'policies' | 'queue'>('queue');

  const [createPolicyOpen, setCreatePolicyOpen] = useState(false);
  const [legalHoldTarget, setLegalHoldTarget] = useState<RetentionPolicy | null>(null);
  const [processItem, setProcessItem] = useState<DeletionReviewItem | null>(null);

  const policies = ctx.db.retentionPolicies.filter((p) => p.companyId === ctx.company.id);
  const queueItems = ctx.db.deletionReviews.filter((d) => d.companyId === ctx.company.id);

  const pendingQueue = queueItems.filter((q) => q.status === 'pending_review');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Conservación de Datos y Cola de Supresiones')}</h1>
          <p className="page-subtitle">
            {t(
              'Cuadro de plazos legales de conservación (Art. 30 CCom, Art. 66 LGT, Art. 4 LISOS), bloqueos legales cautelares (Art. 32 LOPDGDD) y ejecución autorizada de borrados con trazabilidad segura.'
            )}
          </p>
        </div>
        <div className="page-actions">
          {ctx.can('retention.manage') && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setCreatePolicyOpen(true)}
            >
              {t('Nueva regla de retención')}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          {
            id: 'queue',
            label: 'Cola de revisión de supresiones',
            count: pendingQueue.length || undefined,
          },
          {
            id: 'policies',
            label: 'Políticas y cuadro de conservación',
            count: policies.length,
          },
        ]}
      />

      {/* Tab: Deletion Review Queue */}
      {activeTab === 'queue' && (
        <div className="space-y-6">
          <Card
            title={t('Registros elegibles para supresión o bloqueo')}
            subtitle={t(
              'Antes de autorizar el borrado, el sistema valida la ausencia de bloqueos judiciales o litigios pendientes. La supresión genera un identificador seguro de destrucción (tombstone).'
            )}
          >
            <Table>
              <thead>
                <tr>
                  <th>{t('Identificador')}</th>
                  <th>{t('Regla de retención')}</th>
                  <th>{t('Sistema')}</th>
                  <th>{t('Fecha vencimiento')}</th>
                  <th>{t('Bloqueo legal')}</th>
                  <th>{t('Estado')}</th>
                  <th>{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {queueItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted">
                      <EmptyState icon={Archive} title="Cola vacía">
                        {t('No hay registros vencidos pendientes de revisión.')}
                      </EmptyState>
                    </td>
                  </tr>
                ) : (
                  queueItems.map((item) => {
                    const policy = policies.find((p) => p.id === item.policyId);
                    const hasHold = policy?.activeLegalHold;

                    return (
                      <tr key={item.id} className="hover-surface">
                        <td>
                          <div className="strong">{item.recordIdentifier}</div>
                          {item.tombstoneRef && (
                            <div className="tiny muted font-mono">
                              Tombstone: {item.tombstoneRef}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="tiny font-semibold">{policy?.code} · {policy?.categoryName}</span>
                          <div className="tiny muted">{policy?.legalJustification}</div>
                        </td>
                        <td>
                          <span className="badge neutral">{item.system}</span>
                        </td>
                        <td>
                          <span className="tiny font-mono">{formatDate(item.eligibleDate)}</span>
                        </td>
                        <td>
                          {hasHold ? (
                            <Badge tone="danger" icon={Lock}>
                              {t('Bloqueo activo')}
                            </Badge>
                          ) : (
                            <Badge tone="success" icon={Unlock}>
                              {t('Sin excepciones')}
                            </Badge>
                          )}
                        </td>
                        <td>
                          <Badge
                            tone={
                              item.status === 'approved_erased'
                                ? 'success'
                                : item.status === 'blocked_legal_hold'
                                ? 'warning'
                                : item.status === 'rejected_retained'
                                ? 'info'
                                : 'neutral'
                            }
                          >
                            {item.status === 'approved_erased'
                              ? t('Borrado ejecutado')
                              : item.status === 'blocked_legal_hold'
                              ? t('Bloqueado')
                              : item.status === 'rejected_retained'
                              ? t('Conservación extendida')
                              : t('Pendiente revisión')}
                          </Badge>
                        </td>
                        <td>
                          {item.status === 'pending_review' && ctx.can('retention.erase') ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setProcessItem(item)}
                            >
                              {t('Dictaminar')}
                            </Button>
                          ) : (
                            <span className="tiny text-muted">{t('Completado')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      {/* Tab: Retention Policies Table */}
      {activeTab === 'policies' && (
        <div className="space-y-6">
          <Card
            title={t('Cuadro corporativo de plazos de retención')}
            subtitle={t(
              'Políticas configuradas por área de negocio justificadas en normativa sectorial española.'
            )}
          >
            <Table>
              <thead>
                <tr>
                  <th>{t('Código')}</th>
                  <th>{t('Categoría documental')}</th>
                  <th>{t('Finalidad')}</th>
                  <th>{t('Sistema')}</th>
                  <th>{t('Plazo legal')}</th>
                  <th>{t('Fundamentación jurídica')}</th>
                  <th>{t('Bloqueo activo')}</th>
                  <th>{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((pol) => (
                  <tr key={pol.id} className="hover-surface">
                    <td>
                      <span className="font-mono font-semibold">{pol.code}</span>
                    </td>
                    <td>
                      <div className="strong">{pol.categoryName}</div>
                      <div className="tiny muted">{pol.triggerEvent}</div>
                    </td>
                    <td>
                      <div className="tiny" style={{ maxWidth: 200 }}>
                        {pol.purpose}
                      </div>
                    </td>
                    <td>
                      <span className="badge neutral">{pol.system}</span>
                    </td>
                    <td>
                      <span className="strong">
                        {pol.periodMonths} {t('meses')} ({(pol.periodMonths / 12).toFixed(1)} {t('años')})
                      </span>
                    </td>
                    <td>
                      <span className="tiny text-info">{pol.legalJustification}</span>
                    </td>
                    <td>
                      {pol.activeLegalHold ? (
                        <div>
                          <Badge tone="danger" icon={Lock}>
                            {t('Bloqueo judicial/fiscal')}
                          </Badge>
                          {pol.legalHoldReason && (
                            <div className="tiny text-danger mt-1">{pol.legalHoldReason}</div>
                          )}
                        </div>
                      ) : (
                        <span className="tiny text-muted">{t('Ordinario')}</span>
                      )}
                    </td>
                    <td>
                      {ctx.can('retention.manage') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setLegalHoldTarget(pol)}
                        >
                          {pol.activeLegalHold ? t('Retirar bloqueo') : t('Activar bloqueo')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      {/* Modal: Process Deletion Decision */}
      {processItem && (
        <ProcessDeletionModal
          item={processItem}
          policy={policies.find((p) => p.id === processItem.policyId)!}
          onClose={() => setProcessItem(null)}
          onSuccess={() => {
            setProcessItem(null);
            toast.success(t('Resolución ejecutada y registrada en el historial seguro de destrucción.'));
          }}
        />
      )}

      {/* Modal: Toggle Legal Hold */}
      {legalHoldTarget && (
        <LegalHoldModal
          policy={legalHoldTarget}
          onClose={() => setLegalHoldTarget(null)}
          onSuccess={() => {
            setLegalHoldTarget(null);
            toast.success(t('Estado de bloqueo legal actualizado.'));
          }}
        />
      )}

      {/* Modal: Create Retention Policy */}
      {createPolicyOpen && (
        <CreateRetentionPolicyModal
          onClose={() => setCreatePolicyOpen(false)}
          onSaved={() => {
            setCreatePolicyOpen(false);
            toast.success(t('Política de conservación añadida al cuadro corporativo.'));
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Sub-Modals ───────────────────────────────

function ProcessDeletionModal({
  item,
  policy,
  onClose,
  onSuccess,
}: {
  item: DeletionReviewItem;
  policy: RetentionPolicy;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [action, setAction] = useState<'erase' | 'block_retain'>('erase');
  const [notes, setNotes] = useState('Verificado vencimiento del plazo legal de retención sin excepciones activas.');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      processDeletionReview(item.id, action, notes);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Dictaminar Supresión / Bloqueo: {id}', { id: item.recordIdentifier })}
      description={t(
        'La supresión definitiva destruye los registros en los sistemas de producción. Si existe obligación de conservación o litigio, debe seleccionarse Bloqueo de Datos.'
      )}
      onClose={onClose}
      maxWidth={520}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-surface-2 rounded text-xs space-y-1">
          <div>
            <span className="strong">{t('Regla aplicable:')}</span> {policy.code} ({policy.legalJustification})
          </div>
          <div>
            <span className="strong">{t('Sistema destino:')}</span> {item.system}
          </div>
          {policy.activeLegalHold && (
            <div className="text-danger font-semibold mt-1">
              ⚠️ {t('ATENCIÓN: Existe un bloqueo legal activo en esta categoría. La supresión física será rechazada por el sistema.')}
            </div>
          )}
        </div>

        <FormField label="Acción autorizada por el Responsable" required>
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value as 'erase' | 'block_retain')}
          >
            <option value="erase">{t('AUTORIZAR BORRADO FÍSICO (Generar tombstone)')}</option>
            <option value="block_retain">{t('BLOQUEAR DATOS (Art. 32 LOPDGDD - Retención restringida)')}</option>
          </Select>
        </FormField>

        <FormField label="Motivación y constancia de verificación" required>
          <Textarea
            required
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant={action === 'erase' ? 'danger' : 'primary'} type="submit">
            {action === 'erase' ? t('Ejecutar supresión') : t('Formalizar bloqueo')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LegalHoldModal({
  policy,
  onClose,
  onSuccess,
}: {
  policy: RetentionPolicy;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const willHold = !policy.activeLegalHold;
  const [reason, setReason] = useState(
    policy.legalHoldReason ?? 'Requerimiento de inspección tributaria / procedimiento judicial en curso'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLegalHold(policy.id, willHold, willHold ? reason : undefined);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={
        willHold
          ? t('Activar Bloqueo Legal: {code}', { code: policy.code })
          : t('Retirar Bloqueo Legal: {code}', { code: policy.code })
      }
      description={
        willHold
          ? t(
              'El bloqueo legal suspende cualquier orden de borrado automático o manual en esta categoría documental.'
            )
          : t('Al retirar el bloqueo, los registros vencidos volverán a ser elegibles para supresión.')
      }
      onClose={onClose}
      maxWidth={480}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {willHold && (
          <FormField label="Motivo del bloqueo legal" required>
            <Input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Diligencias previas Juzgado de lo Social nº 4"
            />
          </FormField>
        )}

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant={willHold ? 'danger' : 'primary'} type="submit">
            {willHold ? t('Activar bloqueo cautelar') : t('Retirar bloqueo')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateRetentionPolicyModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();

  const [categoryName, setCategoryName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [system, setSystem] = useState('ERP / Base de datos');
  const [triggerEvent, setTriggerEvent] = useState('Extinción de la relación contractual');
  const [periodMonths, setPeriodMonths] = useState<number>(60);
  const [legalJustification, setLegalJustification] = useState('Art. 1964 Código Civil (5 años acciones personales)');
  const [nextReviewDate, setNextReviewDate] = useState('2027-01-15');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      createRetentionPolicy(
        categoryName,
        purpose,
        system,
        triggerEvent,
        Number(periodMonths),
        legalJustification,
        nextReviewDate
      );
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Nueva Regla de Conservación y Retención')}
      description={t('Configure la justificación y plazo legal aplicable a cada serie de datos.')}
      onClose={onClose}
      maxWidth={540}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Categoría de los datos / documentos" required>
          <Input
            required
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="e.g. CVs de candidatos descartados"
          />
        </FormField>

        <FormField label="Finalidad de los registros" required>
          <Input
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Selección de personal y cobertura de vacantes"
          />
        </FormField>

        <div className="grid-2 gap-4">
          <FormField label="Sistema de almacenamiento" required>
            <Input
              required
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="e.g. Portal empleo, Correo RRHH"
            />
          </FormField>

          <FormField label="Plazo de conservación (Meses)" required>
            <Input
              required
              type="number"
              min={1}
              value={periodMonths}
              onChange={(e) => setPeriodMonths(Number(e.target.value))}
            />
          </FormField>
        </div>

        <FormField label="Hito de cómputo del plazo" required>
          <Input
            required
            value={triggerEvent}
            onChange={(e) => setTriggerEvent(e.target.value)}
            placeholder="e.g. Finalización del proceso selectivo"
          />
        </FormField>

        <FormField label="Fundamentación jurídica / Norma habilitante" required>
          <Input
            required
            value={legalJustification}
            onChange={(e) => setLegalJustification(e.target.value)}
            placeholder="e.g. Criterio AEPD: Máximo 1 año para procesos de selección activos"
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
            {t('Guardar regla')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
