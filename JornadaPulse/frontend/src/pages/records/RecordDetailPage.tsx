/**
 * Detalle de registro (TIM-02, TIM-04, TIM-07): effective vs original values, every correction
 * layered on top, the immutable raw events with receipts and idempotency keys, durations with
 * the policy version in force on the work date, retention control (AC-TIM-04) and audit trail.
 */
import { Archive, FileClock, ListChecks, PencilLine, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { DurationText, EmployeeLink, IndicatorBadges, RecordStatusBadge, TimeText, ValuesView } from '../../components/bits';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, ConfirmDialog, DateTimeText, EmptyState, KV, PageHeader, StatusBadge, useAction } from '../../components/ui';
import { index } from '../../domain/indexes';
import { NotFoundError } from '../../domain/permissions';
import { appliedCorrections, APPLIED_CORRECTION, effectiveValues, originalValues, policyForSession, sessionDurations, sessionIndicators } from '../../domain/records';
import { BREAK_KIND_LABEL, CORRECTION_KIND_LABEL, CORRECTION_STATUS, EVENT_TYPE_LABEL, MODE_LABEL, SOURCE_LABEL } from '../../domain/status';
import { formatDate, formatDateLong, formatOffset } from '../../domain/time';
import type { ID, RetentionDecision, WorkSession } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { userName, visibleEmployeeIds } from '../../services/context';
import { getSession, requestRecordDeletion, retentionUntil } from '../../services/timeService';
import { useCtx } from '../../store/hooks';

export function RecordDetailPage() {
  const ctx = useCtx();
  const { id = '' } = useParams();
  let session: WorkSession | null = null;
  try {
    session = getSession(ctx, id);
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  // Out-of-scope records are reported exactly like unknown ids (no existence leak).
  if (!session || !visibleEmployeeIds(ctx).has(session.employeeId)) return <RecordNotFound back="/registros" label={tKey('Registros horarios')} />;
  return <RecordDetail key={session.id} s={session} />;
}

function RecordDetail({ s }: { s: WorkSession }) {
  const ctx = useCtx();
  const db = ctx.db;
  const { run } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [decision, setDecision] = useState<RetentionDecision | null>(null);

  const emp = db.employees.find((e) => e.id === s.employeeId);
  const name = emp ? `${emp.firstName} ${emp.lastName}` : '—';
  const worksiteName = (wid: ID | null) => db.worksites.find((w) => w.id === wid)?.name ?? '—';
  const tz = s.timezone;
  const effective = effectiveValues(db, s);
  const original = originalValues(db, s);
  const applied = appliedCorrections(db, s);
  const corrected = applied.length > 0;
  const corrections = db.corrections.filter((c) => c.companyId === ctx.company.id && c.sessionId === s.id).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const pendingCorr = corrections.find((c) => c.status === 'pending' || c.status === 'pending_employee');
  const events = (index(db).eventsBySession.get(s.id) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at) || a.receivedAt.localeCompare(b.receivedAt));
  const durations = sessionDurations(db, s);
  const policy = policyForSession(db, s);
  const indicators = sessionIndicators(db, s);
  const until = retentionUntil(s.date);
  const decisions = db.retentionDecisions.filter((d) => d.companyId === ctx.company.id && d.entityId === s.id).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const isMine = !!ctx.employee && ctx.employee.id === s.employeeId;
  const offStart = effective.start ? formatOffset(effective.start, tz) : null;
  const offEnd = effective.end ? formatOffset(effective.end, tz) : null;

  const auditIds = new Set<string>([s.id, ...events.map((e) => e.id), ...corrections.map((c) => c.id), ...corrections.map((c) => c.failedAttemptId).filter((x): x is string => !!x)]);

  const doDelete = async (reason: string) => {
    const r = await run(
      () => requestRecordDeletion(s.id, reason),
      (d) => (d.outcome === 'blocked' ? t('Solicitud registrada: eliminación bloqueada hasta el {date}', { date: formatDate(d.retentionUntil) }) : t('Solicitud registrada: requiere revisión; el prototipo no elimina registros')),
    );
    if (r) setDecision(r);
    return !!r;
  };

  return (
    <>
      <PageHeader
        breadcrumbs={
          <>
            <Link to="/registros">{t('Registros horarios')}</Link> <span aria-hidden>/</span> <span>{formatDate(s.date)}</span>
          </>
        }
        title={t('Registro de {name} · {date}', { name, date: formatDate(s.date) })}
        subtitle={`${formatDateLong(s.date)} · ${worksiteName(effective.worksiteId)} · ${t(MODE_LABEL[effective.mode])}`}
        actions={
          <>
            {isMine && ctx.can('corrections.request_own') &&
              (pendingCorr ? (
                <Button icon={PencilLine} disabled title={t('Ya hay una corrección pendiente para este registro')}>
                  {t('Solicitar corrección')}
                </Button>
              ) : (
                <Link to={`/correcciones?nueva=1&sesion=${s.id}`} className="btn primary">
                  <PencilLine size={15} aria-hidden /> {t('Solicitar corrección')}
                </Link>
              ))}
            {!isMine && ctx.can('corrections.propose') &&
              (pendingCorr ? (
                <Button icon={PencilLine} disabled title={t('Ya hay una corrección pendiente para este registro')}>
                  {t('Proponer corrección')}
                </Button>
              ) : (
                <Link to={`/correcciones?nueva=1&sesion=${s.id}&empleado=${s.employeeId}`} className="btn">
                  <PencilLine size={15} aria-hidden /> {t('Proponer corrección')}
                </Link>
              ))}
            {ctx.can('records.delete_request') && (
              <Button variant="danger-outline" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                {t('Solicitar eliminación')}
              </Button>
            )}
          </>
        }
      />

      <div className="stack-lg">
        {pendingCorr && (
          <Callout tone="warning" title={t('Corrección pendiente')}>
            {t('Hay una solicitud de corrección en revisión ({kind}). Se muestran los valores vigentes hasta la decisión.', { kind: t(CORRECTION_KIND_LABEL[pendingCorr.kind]) })}{' '}
            <Link to={`/correcciones/${pendingCorr.id}`}>{t('Ver la solicitud')}</Link>
            {(isMine || ctx.can('corrections.propose')) && <div className="tiny muted">{t('Solo puede haber una solicitud activa por registro.')}</div>}
          </Callout>
        )}
        {decision && (
          <Callout tone={decision.outcome === 'blocked' ? 'warning' : 'info'} icon={Archive} title={decision.outcome === 'blocked' ? t('Eliminación bloqueada') : t('Plazo de conservación cumplido')}>
            {decision.outcome === 'blocked'
              ? t('El registro debe conservarse hasta el {date} (ET art. 34.9, cuatro años). No se ha eliminado nada; la solicitud y la decisión constan en la auditoría.', { date: formatDate(decision.retentionUntil) })
              : t('La eliminación requiere revisión y no se ejecuta en el prototipo. La solicitud consta en la auditoría.')}
          </Callout>
        )}

        <div className="grid-main-side">
          <div className="stack">
            <Card className="record-data" title={t('Datos del registro')} actions={<RecordStatusBadge db={db} session={s} />}>
              <KV
                items={[
                  [t('Empleado'), <span key="e"><EmployeeLink id={s.employeeId} /> <span className="muted small">{emp?.code}</span></span>],
                  [t('Fecha de la jornada'), formatDateLong(s.date)],
                  [t('Centro de trabajo'), worksiteName(effective.worksiteId)],
                  [t('Modalidad'), t(MODE_LABEL[effective.mode])],
                  [
                    t('Zona horaria'),
                    <span key="tz">
                      {tz} · {offStart ?? '—'}
                      {offEnd && offEnd !== offStart && <> → {offEnd} <Badge tone="info">{t('Cambio de hora durante la sesión')}</Badge></>}
                    </span>,
                  ],
                  [t('Origen'), s.origin === 'correction' ? t('Creado por una corrección aprobada') : t('Fichaje')],
                  [t('Indicadores de revisión (configurables)'), indicators.length ? <IndicatorBadges key="i" items={indicators} /> : <span key="i" className="muted">{t('Ninguno')}</span>],
                  [t('Última actualización'), <DateTimeText key="u" at={s.updatedAt} tz={tz} />],
                ]}
              />
            </Card>

            <Card title={corrected ? t('Valores vigentes y originales') : t('Valores registrados')}>
              {corrected ? (
                <div className="grid-2">
                  <div className="record-values effective">
                    <div className="record-values-label">{t('Vigentes (con la corrección aprobada)')}</div>
                    <ValuesView values={effective} tz={tz} worksiteName={worksiteName} />
                  </div>
                  <div className="record-values original">
                    <div className="record-values-label">{t('Originales (evidencia, nunca se modifican)')}</div>
                    <ValuesView values={original} tz={tz} worksiteName={worksiteName} />
                  </div>
                </div>
              ) : (
                <ValuesView values={original} tz={tz} worksiteName={worksiteName} />
              )}
            </Card>

            <Card title={t('Correcciones')} flush>
              {corrections.length === 0 ? (
                <EmptyState icon={ListChecks} title={t('Sin correcciones')}>
                  {t('Este registro conserva los valores originales de los fichajes.')}
                </EmptyState>
              ) : (
                <ol className="record-corrections">
                  {corrections.map((c) => (
                    <li key={c.id} className="stack-sm">
                      <div className="row between" style={{ flexWrap: 'wrap' }}>
                        <span className="strong">
                          {t(CORRECTION_KIND_LABEL[c.kind])}
                          {APPLIED_CORRECTION.includes(c.status) && <> <Badge tone="success">{t('Aplicada')}</Badge></>}
                        </span>
                        <StatusBadge meta={CORRECTION_STATUS[c.status]} />
                      </div>
                      <div className="tiny muted">
                        {c.initiatedBy === 'company' ? t('Propuesta por la empresa') : t('Solicitada')} · {userName(db, c.requestedBy)} · <DateTimeText at={c.requestedAt} tz={tz} />
                      </div>
                      <div className="small">«{c.explanation}»</div>
                      <div className="grid-2">
                        <div>
                          <div className="record-values-label">{t('Solicitado')}</div>
                          <ValuesView values={c.requested} tz={tz} worksiteName={worksiteName} />
                        </div>
                        <div>
                          <div className="record-values-label">{t('Aprobado')}</div>
                          {c.approved ? <ValuesView values={c.approved} tz={tz} worksiteName={worksiteName} /> : <span className="small muted">{t('Sin valores aprobados')}</span>}
                        </div>
                      </div>
                      {c.decidedAt && (
                        <div className="small">
                          {t('Decisión')}: {userName(db, c.reviewerId)} · <DateTimeText at={c.decidedAt} tz={tz} />
                          {c.decisionReason && <div className="muted">{t('Motivo')}: {c.decisionReason}</div>}
                        </div>
                      )}
                      {c.employeeResponse && (
                        <div className="small">
                          {c.employeeResponse.agreed ? t('El empleado dio su conformidad') : t('El empleado manifestó su discrepancia')} · <DateTimeText at={c.employeeResponse.at} tz={tz} />
                          {c.employeeResponse.comment && <div className="muted">«{c.employeeResponse.comment}»</div>}
                        </div>
                      )}
                      <Link to={`/correcciones/${c.id}`} className="small">{t('Abrir la corrección')}</Link>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title={t('Eventos originales (inmutables)')} flush>
              {events.length === 0 ? (
                <EmptyState title={t('Sin eventos')} />
              ) : (
                <div className="table-wrap">
                  <table className="table record-events">
                    <thead>
                      <tr>
                        <th>{t('Tipo')}</th>
                        <th>{t('Hora local')}</th>
                        <th>{t('Instante UTC')}</th>
                        <th>{t('Recibido')}</th>
                        <th>{t('Origen')}</th>
                        <th>{t('Centro')}</th>
                        <th>{t('Recibo')}</th>
                        <th>{t('Clave de idempotencia')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <span className="strong">{t(EVENT_TYPE_LABEL[e.type])}</span>
                            {e.breakKind && <div className="sub">{t(BREAK_KIND_LABEL[e.breakKind])}</div>}
                          </td>
                          <td>
                            <TimeText at={e.at} tz={e.timezone} baseDate={s.date} />
                            <div className="sub">{formatOffset(e.at, e.timezone)}</div>
                          </td>
                          <td className="mono tiny">{e.at}</td>
                          <td className="tiny"><DateTimeText at={e.receivedAt} tz={e.timezone} /></td>
                          <td>
                            {t(SOURCE_LABEL[e.source])}
                            {e.source === 'correction' && <div><Badge tone="warning">{t('Creado por corrección')}</Badge></div>}
                          </td>
                          <td>{worksiteName(e.worksiteId)}</td>
                          <td className="mono">{e.receipt}</td>
                          <td className="mono tiny record-key">{e.idempotencyKey}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="card-footer tiny muted">{t('Los eventos originales nunca se editan ni se eliminan. Una corrección aprobada añade una capa revisada encima; los eventos de un día no registrado se crean con origen «corrección».')}</div>
            </Card>
          </div>

          <div className="stack">
            <Card title={t('Duración')}>
              <dl className="kv">
                <dt>{t('Tiempo bruto')}</dt>
                <dd><DurationText minutes={durations.grossMinutes} provisional={durations.provisional} /></dd>
                <dt>{t('Pausas registradas')}</dt>
                <dd><DurationText minutes={durations.breakMinutes} provisional={durations.provisional} /></dd>
                <dt>{t('Pausas no retribuidas')}</dt>
                <dd><DurationText minutes={durations.unpaidBreakMinutes} provisional={durations.provisional} /></dd>
                <dt>{policy ? t('Neto según política v{v}', { v: policy.version }) : t('Neto')}</dt>
                <dd className="strong"><DurationText minutes={durations.netMinutes} provisional={durations.provisional} /></dd>
              </dl>
              <div className="tiny muted stack-sm" style={{ marginTop: 10 }}>
                {policy ? (
                  <span>
                    {t('Política aplicada: {name} v{v} (vigente desde el {from}).', { name: policy.name, v: policy.version, from: formatDate(policy.effectiveFrom) })}{' '}
                    {policy.breaks.paidBreakKinds.length
                      ? t('Pausas retribuidas: {kinds}.', { kinds: policy.breaks.paidBreakKinds.map((k) => t(BREAK_KIND_LABEL[k])).join(', ') })
                      : t('Ninguna pausa es retribuida según la política')}
                  </span>
                ) : (
                  <span>{t('No hay política vigente en la fecha de la jornada: no se descuenta ninguna pausa.')}</span>
                )}
                <span>{t('Duración real entre instantes (correcta aunque haya cambio de hora). Sin deducción automática de comida ni límite de horas.')}</span>
                {durations.provisional && <span>{t('Provisional: la sesión sigue abierta.')}</span>}
              </div>
            </Card>

            <Card title={t('Conservación')} actions={<FileClock size={16} aria-hidden />}>
              <div className="stack-sm">
                <div className="strong">{t('Conservación hasta {date} (ET art. 34.9, cuatro años)', { date: formatDate(until) })}</div>
                <div className="small muted">
                  {until >= ctx.today ? t('Dentro del plazo de conservación: el registro no se puede eliminar.') : t('Plazo de conservación cumplido: cualquier eliminación requiere revisión.')}
                </div>
                {decisions.length > 0 && (
                  <ul className="myday-list">
                    {decisions.map((d) => (
                      <li key={d.id} className="small">
                        <Badge tone={d.outcome === 'blocked' ? 'warning' : 'info'}>{d.outcome === 'blocked' ? t('Eliminación bloqueada') : t('Requiere revisión')}</Badge> · {userName(db, d.requestedBy)} · <DateTimeText at={d.requestedAt} tz={tz} />
                        <div className="tiny muted">{t('Motivo')}: {d.reason}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card title={t('Historial de auditoría')}>
              <AuditList filter={(e) => auditIds.has(e.entityId)} />
            </Card>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('Solicitar eliminación del registro')}
          message={
            <div className="stack-sm">
              <span>{t('Los registros de jornada se conservan cuatro años (ET art. 34.9). Si el registro está dentro del plazo, la eliminación se bloqueará y la decisión quedará en la auditoría.')}</span>
              <span className="small muted">{t('Conservación hasta {date} (ET art. 34.9, cuatro años)', { date: formatDate(until) })}</span>
            </div>
          }
          confirmLabel={t('Enviar solicitud')}
          danger
          requireReason
          reasonLabel={t('Motivo de la solicitud (queda registrado en la auditoría)')}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
