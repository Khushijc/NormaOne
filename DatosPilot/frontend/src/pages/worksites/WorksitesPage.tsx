/**
 * Centros de trabajo: directory of the company's worksites with their risks, people, readiness
 * summary (aggregated counts), open preventive actions and CAE case. Create / edit / activate /
 * deactivate need worksites.manage; the service re-checks and opens requirement delta reviews.
 */
import { Building2, Handshake, MapPin, Pencil, Plus, Power, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ReadinessDisclaimer } from '../../components/bits';
import { Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, Pagination, SelectField, SortHeader, TextField, sortRows, useAction, usePaged, useSort } from '../../components/ui';
import { READINESS, READINESS_ORDER } from '../../domain/status';
import type { ID, ReadinessState, Worksite } from '../../domain/types';
import { t } from '../../i18n';
import { visibleCases } from '../../services/caeService';
import { employeeName, readinessAggregate, roleName, visibleWorksiteIds } from '../../services/context';
import { employeesAt, setWorksiteActive } from '../../services/peopleService';
import { visibleActions } from '../../services/safetyService';
import { assignmentOn } from '../../domain/requirements';
import { useCtx } from '../../store/hooks';
import { WorksiteFormModal } from './WorksiteFormModal';
import { customerName, ReadinessCounts, ReadinessLegend, RiskTags } from './worksiteShared';

interface Row {
  ws: Worksite;
  customer: string;
  people: number;
  roles: { name: string; n: number }[];
  counts: Record<string, number>;
  worst: ReadinessState | null;
  openActions: number;
  cases: { id: ID; code: string }[];
}

type StatusFilter = 'active' | 'inactive' | 'all';

export function WorksitesPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const canManage = ctx.can('worksites.manage');
  const { run } = useAction();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | Worksite['kind']>('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [shared, setShared] = useState<'' | 'yes' | 'no'>('');
  const [risk, setRisk] = useState('');
  const [readiness, setReadiness] = useState<'' | ReadinessState>('');
  const [withActions, setWithActions] = useState(false);
  const [editing, setEditing] = useState<Worksite | 'new' | null>(null);
  const [toggling, setToggling] = useState<Worksite | null>(null);
  const { sort, onSort } = useSort('code', 'asc');

  const rows = useMemo<Row[]>(() => {
    const sites = visibleWorksiteIds(ctx);
    const agg = new Map(readinessAggregate(ctx).map((a) => [a.worksiteId, a.counts]));
    const actions = visibleActions(ctx).filter((a) => a.status !== 'resolved');
    const cases = visibleCases(ctx);
    return ctx.db.worksites
      .filter((w) => w.companyId === ctx.company.id && sites.has(w.id))
      .map((ws) => {
        const people = employeesAt(ctx, ws.id);
        const roleCount = new Map<string, number>();
        for (const id of people) {
          const name = roleName(ctx.db, assignmentOn(ctx.db, id, ctx.today)?.jobRoleId);
          roleCount.set(name, (roleCount.get(name) ?? 0) + 1);
        }
        const counts = agg.get(ws.id) ?? {};
        return {
          ws,
          customer: ws.kind === 'customer' ? customerName(ctx, ws.customerId) : '',
          people: people.length,
          roles: [...roleCount.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
          counts,
          worst: READINESS_ORDER.find((s) => (counts[s] ?? 0) > 0) ?? null,
          openActions: actions.filter((a) => a.worksiteId === ws.id).length,
          cases: cases.filter((c) => c.worksiteId === ws.id && c.status !== 'closed').map((c) => ({ id: c.id, code: c.code })),
        };
      });
  }, [ctx]);

  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id && rows.some((x) => x.ws.riskTags.includes(r.id)));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === 'active' && !r.ws.active) return false;
      if (status === 'inactive' && r.ws.active) return false;
      if (kind && r.ws.kind !== kind) return false;
      if (shared && r.ws.sharedWorkplace !== (shared === 'yes')) return false;
      if (risk && !r.ws.riskTags.includes(risk)) return false;
      if (readiness && !(r.counts[readiness] > 0)) return false;
      if (withActions && !r.openActions) return false;
      if (needle && ![r.ws.code, r.ws.name, r.ws.municipality, r.ws.address, r.customer].some((s) => s.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, q, status, kind, shared, risk, readiness, withActions]);

  const sorted = sortRows(filtered, sort, (r, col) => {
    switch (col) {
      case 'code':
        return r.ws.code;
      case 'name':
        return r.ws.name;
      case 'customer':
        return r.customer || null;
      case 'people':
        return r.people;
      case 'readiness':
        return r.worst ? READINESS_ORDER.indexOf(r.worst) : 99;
      case 'actions':
        return r.openActions;
      default:
        return r.ws.code;
    }
  });
  const paged = usePaged(sorted, 25);

  const active = rows.filter((r) => r.ws.active);
  const kpis = [
    { key: 'active', label: t('Centros activos'), value: active.length, meta: t('{n} inactivos', { n: rows.length - active.length }), apply: () => setStatus('active') },
    { key: 'shared', label: t('Lugares compartidos'), value: active.filter((r) => r.ws.sharedWorkplace).length, meta: t('Concurren otras empresas'), apply: () => setShared('yes') },
    { key: 'blocked', label: t('Centros con personas bloqueadas'), value: active.filter((r) => (r.counts.blocked ?? 0) > 0).length, meta: t('Requisito crítico sin resolver'), tone: 'danger', apply: () => setReadiness('blocked') },
    { key: 'actions', label: t('Centros con acciones abiertas'), value: active.filter((r) => r.openActions > 0).length, meta: t('{n} acciones abiertas', { n: active.reduce((s, r) => s + r.openActions, 0) }), tone: 'warning', apply: () => setWithActions(true) },
  ];

  const filtersOn = !!(q || kind || status !== 'active' || shared || risk || readiness || withActions);
  const clear = () => {
    setQ('');
    setKind('');
    setStatus('active');
    setShared('');
    setRisk('');
    setReadiness('');
    setWithActions(false);
  };

  const togglePeople = toggling ? employeesAt(ctx, toggling.id).length : 0;

  return (
    <div className="stack-lg">
      <PageHeader
        title={t('Centros de trabajo')}
        subtitle={t('Centros propios y de clientes, sus riesgos, el personal asignado y la coordinación con otras empresas.')}
        actions={
          canManage && (
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              {t('Nuevo centro')}
            </Button>
          )
        }
      />

      <div className="kpis">
        {kpis.map((k) => (
          <button key={k.key} type="button" className={`kpi ${k.tone ? `tone-${k.tone}` : ''}`} onClick={k.apply}>
            <span className="label">{k.label}</span>
            <span className="value">{k.value}</span>
            <span className="meta">{k.meta}</span>
          </button>
        ))}
      </div>

      <Card flush>
        <div className="toolbar">
          <TextField className="search" label={t('Buscar')} placeholder={t('Código, nombre, municipio o cliente')} value={q} onChange={(e) => { setQ(e.target.value); paged.reset(); }} type="search" />
          <SelectField label={t('Estado')} value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); paged.reset(); }}>
            <option value="active">{t('Activos')}</option>
            <option value="inactive">{t('Inactivos')}</option>
            <option value="all">{t('Todos')}</option>
          </SelectField>
          <SelectField label={t('Tipo de centro')} value={kind} onChange={(e) => { setKind(e.target.value as '' | Worksite['kind']); paged.reset(); }}>
            <option value="">{t('Todos')}</option>
            <option value="own">{t('Centro propio')}</option>
            <option value="customer">{t('Centro de un cliente')}</option>
          </SelectField>
          <SelectField label={t('Lugar compartido')} value={shared} onChange={(e) => { setShared(e.target.value as '' | 'yes' | 'no'); paged.reset(); }}>
            <option value="">{t('Todos')}</option>
            <option value="yes">{t('Sí')}</option>
            <option value="no">{t('No')}</option>
          </SelectField>
          <SelectField label={t('Riesgo')} value={risk} onChange={(e) => { setRisk(e.target.value); paged.reset(); }}>
            <option value="">{t('Todos')}</option>
            {tags.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Disponibilidad')} value={readiness} onChange={(e) => { setReadiness(e.target.value as '' | ReadinessState); paged.reset(); }}>
            <option value="">{t('Todas')}</option>
            {READINESS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t('Con personas: {state}', { state: t(READINESS[s].label) })}
              </option>
            ))}
          </SelectField>
          <label className="checkbox ws-toolbar-check">
            <input type="checkbox" checked={withActions} onChange={(e) => { setWithActions(e.target.checked); paged.reset(); }} />
            <span>{t('Con acciones abiertas')}</span>
          </label>
          {filtersOn && (
            <Button size="sm" variant="ghost" onClick={clear}>
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>

        {sorted.length === 0 ? (
          <EmptyState icon={rows.length ? Search : Building2} title={rows.length ? t('Ningún centro coincide con los filtros') : t('No hay centros de trabajo visibles')}>
            {rows.length ? t('Cambie o limpie los filtros para ver más centros.') : canManage ? t('Cree el primer centro para asignar personal y requisitos.') : t('Su rol no tiene centros asignados en esta empresa.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table ws-table">
                <caption className="sr-only">{t('Centros de trabajo')}</caption>
                <thead>
                  <tr>
                    <SortHeader label={t('Código')} col="code" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Centro y cliente')} col="name" sort={sort} onSort={onSort} />
                    <th>{t('Contacto y coordinación')}</th>
                    <SortHeader label={t('Personas asignadas')} col="people" sort={sort} onSort={onSort} />
                    <th>{t('Riesgos')}</th>
                    <SortHeader label={t('Disponibilidad')} col="readiness" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Acciones abiertas')} col="actions" sort={sort} onSort={onSort} num />
                    <th>{t('CAE')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => (
                    <tr key={r.ws.id}>
                      <td className="nowrap">
                        <span className="tag">{r.ws.code}</span>
                        {canManage && (
                          <div className="ws-row-actions">
                            <Button size="sm" variant="ghost" iconOnly icon={Pencil} aria-label={t('Editar {name}', { name: r.ws.name })} onClick={() => setEditing(r.ws)} />
                            <Button size="sm" variant="ghost" iconOnly icon={Power} aria-label={r.ws.active ? t('Desactivar {name}', { name: r.ws.name }) : t('Reactivar {name}', { name: r.ws.name })} onClick={() => setToggling(r.ws)} />
                          </div>
                        )}
                      </td>
                      <td className="ws-col-name">
                        <Link to={`/centros/${r.ws.id}`} className="strong">
                          {r.ws.name}
                        </Link>
                        <div className="small">{r.ws.kind === 'customer' ? r.customer : <span className="muted">{t('Centro propio')}</span>}</div>
                        <div className="tiny muted">
                          <MapPin size={11} aria-hidden /> {r.ws.address} · {r.ws.municipality}
                        </div>
                        <span className="status-stack ws-status">
                          {r.ws.active ? <Badge tone="success">{t('Activo')}</Badge> : <Badge tone="neutral">{t('Inactivo')}</Badge>}
                          {r.ws.sharedWorkplace && <Badge tone="info" icon={Handshake}>{t('Compartido')}</Badge>}
                        </span>
                      </td>
                      <td className="small ws-col-contact">
                        <div>{r.ws.siteContactName || <span className="muted">{t('Sin contacto')}</span>}</div>
                        <div className="tiny muted">
                          {t('Coordinación interna')}: {r.ws.coordinatorEmployeeId ? employeeName(ctx.db, r.ws.coordinatorEmployeeId) : t('Sin asignar')}
                        </div>
                      </td>
                      <td className="ws-col-people">
                        <div className="strong">{r.people}</div>
                        {r.roles.length > 0 && (
                          <ul className="cae-plain-list tiny muted" title={r.roles.map((x) => `${x.n} × ${x.name}`).join(', ')}>
                            {r.roles.slice(0, 2).map((x) => (
                              <li key={x.name} className="ws-roles">
                                {x.n} × {x.name}
                              </li>
                            ))}
                            {r.roles.length > 2 && <li>{t('y {n} puestos más', { n: r.roles.length - 2 })}</li>}
                          </ul>
                        )}
                      </td>
                      <td className="ws-col-risks">
                        <RiskTags ctx={ctx} tags={r.ws.riskTags} />
                      </td>
                      <td className="ws-col-readiness">{r.ws.active ? <ReadinessCounts counts={r.counts} /> : <span className="muted small">{t('Centro inactivo')}</span>}</td>
                      <td className="num">{r.openActions ? <Link to={`/centros/${r.ws.id}?tab=acciones`}>{r.openActions}</Link> : <span className="muted">0</span>}</td>
                      <td className="nowrap">
                        {r.cases.length ? (
                          r.cases.map((c) => (
                            <Link key={c.id} to={`/cae/${c.id}`} className="ws-case-link">
                              {c.code}
                            </Link>
                          ))
                        ) : r.ws.sharedWorkplace ? (
                          <Badge tone="warning">{t('Sin caso')}</Badge>
                        ) : (
                          <span className="muted small">—</span>
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

      <div className="stack-sm">
        <ReadinessLegend />
        <ReadinessDisclaimer />
        <p className="tiny muted">{t('Los recuentos de disponibilidad son agregados por centro (personas × centro). El detalle individual se muestra solo a quien tiene acceso a esas personas.')}</p>
      </div>

      {editing && (
        <WorksiteFormModal
          worksite={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(w) => {
            const wasNew = editing === 'new';
            setEditing(null);
            if (wasNew) navigate(`/centros/${w.id}`);
          }}
        />
      )}

      {toggling && (
        <ConfirmDialog
          title={toggling.active ? t('Desactivar {name}', { name: toggling.name }) : t('Reactivar {name}', { name: toggling.name })}
          danger={toggling.active}
          confirmLabel={toggling.active ? t('Desactivar centro') : t('Reactivar centro')}
          requireReason
          message={
            <p className="small">
              {toggling.active
                ? t('Hay {n} personas asignadas a este centro. Al desactivarlo se abrirá una revisión de cambios de requisitos para las personas afectadas. El historial, las evidencias y los casos CAE se conservan.', { n: togglePeople })
                : t('Al reactivarlo, las {n} personas asignadas recibirán una revisión de cambios de requisitos. El historial se conserva.', { n: togglePeople })}
            </p>
          }
          onConfirm={async (reason) => {
            const wasActive = toggling.active;
            const r = await run(() => setWorksiteActive(toggling.id, !wasActive, reason), (res) => (wasActive ? t('Centro desactivado: {n} revisiones de requisitos abiertas', { n: res.reviews }) : t('Centro reactivado: {n} revisiones de requisitos abiertas', { n: res.reviews })));
            return !!r;
          }}
          onClose={() => setToggling(null)}
        />
      )}
    </div>
  );
}