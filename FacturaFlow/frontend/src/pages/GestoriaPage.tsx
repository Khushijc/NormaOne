import { Building2, CheckCircle2, Download, FolderPlus, PackageCheck, Send } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Callout, Card, Checkbox, DateText, DateTimeText, EmptyState, KV, Money, PageHeader, TextAreaField, TextField, useAction } from '../components/ui';
import { addMonths, formatDate, startOfMonth } from '../domain/dates';
import { isMembershipActive } from '../domain/permissions';
import type { HandoverPackage } from '../domain/types';
import { t, tKey } from '../i18n';
import { accessibleCompanies } from '../services/context';
import { acknowledgeHandover, createHandover, deliverHandover, effectiveChecklist, exportHandover, summarisePeriod, toggleManualCheck, updateHandoverNotes } from '../services/handoverService';
import { setSession } from '../store/db';
import { useCtx } from '../store/hooks';
import { userName } from '../store/selectors';

const STATUS_LABEL: Record<HandoverPackage['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  in_preparation: { label: tKey('En preparación'), tone: 'warning' },
  ready: { label: tKey('Lista'), tone: 'info' },
  delivered: { label: tKey('Entregada a la gestoría'), tone: 'info' },
  acknowledged: { label: tKey('Recibida por la gestoría'), tone: 'success' },
};

export function GestoriaPage() {
  const ctx = useCtx();
  const db = ctx.db;
  const { runOk, pending } = useAction();
  const handovers = db.handovers.filter((h) => h.companyId === ctx.company.id).sort((a, b) => (a.periodFrom < b.periodFrom ? 1 : -1));
  const [selectedId, setSelectedId] = useState<string | null>(handovers[0]?.id ?? null);
  const selected = handovers.find((h) => h.id === selectedId) ?? handovers[0];
  const [month, setMonth] = useState(addMonths(startOfMonth(ctx.today), -1).slice(0, 7));
  const isGestoria = ctx.membership?.roles.includes('gestoria');
  const myClients = accessibleCompanies(db, ctx.user.id).filter((x) => x.membership.roles.includes('gestoria'));
  const advisers = db.memberships.filter((m) => m.companyId === ctx.company.id && m.roles.includes('gestoria'));
  const exportsList = db.exports.filter((x) => x.companyId === ctx.company.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <>
      <PageHeader
        title={t('Gestoría y traspasos contables')}
        subtitle={t('Traspaso periódico a la asesoría: facturas emitidas, gastos aprobados, cobros, excepciones y totales de conciliación. Exportaciones operativas, no declaraciones tributarias.')}
        actions={ctx.can('handover.manage') && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <TextField label={t('Periodo')} type="month" value={month} max={ctx.today.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            <Button icon={FolderPlus} loading={pending} onClick={() => runOk(() => createHandover(month), t('Traspaso creado'))}>{t('Preparar traspaso')}</Button>
          </div>
        )}
      />
      <div className="stack-lg">
        <div className="grid-2">
          {isGestoria ? (
            <Card title={t('Empresas cliente asignadas')}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack-sm">
                {myClients.map(({ company, membership }) => (
                  <li key={company.id} className="row between">
                    <span className="row"><Building2 size={16} aria-hidden /><span><strong>{company.legalName}</strong><div className="tiny muted">{membership.mandateRef} · {t('hasta {date}', { date: formatDate(membership.validUntil) })}</div></span></span>
                    {company.id === ctx.company.id ? <Badge tone="success">{t('Activa')}</Badge> : <Button size="sm" onClick={() => setSession({ companyId: company.id })}>{t('Cambiar')}</Button>}
                  </li>
                ))}
              </ul>
              <p className="tiny muted" style={{ marginTop: 8 }}>{t('Solo se muestran las empresas con mandato vigente. Sin acceso a datos de RR. HH., salud ni casos de privacidad.')}</p>
            </Card>
          ) : (
            <Card title={t('Asesores con acceso a esta empresa')}>
              {advisers.length === 0 ? <p className="muted">{t('Ninguno.')}</p> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack-sm">
                  {advisers.map((m) => (
                    <li key={m.id} className="row between">
                      <span><strong>{userName(db, m.userId)}</strong> · {db.users.find((u) => u.id === m.userId)?.organisation}<div className="tiny muted">{m.mandateRef} · {m.validUntil ? t('hasta {date}', { date: formatDate(m.validUntil) }) : t('sin caducidad')}</div></span>
                      <Badge tone={isMembershipActive(m, ctx.today) ? 'success' : 'neutral'}>{isMembershipActive(m, ctx.today) ? t('Activo') : t('Revocado/caducado')}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {ctx.can('settings.users') && <p className="small" style={{ marginTop: 8 }}><Link to="/configuracion?tab=usuarios">{t('Gestionar accesos')}</Link></p>}
            </Card>
          )}
          <Card title={t('Componente fiscal instalado')}>
            <KV items={[[t('Versión'), ctx.provider?.componentVersion ?? '—'], [t('Declaración responsable'), ctx.provider?.producerDeclaration ? t('{name} v{version} ({date}) — demo', { name: ctx.provider.producerDeclaration.softwareName, version: ctx.provider.producerDeclaration.version, date: formatDate(ctx.provider.producerDeclaration.declarationDate) }) : t('No disponible')], [t('Modalidad'), ctx.finance.sifMode]]} />
          </Card>
        </div>

        {handovers.length === 0 ? (
          <Card><EmptyState icon={PackageCheck} title={t('No hay traspasos')}>{t('Prepare el traspaso del último periodo cerrado.')}</EmptyState></Card>
        ) : (
          <div className="grid-main-side" style={{ gridTemplateColumns: '280px minmax(0,1fr)' }}>
            <Card title={t('Periodos')} flush>
              <ul style={{ listStyle: 'none', margin: 0, padding: 6 }}>
                {handovers.map((h) => (
                  <li key={h.id}>
                    <button className="list-btn" aria-current={h.id === selected?.id} onClick={() => setSelectedId(h.id)}>
                      <span className="grow"><strong>{t(h.label)}</strong><div className="tiny"><Badge tone={STATUS_LABEL[h.status].tone}>{t(STATUS_LABEL[h.status].label)}</Badge></div></span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {selected && <HandoverDetail h={selected} />}
          </div>
        )}

        <Card title={t('Historial de exportaciones')} flush>
          {exportsList.length === 0 ? <EmptyState title={t('Sin exportaciones')} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('Fecha')}</th><th>{t('Archivo')}</th><th>{t('Contenido')}</th><th className="num">{t('Registros')}</th><th className="num">{t('Total')}</th><th>{t('Huella (demo)')}</th><th>{t('Por')}</th></tr></thead>
                <tbody>
                  {exportsList.slice(0, 30).map((x) => (
                    <tr key={x.id}>
                      <td><DateTimeText at={x.createdAt} /></td>
                      <td className="mono small">{x.fileName}</td>
                      <td className="small">{t(x.filters)}{x.periodFrom && <div className="sub">{formatDate(x.periodFrom)} – {formatDate(x.periodTo)}</div>}</td>
                      <td className="num">{x.recordCount}</td>
                      <td className="num">{x.totalCents !== null ? <Money cents={x.totalCents} /> : '—'}</td>
                      <td className="mono small">{x.fingerprint}</td>
                      <td className="small">{userName(db, x.createdBy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-footer tiny muted">{t('Las exportaciones se generan en el navegador. Cada una queda registrada (fecha, alcance, recuento, huella) para poder reconstruir qué se entregó.')}</div>
        </Card>
      </div>
    </>
  );
}

function HandoverDetail({ h }: { h: HandoverPackage }) {
  const ctx = useCtx();
  const db = ctx.db;
  const { run, runOk, pending } = useAction();
  const list = effectiveChecklist(db, h);
  const summary = summarisePeriod(db, h.companyId, h.periodFrom, h.periodTo);
  const done = list.filter((c) => c.done).length;
  const [notes, setNotes] = useState(h.notes);
  const editable = h.status === 'in_preparation' && ctx.can('handover.manage');
  return (
    <Card
      title={<div><h2>{t('Traspaso')} {t(h.label)}</h2><div className="small muted">{formatDate(h.periodFrom)} – {formatDate(h.periodTo)} · <Badge tone={STATUS_LABEL[h.status].tone}>{t(STATUS_LABEL[h.status].label)}</Badge></div></div>}
      actions={
        <>
          {ctx.can('exports.create') && <Button icon={Download} loading={pending} onClick={() => run(() => exportHandover(h.id, 'csv'), (n) => t('{n} archivos CSV generados y registrados', { n }))}>CSV</Button>}
          {ctx.can('exports.create') && <Button icon={Download} loading={pending} onClick={() => run(() => exportHandover(h.id, 'json'), () => t('Paquete JSON generado y registrado'))}>{t('Paquete JSON')}</Button>}
          {editable && <Button variant="primary" icon={Send} loading={pending} onClick={() => runOk(() => deliverHandover(h.id), t('Traspaso entregado a la gestoría'))}>{t('Entregar')}</Button>}
          {h.status === 'delivered' && ctx.can('handover.acknowledge') && <Button variant="primary" icon={CheckCircle2} loading={pending} onClick={() => runOk(() => acknowledgeHandover(h.id), t('Recepción confirmada'))}>{t('Confirmar recepción')}</Button>}
        </>
      }
    >
      <div className="stack">
        <div>
          <div className="row between small"><span>{t('Checklist')}</span><span>{done} {t('de')} {list.length}</span></div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={done}><div style={{ width: `${(done / list.length) * 100}%` }} /></div>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack-sm">
          {list.map((c) => (
            <li key={c.key}>
              {c.auto ? (
                <div className="row">
                  <Badge tone={c.done ? 'success' : 'warning'}>{c.done ? t('Cumple') : t('Pendiente')}</Badge>
                  <span>{t(c.label)}</span>
                  <span className="tiny muted">{t('(automático)')}</span>
                </div>
              ) : (
                <Checkbox label={<>{t(c.label)} <span className="tiny muted">({t('manual')}{c.doneBy ? ` · ${userName(db, c.doneBy)}` : ''})</span></>} checked={c.done} disabled={!editable} onChange={(v) => runOk(() => toggleManualCheck(h.id, c.key, v))} />
              )}
            </li>
          ))}
        </ul>
        <div className="grid-2">
          <div>
            <h3 style={{ marginBottom: 6 }}>{t('Conciliación del periodo')}</h3>
            <KV
              items={[
                [t('Facturas emitidas'), summary.invoices.count],
                [t('Base / IVA'), <><Money cents={summary.invoices.base} /> / <Money cents={summary.invoices.tax} /></>],
                [t('Retenciones'), <Money cents={summary.invoices.withholding} />],
                [t('Total facturado'), <Money cents={summary.invoices.total} />],
                [t('Rectificativas'), <>{summary.invoices.rectifyingCount} · <Money cents={summary.invoices.rectifyingTotal} /></>],
                [t('Cobrado en el periodo'), <Money cents={summary.collected} />],
                [t('Gastos aprobados'), <>{summary.expenses.count} · <Money cents={summary.expenses.total} /> ({t('IVA')} <Money cents={summary.expenses.vat} />)</>],
                [t('Gastos sin revisar'), summary.expenses.pending],
              ]}
            />
          </div>
          <div>
            <h3 style={{ marginBottom: 6 }}>{t('Excepciones ({n})', { n: summary.exceptions.length })}</h3>
            {summary.exceptions.length === 0 ? <Callout tone="success">{t('Sin excepciones en el periodo.')}</Callout> : (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {summary.exceptions.map((x, i) => <li key={i}><Link to={x.link}>{t(x.label)}</Link></li>)}
              </ul>
            )}
          </div>
        </div>
        <TextAreaField label={t('Notas del traspaso (obligatorias si se entrega con puntos pendientes)')} rows={3} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== h.notes && runOk(() => updateHandoverNotes(h.id, notes))} />
        <KV items={[[t('Creado'), <>{userName(db, h.createdBy)} · <DateTimeText at={h.createdAt} /></>], [t('Entregado'), <DateTimeText at={h.deliveredAt} />], [t('Recibido'), h.acknowledgedBy ? <>{userName(db, h.acknowledgedBy)} · <DateTimeText at={h.acknowledgedAt} /></> : '—'], [t('Exportaciones vinculadas'), h.exportIds.length]]} />
        <p className="tiny muted">{t('Se excluyen borradores, gastos no aprobados y cualquier dato de RR. HH., salud o privacidad.')} <DateText date={ctx.today} /></p>
      </div>
    </Card>
  );
}
