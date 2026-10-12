/**
 * Employee detail (/equipo/:id). Only employees visible to the caller in the active company are
 * shown; anything else is "not found" (tenant isolation, AC-PLT-01). Deactivation never deletes
 * records: they are kept for the four-year retention period (ET art. 34.9, TIM-07).
 */
import { FileClock, Pencil, PlusCircle, ShieldAlert, UserCheck, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ANOMALY_LABEL, ANOMALY_STATUS_LABEL, isOpenStatus } from '../../domain/anomalies';
import { index } from '../../domain/indexes';
import { effectiveValues, policyOn, sessionDurations } from '../../domain/records';
import { ABSENCE_STATUS, BREAK_KIND_LABEL, CONTRACT_LABEL, CORRECTION_KIND_LABEL, CORRECTION_STATUS, WORKDAY_LABEL } from '../../domain/status';
import { addDays, formatDate, isValidISODate } from '../../domain/time';
import type { Employee, EmploymentRelationship, WorkSession } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { absenceTypeLabel, visibleAbsences } from '../../services/absenceService';
import { userName, visibleEmployeeIds } from '../../services/context';
import { visibleCorrections } from '../../services/correctionService';
import { visibleAnomalies } from '../../services/opsService';
import { addRelationshipVersion, setEmployeeActive, updateEmployee, validateEmployee, validateRelationship } from '../../services/planningService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { AuditList } from '../../components/AuditList';
import { DurationText, EmployeeLink, msg, RecordStatusBadge, TimeText } from '../../components/bits';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, KV, Modal, PageHeader, Pagination, StatusBadge, Tabs, TextField, useAction, usePaged } from '../../components/ui';
import { fmtNum, GeneralErrors, IdentityFields, identityFromEmployee, mapErrors, minVersionDate, RelationshipFields, relFromRelationship, emptyRel, toEmployeeInput, toRelationshipInput, type FieldErrors, type IdentityState, type RelState } from './employeeForms';
import { currentRelationship, TODAY_STATE, todayState } from './teamData';

type TabId = 'resumen' | 'condiciones' | 'registros' | 'ausencias' | 'correcciones' | 'indicadores' | 'auditoria';
const TAB_IDS: TabId[] = ['resumen', 'condiciones', 'registros', 'ausencias', 'correcciones', 'indicadores', 'auditoria'];

export function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<'edit' | 'deactivate' | 'reactivate' | 'version' | null>(null);

  const emp = ctx.db.employees.find((e) => e.id === id && e.companyId === ctx.company.id);
  const visible = !!emp && visibleEmployeeIds(ctx).has(emp.id);

  const data = useMemo(() => {
    if (!emp || !visible) return null;
    const isOpen = (s: string) => s === 'pending' || s === 'pending_employee';
    return {
      corrections: visibleCorrections(ctx).filter((c) => c.employeeId === emp.id && isOpen(c.status)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
      anomalies: visibleAnomalies(ctx).filter((a) => a.employeeId === emp.id && a.active && isOpenStatus(a.status)).sort((a, b) => b.date.localeCompare(a.date)),
      absences: visibleAbsences(ctx).filter((a) => a.employeeId === emp.id).sort((a, b) => b.startDate.localeCompare(a.startDate)),
      sessions: (index(ctx.db).sessionsByEmployee.get(emp.id) ?? []).filter((s) => s.date >= addDays(ctx.today, -30)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    };
  }, [ctx, emp, visible]);

  if (!emp || !visible || !data) return <RecordNotFound back="/equipo" label={tKey('Equipo')} />;

  const canManage = ctx.can('employees.manage');
  const isSelf = ctx.employee?.id === emp.id;
  const canAudit = ctx.can('audit.view') || isSelf;
  const requested = params.get('pestana') as TabId | null;
  const tab: TabId = requested && TAB_IDS.includes(requested) && (requested !== 'auditoria' || canAudit) ? requested : 'resumen';
  const setTab = (v: TabId) => {
    const next = new URLSearchParams(params);
    if (v === 'resumen') next.delete('pestana');
    else next.set('pestana', v);
    setParams(next, { replace: true });
  };
  const name = `${emp.firstName} ${emp.lastName}`;
  const state = emp.status === 'active' ? todayState(ctx.db, emp.id, ctx.today) : null;

  return (
    <div className="stack team-area">
      <PageHeader
        breadcrumbs={
          <>
            <Link to="/equipo">{t('Equipo')}</Link>
            <span aria-hidden>/</span>
            <span>{emp.code}</span>
          </>
        }
        title={name}
        subtitle={
          <span className="row-wrap">
            <span className="mono">{emp.code}</span>
            <span>{emp.jobTitle || '—'}</span>
            <Badge tone={emp.status === 'active' ? 'success' : 'neutral'}>{emp.status === 'active' ? t('Activo') : t('Inactivo')}</Badge>
            {state && <Badge tone={TODAY_STATE[state].tone} title={t(TODAY_STATE[state].help)}>{t('Hoy: {state}', { state: t(TODAY_STATE[state].label) })}</Badge>}
            {isSelf && <Badge tone="info">{t('Su propia ficha')}</Badge>}
          </span>
        }
        actions={
          canManage ? (
            <>
              <Button icon={Pencil} onClick={() => setDialog('edit')}>
                {t('Editar ficha')}
              </Button>
              {emp.status === 'active' ? (
                <Button variant="danger-outline" icon={UserX} onClick={() => setDialog('deactivate')} disabled={isSelf} title={isSelf ? t('No puede desactivar su propia ficha.') : undefined}>
                  {t('Desactivar ficha')}
                </Button>
              ) : (
                <Button icon={UserCheck} onClick={() => setDialog('reactivate')}>
                  {t('Reactivar')}
                </Button>
              )}
            </>
          ) : null
        }
      />

      {emp.status === 'inactive' ? (
        <Callout tone="warning" title={t('Ficha desactivada con efecto {date}', { date: formatDate(emp.endDate) })}>
          {t('Los registros horarios, correcciones y ausencias de esta persona se conservan durante cuatro años y siguen disponibles para consulta, informes y exportaciones. La desactivación nunca elimina registros.')}
        </Callout>
      ) : (
        <p className="tiny muted">{t('Conservación: desactivar una ficha nunca elimina sus registros; se conservan durante cuatro años (ET art. 34.9).')}</p>
      )}

      <Tabs<TabId>
        label={t('Secciones de la ficha')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'resumen', label: t('Resumen') },
          { id: 'condiciones', label: t('Condiciones laborales') },
          { id: 'registros', label: t('Registros'), count: data.sessions.length },
          { id: 'ausencias', label: t('Ausencias'), count: data.absences.length },
          { id: 'correcciones', label: t('Correcciones pendientes'), count: data.corrections.length },
          { id: 'indicadores', label: t('Indicadores de revisión'), count: data.anomalies.length },
          { id: 'auditoria', label: t('Auditoría'), hidden: !canAudit },
        ]}
      />

      {tab === 'resumen' && <SummaryTab ctx={ctx} emp={emp} />}
      {tab === 'condiciones' && <ConditionsTab ctx={ctx} emp={emp} onNewVersion={canManage && emp.status === 'active' ? () => setDialog('version') : null} />}
      {tab === 'registros' && <RecordsTab ctx={ctx} emp={emp} sessions={data.sessions} />}
      {tab === 'ausencias' && <AbsencesTab ctx={ctx} absences={data.absences} />}
      {tab === 'correcciones' && <CorrectionsTab ctx={ctx} items={data.corrections} />}
      {tab === 'indicadores' && <IndicatorsTab items={data.anomalies} />}
      {tab === 'auditoria' && canAudit && (
        <Card title={t('Historial de auditoría del empleado')}>
          <AuditList filter={(e) => e.employeeId === emp.id} />
        </Card>
      )}

      {dialog === 'edit' && <EditEmployeeModal ctx={ctx} emp={emp} onClose={() => setDialog(null)} />}
      {dialog === 'version' && <NewVersionModal ctx={ctx} emp={emp} onClose={() => setDialog(null)} />}
      {dialog === 'deactivate' && <DeactivateDialog ctx={ctx} emp={emp} onClose={() => setDialog(null)} />}
      {dialog === 'reactivate' && <ReactivateDialog emp={emp} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ─────────────────────────────── Tabs ───────────────────────────────

function SummaryTab({ ctx, emp }: { ctx: UiCtx; emp: Employee }) {
  const dep = ctx.db.departments.find((d) => d.id === emp.departmentId);
  const sites = emp.worksiteIds.map((id) => ctx.db.worksites.find((w) => w.id === id)).filter((w) => !!w);
  const rel = currentRelationship(ctx.db, emp.id, ctx.today);
  return (
    <div className="grid-2">
      <Card title={t('Identificación')}>
        <KV
          items={[
            [t('Código interno'), <span className="mono">{emp.code}</span>],
            [t('Nombre'), emp.firstName],
            [t('Apellidos'), emp.lastName],
            [t('Correo de trabajo'), emp.workEmail],
            [t('Departamento'), dep?.name ?? '—'],
            [t('Puesto'), emp.jobTitle || '—'],
            [t('Responsable directo'), emp.managerEmployeeId ? <EmployeeLink id={emp.managerEmployeeId} /> : t('Sin responsable asignado')],
            [t('Cuenta de usuario vinculada'), emp.userId ? <span>{t('Sí')} · {userName(ctx.db, emp.userId)}</span> : <span>{t('No')} <span className="muted small">{t('(registra a través de RR. HH. o de un terminal)')}</span></span>],
            [t('Estado'), <Badge tone={emp.status === 'active' ? 'success' : 'neutral'}>{emp.status === 'active' ? t('Activo') : t('Inactivo')}</Badge>],
            [t('Fecha de alta'), <DateText date={emp.hireDate} />],
            [t('Fecha de baja'), emp.endDate ? <DateText date={emp.endDate} /> : '—'],
          ]}
        />
      </Card>
      <div className="stack">
        <Card title={t('Centros de trabajo')}>
          {sites.length === 0 ? (
            <EmptyState title={t('Sin centros asignados')} />
          ) : (
            <ul className="team-list">
              {sites.map((w) => (
                <li key={w.id}>
                  <span className="strong">{w.name}</span> {w.id === emp.primaryWorksiteId && <Badge tone="info" icon={false}>{t('Principal')}</Badge>}
                  <div className="tiny muted">
                    {w.kind === 'customer' ? t('Centro de cliente') : t('Centro propio')} · {w.address}, {w.city}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('Condiciones en vigor hoy')}>
          {rel ? (
            <KV
              items={[
                [t('Tipo de contrato'), t(CONTRACT_LABEL[rel.contractType])],
                [t('Jornada'), <span>{t(WORKDAY_LABEL[rel.workdayType])}{rel.partTimePct !== null && ` · ${fmtNum(rel.partTimePct)} %`}</span>],
                [t('Horas semanales'), `${fmtNum(rel.weeklyHours)} h`],
                [t('Vigente desde'), <DateText date={rel.effectiveFrom} />],
              ]}
            />
          ) : (
            <EmptyState title={t('Sin condiciones laborales registradas')} />
          )}
        </Card>
      </div>
    </div>
  );
}

function ConditionsTab({ ctx, emp, onNewVersion }: { ctx: UiCtx; emp: Employee; onNewVersion: (() => void) | null }) {
  const versions = ctx.db.relationships.filter((r) => r.employeeId === emp.id && r.companyId === ctx.company.id).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const today = currentRelationship(ctx.db, emp.id, ctx.today);
  const policy = today ? policyOn(ctx.db, ctx.company.id, today.policyKey, ctx.today) : undefined;
  const agreement = (id: string) => ctx.db.agreements.find((a) => a.id === id)?.name ?? '—';
  const policyName = (key: string) => ctx.db.policies.find((p) => p.key === key && p.companyId === ctx.company.id)?.name ?? key;
  return (
    <div className="stack">
      <Card
        title={t('Versiones de las condiciones laborales')}
        actions={
          onNewVersion ? (
            <Button variant="primary" size="sm" icon={PlusCircle} onClick={onNewVersion}>
              {t('Nueva versión de condiciones')}
            </Button>
          ) : null
        }
        flush
      >
        {versions.length === 0 ? (
          <EmptyState title={t('Sin condiciones laborales registradas')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Versiones de las condiciones laborales')}</caption>
              <thead>
                <tr>
                  <th>{t('Vigencia')}</th>
                  <th>{t('Contrato')}</th>
                  <th>{t('Jornada')}</th>
                  <th className="num">{t('Horas/semana')}</th>
                  <th>{t('Convenio de referencia')}</th>
                  <th>{t('Política de jornada')}</th>
                  <th>{t('Reducción de jornada')}</th>
                  <th>{t('Teletrabajo')}</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((r) => (
                  <tr key={r.id} className={today?.id === r.id ? 'team-current' : undefined}>
                    <td>
                      <span className="nowrap">
                        <DateText date={r.effectiveFrom} /> → {r.effectiveTo ? <DateText date={r.effectiveTo} /> : t('sin fin')}
                      </span>
                      {today?.id === r.id && (
                        <div>
                          <Badge tone="success">{t('En vigor hoy')}</Badge>
                        </div>
                      )}
                      {r.effectiveFrom > ctx.today && (
                        <div>
                          <Badge tone="info">{t('Programada')}</Badge>
                        </div>
                      )}
                      {r.note && <div className="sub">{r.note}</div>}
                    </td>
                    <td>{t(CONTRACT_LABEL[r.contractType])}</td>
                    <td>
                      {t(WORKDAY_LABEL[r.workdayType])}
                      {r.partTimePct !== null && <div className="sub">{fmtNum(r.partTimePct)} %</div>}
                    </td>
                    <td className="num">{fmtNum(r.weeklyHours)} h</td>
                    <td>{agreement(r.agreementId)}</td>
                    <td>
                      {policyName(r.policyKey)}
                      <div className="sub mono">{r.policyKey}</div>
                    </td>
                    <td>
                      {r.reducedHours ? (
                        <>
                          {fmtNum(r.reducedHours.pct)} %<div className="sub">{r.reducedHours.basis}</div>
                        </>
                      ) : (
                        <span className="muted">{t('No')}</span>
                      )}
                    </td>
                    <td>{r.remoteAllowed ? t('Permitido') : t('No')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer tiny muted">
          {t('Cada cambio crea una versión con fecha de efecto. Los registros ya realizados se siguen calculando con las condiciones y la política vigentes en su fecha.')}
        </div>
      </Card>

      <Card title={t('Política de jornada aplicable hoy')}>
        {policy ? (
          <div className="stack-sm">
            <KV
              items={[
                [t('Política'), <span>{policy.name} · {t('versión {v}', { v: policy.version })}</span>],
                [t('Vigente desde'), <DateText date={policy.effectiveFrom} />],
                [t('Base'), policy.basis],
                [t('Pausas retribuidas'), policy.breaks.paidBreakKinds.length ? policy.breaks.paidBreakKinds.map((k) => t(BREAK_KIND_LABEL[k])).join(', ') : t('Ninguna: las pausas registradas no computan como trabajo')],
                [t('Aprobada por'), policy.approvedBy ?? <span className="muted">{t('Pendiente de validación por la asesoría')}</span>],
              ]}
            />
            <p className="tiny muted">{t('Los umbrales de la política solo generan indicadores de revisión: no bloquean registros ni limitan horas.')}</p>
          </div>
        ) : (
          <EmptyState title={t('No hay ninguna versión de la política en vigor hoy')}>{t('Revise la configuración de políticas en Turnos y horarios.')}</EmptyState>
        )}
      </Card>
    </div>
  );
}

function RecordsTab({ ctx, emp, sessions }: { ctx: UiCtx; emp: Employee; sessions: WorkSession[] }) {
  const paged = usePaged(sessions, 10);
  const site = (id: string) => ctx.db.worksites.find((w) => w.id === id)?.name ?? '—';
  return (
    <Card
      title={t('Registros de los últimos 30 días')}
      actions={
        <Link to={`/registros?empleado=${emp.id}`} className="btn sm">
          <FileClock size={14} aria-hidden /> {t('Ver en Registros horarios')}
        </Link>
      }
      flush
    >
      {sessions.length === 0 ? (
        <EmptyState icon={FileClock} title={t('Sin registros en los últimos 30 días')}>
          {t('Los turnos planificados y las ausencias no aparecen aquí: solo el tiempo efectivamente registrado.')}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Registros de los últimos 30 días')}</caption>
              <thead>
                <tr>
                  <th>{t('Fecha')}</th>
                  <th>{t('Centro')}</th>
                  <th>{t('Entrada')}</th>
                  <th>{t('Salida')}</th>
                  <th className="num">{t('Neto')}</th>
                  <th>{t('Estado')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((s) => {
                  const d = sessionDurations(ctx.db, s);
                  const v = effectiveValues(ctx.db, s);
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link to={`/registros/${s.id}`} className="nowrap">
                          <DateText date={s.date} />
                        </Link>
                      </td>
                      <td>{site(s.worksiteId)}</td>
                      <td>
                        <TimeText at={v.start} tz={s.timezone} baseDate={s.date} />
                      </td>
                      <td>
                        <TimeText at={v.end} tz={s.timezone} baseDate={s.date} />
                      </td>
                      <td className="num">
                        <DurationText minutes={d.netMinutes} provisional={d.provisional} />
                      </td>
                      <td>
                        <RecordStatusBadge db={ctx.db} session={s} />
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
  );
}

function AbsencesTab({ ctx, absences }: { ctx: UiCtx; absences: ReturnType<typeof visibleAbsences> }) {
  const paged = usePaged(absences, 10);
  const masked = absences.some((a) => absenceTypeLabel(ctx, a) === 'Ausencia justificada (categoría reservada)');
  return (
    <Card title={t('Ausencias')} flush>
      {absences.length === 0 ? (
        <EmptyState title={t('Sin ausencias visibles')}>{t('Solo se muestran las ausencias que su rol permite consultar.')}</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Ausencias')}</caption>
              <thead>
                <tr>
                  <th>{t('Tipo')}</th>
                  <th>{t('Desde')}</th>
                  <th>{t('Hasta')}</th>
                  <th>{t('Horario')}</th>
                  <th>{t('Estado')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/ausencias/${a.id}`}>{t(absenceTypeLabel(ctx, a))}</Link>
                    </td>
                    <td>
                      <DateText date={a.startDate} />
                    </td>
                    <td>
                      <DateText date={a.endDate} />
                    </td>
                    <td>{a.partial ? `${a.partial.startTime}–${a.partial.endTime}` : t('Día completo')}</td>
                    <td>
                      <StatusBadge meta={ABSENCE_STATUS[a.status]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paged.props} />
        </>
      )}
      <div className="card-footer tiny muted stack-sm">
        {masked && <span>{t('Algunas categorías se muestran como «categoría reservada»: su rol no permite ver el motivo de ausencias sensibles.')}</span>}
        <span>{t('Una ausencia aprobada no crea registros de asistencia.')}</span>
      </div>
    </Card>
  );
}

function CorrectionsTab({ ctx, items }: { ctx: UiCtx; items: ReturnType<typeof visibleCorrections> }) {
  return (
    <Card title={t('Correcciones pendientes')} flush>
      {items.length === 0 ? (
        <EmptyState title={t('No hay correcciones pendientes')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{t('Correcciones pendientes')}</caption>
            <thead>
              <tr>
                <th>{t('Jornada')}</th>
                <th>{t('Motivo')}</th>
                <th>{t('Iniciada por')}</th>
                <th>{t('Solicitada')}</th>
                <th>{t('Estado')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/correcciones/${c.id}`}>
                      <DateText date={c.date} />
                    </Link>
                  </td>
                  <td>{t(CORRECTION_KIND_LABEL[c.kind])}</td>
                  <td>{c.initiatedBy === 'company' ? t('La empresa (propuesta)') : t('El empleado')}</td>
                  <td>
                    <DateTimeText at={c.requestedAt} tz={ctx.company.timezone} />
                  </td>
                  <td>
                    <StatusBadge meta={CORRECTION_STATUS[c.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card-footer tiny muted">{t('El registro original nunca se modifica: una corrección aprobada añade una capa revisada.')}</div>
    </Card>
  );
}

function IndicatorsTab({ items }: { items: ReturnType<typeof visibleAnomalies> }) {
  return (
    <Card title={t('Indicadores de revisión abiertos')} flush>
      <div className="card-body">
        <Callout tone="neutral">{t('Son indicadores configurables que piden una revisión. No son conclusiones sobre la conducta de la persona ni sustituyen la valoración de RR. HH. o de la asesoría.')}</Callout>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={ShieldAlert} title={t('No hay indicadores abiertos en su ámbito')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{t('Indicadores de revisión abiertos')}</caption>
            <thead>
              <tr>
                <th>{t('Fecha')}</th>
                <th>{t('Indicador')}</th>
                <th>{t('Detalle')}</th>
                <th>{t('Estado de la revisión')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.key}>
                  <td>
                    <Link to={`/incidencias?clave=${encodeURIComponent(a.key)}`}>
                      <DateText date={a.date} />
                    </Link>
                  </td>
                  <td>{t(ANOMALY_LABEL[a.type])}</td>
                  <td className="small">{msg(a.reason)}</td>
                  <td>
                    <Badge tone="neutral">{t(ANOMALY_STATUS_LABEL[a.status])}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────── Dialogs ───────────────────────────────

function EditEmployeeModal({ ctx, emp, onClose }: { ctx: UiCtx; emp: Employee; onClose: () => void }) {
  const { run, pending } = useAction();
  const [value, setValue] = useState<IdentityState>(() => identityFromEmployee(emp));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string[]>([]);
  const submit = async () => {
    const input = toEmployeeInput(value);
    const mapped = mapErrors(validateEmployee(ctx, input, emp.id));
    setErrors(mapped.fields);
    setGeneral(mapped.general);
    if (Object.keys(mapped.fields).length || mapped.general.length) return;
    const ok = await run(() => updateEmployee(emp.id, input), t('Ficha actualizada'));
    if (ok) onClose();
  };
  return (
    <Modal
      wide
      title={t('Editar ficha de {name}', { name: `${emp.firstName} ${emp.lastName}` })}
      description={t('Los cambios quedan en la auditoría con el valor anterior y el nuevo. Para cambiar horas, contrato o política, cree una nueva versión de condiciones.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Guardar cambios')}
          </Button>
        </>
      }
    >
      <GeneralErrors items={general} />
      <IdentityFields ctx={ctx} value={value} onChange={setValue} errors={errors} selfId={emp.id} />
    </Modal>
  );
}

function NewVersionModal({ ctx, emp, onClose }: { ctx: UiCtx; emp: Employee; onClose: () => void }) {
  const { run, pending } = useAction();
  const versions = ctx.db.relationships.filter((r) => r.employeeId === emp.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const latest: EmploymentRelationship | undefined = versions[0];
  const min = minVersionDate(ctx.today, latest?.effectiveFrom);
  const [value, setValue] = useState<RelState>(() => (latest ? relFromRelationship(latest, min) : { ...emptyRel(ctx), effectiveFrom: min }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string[]>([]);
  const submit = async () => {
    const input = toRelationshipInput(value);
    const fields: FieldErrors = {};
    const mapped = mapErrors(validateRelationship(ctx, input));
    Object.assign(fields, mapped.fields);
    if (isValidISODate(input.effectiveFrom) && input.effectiveFrom < ctx.today) fields.effectiveFrom ??= t('No se puede dar efecto retroactivo: los registros ya realizados mantienen las condiciones vigentes en su fecha.');
    else if (latest && isValidISODate(input.effectiveFrom) && input.effectiveFrom <= latest.effectiveFrom) fields.effectiveFrom ??= t('La nueva versión debe empezar después del {date}.', { date: formatDate(latest.effectiveFrom) });
    if (input.note.length < 5) fields.note = t('Explique el motivo del cambio (mínimo 5 caracteres).');
    setErrors(fields);
    setGeneral(mapped.general);
    if (Object.keys(fields).length || mapped.general.length) return;
    const ok = await run(() => addRelationshipVersion(emp.id, input), (r) => t('Nuevas condiciones registradas con efecto {date}', { date: formatDate(r.effectiveFrom) }));
    if (ok) onClose();
  };
  return (
    <Modal
      wide
      title={t('Nueva versión de condiciones')}
      description={`${emp.firstName} ${emp.lastName} · ${emp.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Registrar nueva versión')}
          </Button>
        </>
      }
    >
      <Callout tone="info" title={t('Sin efecto retroactivo')}>
        {t('La versión actual termina el día anterior a la fecha de efecto. Los registros anteriores conservan las condiciones y la política vigentes en su fecha; solo los registros desde la fecha de efecto usan las nuevas.')}
      </Callout>
      <GeneralErrors items={general} />
      <RelationshipFields ctx={ctx} value={value} onChange={setValue} errors={errors} showEffectiveFrom minEffectiveFrom={min} requireNote />
    </Modal>
  );
}

function DeactivateDialog({ ctx, emp, onClose }: { ctx: UiCtx; emp: Employee; onClose: () => void }) {
  const { runOk } = useAction();
  const [date, setDate] = useState(ctx.today);
  const [dateError, setDateError] = useState<string | undefined>();
  const futureShifts = isValidISODate(date) ? ctx.db.shifts.filter((s) => s.employeeId === emp.id && s.status === 'planned' && s.date > date).length : 0;
  const isSelf = ctx.employee?.id === emp.id;
  return (
    <ConfirmDialog
      title={t('Desactivar la ficha de {name}', { name: `${emp.firstName} ${emp.lastName}` })}
      confirmLabel={t('Desactivar ficha')}
      danger
      requireReason
      reasonLabel={t('Motivo de la baja (queda en la auditoría)')}
      onClose={onClose}
      onConfirm={async (reason) => {
        if (!isValidISODate(date)) {
          setDateError(t('Indique la fecha de baja.'));
          return false;
        }
        setDateError(undefined);
        return runOk(() => setEmployeeActive(emp.id, false, date, reason), t('Ficha desactivada. Los registros se conservan.'));
      }}
      message={
        <div className="stack-sm">
          {isSelf && <Callout tone="danger">{t('No puede desactivar su propia ficha.')}</Callout>}
          <Callout tone="warning" title={t('Qué ocurre al desactivar')}>
            <ul>
              <li>{t('La persona deja de poder registrar jornada a partir de la fecha de baja.')}</li>
              <li>{t('Sus registros horarios, correcciones y ausencias no se eliminan: se conservan durante cuatro años.')}</li>
              <li>{t('Se cancelan los turnos planificados posteriores a la fecha de baja: {n}.', { n: futureShifts })}</li>
              <li>{t('Las condiciones laborales vigentes terminan en la fecha de baja.')}</li>
            </ul>
          </Callout>
        </div>
      }
    >
      <TextField label={t('Fecha de baja')} required type="date" value={date} onChange={(e) => setDate(e.target.value)} error={dateError} />
    </ConfirmDialog>
  );
}

function ReactivateDialog({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const { runOk } = useAction();
  return (
    <ConfirmDialog
      title={t('Reactivar la ficha de {name}', { name: `${emp.firstName} ${emp.lastName}` })}
      confirmLabel={t('Reactivar')}
      requireReason
      onClose={onClose}
      onConfirm={(reason) => runOk(() => setEmployeeActive(emp.id, true, '', reason), t('Ficha reactivada'))}
      message={
        <p>
          {t('La persona podrá volver a registrar jornada. Las condiciones laborales más recientes vuelven a quedar abiertas; revíselas después de reactivar. Los turnos cancelados no se restauran.')}
        </p>
      }
    />
  );
}
