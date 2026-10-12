import { ClipboardList, History, Info, Plus, Reply, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmployeeLink } from '../../components/bits';
import { Button, Callout, Card, DateText, EmptyState, Pagination, SortHeader, sortRows, usePaged, useSort } from '../../components/ui';
import type { HealthOffer, ID } from '../../domain/types';
import { t } from '../../i18n';
import { employeeName, userName } from '../../services/context';
import { useCtx } from '../../store/hooks';
import { OfferModal, ResponseModal } from './healthForms';
import { BasisBadge, HealthHistoryModal, requirementLabel, RESPONSE_META, ResponseBadge, type HealthRow } from './healthShared';

type ResponseFilter = '' | HealthOffer['response'] | 'none';

export function OffersTab({ rows, employeeId, onEmployee }: { rows: HealthRow[]; employeeId: ID; onEmployee: (id: ID) => void }) {
  const ctx = useCtx();
  const [q, setQ] = useState('');
  const [resp, setResp] = useState<ResponseFilter>('');
  const [offerFor, setOfferFor] = useState<{ employeeId: ID | null } | null>(null);
  const [respondTo, setRespondTo] = useState<HealthOffer | null>(null);
  const [historyOf, setHistoryOf] = useState<ID | null>(null);
  const historyRow = historyOf ? rows.find((r) => r.employee.id === historyOf) ?? null : null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!employeeId || r.employee.id === employeeId) &&
        (!needle || employeeName(ctx.db, r.employee.id).toLowerCase().includes(needle) || r.employee.code.toLowerCase().includes(needle)) &&
        (!resp || (resp === 'none' ? !r.offer : r.offer?.response === resp)),
    );
  }, [rows, employeeId, q, resp, ctx.db]);
  const { sort, onSort } = useSort('offered', 'desc');
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (r, col) =>
        col === 'employee' ? employeeName(ctx.db, r.employee.id) : col === 'offered' ? r.offer?.offeredAt ?? null : col === 'response' ? (r.offer ? t(RESPONSE_META[r.offer.response].label) : null) : col === 'basis' ? r.offer?.basis ?? null : null,
      ),
    [filtered, sort, ctx.db],
  );
  const paged = usePaged(sorted, 25);
  const pendingCount = rows.filter((r) => r.offer?.response === 'pending').length;
  const anyFilter = !!(q || resp || employeeId);

  return (
    <div className="stack">
      <Callout tone="info" icon={Info} title={t('Oferta, respuesta y excepción obligatoria son cosas distintas')}>
        <ul>
          <li>{t('La vigilancia de la salud se ofrece a la persona trabajadora y, por regla general, es voluntaria (LPRL art. 22.1): solo se registra si acepta o no la oferta.')}</li>
          <li>{t('No aceptar una oferta voluntaria no es un incumplimiento y no bloquea la disponibilidad. Los motivos no se registran.')}</li>
          <li>{t('Un reconocimiento obligatorio existe solo cuando un requisito aprobado por el servicio médico recoge una de las excepciones del art. 22.1, con el informe previo de la representación de las personas trabajadoras. En ese caso la negativa la trata el servicio médico.')}</li>
        </ul>
      </Callout>
      <Card
        flush
        title={
          <h2 className="row">
            <ClipboardList size={16} aria-hidden /> {t('Ofertas de vigilancia de la salud')}
          </h2>
        }
        actions={
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setOfferFor({ employeeId: employeeId || null })}>
            {t('Registrar oferta')}
          </Button>
        }
      >
        <div className="toolbar" role="search" aria-label={t('Filtros de ofertas')}>
          <div className="field search">
            <label htmlFor="ho-q">{t('Buscar')}</label>
            <div className="health-search">
              <Search size={14} aria-hidden />
              <input id="ho-q" className="input" type="search" value={q} placeholder={t('Nombre o código de empleado')} onChange={(e) => { setQ(e.target.value); paged.reset(); }} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ho-emp">{t('Empleado')}</label>
            <select id="ho-emp" className="select" value={employeeId} onChange={(e) => { onEmployee(e.target.value); paged.reset(); }}>
              <option value="">{t('Todos')}</option>
              {rows.map((r) => (
                <option key={r.employee.id} value={r.employee.id}>
                  {employeeName(ctx.db, r.employee.id)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ho-resp">{t('Respuesta')}</label>
            <select id="ho-resp" className="select" value={resp} onChange={(e) => { setResp(e.target.value as ResponseFilter); paged.reset(); }}>
              <option value="">{t('Todas')}</option>
              {(Object.keys(RESPONSE_META) as HealthOffer['response'][]).map((k) => (
                <option key={k} value={k}>
                  {t(RESPONSE_META[k].label)}
                </option>
              ))}
              <option value="none">{t('Sin oferta registrada')}</option>
            </select>
          </div>
          {anyFilter && (
            <Button variant="ghost" onClick={() => { setQ(''); setResp(''); onEmployee(''); }}>
              {t('Limpiar filtros')}
            </Button>
          )}
          <span className="small muted health-toolbar-note">{t('{n} pendientes de respuesta', { n: pendingCount })}</span>
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon={ClipboardList} title={rows.length === 0 ? t('No hay personas trabajadoras en su ámbito') : t('Ninguna persona coincide con los filtros')}>
            {rows.length === 0 ? undefined : t('Cambie o limpie los filtros.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table health-table">
                <thead>
                  <tr>
                    <SortHeader label={t('Empleado')} col="employee" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Carácter de la última oferta')} col="basis" sort={sort} onSort={onSort} />
                    <th>{t('Requisito')}</th>
                    <SortHeader label={t('Fecha de la oferta')} col="offered" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Respuesta')} col="response" sort={sort} onSort={onSort} />
                    <th>{t('Acciones')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => {
                    const o = r.offer;
                    return (
                      <tr key={r.employee.id} className={employeeId === r.employee.id ? 'health-row-focus' : undefined}>
                        <td>
                          <EmployeeLink id={r.employee.id} />
                          <div className="sub">{r.employee.code}</div>
                        </td>
                        <td>{o ? <BasisBadge basis={o.basis} /> : <span className="muted small">{t('Sin oferta registrada')}</span>}</td>
                        <td className="small">{o ? requirementLabel(ctx, o.templateId) : '—'}</td>
                        <td>
                          {o ? (
                            <>
                              <DateText date={o.offeredAt} />
                              <div className="sub">{t('Por {name}', { name: userName(ctx.db, o.offeredBy) })}</div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {o ? (
                            <>
                              <ResponseBadge response={o.response} />
                              {o.respondedAt && (
                                <div className="sub">
                                  <DateText date={o.respondedAt} />
                                </div>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <div className="row-wrap health-actions">
                            {o?.response === 'pending' ? (
                              <Button size="sm" variant="primary" icon={Reply} onClick={() => setRespondTo(o)} aria-label={t('Registrar respuesta de {name}', { name: employeeName(ctx.db, r.employee.id) })}>
                                {t('Registrar respuesta')}
                              </Button>
                            ) : (
                              <Button size="sm" icon={Plus} onClick={() => setOfferFor({ employeeId: r.employee.id })} aria-label={t('Registrar oferta para {name}', { name: employeeName(ctx.db, r.employee.id) })}>
                                {t('Registrar oferta')}
                              </Button>
                            )}
                            {(r.offers.length > 1 || r.conclusions.length > 0) && (
                              <Button size="sm" variant="ghost" icon={History} onClick={() => setHistoryOf(r.employee.id)} aria-label={t('Historial de {name}', { name: employeeName(ctx.db, r.employee.id) })}>
                                {t('Historial')}
                              </Button>
                            )}
                          </div>
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
      {offerFor && <OfferModal employeeId={offerFor.employeeId} onClose={() => setOfferFor(null)} />}
      {respondTo && <ResponseModal offer={respondTo} onClose={() => setRespondTo(null)} />}
      {historyRow && <HealthHistoryModal row={historyRow} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}
