import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { financeIssueGate, isIssueBlocked } from '../domain/applicability';
import { COLLECTION_STATUS, DOCUMENT_STATUS, EXCHANGE_STATUS, FISCAL_STATUS } from '../domain/status';
import type { Database, Invoice } from '../domain/types';
import { t, tKey } from '../i18n';
import type { UiCtx } from '../store/hooks';
import { collectionStatus, isOverdue, daysOverdue } from '../store/selectors';
import { Badge, Callout, StatusBadge } from './ui';

/** Compact rendering of the four independent tracks (never collapsed into one). */
export function InvoiceStatusStack({ db, inv, today, compact }: { db: Database; inv: Invoice; today: string; compact?: boolean }) {
  const col = collectionStatus(db, inv);
  const overdue = isOverdue(db, inv, today);
  return (
    <div className="status-stack">
      <StatusBadge meta={DOCUMENT_STATUS[inv.documentStatus]} prefix={tKey('Documento')} />
      {inv.documentStatus === 'draft' && inv.review.state === 'requested' && <Badge tone="accent">{t('Pend. aprobación')}</Badge>}
      {inv.documentStatus === 'draft' && inv.review.state === 'returned' && <Badge tone="warning">{t('Devuelta')}</Badge>}
      {(inv.fiscalStatus !== 'not_submitted' || !compact) && <StatusBadge meta={FISCAL_STATUS[inv.fiscalStatus]} prefix={tKey('Fiscal')} />}
      {inv.pendingOperationId && <Badge tone="warning">{t('Conciliar')}</Badge>}
      {(inv.exchangeStatus !== 'not_sent' || !compact) && inv.documentStatus !== 'draft' && <StatusBadge meta={EXCHANGE_STATUS[inv.exchangeStatus]} prefix={tKey('Envío')} />}
      {col && <StatusBadge meta={COLLECTION_STATUS[col]} prefix={tKey('Cobro')} />}
      {overdue && <Badge tone="danger">{t('Vencida {n} d', { n: daysOverdue(db, inv, today) })}</Badge>}
    </div>
  );
}

/** The four tracks with explanations, for the invoice detail header. */
export function InvoiceTracks({ db, inv, today }: { db: Database; inv: Invoice; today: string }) {
  const col = collectionStatus(db, inv);
  const tracks = [
    { label: tKey('Documento'), meta: DOCUMENT_STATUS[inv.documentStatus] },
    { label: tKey('Registro fiscal (simulado)'), meta: FISCAL_STATUS[inv.fiscalStatus] },
    { label: tKey('Envío / intercambio'), meta: EXCHANGE_STATUS[inv.exchangeStatus] },
    { label: tKey('Cobro'), meta: col ? COLLECTION_STATUS[col] : { label: tKey('No aplica'), tone: 'neutral' as const, help: inv.kind === 'rectifying' ? tKey('El cobro o abono se gestiona en la factura original.') : tKey('Solo las facturas emitidas generan derecho de cobro.') } },
  ];
  return (
    <div className="card">
      <div className="tracks" aria-label={t('Estados independientes de la factura')}>
        {tracks.map((track) => (
          <div className="track" key={track.label}>
            <div className="t-label">{t(track.label)}</div>
            <StatusBadge meta={track.meta} prefix={track.label} />
            {track.label === 'Cobro' && isOverdue(db, inv, today) && (
              <span style={{ marginLeft: 6 }}>
                <Badge tone="danger">{t('Vencida hace {n} días', { n: daysOverdue(db, inv, today) })}</Badge>
              </span>
            )}
            <div className="t-help">{t(track.meta.help)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** FIN-01 / AC-FIN-04: blocking reasons with responsible owner. */
export function IssueGatePanel({ ctx, showWhenOk }: { ctx: UiCtx; showWhenOk?: boolean }) {
  const gate = financeIssueGate(ctx.company, ctx.finance, ctx.provider, ctx.today);
  const blocked = isIssueBlocked(gate);
  if (!gate.length) {
    return showWhenOk ? (
      <Callout tone="success" icon={ShieldCheck} title={t('Emisión simulada habilitada para esta empresa')}>
        {t('Configuración revisada, proveedor (simulado) aprobado y declaración responsable disponible. Esto no certifica el cumplimiento legal.')}
      </Callout>
    ) : null;
  }
  return (
    <Callout tone={blocked ? 'danger' : 'warning'} icon={ShieldAlert} title={blocked ? t('Emisión bloqueada para esta empresa') : t('Avisos de aplicabilidad')}>
      <ul>
        {gate.map((g) => (
          <li key={g.code}>
            <strong>{g.severity === 'block' ? t('Bloqueo') : t('Aviso')}:</strong> {t(g.message)} <span className="muted">— {t('Responsable: {owner}', { owner: t(g.owner) })} · {g.requirement}</span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}
