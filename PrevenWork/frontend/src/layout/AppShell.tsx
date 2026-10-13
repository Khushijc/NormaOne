import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  Building,
  Building2,
  ChevronDown,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  History,
  Home,
  Languages,
  LayoutGrid,
  ListChecks,
  Lock,
  Menu,
  Moon,
  RotateCcw,
  Settings,
  ShieldAlert,
  Sun,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isMembershipActive, ROLES, type Permission } from '../domain/permissions';
import { formatInstant, today as realToday } from '../domain/time';
import { LANG_LABEL, setLang, t, type Lang } from '../i18n';
import { getLoadResult, resetDemoData } from '../store/db';
import { useCtx, useLang, useTheme } from '../store/hooks';
import { accessibleCompanies, markNotificationRead, myNotifications, switchIdentity } from '../services/opsService';
import { Badge, Button, ConfirmDialog, useToast } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm: Permission[];
  count?: number;
  restricted?: boolean;
  end?: boolean;
}

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onOut();
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [ref, onOut]);
}

/** Permissions required to open each section (also used by route guards) */
export const SECTION_PERMS = {
  ropa: ['ropa.view', 'ropa.manage', 'ropa.review'] as Permission[],
  rights: ['rights.view', 'rights.manage'] as Permission[],
  incidents: ['incidents.view_summary', 'incidents.view_restricted'] as Permission[],
  documents: ['documents.view', 'documents.manage', 'documents.approve'] as Permission[],
  suppliers: ['suppliers.view', 'suppliers.manage', 'suppliers.review'] as Permission[],
  retention: ['retention.view', 'retention.manage', 'retention.erase'] as Permission[],
  tasks: ['tasks.view_own', 'tasks.view_all', 'tasks.manage'] as Permission[],
  reports: ['reports.view', 'reports.export_standard', 'reports.export_unredacted'] as Permission[],
  audit: ['audit.view'] as Permission[],
  settings: ['settings.manage'] as Permission[],
};

export function AppShell({ children }: { children: ReactNode }) {
  const ctx = useCtx();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  const active = !!ctx.membership && ctx.perms.size > 0;

  // Real mock counters for sidebar badges
  const pendingRights = ctx.db.rightsRequests.filter(
    (r) => r.companyId === ctx.company.id && !['closed', 'rejected', 'withdrawn'].includes(r.status)
  ).length;

  const openIncidents = ctx.db.incidents.filter(
    (i) => i.companyId === ctx.company.id && i.status !== 'closed'
  ).length;

  const openTasks = ctx.db.tasks.filter(
    (t) => t.companyId === ctx.company.id && t.status !== 'completed' && t.status !== 'cancelled'
  ).length;

  const pendingDeletions = ctx.db.deletionReviews.filter(
    (d) => d.companyId === ctx.company.id && d.status === 'pending_review'
  ).length;

  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Panel y operaciones',
      items: [
        { to: '/', label: 'Visión general', icon: Home, perm: [], end: true },
        {
          to: '/tratamientos',
          label: 'Registro de tratamientos (RAT)',
          icon: FileSpreadsheet,
          perm: SECTION_PERMS.ropa,
        },
        {
          to: '/derechos',
          label: 'Solicitudes de derechos',
          icon: UserCheck,
          perm: SECTION_PERMS.rights,
          count: pendingRights || undefined,
        },
        {
          to: '/incidentes',
          label: 'Incidentes de datos',
          icon: ShieldAlert,
          perm: SECTION_PERMS.incidents,
          count: openIncidents || undefined,
          restricted: !ctx.can('incidents.view_restricted'),
        },
      ],
    },
    {
      title: 'Políticas y cadena de custodia',
      items: [
        {
          to: '/documentos',
          label: 'Documentos y políticas',
          icon: FileText,
          perm: SECTION_PERMS.documents,
        },
        {
          to: '/proveedores',
          label: 'Proveedores y encargados',
          icon: Building,
          perm: SECTION_PERMS.suppliers,
        },
        {
          to: '/conservacion',
          label: 'Conservación y supresión',
          icon: Archive,
          perm: SECTION_PERMS.retention,
          count: pendingDeletions || undefined,
        },
        {
          to: '/tareas',
          label: 'Revisiones y tareas',
          icon: ListChecks,
          perm: SECTION_PERMS.tasks,
          count: openTasks || undefined,
        },
      ],
    },
    {
      title: 'Control y auditoría',
      items: [
        {
          to: '/informes',
          label: 'Informes y exportaciones',
          icon: BarChart3,
          perm: SECTION_PERMS.reports,
        },
        {
          to: '/auditoria',
          label: 'Auditoría inmutable',
          icon: History,
          perm: SECTION_PERMS.audit,
        },
        {
          to: '/configuracion',
          label: 'Configuración',
          icon: Settings,
          perm: SECTION_PERMS.settings,
        },
      ],
    },
  ];

  const allowed = (p: Permission[]) => p.length === 0 || p.some((x) => ctx.can(x));

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label={t('Navegación de PrevenWork')}>
        <div className="sidebar-brand">
          <div className="portal">{t('Portal de Cumplimiento Pyme')}</div>
          <div className="module">PrevenWork</div>
          <div className="tiny" style={{ opacity: 0.8, marginTop: 2 }}>
            {t('Privacidad · RGPD / LOPDGDD')}
          </div>
        </div>

        <nav className="nav">
          {active &&
            sections.map((s) => {
              const items = s.items.filter((i) => allowed(i.perm));
              if (!items.length) return null;
              return (
                <div key={s.title} style={{ display: 'contents' }}>
                  <div className="nav-section">{t(s.title)}</div>
                  {items.map((i) => (
                    <NavLink
                      key={i.to}
                      to={i.to}
                      end={i.end ?? false}
                      className={({ isActive }) => (isActive ? 'active' : '')}
                    >
                      <i.icon size={16} aria-hidden />
                      <span className="grow">{t(i.label)}</span>
                      {i.restricted && <Lock size={12} aria-label={t('Acceso restringido a incidentes')} />}
                      {i.count !== undefined && (
                        <span className="count" aria-label={t('Pendientes: {n}', { n: i.count })}>
                          {i.count}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              );
            })}
        </nav>

        <div className="sidebar-foot">
          {t('Prototipo de operaciones de privacidad (RGPD / LOPDGDD).')}
          <br />
          {t('Este software coordina evidencias operativas para pymes españolas; no constituye asesoramiento jurídico ni garantiza el cumplimiento regulatorio.')}
        </div>
      </aside>

      <div className="main">
        <TopBar onMenu={() => setNavOpen((v) => !v)} />
        <DemoBanner />
        <main className="content" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}

function DemoBanner() {
  const load = getLoadResult();
  return (
    <>
      <div className="demo-banner" role="note">
        <FlaskConical size={14} aria-hidden />
        <span>
          <strong>{t('Prototipo interactivo con datos ficticios.')}</strong>{' '}
          {t(
            'Los cambios se persisten en el almacenamiento local de este navegador (localStorage). Sin conexión con la AEPD ni envío real de correos electrónicos.'
          )}
        </span>
      </div>
      {load.message && (
        <div
          className="demo-banner"
          style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
          role="alert"
        >
          <AlertTriangle size={14} aria-hidden />
          {t(load.message)}
        </div>
      )}
    </>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="topbar">
      <Button
        className="mobile-nav-toggle"
        variant="ghost"
        iconOnly
        icon={Menu}
        aria-label={t('Abrir menú')}
        onClick={onMenu}
      />
      <PortalAppSwitcher />
      <CompanySwitcher />
      <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
        <ActiveRoleBadge />
        <ThemeToggle />
        <LanguageToggle />
        <NotificationsBell />
        <UserSwitcher />
      </div>
    </header>
  );
}

function ActiveRoleBadge() {
  const ctx = useCtx();
  const primaryRole = ctx.roles[0];
  if (!primaryRole) return null;
  const roleDef = ROLES[primaryRole];

  return (
    <div className="hide-sm">
      <Badge
        tone={
          primaryRole === 'privacy_lead'
            ? 'success'
            : primaryRole === 'dpo_adviser'
            ? 'info'
            : primaryRole === 'owner'
            ? 'warning'
            : 'neutral'
        }
        title={roleDef?.description}
      >
        {roleDef ? t(roleDef.label) : primaryRole}
      </Badge>
    </div>
  );
}

function PortalAppSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));

  const apps = [
    { name: 'NormaOne', desc: 'Portal Central de Cumplimiento', port: 3000, current: false },
    { name: 'FacturaFlow', desc: 'Facturación y Cumplimiento', port: 3001, current: false },
    { name: 'JornadaPulse', desc: 'Registro de Jornada y Turnos', port: 3002, current: false },
    { name: 'DatosPilot', desc: 'PRL y Coordinación de Evidencias', port: 3003, current: false },
    { name: 'PrevenWork', desc: 'Privacidad y Operaciones RGPD', port: 3004, current: true },
    { name: 'BuzonDesk', desc: 'Canal de Denuncias (Ley 2/2023)', port: 3005, current: false },
    { name: 'SafeVoice', desc: 'Comunicaciones y Alertas Pyme', port: 3006, current: false },
  ];

  return (
    <div className="dropdown" ref={ref}>
      <button
        className="btn ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={t('Módulos del portal')}
        style={{ height: 40 }}
      >
        <LayoutGrid size={16} aria-hidden />
        <span className="hide-sm strong">{t('Módulos')}</span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open && (
        <div className="dropdown-menu" role="menu" style={{ width: 320, left: 0, right: 'auto' }}>
          <div className="group">{t('Suite de Cumplimiento super_one')}</div>
          {apps.map((a) => (
            <a
              key={a.name}
              href={a.current ? '#' : `http://localhost:${a.port}`}
              onClick={(e) => {
                if (a.current) {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              className={`item ${a.current ? 'active' : ''}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="grow">
                <div className="row items-center gap-1">
                  <span className="strong">{a.name}</span>
                  {a.current && <Badge tone="info">{t('Activo')}</Badge>}
                </div>
                <div className="tiny muted">{a.desc}</div>
              </div>
              {!a.current && <ExternalLink size={13} className="muted" />}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro');
  return (
    <button
      type="button"
      className="btn ghost icon theme-toggle"
      style={{ position: 'relative', height: 40, width: 40 }}
      title={label}
      aria-label={label}
      onClick={toggleTheme}
    >
      {theme === 'dark' ? <Sun size={18} aria-hidden style={{ color: 'var(--warning)' }} /> : <Moon size={18} aria-hidden />}
    </button>
  );
}

function LanguageToggle() {
  const lang = useLang();
  return (
    <div className="segmented lang-toggle" role="group" aria-label={t('Idioma de la interfaz')}>
      <Languages size={15} aria-hidden className="lang-icon" />
      {(['es', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          title={l === 'en' ? t('Cambiar a inglés') : t('Cambiar a español')}
          aria-label={LANG_LABEL[l]}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function CompanySwitcher() {
  const ctx = useCtx();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const navigate = useNavigate();
  const companies = accessibleCompanies(ctx.db, ctx.user.id);

  return (
    <div className="dropdown" ref={ref}>
      <button
        className="btn ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ height: 40 }}
      >
        <Building2 size={16} aria-hidden />
        <span style={{ textAlign: 'left', lineHeight: 1.2 }}>
          <span className="tiny muted" style={{ display: 'block' }}>
            {t('Empresa activa')}
          </span>
          <span className="strong">{ctx.company.tradeName}</span>
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open && (
        <div className="dropdown-menu" role="menu" style={{ left: 0, right: 'auto' }}>
          <div className="group">{t('Seleccione la empresa para operar')}</div>
          {companies.length === 0 && <div className="item muted">{t('Sin empresas accesibles')}</div>}
          {companies.map(({ company, membership, active }) => (
            <button
              key={company.id}
              role="menuitem"
              className="item"
              aria-current={company.id === ctx.company.id}
              onClick={() => {
                switchIdentity(ctx.user.id, company.id);
                setOpen(false);
                navigate('/');
              }}
            >
              <Building2 size={16} aria-hidden />
              <span className="grow">
                <span className="strong" style={{ display: 'block' }}>
                  {company.legalName}
                </span>
                <span className="tiny muted">
                  {company.nif} · {membership.roles.map((r) => t(ROLES[r].label)).join(', ')}
                </span>
              </span>
              {!active && <Badge tone="danger">{t('Sin acceso vigente')}</Badge>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserSwitcher() {
  const ctx = useCtx();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const navigate = useNavigate();
  const now = realToday();

  const groups = ctx.db.companies.map((c) => ({
    company: c,
    people: ctx.db.memberships
      .filter((m) => m.companyId === c.id)
      .map((m) => ({ m, u: ctx.db.users.find((u) => u.id === m.userId)! }))
      .filter((x) => x.u),
  }));

  return (
    <div className="dropdown" ref={ref}>
      <button
        className="btn ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ height: 40 }}
      >
        <span className="avatar" aria-hidden>
          {initials(ctx.user.name)}
        </span>
        <span style={{ textAlign: 'left', lineHeight: 1.2 }} className="hide-sm">
          <span className="strong" style={{ display: 'block' }}>
            {ctx.user.name}
          </span>
          <span className="tiny muted">
            {ctx.roles.length ? ctx.roles.map((r) => t(ROLES[r].label)).join(', ') : t('Sin acceso')}
          </span>
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open && (
        <div className="dropdown-menu" role="menu" style={{ minWidth: 360, maxHeight: '75vh', overflowY: 'auto' }}>
          <div className="group" style={{ paddingBottom: 6 }}>
            <Badge tone="warning" icon={FlaskConical}>
              {t('Cambio de rol de demostración')}
            </Badge>
            <div className="tiny muted" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 4 }}>
              {t(
                'Permite verificar cómo responde la interfaz a los diferentes permisos (Titular, Responsable de Privacidad, Tramitador, Empleado, DPO Asesor o Auditor).'
              )}
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.company.id}>
              <div className="group">{g.company.tradeName}</div>
              {g.people.map(({ m, u }) => {
                const active = isMembershipActive(m, now);
                return (
                  <button
                    key={m.id}
                    role="menuitem"
                    className="item"
                    aria-current={u.id === ctx.user.id && g.company.id === ctx.company.id}
                    onClick={() => {
                      switchIdentity(u.id, g.company.id);
                      setOpen(false);
                      navigate('/');
                    }}
                  >
                    <span className="avatar" aria-hidden>
                      {initials(u.name)}
                    </span>
                    <span className="grow">
                      <span className="strong" style={{ display: 'block' }}>
                        {u.name}
                      </span>
                      <span className="tiny muted">
                        {m.roles.map((r) => t(ROLES[r].label)).join(', ')}
                        {u.organisation ? ` · ${u.organisation}` : ''}
                      </span>
                    </span>
                    {!active && <Badge tone="danger">{t('Acceso caducado')}</Badge>}
                  </button>
                );
              })}
            </div>
          ))}

          <div className="group">{t('Controles de demostración')}</div>
          <button role="menuitem" className="item" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={15} aria-hidden />
            <span className="grow">{t('Restablecer datos iniciales')}</span>
          </button>
        </div>
      )}

      {confirmReset && (
        <ConfirmDialog
          title={t('Restablecer datos de demostración')}
          message={t(
            'Se restablecerá la base de datos de demostración de PrevenWork a su estado inicial. Se perderán las modificaciones locales guardadas en este navegador.'
          )}
          confirmLabel={t('Restablecer')}
          danger
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            resetDemoData();
            setConfirmReset(false);
            setOpen(false);
            navigate('/');
            toast.success(t('Datos restablecidos al estado inicial'));
          }}
        />
      )}
    </div>
  );
}

function NotificationsBell() {
  const ctx = useCtx();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const navigate = useNavigate();
  const items = myNotifications(ctx.db, ctx.user.id, ctx.company.id);
  const unread = items.filter((n) => !n.readBy.includes(ctx.user.id)).length;

  return (
    <div className="dropdown" ref={ref}>
      <button
        className="btn ghost icon"
        style={{ position: 'relative', height: 40, width: 40 }}
        aria-label={t('Avisos: {n} sin leer', { n: unread })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} aria-hidden />
        {unread > 0 && <span className="bell-count" aria-hidden>{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="dropdown-menu" role="menu" style={{ width: 380 }}>
          <div className="row between" style={{ padding: '4px 8px 8px' }}>
            <span className="strong">{t('Avisos')}</span>
            <span className="tiny muted">{unread} {t('sin leer')}</span>
          </div>

          {items.length === 0 && <div className="item muted">{t('No hay avisos pendientes.')}</div>}

          {items.slice(0, 8).map((n) => (
            <button
              key={n.id}
              role="menuitem"
              className="item"
              onClick={() => {
                markNotificationRead(n.id, ctx.user.id);
                setOpen(false);
                navigate(n.link);
              }}
            >
              {!n.readBy.includes(ctx.user.id) ? (
                <span className="unread-dot" aria-label={t('Sin leer')} />
              ) : (
                <span style={{ width: 8 }} />
              )}
              <span className="grow">
                <span className={n.readBy.includes(ctx.user.id) ? '' : 'strong'} style={{ display: 'block' }}>
                  {t(n.title)}
                </span>
                <span className="tiny muted">
                  {t(n.body)} · {formatInstant(n.createdAt)}
                </span>
              </span>
            </button>
          ))}

          <div className="tiny muted" style={{ padding: '6px 10px' }}>
            {t('Los avisos no incluyen datos sensibles de incidentes.')}
          </div>
        </div>
      )}
    </div>
  );
}
