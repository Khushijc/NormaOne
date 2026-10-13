import {
  Info,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resetDemoData } from '../store/db';
import { useCtx } from '../store/hooks';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  useToast,
} from '../components/ui';
import { t } from '../i18n';

export function SettingsPage() {
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Configuración y Parámetros de Privacidad')}</h1>
          <p className="page-subtitle">
            {t(
              'Parámetros organizativos de {name}, designación del Delegado de Protección de Datos (DPO) y controles de demostración.',
              { name: ctx.company.tradeName }
            )}
          </p>
        </div>
      </div>

      {/* Company Identity Card */}
      <Card
        title={t('Datos de la Empresa Responsable')}
        subtitle={t('Identificación corporativa para el encabezado del RAT e informes oficiales')}
      >
        <div className="grid-2 gap-4 text-sm">
          <div>
            <span className="muted block tiny">{t('Razón social:')}</span>
            <span className="strong">{ctx.company.legalName}</span>
          </div>
          <div>
            <span className="muted block tiny">{t('NIF / CIF:')}</span>
            <span className="font-mono strong">{ctx.company.nif}</span>
          </div>
          <div>
            <span className="muted block tiny">{t('Actividad económica:')}</span>
            <span>{ctx.company.activity}</span>
          </div>
          <div>
            <span className="muted block tiny">{t('Domicilio social:')}</span>
            <span>{ctx.company.registeredAddress}</span>
          </div>
        </div>
      </Card>

      {/* DPO / External Privacy Adviser Status */}
      <Card
        title={t('Delegado de Protección de Datos (DPO / DPD)')}
        subtitle={t('Art. 37 RGPD y Art. 34 LOPDGDD')}
      >
        <div className="space-y-4">
          <div className="row items-center gap-3">
            <Badge tone={ctx.company.hasDpo ? 'success' : 'neutral'}>
              {ctx.company.hasDpo ? t('DPO Designado formalmente') : t('Sin DPO preceptivo')}
            </Badge>
            <span className="text-sm">
              {ctx.company.hasDpo
                ? t('Designación voluntaria o preceptiva comunicada a la AEPD.')
                : t('Las actividades habituales de la empresa no requieren nombramiento obligatorio de DPO.')}
            </span>
          </div>

          {ctx.company.hasDpo && (
            <div className="p-3 bg-surface-2 rounded text-sm">
              <span className="muted block tiny">{t('Datos de contacto del DPO:')}</span>
              <span className="strong">{ctx.company.dpoContact}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Local Storage & Prototype Controls */}
      <Card
        title={t('Almacenamiento Local y Datos de Demostración')}
        subtitle={t('Gestión de la base de datos simulada en este navegador')}
      >
        <div className="space-y-4">
          <div className="p-3 bg-surface-2 rounded text-sm space-y-1">
            <div className="row between">
              <span>{t('Actividades de tratamiento (RAT):')}</span>
              <span className="strong">{ctx.db.ropaActivities.length}</span>
            </div>
            <div className="row between">
              <span>{t('Solicitudes de derechos:')}</span>
              <span className="strong">{ctx.db.rightsRequests.length}</span>
            </div>
            <div className="row between">
              <span>{t('Incidentes de seguridad registrados:')}</span>
              <span className="strong">{ctx.db.incidents.length}</span>
            </div>
            <div className="row between">
              <span>{t('Documentos y políticas:')}</span>
              <span className="strong">{ctx.db.documents.length}</span>
            </div>
            <div className="row between">
              <span>{t('Eventos en la cadena de auditoría:')}</span>
              <span className="strong">{ctx.db.audit.length}</span>
            </div>
          </div>

          <div>
            <Button
              variant="danger"
              icon={RotateCcw}
              onClick={() => setConfirmReset(true)}
            >
              {t('Restablecer datos de demostración')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Legal Prototype Disclaimer */}
      <div className="p-4 bg-surface-2 rounded border text-xs text-muted space-y-1">
        <div className="strong text-foreground flex items-center gap-1">
          <Info size={14} />
          <span>{t('Aviso sobre la naturaleza del prototipo PrevenWork')}</span>
        </div>
        <p>
          {t(
            'PrevenWork es una maqueta de interfaz interactiva creada como parte del portal de cumplimiento para pymes españolas (super_one). Los cálculos de plazos, registros RAT y evaluaciones de proveedores son demostrativos y no garantizan el cumplimiento de las obligaciones del RGPD ni de la LOPDGDD ni sustituyen la asesoría letrada especializada.'
          )}
        </p>
      </div>

      {/* Confirm Reset Dialog */}
      {confirmReset && (
        <ConfirmDialog
          title={t('Restablecer datos de demostración')}
          message={t(
            'Se restablecerá la base de datos local al estado inicial de demostración. Se perderán los tratamientos, solicitudes y documentos creados durante esta sesión.'
          )}
          confirmLabel={t('Restablecer todo')}
          danger
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            resetDemoData();
            setConfirmReset(false);
            navigate('/');
            toast.success(t('Base de datos restablecida al estado inicial'));
          }}
        />
      )}
    </div>
  );
}
