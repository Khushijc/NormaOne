/**
 * Period close status (TIM-08, R05, R30): open items per month, close with explicit
 * acknowledgement of open items and a note, reopen with a reason, and the close history.
 * Closing never hides anything: the open items at close are stored and every export of the
 * period discloses the current open exceptions and pending corrections.
 */
import { Lock, LockOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportButton } from '../../components/ExportButton';
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, DateTimeText, EmptyState, StatusBadge, useAction } from '../../components/ui';
import { PERIOD_STATUS } from '../../domain/status';
import { addMonths, formatMonth, nowInstant, startOfMonth } from '../../domain/time';
import { t, tKey } from '../../i18n';
import { userName } from '../../services/context';
import { closePeriod, periodRange, periodStatus, reopenPeriod, type Column, type PeriodStatusInfo } from '../../services/reportService';
import { useCtx } from '../../store/hooks';

const PERIOD_COLUMNS: Column<PeriodStatusInfo>[] = [
  { key: 'periodo', label: 'Periodo', value: (r) => r.period },
  { key: 'estado', label: 'Estado', value: (r) => (r.status === 'closed' ? 'Cerrado' : 'Abierto') },
  { key: 'incidencias_abiertas', label: 'Incidencias abiertas', value: (r) => r.openExceptions },
  { key: 'correcciones_pendientes', label: 'Correcciones pendientes', value: (r) => r.pendingCorrections },
  { key: 'ausencias_pendientes', label: 'Ausencias pendientes', value: (r) => r.pendingAbsences },
  { key: 'registros_incompletos', label: 'Registros incompletos', value: (r) => r.incompleteRecords },
  { key: 'cerrado_el', label: 'Cerrado el', value: (r) => (r.status === 'closed' ? r.record?.closedAt ?? null : null) },
  { key: 'declaradas_al_cierre', label: 'Elementos abiertos declarados al cierre', value: (r) => (r.status === 'closed' ? r.record?.openExceptionsAtClose ?? null : null) },
];

const HISTORY_ACTION: Record<string, string> = { closed: tKey('Periodo cerrado'), reopened: tKey('Periodo reabierto') };

const EXPORT_TITLE = 'Estado de cierre de periodos';

export function PeriodCloseReport() {
  const ctx = useCtx();
  const periods = useMemo(() => [0, -1, -2].map((n) => addMonths(startOfMonth(ctx.today), n).slice(0, 7)), [ctx.today]);
  const infos = useMemo(() => {
    const now = nowInstant();
    return periods.map((p) => periodStatus(ctx, p, now));
  }, [ctx, periods]);
  const protocol = ctx.db.protocols.find((p) => p.companyId === ctx.company.id && p.status === 'active');
  const canClose = ctx.can('periods.close');
  const [closing, setClosing] = useState<PeriodStatusInfo | null>(null);
  const [reopening, setReopening] = useState<PeriodStatusInfo | null>(null);
  const history = useMemo(
    () =>
      ctx.db.periods
        .filter((p) => p.companyId === ctx.company.id)
        .flatMap((p) => p.history.map((h) => ({ ...h, period: p.period, declared: p.openExceptionsAtClose })))
        .sort((a, b) => b.at.localeCompare(a.at)),
    [ctx],
  );

  return (
    <div className="stack">
      {!protocol && (
        <Callout tone="warning" title={t('No hay un protocolo de registro aprobado')}>
          {t('El cierre exige un protocolo de registro vigente (ET art. 34.9).')}{' '}
          {ctx.can('settings.manage') && <Link to="/configuracion">{t('Ir a Configuración')}</Link>}
        </Callout>
      )}
      {!canClose && <Callout tone="neutral">{t('Solo la administración de RR. HH. puede cerrar o reabrir periodos. Usted puede consultar su estado.')}</Callout>}
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{t('Estado de cierre de los tres últimos meses')}</caption>
          <thead>
            <tr>
              <th>{t('Periodo')}</th>
              <th>{t('Estado')}</th>
              <th className="num">{t('Incidencias abiertas')}</th>
              <th className="num">{t('Correcciones pendientes')}</th>
              <th className="num">{t('Ausencias pendientes')}</th>
              <th className="num">{t('Registros incompletos')}</th>
              <th>{t('Último cierre')}</th>
              {canClose && <th>{t('Acciones')}</th>}
            </tr>
          </thead>
          <tbody>
            {infos.map((p) => {
              const { from, to } = periodRange(p.period);
              const closed = p.status === 'closed';
              return (
                <tr key={p.period}>
                  <td className="strong nowrap">{formatMonth(p.period)}</td>
                  <td>{closed ? <StatusBadge meta={PERIOD_STATUS.closed} /> : <StatusBadge meta={PERIOD_STATUS.open} />}</td>
                  <td className="num"><Link to={`/incidencias?desde=${from}&hasta=${to}`}>{p.openExceptions}</Link></td>
                  <td className="num"><Link to="/correcciones">{p.pendingCorrections}</Link></td>
                  <td className="num"><Link to="/ausencias">{p.pendingAbsences}</Link></td>
                  <td className="num"><Link to={`/registros?estado=incomplete&desde=${from}&hasta=${to}`}>{p.incompleteRecords}</Link></td>
                  <td className="small">
                    {p.record?.closedAt ? (
                      <>
                        <DateTimeText at={p.record.closedAt} tz={ctx.company.timezone} /> · {userName(ctx.db, p.record.closedBy)}
                        <div className="sub">{t('{n} incidencias declaradas al cierre', { n: p.record.openExceptionsAtClose })}</div>
                        {!closed && p.record.reopenedAt && <div className="sub">{t('Reabierto')}: <DateTimeText at={p.record.reopenedAt} tz={ctx.company.timezone} /></div>}
                      </>
                    ) : (
                      <span className="muted">{t('Nunca cerrado')}</span>
                    )}
                  </td>
                  {canClose && (
                    <td>
                      {closed ? (
                        <Button size="sm" icon={LockOpen} onClick={() => setReopening(p)}>{t('Reabrir')}</Button>
                      ) : (
                        <Button size="sm" variant="primary" icon={Lock} onClick={() => setClosing(p)} disabled={!protocol}>{t('Cerrar periodo')}</Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row-wrap between">
        <span className="small muted">{t('Al cerrar se guarda el número de elementos abiertos; cada exportación posterior los declara en sus metadatos.')}</span>
        <ExportButton kind="estado_cierre" title={EXPORT_TITLE} rows={infos} columns={PERIOD_COLUMNS} filters="Tres últimos meses" />
      </div>

      <Card title={t('Historial de cierres y reaperturas')}>
        {history.length === 0 ? (
          <EmptyState title={t('Todavía no se ha cerrado ningún periodo')} />
        ) : (
          <ol className="timeline">
            {history.map((h, i) => (
              <li key={i}>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="strong">{t(HISTORY_ACTION[h.action] ?? h.action)} · {formatMonth(h.period)}</span>
                  <span className="tiny muted nowrap"><DateTimeText at={h.at} tz={ctx.company.timezone} /></span>
                </div>
                <div className="tiny muted">{userName(ctx.db, h.by)}</div>
                {h.action === 'closed' && <div className="tiny">{t('{n} incidencias declaradas al cierre', { n: h.declared })}</div>}
                {h.note && <div className="small">{h.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {closing && <CloseDialog info={closing} onClose={() => setClosing(null)} />}
      {reopening && <ReopenDialog info={reopening} onClose={() => setReopening(null)} />}
    </div>
  );
}

function CloseDialog({ info, onClose }: { info: PeriodStatusInfo; onClose: () => void }) {
  const { runOk } = useAction();
  const open = info.openExceptions + info.pendingCorrections + info.incompleteRecords;
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title={t('Cerrar el periodo {p}', { p: formatMonth(info.period) })}
      confirmLabel={t('Cerrar periodo')}
      requireReason={open > 0}
      reasonLabel={open > 0 ? t('Nota de cierre: explique las incidencias abiertas que se declaran (mínimo 10 caracteres)') : t('Nota de cierre (opcional)')}
      onConfirm={async (reason) => {
        if (open > 0 && !ack) {
          setError(t('Confirme que los elementos abiertos se declararán en el cierre y en cada exportación.'));
          return false;
        }
        if (open > 0 && reason.length < 10) {
          setError(t('Explique las incidencias abiertas que se declaran al cerrar (mínimo 10 caracteres).'));
          return false;
        }
        setError(null);
        return runOk(() => closePeriod(info.period, reason, ack), t('Periodo {p} cerrado', { p: formatMonth(info.period) }));
      }}
      onClose={onClose}
      message={
        <div className="stack-sm">
          <span>{t('Cerrar el periodo bloquea nuevas correcciones de sus fechas hasta que se reabra. No modifica ningún registro.')}</span>
          {open > 0 ? (
            <Callout tone="warning" title={t('Hay {n} elementos abiertos', { n: open })}>
              <ul>
                <li>{t('Incidencias abiertas')}: {info.openExceptions}</li>
                <li>{t('Correcciones pendientes')}: {info.pendingCorrections}</li>
                <li>{t('Registros incompletos')}: {info.incompleteRecords}</li>
                <li>{t('Ausencias pendientes')}: {info.pendingAbsences}</li>
              </ul>
            </Callout>
          ) : (
            <Callout tone="success">{t('No hay incidencias abiertas, correcciones pendientes ni registros incompletos en el periodo.')}</Callout>
          )}
        </div>
      }
    >
      {open > 0 && (
        <Checkbox
          checked={ack}
          onChange={(v) => {
            setAck(v);
            if (v) setError(null);
          }}
          label={t('Entiendo que los {n} elementos abiertos se declaran en el cierre y en cada exportación del periodo.', { n: open })}
        />
      )}
      {error && <div className="field"><span className="error" role="alert">{error}</span></div>}
    </ConfirmDialog>
  );
}

function ReopenDialog({ info, onClose }: { info: PeriodStatusInfo; onClose: () => void }) {
  const { runOk } = useAction();
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title={t('Reabrir el periodo {p}', { p: formatMonth(info.period) })}
      confirmLabel={t('Reabrir')}
      requireReason
      reasonLabel={t('Motivo de la reapertura (mínimo 10 caracteres; queda en la auditoría)')}
      message={t('Las exportaciones generadas antes se conservan. Reabrir permite volver a corregir registros de este periodo.')}
      onConfirm={async (reason) => {
        if (reason.length < 10) {
          setError(t('Explique el motivo de la reapertura (mínimo 10 caracteres).'));
          return false;
        }
        setError(null);
        return runOk(() => reopenPeriod(info.period, reason), t('Periodo {p} reabierto', { p: formatMonth(info.period) }));
      }}
      onClose={onClose}
    >
      {error && <div className="field"><span className="error" role="alert">{error}</span></div>}
      {info.record?.closedAt && (
        <Badge tone="neutral" icon={false}>
          {t('{n} incidencias declaradas al cierre', { n: info.record.openExceptionsAtClose })}
        </Badge>
      )}
    </ConfirmDialog>
  );
}
