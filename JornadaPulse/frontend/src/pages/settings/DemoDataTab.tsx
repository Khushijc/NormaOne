/**
 * Demo storage information and reset. localStorage is NOT secure storage: it is per browser,
 * unencrypted and limited in size. The production system keeps records server-side.
 */
import { Database as DbIcon, RotateCcw, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CollectionKey } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { resetDemoData } from '../../store/db';
import { isPersistent, KEYS, readRaw } from '../../store/storage';
import { useCtx } from '../../store/hooks';
import { Badge, Button, Callout, Card, ConfirmDialog, DateTimeText, KV, TextField, useToast } from '../../components/ui';
import { fmtNum } from '../team/employeeForms';

const CONFIRM_WORD = 'RESTABLECER';

const COUNTED: { key: CollectionKey; label: string }[] = [
  { key: 'sessions', label: tKey('Sesiones de trabajo') },
  { key: 'events', label: tKey('Eventos de fichaje') },
  { key: 'absences', label: tKey('Ausencias') },
  { key: 'corrections', label: tKey('Correcciones') },
  { key: 'audit', label: tKey('Eventos de auditoría') },
];

export function DemoDataTab() {
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | undefined>();
  const raw = readRaw(KEYS.db);
  const sizeKb = raw ? raw.length / 1024 : 0;
  const persistent = isPersistent();

  const count = (key: CollectionKey, companyOnly: boolean) => {
    const rows = ctx.db[key] as unknown as { companyId?: string }[];
    return companyOnly ? rows.filter((r) => r.companyId === ctx.company.id).length : rows.length;
  };

  return (
    <div className="stack">
      <Callout tone="warning" title={t('Almacenamiento de demostración: no es seguro')}>
        {t('Los datos se guardan solo en el almacenamiento local de este navegador (localStorage): sin cifrar, legibles por cualquier script del mismo origen, limitados a unos pocos MB y no compartidos con otros dispositivos ni usuarios. El sistema real guardará los registros en el servidor, con control de conservación de cuatro años y copias de seguridad.')}
      </Callout>

      <div className="grid-2">
        <Card title={t('Estado del almacenamiento')}>
          <KV
            items={[
              [t('Datos de demostración cargados'), <DateTimeText at={ctx.db.seededAt} tz={ctx.company.timezone} />],
              [t('Persistencia'), persistent ? <Badge tone="success">{t('localStorage de este navegador')}</Badge> : <Badge tone="danger">{t('Solo en memoria: se perderá al recargar')}</Badge>],
              [t('Tamaño aproximado'), t('{kb} KB', { kb: fmtNum(Math.round(sizeKb)) })],
              [
                t('Fallo de conexión simulado'),
                <span className="row-wrap">
                  {ctx.switches.simulateClockFailure ? <Badge tone="danger" icon={WifiOff}>{t('Activado')}</Badge> : <Badge tone="neutral">{t('Desactivado')}</Badge>}
                  <span className="tiny muted">{t('Se cambia en el menú de usuario (arriba a la derecha) → Controles de demostración.')}</span>
                </span>,
              ],
            ]}
          />
          <p className="tiny muted settings-gap">{t('Los datos de demostración se generan en la primera visita con fechas relativas a ese día, para que las vistas de «hoy» tengan datos.')}</p>
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
                    <td className="num">{fmtNum(count(c.key, true))}</td>
                    <td className="num">{fmtNum(count(c.key, false))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title={t('Restablecer datos de demostración')}>
        <div className="stack-sm">
          <p>{t('Borra todos los cambios hechos en este navegador (fichajes, solicitudes, configuración y auditoría) y vuelve a cargar el conjunto de datos inicial. No afecta a otros navegadores ni al otro prototipo del portal.')}</p>
          <div>
            <Button variant="danger-outline" icon={RotateCcw} onClick={() => { setTyped(''); setTypedError(undefined); setConfirming(true); }}>
              {t('Restablecer datos de demostración')}
            </Button>
          </div>
        </div>
      </Card>

      {confirming && (
        <ConfirmDialog
          title={t('Restablecer datos de demostración')}
          danger
          confirmLabel={t('Restablecer')}
          onClose={() => setConfirming(false)}
          message={
            <Callout tone="danger" icon={DbIcon}>
              {t('Esta acción no se puede deshacer. Se perderán todos los registros, solicitudes y eventos de auditoría creados en este navegador, y la sesión volverá al usuario de demostración inicial.')}
            </Callout>
          }
          onConfirm={() => {
            if (typed.trim() !== CONFIRM_WORD) {
              setTypedError(t('Escriba {word} para confirmar.', { word: CONFIRM_WORD }));
              return false;
            }
            try {
              resetDemoData();
            } catch (e) {
              toast.error(e);
              return false;
            }
            navigate('/');
            toast.success(t('Datos de demostración restablecidos'));
            return true;
          }}
        >
          <TextField label={t('Escriba {word} para confirmar', { word: CONFIRM_WORD })} required value={typed} onChange={(e) => setTyped(e.target.value)} error={typedError} autoComplete="off" spellCheck={false} />
        </ConfirmDialog>
      )}
    </div>
  );
}
