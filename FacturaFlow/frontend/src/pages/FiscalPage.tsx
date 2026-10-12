import { Activity, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { IssueGatePanel } from '../components/invoiceBits';
import { Badge, Button, Callout, Card, DateText, DateTimeText, EmptyState, KV, PageHeader, SelectField, SimulatedTag, StatusBadge, useAction } from '../components/ui';
import { diffDays } from '../domain/dates';
import { FISCAL_OPERATION_STATE, FISCAL_STATUS } from '../domain/status';
import type { ProviderScenario } from '../domain/types';
import { t } from '../i18n';
import { runHealthCheck, SCENARIO_LABEL, setNextScenario, setProviderStatus } from '../services/adminService';
import { reconcileOperation } from '../services/invoiceService';
import { useCtx } from '../store/hooks';
import { userName } from '../store/selectors';

export function FiscalPage() {
  const ctx = useCtx();
  const db = ctx.db;
  const p = ctx.provider;
  const [params] = useSearchParams();
  const highlight = params.get('op');
  const { run, runOk, pending } = useAction();
  const [stateFilter, setStateFilter] = useState('');
  const invoices = db.invoices.filter((i) => i.companyId === ctx.company.id);
  const exceptions = invoices.filter((i) => i.pendingOperationId || i.fiscalStatus === 'rejected' || i.fiscalStatus === 'needs_review');
  const ops = db.fiscalOperations.filter((o) => o.companyId === ctx.company.id && (!stateFilter || o.state === stateFilter)).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  const expiresIn = p?.authorisationExpires ? diffDays(ctx.today, p.authorisationExpires) : null;
  const providerStatusLabel = { approved: t('Aprobado'), expired: t('Caducado'), suspended: t('Suspendido'), not_configured: t('No configurado') };

  return (
    <>
      <PageHeader
        title={t('Integración fiscal')}
        subtitle={t('Frontera con el proveedor fiscal aprobado (emisión, registros de facturación, acuses). En este prototipo el proveedor es una simulación local.')}
        actions={<SimulatedTag label={t('Sin conexión con la AEAT ni con un proveedor real')} />}
      />
      <div className="stack-lg">
        <IssueGatePanel ctx={ctx} showWhenOk />
        <div className="grid-2">
          <Card title={t('Proveedor fiscal')} actions={<Button size="sm" icon={Activity} loading={pending} disabled={!p || p.status === 'not_configured'} onClick={() => run(() => runHealthCheck(), (r) => t('Comprobación simulada correcta ({ms} ms)', { ms: r.latencyMs }))}>{t('Comprobar estado')}</Button>}>
            {!p || p.status === 'not_configured' ? (
              <EmptyState icon={PlugZap} title={t('Sin proveedor configurado')}>{t('La emisión está bloqueada. Seleccionar el proveedor es la decisión D-03 del BRD.')}</EmptyState>
            ) : (
              <KV
                items={[
                  [t('Proveedor'), p.providerName],
                  [t('Entorno'), <Badge tone="warning">{t('Simulación local (sandbox)')}</Badge>],
                  [t('Estado'), <Badge tone={p.status === 'approved' ? 'success' : 'danger'}>{providerStatusLabel[p.status]}</Badge>],
                  [t('Mandato / autorización'), p.authorisationRef],
                  [t('Caducidad'), <><DateText date={p.authorisationExpires} />{expiresIn !== null && <> {expiresIn < 0 ? <Badge tone="danger">{t('Caducada')}</Badge> : expiresIn <= 30 ? <Badge tone="warning">{t('Caduca en {n} días', { n: expiresIn })}</Badge> : null}</>}</>],
                  [t('Versión del componente'), <span className="mono">{p.componentVersion}</span>],
                  [t('Modalidad SIF'), ctx.finance.sifMode === 'verifactu' ? t('VERI*FACTU (remisión por el proveedor)') : ctx.finance.sifMode === 'no_verifactu' ? t('No VERI*FACTU') : t('Sin decidir')],
                  [t('Escenarios soportados'), <ul style={{ margin: 0, paddingLeft: 18 }}>{p.supportedScenarios.map((s) => <li key={s}>{t(s)}</li>)}</ul>],
                  [t('Última comprobación'), <DateTimeText at={p.lastHealthCheckAt} />],
                ]}
              />
            )}
            {ctx.can('settings.company') && p && p.status !== 'not_configured' && (
              <div className="row" style={{ marginTop: 12 }}>
                <span className="small muted">{t('Demostración:')}</span>
                {p.status === 'approved' ? <Button size="sm" onClick={() => runOk(() => setProviderStatus('suspended'), t('Proveedor suspendido (simulado): la emisión queda bloqueada'))}>{t('Simular suspensión')}</Button> : <Button size="sm" onClick={() => runOk(() => setProviderStatus('approved'), t('Proveedor reactivado (simulado)'))}>{t('Reactivar')}</Button>}
              </div>
            )}
          </Card>
          <Card title={t('Declaración responsable del productor')}>
            {p?.producerDeclaration ? (
              <>
                <KV items={[[t('Sistema'), p.producerDeclaration.softwareName], [t('Identificador'), p.producerDeclaration.softwareId], [t('Versión'), p.producerDeclaration.version], [t('Productor'), `${p.producerDeclaration.producerName} · ${p.producerDeclaration.producerNif}`], [t('Fecha'), <DateText date={p.producerDeclaration.declarationDate} />]]} />
                <div style={{ marginTop: 10 }}>
                  <Callout tone="warning" title={t('Contenido ilustrativo')}>
                    {t('Datos ficticios. En producción se mostrará la declaración real de la versión instalada (RD 1007/2023 art. 13; Orden HAC/1177/2024 art. 15). La AEAT no certifica software: el producto nunca debe presentarse como «certificado por la AEAT».')}
                  </Callout>
                </div>
              </>
            ) : <Callout tone="danger">{t('Sin declaración responsable: la emisión permanece bloqueada.')}</Callout>}
          </Card>
        </div>

        {(ctx.can('fiscal.simulate') || ctx.can('fiscal.reconcile')) && p && p.status !== 'not_configured' && (
          <Card title={<div className="row"><h2>{t('Simulación del próximo envío')}</h2><SimulatedTag /></div>}>
            <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
              <SelectField label={t('Respuesta que devolverá el proveedor simulado')} value={p.nextScenario} onChange={(e) => runOk(() => setNextScenario(e.target.value as ProviderScenario), t('Escenario actualizado'))} hint={t('Se aplica a un único envío y vuelve a «Aceptación».')}>
                {Object.entries(SCENARIO_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </SelectField>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>{t('Use «Tiempo de espera — el proveedor SÍ lo procesó» y vuelva a pulsar «Emitir» para comprobar que no se duplica la factura (AC-FIN-01). Use «Rechazo» para AC-FIN-02.')}</p>
          </Card>
        )}

        <Card title={t('Excepciones abiertas')} flush>
          {exceptions.length === 0 ? <EmptyState icon={ShieldCheck} title={t('Sin excepciones fiscales abiertas')} /> : (
            <table className="table">
              <thead><tr><th>{t('Factura')}</th><th>{t('Estado fiscal')}</th><th>{t('Detalle')}</th><th>{t('Responsable')}</th><th /></tr></thead>
              <tbody>
                {exceptions.map((i) => {
                  const op = i.pendingOperationId ? db.fiscalOperations.find((o) => o.id === i.pendingOperationId) : db.fiscalOperations.filter((o) => o.invoiceId === i.id).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))[0];
                  return (
                    <tr key={i.id}>
                      <td><Link to={`/facturas/${i.id}?tab=fiscal`} className="strong">{i.number ?? op?.reservedNumber ?? t('Pendiente')}</Link><div className="sub">{db.customers.find((c) => c.id === i.customerId)?.legalName}</div></td>
                      <td><StatusBadge meta={FISCAL_STATUS[i.fiscalStatus]} />{i.pendingOperationId && <div className="sub">{t('Resultado incierto')}</div>}</td>
                      <td className="small">{op?.responseMessage ? t(op.responseMessage) : null}{op?.errors.map((e) => <div key={e.code} style={{ color: 'var(--danger)' }}>{e.code}: {t(e.message)}</div>)}</td>
                      <td className="small">{t('Emisor/a autorizado/a')}<div className="sub">{t('Suplente: propiedad')}</div></td>
                      <td>
                        {i.pendingOperationId && ctx.can('fiscal.reconcile') ? (
                          <Button size="sm" variant="primary" icon={RefreshCw} loading={pending} onClick={() => run(() => reconcileOperation(i.pendingOperationId!), (r) => t(r.message))}>{t('Conciliar')}</Button>
                        ) : (
                          <Link className="btn sm" to={`/facturas/${i.id}?tab=fiscal`}>{t('Subsanar')}</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="card-footer small muted">{t('Una excepción solo se cierra con un resultado del proveedor (conciliación o reenvío aceptado), nunca marcándola manualmente (AC-PLT-04).')}</div>
        </Card>

        <Card title={t('Registro de operaciones')} flush actions={<select aria-label={t('Filtrar por resultado')} className="select" style={{ width: 200 }} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}><option value="">{t('Todos los resultados')}</option>{Object.entries(FISCAL_OPERATION_STATE).map(([k, m]) => <option key={k} value={k}>{t(m.label)}</option>)}</select>}>
          {ops.length === 0 ? <EmptyState title={t('Sin operaciones')} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('Solicitada')}</th><th>{t('Factura')}</th><th>{t('Clave de operación')}</th><th className="num">{t('Intento')}</th><th>{t('Resultado')}</th><th>{t('ID solicitud / proveedor')}</th><th>{t('Por')}</th></tr></thead>
                <tbody>
                  {ops.slice(0, 60).map((o) => (
                    <tr key={o.id} style={o.id === highlight ? { background: 'var(--warning-bg)' } : undefined}>
                      <td><DateTimeText at={o.requestedAt} /></td>
                      <td><Link to={`/facturas/${o.invoiceId}?tab=fiscal`}>{db.invoices.find((i) => i.id === o.invoiceId)?.number ?? o.reservedNumber}</Link></td>
                      <td className="mono small">{o.operationKey}</td>
                      <td className="num">{o.attempt}</td>
                      <td><StatusBadge meta={FISCAL_OPERATION_STATE[o.state]} />{o.reconciledAt && <div className="sub">{t('conciliada')}</div>}</td>
                      <td className="mono small">{o.providerRequestId ?? '—'}<div className="sub">{o.providerInvoiceId ?? ''}</div></td>
                      <td className="small">{userName(db, o.requestedBy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('Controles comunes de integración (diseño para el backend)')}>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>INT-01</strong> {t('Se conservan identificadores de solicitud/respuesta y marcas de tiempo, sin credenciales ni datos personales innecesarios en los registros.')}</li>
            <li><strong>INT-02</strong> {t('Clave de operación única por factura')} (<span className="mono">inv:&lt;id&gt;:issue</span>){t('; los reintentos reutilizan clave y número.')}</li>
            <li><strong>INT-03</strong> {t('Los fallos quedan en cola con responsable y vía de resolución manual (conciliación).')}</li>
            <li><strong>INT-04</strong> {t('Validar autenticidad, pertenencia a la empresa y protección frente a repeticiones de los eventos entrantes (pendiente de backend).')}</li>
            <li><strong>INT-05</strong> {t('Estado del proveedor, versión y caducidad de autorización visibles en esta pantalla.')}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
