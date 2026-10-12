/**
 * "Calendarios laborales": working calendars per worksite, versioned by year (research R23).
 * Holidays never create or delete attendance records.
 */
import { CalendarOff, CalendarPlus, ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Callout, Card, ConfirmDialog, EmptyState, KV, Modal, SelectField, TextField, useAction } from '../../components/ui';
import { formatDate, formatDateLong, isValidISODate } from '../../domain/time';
import type { Holiday, WorkingCalendar } from '../../domain/types';
import { t } from '../../i18n';
import { addHoliday, removeHoliday } from '../../services/planningService';
import { useCtx } from '../../store/hooks';
import { HOLIDAY_SCOPE_LABEL, HOLIDAY_SCOPE_TONE } from './shared';

const SCOPES: Holiday['scope'][] = ['national', 'regional', 'local', 'company'];

export function CalendarsTab() {
  const ctx = useCtx();
  const canManage = ctx.can('policies.manage');
  const { runOk } = useAction();
  const [adding, setAdding] = useState<WorkingCalendar | null>(null);
  const [removing, setRemoving] = useState<{ cal: WorkingCalendar; holiday: Holiday } | null>(null);
  const calendars = ctx.db.calendars.filter((c) => c.companyId === ctx.company.id).sort((a, b) => b.year - a.year || a.name.localeCompare(b.name, 'es'));

  return (
    <div className="stack">
      <Callout tone="info" title={t('Los festivos no crean ni eliminan registros de asistencia')}>
        {t('Si alguien trabaja en un festivo, su registro se conserva tal cual; un turno planificado en festivo solo se marca como aviso. En España hay hasta 12 fiestas nacionales y autonómicas más 2 locales por municipio, y varían según la comunidad autónoma: cada centro usa el calendario de su localidad.')}
      </Callout>

      {calendars.length === 0 && (
        <Card>
          <EmptyState icon={CalendarOff} title={t('No hay calendarios laborales configurados')} />
        </Card>
      )}

      {calendars.map((cal) => {
        const sites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && w.calendarId === cal.id);
        const counts = SCOPES.map((s) => ({ s, n: cal.holidays.filter((h) => h.scope === s).length })).filter((x) => x.n > 0);
        const onlyNational = cal.holidays.length > 0 && cal.holidays.every((h) => h.scope === 'national');
        return (
          <Card
            key={cal.id}
            flush
            title={
              <h2>
                {cal.name} <span className="tag">{cal.year}</span>
              </h2>
            }
            actions={
              canManage && (
                <Button size="sm" icon={CalendarPlus} onClick={() => setAdding(cal)}>
                  {t('Añadir festivo')}
                </Button>
              )
            }
          >
            <div className="card-body stack">
              {onlyNational && (
                <Callout tone="warning" title={t('Calendario incompleto')}>
                  {t('Solo contiene fiestas nacionales. Faltan las fiestas autonómicas y las locales del municipio, que deben cargarse y verificarse en el boletín oficial antes de usarlo como referencia.')}
                </Callout>
              )}
              <KV
                items={[
                  [t('Año'), cal.year],
                  [t('Fuente'), <span className="small">{cal.source}</span>],
                  [
                    t('Enlace a la fuente'),
                    cal.sourceUrl ? (
                      <a href={cal.sourceUrl} target="_blank" rel="noreferrer">
                        {t('Boletín oficial')} <ExternalLink size={12} aria-hidden />
                        <span className="sr-only"> {t('(se abre en otra pestaña)')}</span>
                      </a>
                    ) : (
                      '—'
                    ),
                  ],
                  [t('Centros que lo usan'), sites.length ? sites.map((w) => w.name).join(', ') : t('Ninguno')],
                  [
                    t('Festivos'),
                    <span className="row-wrap" style={{ gap: 4 }}>
                      {counts.map(({ s, n }) => (
                        <Badge key={s} tone={HOLIDAY_SCOPE_TONE[s]} icon={false}>
                          {t(HOLIDAY_SCOPE_LABEL[s])}: {n}
                        </Badge>
                      ))}
                      {counts.length === 0 && <span className="muted">{t('Ninguno')}</span>}
                    </span>,
                  ],
                ]}
              />
            </div>
            {cal.holidays.length === 0 ? (
              <EmptyState icon={CalendarOff} title={t('Este calendario no tiene festivos')} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">{t('Festivos del calendario {name}', { name: cal.name })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('Fecha')}</th>
                      <th scope="col">{t('Día')}</th>
                      <th scope="col">{t('Festivo')}</th>
                      <th scope="col">{t('Ámbito')}</th>
                      {canManage && <th scope="col"><span className="sr-only">{t('Acciones')}</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {[...cal.holidays].sort((a, b) => a.date.localeCompare(b.date)).map((h) => (
                      <tr key={h.date} className={h.date < ctx.today ? 'plan-past' : undefined}>
                        <td className="nowrap num">{formatDate(h.date)}</td>
                        <td className="small">{formatDateLong(h.date)}</td>
                        <td className="strong">{h.name}</td>
                        <td><Badge tone={HOLIDAY_SCOPE_TONE[h.scope]} icon={false}>{t(HOLIDAY_SCOPE_LABEL[h.scope])}</Badge></td>
                        {canManage && (
                          <td>
                            <Button size="sm" variant="ghost" iconOnly icon={Trash2} aria-label={t('Quitar festivo {name} ({date})', { name: h.name, date: formatDate(h.date) })} onClick={() => setRemoving({ cal, holiday: h })} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}

      {adding && <AddHolidayModal cal={adding} onClose={() => setAdding(null)} />}
      {removing && (
        <ConfirmDialog
          title={t('Quitar festivo del calendario')}
          message={t('Se quitará «{name}» ({date}) de «{calendar}». Los registros de asistencia de ese día no cambian.', { name: removing.holiday.name, date: formatDate(removing.holiday.date), calendar: removing.cal.name })}
          confirmLabel={t('Quitar festivo')}
          danger
          requireReason
          onClose={() => setRemoving(null)}
          onConfirm={(reason) => runOk(() => removeHoliday(removing.cal.id, removing.holiday.date, reason), t('Festivo quitado del calendario. No se ha modificado ningún registro de asistencia.'))}
        />
      )}
    </div>
  );
}

function AddHolidayModal({ cal, onClose }: { cal: WorkingCalendar; onClose: () => void }) {
  const { run, pending } = useAction();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Holiday['scope']>('local');
  const [touched, setTouched] = useState(false);
  const errors: { date?: string; name?: string } = {};
  if (!isValidISODate(date) || !date.startsWith(String(cal.year))) errors.date = t('La fecha debe pertenecer a {year}.', { year: cal.year });
  else if (cal.holidays.some((h) => h.date === date)) errors.date = t('Ya hay un festivo en esa fecha.');
  if (!name.trim()) errors.name = t('Indique el nombre del festivo.');

  const submit = async () => {
    setTouched(true);
    if (errors.date || errors.name) return;
    const r = await run(() => addHoliday(cal.id, { date, name: name.trim(), scope }), t('Festivo añadido. No crea ni elimina registros de asistencia.'));
    if (r) onClose();
  };

  return (
    <Modal
      title={t('Añadir festivo')}
      description={cal.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('Añadir festivo')}</Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label={t('Fecha')} required type="date" min={`${cal.year}-01-01`} max={`${cal.year}-12-31`} value={date} onChange={(e) => setDate(e.target.value)} error={touched ? errors.date : undefined} />
        <SelectField label={t('Ámbito')} required value={scope} onChange={(e) => setScope(e.target.value as Holiday['scope'])}>
          {SCOPES.map((s) => (
            <option key={s} value={s}>{t(HOLIDAY_SCOPE_LABEL[s])}</option>
          ))}
        </SelectField>
        <TextField label={t('Nombre del festivo')} required className="span-all" value={name} onChange={(e) => setName(e.target.value)} error={touched ? errors.name : undefined} hint={t('Nombre oficial tal como figura en el boletín.')} />
      </div>
      <p className="tiny muted" style={{ marginTop: 12 }}>{t('Un festivo no crea ni elimina registros de asistencia. Los turnos ya planificados ese día se mostrarán con un aviso.')}</p>
    </Modal>
  );
}
