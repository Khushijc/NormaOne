import { Lock, ShieldAlert, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Permission } from '../domain/permissions';
import { useCtx } from '../store/hooks';
import { Button, Card, EmptyState } from './ui';
import { t } from '../i18n';

export function RequirePerm({
  perm,
  children,
}: {
  perm: Permission | Permission[];
  children: ReactNode;
}) {
  const ctx = useCtx();
  const perms = Array.isArray(perm) ? perm : [perm];
  const allowed = perms.some((p) => ctx.can(p));

  if (!allowed) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="Acceso restringido"
          action={
            <Button variant="secondary" onClick={() => window.history.back()}>
              {t('Volver')}
            </Button>
          }
        >
          {t(
            'Su rol actual ({role}) no dispone de los permisos necesarios para acceder a esta sección. Utilice el selector de usuario en la barra superior si desea probar la vista con otro perfil de demostración.',
            { role: ctx.roles[0] ?? 'sin rol' }
          )}
        </EmptyState>
      </Card>
    );
  }

  return <>{children}</>;
}

export function SensitiveIncidentGuard({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = useCtx();
  const allowed = ctx.can('incidents.view_restricted');

  if (!allowed) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="Detalle confidencial de incidente restringido"
          action={
            <Button variant="secondary" onClick={() => window.history.back()}>
              {t('Volver al registro general')}
            </Button>
          }
        >
          {t(
            'El contenido sensible y la descripción técnica de las brechas de seguridad están reservados estrictamente al Responsable de Privacidad y al DPO / Asesor de Protección de Datos (Art. 33.5 RGPD). Los intentos de inspección quedan registrados en la auditoría.'
          )}
        </EmptyState>
      </Card>
    );
  }

  return <>{children}</>;
}

export function NoMembership() {
  return (
    <Card>
      <EmptyState icon={UserX} title="Sin membresía activa">
        {t(
          'El usuario seleccionado no tiene una asignación vigente en esta empresa. Seleccione otra empresa o cambie de usuario en el menú superior.'
        )}
      </EmptyState>
    </Card>
  );
}
