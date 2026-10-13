import {
  CheckCircle2,
  Download,
  Lock,
} from 'lucide-react';
import { useState } from 'react';
import {
  generateReportCsv,
  REPORTS,
} from '../services/reportService';
import { useCtx } from '../store/hooks';
import {
  Badge,
  Button,
  Card,
  Table,
  useToast,
} from '../components/ui';
import { t } from '../i18n';

export function ReportsPage() {
  const ctx = useCtx();
  const toast = useToast();

  const [selectedReportId, setSelectedReportId] = useState<string>('ropa_inventory');
  const [downloading, setDownloading] = useState(false);

  const canUnredacted = ctx.can('reports.export_unredacted');
  const currentReport = REPORTS.find((r) => r.id === selectedReportId) ?? REPORTS[0];

  const handleDownloadCsv = () => {
    try {
      setDownloading(true);
      const { csv, filename } = generateReportCsv(selectedReportId);

      // Create browser blob and trigger download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(
        canUnredacted
          ? t('Exportación CSV generada (Versión íntegra autorizada).')
          : t('Exportación CSV generada con campos confidenciales anonimizados según su rol.')
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setDownloading(false);
    }
  };

  // Sample preview rows
  const { csv } = generateReportCsv(selectedReportId);
  const lines = csv.split('\n').filter(Boolean);
  const headers = lines[0]?.split(';') ?? [];
  const previewRows = lines.slice(1, 6).map((l) => l.split(';'));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Informes y Exportaciones de Privacidad')}</h1>
          <p className="page-subtitle">
            {t(
              'Generación de libros oficiales para inspección de la AEPD y cuadros de mando. Las exportaciones aplican redacción y anonimización de campos sensibles según el rol activo.'
            )}
          </p>
        </div>
      </div>

      {/* Redaction Notice Banner (Scenario 12) */}
      <div
        className="p-4 rounded border text-sm"
        style={{
          background: canUnredacted ? 'var(--info-bg)' : 'var(--surface-2)',
          borderColor: canUnredacted ? 'var(--info)' : 'var(--border)',
        }}
      >
        <div className="row items-center gap-2 mb-1">
          {canUnredacted ? (
            <Badge tone="info" icon={CheckCircle2}>
              {t('Modo Completo / Sin Redacción')}
            </Badge>
          ) : (
            <Badge tone="warning" icon={Lock}>
              {t('Modo Redactado por Rol')}
            </Badge>
          )}
          <span className="strong">
            {canUnredacted
              ? t('Rol con acceso completo a datos confidenciales ({role})', { role: ctx.roles[0] })
              : t('Redacción de seguridad activa para el rol {role}', { role: ctx.roles[0] })}
          </span>
        </div>
        <p className="tiny text-muted">
          {canUnredacted
            ? t(
                'Como Responsable de Privacidad o DPO, sus informes contienen los datos íntegros de interesados y descripciones sensibles de incidentes requeridos para trámites ante la AEPD.'
              )
            : t(
                'Los datos identificativos de interesados (emails, DNI), las descripciones técnicas de brechas y datos de categoría especial se anonimizan automáticamente para preservar el secreto profesional.'
              )}
        </p>
      </div>

      {/* Catalogue & Controls */}
      <div className="grid-3 gap-4">
        {REPORTS.map((rep) => {
          const isSelected = rep.id === selectedReportId;
          return (
            <div
              key={rep.id}
              className={`p-4 border rounded clickable hover-surface ${
                isSelected ? 'border-primary ring-1' : ''
              }`}
              style={{
                borderColor: isSelected ? 'var(--primary)' : undefined,
                background: isSelected ? 'var(--surface-sunken)' : 'var(--surface-1)',
              }}
              onClick={() => setSelectedReportId(rep.id)}
            >
              <div className="row between items-center mb-2">
                <span className="strong text-sm">{rep.title}</span>
                {isSelected && <Badge tone="info">{t('Seleccionado')}</Badge>}
              </div>
              <p className="tiny text-muted">{rep.description}</p>
            </div>
          );
        })}
      </div>

      {/* Report Preview & Download Action */}
      <Card
        title={
          <div className="row between items-center w-full">
            <span>{currentReport.title}</span>
            <Button
              variant="primary"
              icon={Download}
              loading={downloading}
              onClick={handleDownloadCsv}
            >
              {t('Descargar CSV')}
            </Button>
          </div>
        }
        subtitle={t('Vista previa de las primeras líneas del archivo generado:')}
      >
        <Table>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h.replace(/"/g, '')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.length === 0 ? (
              <tr>
                <td colSpan={headers.length || 1} className="p-4 text-center text-muted">
                  {t('No hay registros disponibles para este informe.')}
                </td>
              </tr>
            ) : (
              previewRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}>
                      <span className="tiny font-mono">{cell.replace(/"/g, '')}</span>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
