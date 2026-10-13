import {
  History,
  KeyRound,
  Lock,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { verifyAuditChain } from '../domain/audit';
import { formatInstant } from '../domain/time';
import type { AuditEvent } from '../domain/types';
import { useCtx } from '../store/hooks';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Input,
  Select,
  Table,
} from '../components/ui';
import { t } from '../i18n';

export function AuditPage() {
  const ctx = useCtx();

  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  const canViewRestricted = ctx.can('incidents.view_restricted');
  const allEvents = ctx.db.audit.filter((a) => a.companyId === ctx.company.id);

  // Cryptographic verification of the immutable chain
  const chainVerification = verifyAuditChain(ctx.db.audit);

  const filtered = allEvents.filter((ev) => {
    if (filterAction !== 'all' && !ev.action.startsWith(filterAction)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        ev.action.toLowerCase().includes(q) ||
        ev.summary.toLowerCase().includes(q) ||
        ev.entityLabel.toLowerCase().includes(q) ||
        ev.actor.name.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Registro de Trazabilidad y Auditoría (Accountability)')}</h1>
          <p className="page-subtitle">
            {t(
              'Evidencias de cumplimiento formal encadenadas criptográficamente según el Art. 5.2 RGPD (Principio de Responsabilidad Proactiva). Registra creaciones, decisiones, prórrogas, accesos a brechas e inspecciones.'
            )}
          </p>
        </div>
      </div>

      {/* Chain Verification Card */}
      <Card>
        <div className="row between items-center">
          <div className="row items-center gap-3">
            <div
              className="p-2 rounded"
              style={{
                background: chainVerification.valid ? 'var(--success-bg)' : 'var(--danger-bg)',
                color: chainVerification.valid ? 'var(--success)' : 'var(--danger)',
              }}
            >
              <ShieldCheck size={24} />
            </div>
            <div>
              <div className="strong">
                {chainVerification.valid
                  ? t('Cadena de auditoría verificada íntegra ({n} bloques)', {
                      n: chainVerification.totalEvents,
                    })
                  : t('Anomalía detectada en el encadenamiento criptográfico')}
              </div>
              <div className="tiny muted">
                {t(
                  'Cada evento vincula el hash SHA-256 del registro precedente para impedir manipulaciones o supresiones no autorizadas.'
                )}
              </div>
            </div>
          </div>

          <Badge tone={chainVerification.valid ? 'success' : 'danger'}>
            {chainVerification.valid ? t('Inmutable') : t('Alterado')}
          </Badge>
        </div>
      </Card>

      {/* Filter Bar */}
      <Card>
        <div className="row wrap gap-3 items-center">
          <div className="grow" style={{ minWidth: 240 }}>
            <Input
              placeholder={t('Buscar por acción, usuario, entidad o resumen…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ width: 220 }}>
            <Select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              aria-label={t('Filtrar por tipo de acción')}
            >
              <option value="all">{t('Todas las operaciones')}</option>
              <option value="ropa">{t('Tratamientos (RAT)')}</option>
              <option value="rights">{t('Derechos de interesados')}</option>
              <option value="incident">{t('Incidentes y seguridad')}</option>
              <option value="document">{t('Documentos y DPA')}</option>
              <option value="supplier">{t('Proveedores y encargados')}</option>
              <option value="retention">{t('Retención y borrado')}</option>
              <option value="task">{t('Tareas y revisiones')}</option>
            </Select>
          </div>

          {(search || filterAction !== 'all') && (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              onClick={() => {
                setSearch('');
                setFilterAction('all');
              }}
            >
              {t('Limpiar')}
            </Button>
          )}
        </div>
      </Card>

      {/* Audit Timeline Table */}
      <Card>
        <Table>
          <thead>
            <tr>
              <th>{t('Seq.')}</th>
              <th>{t('Fecha / Hora')}</th>
              <th>{t('Usuario actuante')}</th>
              <th>{t('Operación')}</th>
              <th>{t('Entidad / Expediente')}</th>
              <th>{t('Resumen de la actuación')}</th>
              <th>{t('Hash')}</th>
              <th>{t('Detalle')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted">
                  <EmptyState icon={History} title="Sin eventos coincidentes">
                    {t('No hay registros de auditoría para los criterios seleccionados.')}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered
                .slice()
                .reverse()
                .map((ev) => {
                  const isRestrictedEvent = ev.restricted && !canViewRestricted;

                  return (
                    <tr
                      key={ev.id}
                      className="clickable hover-surface"
                      onClick={() => setSelectedEvent(ev)}
                    >
                      <td>
                        <span className="font-mono text-xs">#{ev.seq}</span>
                      </td>
                      <td>
                        <span className="tiny font-mono">{formatInstant(ev.at)}</span>
                      </td>
                      <td>
                        <div className="strong tiny">{ev.actor.name}</div>
                        <div className="tiny muted">{ev.actor.role}</div>
                      </td>
                      <td>
                        <span className="badge neutral font-mono tiny">{ev.action}</span>
                      </td>
                      <td>
                        <span className="strong tiny">{ev.entityLabel}</span>
                      </td>
                      <td>
                        {isRestrictedEvent ? (
                          <span className="tiny muted italic">
                            <Lock size={11} className="inline mr-1" />
                            [Evento sensible reservado a Responsable de Privacidad]
                          </span>
                        ) : (
                          <span className="tiny">{ev.summary}</span>
                        )}
                      </td>
                      <td>
                        <span className="tiny font-mono muted" title={ev.hash}>
                          {ev.hash.slice(0, 8)}…
                        </span>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(ev);
                          }}
                        >
                          {t('Inspeccionar')}
                        </Button>
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </Table>
      </Card>

      {/* Drawer: Audit Event Details */}
      {selectedEvent && (
        <Drawer
          title={`Evento #${selectedEvent.seq} · ${selectedEvent.action}`}
          subtitle={formatInstant(selectedEvent.at)}
          onClose={() => setSelectedEvent(null)}
        >
          <div className="space-y-4">
            <div className="p-3 bg-surface-2 rounded text-sm space-y-2">
              <div className="grid-2 gap-2">
                <div>
                  <span className="muted block tiny">{t('Secuencia en la cadena:')}</span>
                  <span className="font-mono strong">#{selectedEvent.seq}</span>
                </div>
                <div>
                  <span className="muted block tiny">{t('Identificador único:')}</span>
                  <span className="font-mono">{selectedEvent.id}</span>
                </div>
                <div>
                  <span className="muted block tiny">{t('Usuario y rol:')}</span>
                  <span className="strong">
                    {selectedEvent.actor.name} ({selectedEvent.actor.role})
                  </span>
                </div>
                <div>
                  <span className="muted block tiny">{t('Entidad afectada:')}</span>
                  <span>{selectedEvent.entityType} ({selectedEvent.entityLabel})</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-1">{t('Resumen registrado')}</h4>
              <p className="bg-surface-1 p-3 rounded border text-sm">
                {selectedEvent.restricted && !canViewRestricted
                  ? t('[INFORMACIÓN CONFIDENCIAL: Reservada a Responsable de Privacidad y DPO]')
                  : selectedEvent.summary}
              </p>
            </div>

            {selectedEvent.changes && selectedEvent.changes.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-1">{t('Modificaciones de campos')}</h4>
                <div className="space-y-1">
                  {selectedEvent.changes.map((ch, idx) => (
                    <div key={idx} className="p-2 bg-surface-2 rounded text-xs grid-3 gap-2">
                      <span className="strong">{ch.field}</span>
                      <span className="text-danger">Antes: {ch.before}</span>
                      <span className="text-success">Después: {ch.after}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cryptographic Proof */}
            <div>
              <h4 className="font-semibold text-sm mb-1 row items-center gap-1">
                <KeyRound size={15} />
                <span>{t('Integridad criptográfica (SHA-256)')}</span>
              </h4>
              <div className="p-3 bg-surface-2 rounded text-xs font-mono space-y-2 break-all">
                <div>
                  <span className="muted block text-[10px] uppercase">{t('Hash previo (prevHash):')}</span>
                  <span>{selectedEvent.prevHash}</span>
                </div>
                <div>
                  <span className="muted block text-[10px] uppercase">{t('Hash del bloque (hash):')}</span>
                  <span className="strong text-info">{selectedEvent.hash}</span>
                </div>
              </div>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
