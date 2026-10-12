/**
 * Coordinación CAE: list of coordination cases with their open points (not sent, no receipt,
 * no recipient acknowledgement, received information to review, overdue follow-up).
 * A CAE case is a coordination record, not a folder of certificates.
 */
import { Handshake, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KindDate, WorksiteLink } from '../../components/bits';
import { Button, Callout, Card, EmptyState, PageHeader, Pagination, SelectField, SortHeader, TextField, sortRows, usePaged, useSort } from '../../components/ui';
import type { CaeCase } from '../../domain/types';
import { t } from '../../i18n';
import { casePending, visibleCases } from '../../services/caeService';
import { userName } from '../../services/context';
import { useCtx } from '../../store/hooks';
import { CaseFormModal } from './CaseFormModal';
import { CASE_STATUS, CaseStatusBadge, customerName, PendingBadges, pendingTotal } from './worksiteShared';

type StatusFilter = '' | CaeCase['status'] | 'not_closed';
type PointFilter = '' | 'any' | 'notSent' | 'noReceipt' | 'noAck' | 'toReview' | 'followUp';

export function CaePage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canManage = ctx.can('cae.manage');
  const readOnly = !canManage;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('not_closed');
  const [site, setSite] = useState('');
  const [point, setPoint] = useState<PointFilter>('');
  const [creating, setCreating] = useState(false);
  const { sort, onSort } = useSort('followUp', 'asc');

  const initialWs = params.get('centro') ?? undefined;
  useEffect(() => {
    if (params.get('nuevo') === '1' && canManage) setCreating(true);
  }, [params, canManage]);
  const closeCreate = () => {
    setCreating(false);
    if (params.get('nuevo')) setParams((p) => { p.delete('nuevo'); p.delete('centro'); return p; }, { replace: true });
  };

  const rows = useMemo(
    () =>
      visibleCases(ctx).map((c) => {
        const ws = ctx.db.worksites.find((w) => w.id === c.worksiteId);
        const p = casePending(ctx, c);
        return { c, ws, customer: ws?.kind === 'customer' ? customerName(ctx, ws.customerId) : '', p, total: c.status === 'closed' ? 0 : pendingTotal(p) };
      }),
    [ctx],
  );

  const sites = ctx.db.worksites.filter((w) => rows.some((r) => r.c.worksiteId === w.id));

  const filtered = rows.filter(({ c, ws, customer, p }) => {
    if (status === 'not_closed' && c.status === 'closed') return false;
    if (status && status !== 'not_closed' && c.status !== status) return false;
    if (site && c.worksiteId !== site) return false;
    if (point === 'any' && !pendingTotal(p)) return false;
    if (point === 'followUp' && !p.followUpOverdue) return false;
    if (point && point !== 'any' && point !== 'followUp' && !p[point]) return false;
    const needle = q.trim().toLowerCase();
    if (needle && ![c.code, c.title, ws?.name ?? '', customer, ...c.participants.map((x) => x.organisation)].some((s) => s.toLowerCase().includes(needle))) return false;
    return true;
  });

  const sorted = sortRows(filtered, sort, (r, col) => {
    switch (col) {
      case 'code':
        return r.c.code;
      case 'worksite':
        return r.ws?.name ?? null;
      case 'status':
        return r.c.status;
      case 'points':
        return r.total;
      case 'followUp':
        return r.c.status === 'closed' ? null : r.c.nextFollowUp;
      default:
        return r.c.code;
    }
  });
  const paged = usePaged(sorted, 25);

  const open = rows.filter((r) => r.c.status !== 'closed');
  const kpis = [
    { key: 'open', label: t('Casos abiertos'), value: open.length, meta: t('{n} cerrados', { n: rows.length - open.length }), apply: () => { setStatus('not_closed'); setPoint(''); } },
    { key: 'receipt', label: t('Envíos sin confirmación de recepción'), value: open.reduce((s, r) => s + r.p.noReceipt + r.p.notSent, 0), meta: t('Enviar no implica que se haya recibido'), tone: 'warning', apply: () => setPoint('noReceipt') },
    { key: 'ack', label: t('Recibidos sin acuse del destinatario'), value: open.reduce((s, r) => s + r.p.noAck, 0), meta: t('Recibir no implica haber entendido'), tone: 'warning', apply: () => setPoint('noAck') },
    { key: 'review', label: t('Información recibida por revisar'), value: open.reduce((s, r) => s + r.p.toReview, 0), meta: t('Pendiente de revisión del contenido'), tone: 'warning', apply: () => setPoint('toReview') },
    { key: 'followUp', label: t('Seguimientos vencidos'), value: open.filter((r) => r.p.followUpOverdue).length, meta: t('Fecha interna de seguimiento superada'), tone: 'danger', apply: () => setPoint('followUp') },
  ];

  const filtersOn = !!(q || status !== 'not_closed' || site || point);

  return (
    <div className="stack-lg">
      <PageHeader
        title={t('Coordinación CAE')}
        subtitle={t('Coordinación de actividades empresariales en centros compartidos (RD 171/2004): quién informa de qué, a quién, y qué falta. No es un archivo de certificados.')}
        actions={
          canManage && (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              {t('Nuevo caso')}
            </Button>
          )
        }
      />

      {readOnly && (
        <Callout tone="info" title={t('Consulta en modo lectura')}>
          {t('Su rol permite consultar los casos de coordinación, sin registrar intercambios ni modificar casos.')}
        </Callout>
      )}

      <div className="kpis">
        {kpis.map((k) => (
          <button key={k.key} type="button" className={`kpi ${k.tone && k.value ? `tone-${k.tone}` : ''}`} onClick={k.apply}>
            <span className="label">{k.label}</span>
            <span className="value">{k.value}</span>
            <span className="meta">{k.meta}</span>
          </button>
        ))}
      </div>

      <Card flush>
        <div className="toolbar">
          <TextField className="search" type="search" label={t('Buscar')} placeholder={t('Código, centro, cliente o empresa')} value={q} onChange={(e) => { setQ(e.target.value); paged.reset(); }} />
          <SelectField label={t('Estado')} value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); paged.reset(); }}>
            <option value="not_closed">{t('Abiertos y en curso')}</option>
            <option value="">{t('Todos')}</option>
            {(Object.keys(CASE_STATUS) as CaeCase['status'][]).map((s) => (
              <option key={s} value={s}>
                {t(CASE_STATUS[s].label)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Centro de trabajo')} value={site} onChange={(e) => { setSite(e.target.value); paged.reset(); }}>
            <option value="">{t('Todos')}</option>
            {sites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Puntos abiertos')} value={point} onChange={(e) => { setPoint(e.target.value as PointFilter); paged.reset(); }}>
            <option value="">{t('Todos')}</option>
            <option value="any">{t('Con algún punto abierto')}</option>
            <option value="notSent">{t('Pendiente de envío')}</option>
            <option value="noReceipt">{t('Sin confirmación de recepción')}</option>
            <option value="noAck">{t('Sin acuse del destinatario')}</option>
            <option value="toReview">{t('Recibido por revisar')}</option>
            <option value="followUp">{t('Seguimiento vencido')}</option>
          </SelectField>
          {filtersOn && (
            <Button size="sm" variant="ghost" onClick={() => { setQ(''); setStatus('not_closed'); setSite(''); setPoint(''); }}>
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            icon={rows.length ? Search : Handshake}
            title={rows.length ? t('Ningún caso coincide con los filtros') : t('Todavía no hay casos de coordinación')}
            action={!rows.length && canManage ? <Button icon={Plus} onClick={() => setCreating(true)}>{t('Nuevo caso')}</Button> : undefined}
          >
            {rows.length ? t('Cambie o limpie los filtros para ver más casos.') : t('Abra un caso cuando trabajadores de varias empresas concurran en un mismo centro.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">{t('Casos de coordinación CAE')}</caption>
                <thead>
                  <tr>
                    <SortHeader label={t('Caso')} col="code" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Centro y cliente')} col="worksite" sort={sort} onSort={onSort} />
                    <th>{t('Participantes')}</th>
                    <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Puntos abiertos')} col="points" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Próximo seguimiento')} col="followUp" sort={sort} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map(({ c, customer, p }) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/cae/${c.id}`} className="strong">
                          {c.code}
                        </Link>
                        <div className="small">{c.title}</div>
                      </td>
                      <td>
                        <WorksiteLink id={c.worksiteId} />
                        {customer && <div className="tiny muted">{customer}</div>}
                      </td>
                      <td className="small">
                        <div>{t('{n} empresas', { n: c.participants.length })}</div>
                        <div className="tiny muted cae-orgs">
                          {c.participants
                            .filter((x) => !x.isOwnCompany)
                            .map((x) => x.organisation)
                            .join(' · ')}
                        </div>
                      </td>
                      <td>
                        <CaseStatusBadge status={c.status} />
                      </td>
                      <td>{c.status === 'closed' ? <span className="muted small">—</span> : <PendingBadges p={p} />}</td>
                      <td>
                        {c.status === 'closed' ? (
                          <span className="muted small">{t('Caso cerrado')}</span>
                        ) : (
                          <>
                            <KindDate kind="internal" date={c.nextFollowUp} today={ctx.today} />
                            <div className="tiny muted">{c.followUpOwnerId ? userName(ctx.db, c.followUpOwnerId) : t('Sin responsable')}</div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>

      <Callout tone="neutral" title={t('Fuera del alcance inicial')}>
        {t('La coordinación específica de obras de construcción (RD 1627/1997: estudio y plan de seguridad, coordinador en obra, libro de subcontratación) no se gestiona en esta versión.')}
      </Callout>

      {creating && canManage && (
        <CaseFormModal
          kase={null}
          initialWorksiteId={initialWs}
          onClose={closeCreate}
          onSaved={(c) => {
            setCreating(false);
            navigate(`/cae/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
