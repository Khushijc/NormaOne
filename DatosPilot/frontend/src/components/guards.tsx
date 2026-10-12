import { Lock, SearchX, ShieldAlert } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Permission } from '../domain/permissions';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { logAreaView, recordDeniedAccess } from '../services/healthService';
import { Card, EmptyState } from './ui';

/** UI-level route guard. Services re-check every action; this only avoids showing unusable screens. */
export function RequirePerm({ perm, children }: { perm: Permission | Permission[]; children: ReactNode }) {
  const ctx = useCtx();
  const list = Array.isArray(perm) ? perm : [perm];
  if (!ctx.membership) return <NoMembership />;
  if (!list.some((p) => ctx.can(p))) {
    return (
      <Card>
        <EmptyState icon={Lock} title={t('Esta sección no está disponible para su rol')}>
          {t('Su rol en {company} no incluye este permiso ({perms}). En producción, el servidor también rechazará cualquier acceso directo.', { company: ctx.company.tradeName, perms: list.join(` ${t('o')} `) })}
        </EmptyState>
      </Card>
    );
  }
  return <>{children}</>;
}

export function NoMembership() {
  const ctx = useCtx();
  return (
    <Card>
      <EmptyState icon={Lock} title={t('Sin acceso activo a esta empresa')}>
        {t('{user} no tiene una autorización vigente en {company} (revocada, caducada o inexistente). Las lecturas, descargas y acciones están bloqueadas. Seleccione otra empresa o usuario de demostración.', { user: ctx.user.name, company: ctx.company.legalName })}
      </EmptyState>
    </Card>
  );
}

/** Shown for unknown ids and for records of another company (AC-PLT-01: indistinguishable). */
export function RecordNotFound({ back, label }: { back: string; label: string }) {
  return (
    <Card>
      <EmptyState icon={SearchX} title={t('Registro no disponible')} action={<Link to={back} className="btn">{t('Volver a {label}', { label: t(label) })}</Link>}>
        {t('El registro no existe o no pertenece a la empresa activa. Por aislamiento entre empresas, ambos casos se muestran igual.')}
      </EmptyState>
    </Card>
  );
}

/**
 * Guard for the restricted health area. Unlike ordinary sections, a denied attempt is AUDITED
 * (restricted event) so that access attempts to health-related content are traceable (AC-PRL-03).
 */
export function HealthGuard({ children }: { children: ReactNode }) {
  const ctx = useCtx();
  const allowed = ctx.can('health.view_conclusions') || ctx.can('health.manage');
  useEffect(() => {
    if (ctx.membership && ctx.perms.size && !allowed) recordDeniedAccess('Área restringida de salud (acceso directo por dirección)');
    if (allowed) logAreaView();
  }, [allowed, ctx.membership, ctx.perms.size, ctx.user.id]);
  if (!ctx.membership) return <NoMembership />;
  if (!allowed) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title={t('Área restringida')}>
          {t('Solo el personal sanitario autorizado y la coordinación de PRL pueden abrir esta área. El intento de acceso ha quedado registrado en la auditoría.')}
        </EmptyState>
      </Card>
    );
  }
  return <>{children}</>;
}
