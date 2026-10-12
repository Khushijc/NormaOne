/**
 * Demo storage information and reset. localStorage is NOT secure storage: it is per browser,
 * unencrypted and limited in size. There is no real database behind this prototype.
 */
import { Database as DbIcon, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Callout, Card, ConfirmDialog, DateTimeText, KV, useToast } from '../../components/ui';
import type { CollectionKey } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { resetDemoData } from '../../store/db';
import { useCtx } from '../../store/hooks';
import { isPersistent, KEYS, readRaw } from '../../store/storage';

const COUNTED: { key: CollectionKey; label: string }[] = [
  { key: 'employees', label: tKey('Empleados') },
  { key: 'documents', label: tKey('Documentos') },
  { key: 'docVersions', label: tKey('Versiones de documentos') },
  { key: 'versions', label: tKey('Versiones de requisitos') },
  { key: 'actions', label: tKey('Acciones preventivas') },
  { key: 'caeExchanges', label: tKey('Intercambios CAE') },
  { key: 'exports', label: tKey('Exportaciones') },
  { key: 'audit', label: tKey('Eventos de auditoría') },
];

export function SettingsDemoTab() {
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const raw = readRaw(KEYS.db);
  const sizeKb = raw ? Math.round(raw.length / 1024) : 0;
  const persistent = isPersistent();

  const count = (key: CollectionKey, companyOnly: boolean) => {
    const rows = ctx.db[key] as unknown as { companyId?: string }[];
    return companyOnly ? rows.filter((r) => r.companyId === ctx.company.id).length : rows.length;
  };

  return (
    <div className="stack">
      <Callout tone="warning" title={t('Almacenamiento de demostración: no es seguro')}>
        {t('Este prototipo no tiene base de datos real. Los datos se guardan solo en el almacenamiento local de este navegador (localStorage): sin cifrar, legibles por cualquier script del mismo origen, limitados a unos pocos MB y no compartidos con otros dispositivos ni usuarios. No introduzca datos personales reales ni documentos de salud.')}
      </Callout>

      <div className="grid-2">
        <Card title={t('Estado del almacenamiento')} className="control-demo">
          <KV
            items={[
              [t('Datos de demostración cargados'), <DateTimeText at={ctx.db.seededAt} tz={ctx.company.timezone} />],
              [t('Persistencia'), persistent ? <Badge tone="warning">{t('localStorage de este navegador')}</Badge> : <Badge tone="danger">{t('Solo en memoria: se perderá al recargar')}</Badge>],
              [t('Tamaño aproximado'), t('{kb} KB', { kb: sizeKb })],
            ]}
          />
          <p className="tiny muted control-gap">{t('Los datos de demostración se generan en la primera visita con fechas relativas a ese día. En producción, los registros se guardarán en el servidor con control de acceso, copias de seguridad y conservación definida.')}</p>
        </Card>

        <Card title={t('Registros guardados')} flush>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Registros guardados en este navegador')}</caption>
              <thead>
                <tr>
                  <th>{t('Colección')}</th>
                  <th className="num">{ctx.company.tradeName}</th>
                  <th className="num">{t('Todo el navegador')}</th>
                </tr>
              </thead>
              <tbody>
                {COUNTED.map((c) => (
                  <tr key={c.key}>
                    <td>{t(c.label)}</td>
                    <td className="num">{count(c.key, true)}</td>
                    <td className="num">{count(c.key, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title={t('Restablecer los datos de demostración')}>
        <div className="stack-sm">
          <p className="small">{t('Borra todos los cambios hechos en este navegador (documentos, revisiones, configuración, exportaciones y auditoría) de todas las empresas de demostración y vuelve a cargar el conjunto de datos inicial. La sesión vuelve al usuario de demostración inicial.')}</p>
          <div>
            <Button variant="danger-outline" icon={RotateCcw} onClick={() => setConfirming(true)}>
              {t('Restablecer los datos de demostración')}
            </Button>
          </div>
        </div>
      </Card>

      {confirming && (
        <ConfirmDialog
          title={t('Restablecer los datos de demostración')}
          danger
          confirmLabel={t('Restablecer ahora')}
          onClose={() => setConfirming(false)}
          message={
            <Callout tone="danger" icon={DbIcon}>
              {t('Esta acción no se puede deshacer. Se perderán todos los registros y eventos de auditoría creados en este navegador.')}
            </Callout>
          }
          onConfirm={() => {
            try {
              resetDemoData();
            } catch (e) {
              toast.error(e);
              return false;
            }
            navigate('/');
            toast.success(t('Datos de demostración restablecidos en este navegador'));
            return true;
          }}
        />
      )}
    </div>
  );
}
