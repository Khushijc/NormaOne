import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { evaluateRightsDeadline, formatDate } from '../domain/time';
import { Badge } from './ui';
import { t } from '../i18n';

export function CalendarMonthBadge({
  effectiveDeadline,
  isClosed,
  hasExtension,
}: {
  effectiveDeadline: string;
  isClosed: boolean;
  hasExtension?: boolean;
}) {
  const evalResult = evaluateRightsDeadline(effectiveDeadline, isClosed);

  if (isClosed) {
    return (
      <Badge tone="success" icon={CheckCircle2}>
        {t('Resuelto')} ({formatDate(effectiveDeadline)})
      </Badge>
    );
  }

  if (evalResult.status === 'overdue') {
    return (
      <Badge tone="danger" icon={AlertCircle}>
        {t('Vencido')} ({Math.abs(evalResult.daysRemaining)}d · {formatDate(effectiveDeadline)})
      </Badge>
    );
  }

  if (evalResult.status === 'approaching') {
    return (
      <Badge tone="warning" icon={AlertTriangle}>
        {t('Próximo')} ({evalResult.daysRemaining}d · {formatDate(effectiveDeadline)})
      </Badge>
    );
  }

  return (
    <Badge tone={hasExtension ? 'info' : 'neutral'} icon={Clock}>
      {hasExtension ? t('Prorrogado') : t('En plazo')} ({evalResult.daysRemaining}d · {formatDate(effectiveDeadline)})
    </Badge>
  );
}
