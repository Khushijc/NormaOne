import { Files } from 'lucide-react';
import { useMemo } from 'react';
import { Badge, Card, DateTimeText, EmptyState, Pagination, SortHeader, sortRows, usePaged, useSort } from '../../components/ui';
import type { ExportJob } from '../../domain/types';
import { scopeLabel } from '../../components/bits';
import { t } from '../../i18n';
import { canSeeHealth, userName } from '../../services/context';
import { REPORTS, visibleExports } from '../../services/reportService';
import { useCtx } from '../../store/hooks';

const reportTitle = (kind: string) => REPORTS.find((r) => r.id === kind)?.title ?? kind;

/**
 * Exports generated in the active company. Users with audit access see all exports; others see
 * their own. Exports of the restricted health report are listed only to health-authorised users.
 */
export function ExportHistory() {
  const ctx = useCtx();
  const jobs = useMemo(() => visibleExports(ctx), [ctx]);
  const { sort, onSort } = useSort('generatedAt', 'desc');
  const rows = useMemo(
    () =>
      sortRows<ExportJob>(jobs, sort, (j, c) => {
        switch (c) {
          case 'report':
            return t(reportTitle(j.kind));
          case 'recipient':
            return j.recipient ?? '';
          case 'recordCount':
            return j.recordCount;
          case 'openItems':
            return j.openItems;
          case 'by':
            return userName(ctx.db, j.generatedBy);
          default:
            return j.generatedAt;
        }
      }),
    [jobs, sort, ctx.db],
  );
  const paged = usePaged(rows, 10);

  return (
    <Card
      flush
      title={
        <h2 className="row">
          <Files size={16} aria-hidden /> {t('Historial de exportaciones')}
        </h2>
      }
    >
      <p className="tiny muted control-pad">
        {ctx.can('audit.view')
          ? canSeeHealth(ctx)
            ? t('Exportaciones de la empresa activa, incluidas las del informe restringido de aptitud.')
            : t('Exportaciones de la empresa activa. Las exportaciones del informe restringido de aptitud no se muestran a su rol.')
          : t('Solo se muestran las exportaciones que ha generado usted.')}
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={Files} title={t('Todavía no hay exportaciones')}>
          {t('Cada exportación generada aparecerá aquí con su destinatario, sus registros, los pendientes declarados y su huella de demostración.')}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Historial de exportaciones')}</caption>
              <thead>
                <tr>
                  <th>{t('Archivo')}</th>
                  <SortHeader label={t('Informe')} col="report" sort={sort} onSort={onSort} />
                  <SortHeader label={t('Destinatario')} col="recipient" sort={sort} onSort={onSort} />
                  <SortHeader label={t('Registros')} col="recordCount" sort={sort} onSort={onSort} num />
                  <SortHeader label={t('Pendientes declarados')} col="openItems" sort={sort} onSort={onSort} num />
                  <th>{t('Redacción')}</th>
                  <SortHeader label={t('Generado por')} col="by" sort={sort} onSort={onSort} />
                  <SortHeader label={t('Generado')} col="generatedAt" sort={sort} onSort={onSort} />
                  <th>{t('Huella demo')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((j) => (
                  <tr key={j.id}>
                    <td className="small">
                      <span className="mono control-break">{j.fileName}</span>
                      <div className="sub">{j.format.toUpperCase()}</div>
                    </td>
                    <td className="small">
                      {t(reportTitle(j.kind))}
                      <div className="sub control-break">{scopeLabel(j.scope)}</div>
                    </td>
                    <td className="small">{j.recipient ? t(j.recipient) : <span className="muted">—</span>}</td>
                    <td className="num">{j.recordCount}</td>
                    <td className="num">{j.openItems}</td>
                    <td>{j.redacted ? <Badge tone="accent">{t('Redactado')}</Badge> : <span className="small muted">{t('Sin redacción')}</span>}</td>
                    <td className="small">{userName(ctx.db, j.generatedBy)}</td>
                    <td className="small">
                      <DateTimeText at={j.generatedAt} tz={ctx.company.timezone} />
                    </td>
                    <td className="small">
                      <span className="mono" title={t('Huella de demostración no criptográfica')}>{j.fingerprint}</span>
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
  );
}
