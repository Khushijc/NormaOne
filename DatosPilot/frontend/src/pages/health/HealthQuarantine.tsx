import { FileX2, Lock, Undo2, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmployeeLink } from '../../components/bits';
import { Badge, Button, Callout, Card, ConfirmDialog, DateTimeText, EmptyState, Pagination, SortHeader, sortRows, useAction, usePaged, useSort } from '../../components/ui';
import type { Tone } from '../../domain/status';
import type { QuarantineItem } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { userName } from '../../services/context';
import { handleQuarantine, quarantineRows } from '../../services/healthService';
import { useCtx } from '../../store/hooks';

type QRow = ReturnType<typeof quarantineRows>[number];
type HandleAction = 'returned_to_provider' | 'file_removed';

const DETECTION: Record<QuarantineItem['detectedBy'], { label: string; help: string }> = {
  uploader_flag: { label: tKey('Marcado por quien lo subió'), help: tKey('La persona que subió el archivo indicó que podía contener información clínica.') },
  keyword: { label: tKey('Palabra clave clínica'), help: tKey('El título o el nombre del archivo contiene una palabra clave clínica configurada por la empresa.') },
};

const Q_STATUS: Record<QuarantineItem['status'], { label: string; tone: Tone }> = {
  quarantined: { label: tKey('Retenido en cuarentena'), tone: 'danger' },
  returned_to_provider: { label: tKey('Devuelto al servicio médico'), tone: 'success' },
  file_removed: { label: tKey('Archivo retirado del portal'), tone: 'neutral' },
};

export function QuarantineTab({ rows }: { rows: QRow[] }) {
  const ctx = useCtx();
  const { runOk } = useAction();
  const [pendingAction, setPendingAction] = useState<{ row: QRow; action: HandleAction } | null>(null);
  const [status, setStatus] = useState<'' | QuarantineItem['status']>('quarantined');
  const filtered = useMemo(() => rows.filter((r) => !status || r.q.status === status), [rows, status]);
  const { sort, onSort } = useSort('at', 'desc');
  const sorted = useMemo(() => sortRows(filtered, sort, (r, col) => (col === 'at' ? r.q.quarantinedAt : col === 'status' ? r.q.status : col === 'uploader' ? userName(ctx.db, r.q.uploaderId) : null)), [filtered, sort, ctx.db]);
  const paged = usePaged(sorted, 25);

  return (
    <div className="stack">
      <Callout tone="warning" icon={ShieldAlert} title={t('Por qué un documento está en cuarentena (PRL-04)')}>
        {t('Cuando un archivo subido al área ordinaria parece contener información clínica (lo indica quien lo sube o coincide con una palabra clave configurada), no se incorpora al expediente: queda retenido aquí, fuera de las listas de documentación, y solo el personal sanitario puede gestionarlo.')}{' '}
        {t('El archivo no se puede abrir en el portal, tampoco desde esta área. El servicio médico lo devuelve a su circuito o lo retira; se conservan solo los metadatos del evento para la auditoría.')}
      </Callout>
      <Card
        flush
        title={
          <h2 className="row">
            <Lock size={16} aria-hidden /> {t('Documentos en cuarentena')}
          </h2>
        }
      >
        <div className="toolbar" role="search" aria-label={t('Filtros de cuarentena')}>
          <div className="field">
            <label htmlFor="hq-status">{t('Estado')}</label>
            <select id="hq-status" className="select" value={status} onChange={(e) => { setStatus(e.target.value as '' | QuarantineItem['status']); paged.reset(); }}>
              <option value="">{t('Todos')}</option>
              {(Object.keys(Q_STATUS) as QuarantineItem['status'][]).map((s) => (
                <option key={s} value={s}>
                  {t(Q_STATUS[s].label)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon={Lock} title={rows.length === 0 ? t('No hay documentos en cuarentena') : t('Ningún documento coincide con el filtro')}>
            {rows.length === 0 ? t('Si alguien sube un archivo con posible contenido clínico, aparecerá aquí para su gestión.') : t('Cambie el filtro de estado.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table health-table">
                <thead>
                  <tr>
                    <SortHeader label={t('Retenido el')} col="at" sort={sort} onSort={onSort} />
                    <th>{t('Persona afectada')}</th>
                    <th>{t('Archivo')}</th>
                    <SortHeader label={t('Subido por')} col="uploader" sort={sort} onSort={onSort} />
                    <th>{t('Detección')}</th>
                    <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                    <th>{t('Acciones')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => {
                    const st = Q_STATUS[r.q.status];
                    const det = DETECTION[r.q.detectedBy];
                    return (
                      <tr key={r.q.id}>
                        <td>
                          <DateTimeText at={r.q.quarantinedAt} tz={ctx.company.timezone} />
                        </td>
                        <td>
                          <EmployeeLink id={r.doc?.employeeId} />
                        </td>
                        <td className="small">
                          <span className="health-locked">
                            <Lock size={12} aria-hidden /> {r.version?.file?.name ?? t('Archivo retirado')}
                          </span>
                          <div className="sub">{t('No se puede abrir desde el portal')}</div>
                        </td>
                        <td className="small">{userName(ctx.db, r.q.uploaderId)}</td>
                        <td>
                          <Badge tone="info" icon={false} title={t(det.help)}>
                            {t(det.label)}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={st.tone}>{t(st.label)}</Badge>
                          {r.q.handledAt && (
                            <div className="sub">
                              {userName(ctx.db, r.q.handledBy)} · <DateTimeText at={r.q.handledAt} tz={ctx.company.timezone} />
                            </div>
                          )}
                          {r.q.note && <div className="sub">{r.q.note}</div>}
                        </td>
                        <td>
                          {r.q.status === 'quarantined' ? (
                            <div className="row-wrap health-actions">
                              <Button size="sm" variant="primary" icon={Undo2} onClick={() => setPendingAction({ row: r, action: 'returned_to_provider' })}>
                                {t('Devolver al servicio médico')}
                              </Button>
                              <Button size="sm" variant="danger-outline" icon={FileX2} onClick={() => setPendingAction({ row: r, action: 'file_removed' })}>
                                {t('Retirar el archivo')}
                              </Button>
                            </div>
                          ) : (
                            <span className="muted small">{t('Gestionado')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>
      {pendingAction && (
        <ConfirmDialog
          title={pendingAction.action === 'returned_to_provider' ? t('Devolver al servicio médico') : t('Retirar el archivo del portal')}
          message={
            <p className="small">
              {pendingAction.action === 'returned_to_provider'
                ? t('El archivo se devuelve al circuito del servicio médico y se elimina del portal. Se conservan los metadatos del evento.')
                : t('El archivo se elimina del portal sin incorporarse a ningún expediente. Se conservan los metadatos del evento.')}
            </p>
          }
          confirmLabel={pendingAction.action === 'returned_to_provider' ? t('Devolver y retirar') : t('Retirar el archivo')}
          danger={pendingAction.action === 'file_removed'}
          requireReason
          reasonLabel={t('Nota de gestión (queda en la auditoría restringida)')}
          onConfirm={(note) =>
            runOk(() => handleQuarantine(pendingAction.row.q.id, pendingAction.action, note), pendingAction.action === 'returned_to_provider' ? t('Documento devuelto al servicio médico; archivo retirado del portal') : t('Archivo retirado del portal'))
          }
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
