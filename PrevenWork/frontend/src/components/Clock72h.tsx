import { AlertTriangle, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { computeIncidentClock, formatInstant, nowInstant, type IncidentClock72h } from '../domain/time';
import { t } from '../i18n';

export function Clock72h({
  awarenessTimestamp,
  authorityNotified,
  showDetail = false,
}: {
  awarenessTimestamp: string;
  authorityNotified: boolean;
  showDetail?: boolean;
}) {
  const [clock, setClock] = useState<IncidentClock72h>(() =>
    computeIncidentClock(awarenessTimestamp, authorityNotified, nowInstant())
  );

  useEffect(() => {
    if (authorityNotified) return;
    const interval = setInterval(() => {
      setClock(computeIncidentClock(awarenessTimestamp, authorityNotified, nowInstant()));
    }, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [awarenessTimestamp, authorityNotified]);

  const Icon = authorityNotified
    ? CheckCircle2
    : clock.status === 'critical' || clock.status === 'expired'
    ? ShieldAlert
    : clock.status === 'warning'
    ? AlertTriangle
    : Clock;

  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`clock-72h ${clock.status}`}
        title={`Conocimiento organizativo: ${formatInstant(awarenessTimestamp)}. El plazo legal de 72 horas computa de forma continua incluidos fines de semana.`}
      >
        <Icon size={13} aria-hidden />
        <span>{clock.formattedCountdown}</span>
      </span>

      {showDetail && !authorityNotified && (
        <span className="tiny muted">
          {clock.isOverdue
            ? t('Plazo de 72h excedido. Si se notifica ahora, debe incluirse justificación motivada del retraso (Art. 33.1 RGPD).')
            : t('Reloj continuo 72h activo (fines de semana incluidos).')}
        </span>
      )}
    </div>
  );
}
