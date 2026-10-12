/**
 * Small shared presentation pieces for working-time data.
 */
import { Link } from 'react-router-dom';
import { recordStatus, type Indicator } from '../domain/records';
import { RECORD_STATUS } from '../domain/status';
import { formatDate, formatDuration, formatOffset, localDate, localTime } from '../domain/time';
import type { Database, ID, Msg, SessionValues, WorkSession } from '../domain/types';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { BREAK_KIND_LABEL, MODE_LABEL } from '../domain/status';
import { Badge, StatusBadge } from './ui';

/** Renders a translatable message produced by the domain ({text, params}). */
export function msg(m: Msg): string {
  return t(m.text, m.params);
}

export function RecordStatusBadge({ db, session }: { db: Database; session: WorkSession }) {
  return <StatusBadge meta={RECORD_STATUS[recordStatus(db, session)]} />;
}

/**
 * Local time in the workplace zone with an unambiguous tooltip (UTC instant + offset).
 * Shows "+1" when the time falls on the day after `baseDate` (overnight sessions).
 */
export function TimeText({ at, tz, baseDate }: { at: string | null | undefined; tz: string; baseDate?: string }) {
  if (!at) return <span className="muted">—</span>;
  const d = localDate(at, tz);
  const plus = baseDate && d > baseDate ? ' (+1)' : '';
  return (
    <span className="nowrap num" title={`${formatDate(d)} ${localTime(at, tz)} ${formatOffset(at, tz)} · ${at}`}>
      {localTime(at, tz)}
      {plus && <span className="tiny muted">{plus}</span>}
    </span>
  );
}

export function DurationText({ minutes, provisional }: { minutes: number | null | undefined; provisional?: boolean }) {
  return (
    <span className="num nowrap" title={provisional ? t('Provisional: la sesión sigue abierta') : undefined}>
      {formatDuration(minutes)}
      {provisional && minutes !== null && minutes !== undefined ? <span className="tiny muted"> *</span> : null}
    </span>
  );
}

export function EmployeeLink({ id }: { id: ID }) {
  const ctx = useCtx();
  const e = ctx.db.employees.find((x) => x.id === id);
  if (!e) return <span>—</span>;
  const canOpen = ctx.can('employees.view_all') || ctx.can('employees.view_team');
  const name = `${e.firstName} ${e.lastName}`;
  return canOpen ? (
    <Link to={`/equipo/${e.id}`} className="strong">
      {name}
    </Link>
  ) : (
    <span className="strong">{name}</span>
  );
}

export function IndicatorBadges({ items }: { items: Indicator[] }) {
  if (!items.length) return null;
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {items.map((i) => (
        <Badge key={i.code} tone="accent" title={`${msg(i.message)} — ${t('Indicador de revisión configurable; no es una conclusión.')}`}>
          {t(INDICATOR_LABEL[i.code])}
        </Badge>
      ))}
    </span>
  );
}

export const INDICATOR_LABEL: Record<Indicator['code'], string> = {
  long_day: 'Jornada larga',
  night: 'Nocturno',
  no_break: 'Sin pausa',
  short_rest: 'Descanso corto',
};

/** Read-only view of a set of session values (original / requested / approved). */
export function ValuesView({ values, tz, worksiteName }: { values: SessionValues | null; tz: string; worksiteName: (id: ID | null) => string }) {
  if (!values) return <span className="muted">{t('Sin registro original (jornada no registrada)')}</span>;
  const base = values.start ? localDate(values.start, tz) : undefined;
  return (
    <div className="stack-sm">
      <div>
        <span className="muted tiny">{t('Entrada')}</span> <TimeText at={values.start} tz={tz} baseDate={base} /> · <span className="muted tiny">{t('Salida')}</span> <TimeText at={values.end} tz={tz} baseDate={base} />
        {!values.end && <Badge tone="danger">{t('Sin salida')}</Badge>}
      </div>
      <div className="tiny">
        {values.breaks.length === 0 ? (
          <span className="muted">{t('Sin pausas registradas')}</span>
        ) : (
          values.breaks.map((b, i) => (
            <span key={i} className="nowrap" style={{ marginRight: 8 }}>
              {t(BREAK_KIND_LABEL[b.kind])}: <TimeText at={b.start} tz={tz} baseDate={base} />–<TimeText at={b.end} tz={tz} baseDate={base} />
            </span>
          ))
        )}
      </div>
      <div className="tiny muted">
        {worksiteName(values.worksiteId)} · {t(MODE_LABEL[values.mode])}
      </div>
    </div>
  );
}
