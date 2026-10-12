import {
  AlertTriangle,
  Bell,
  BookCheck,
  Building2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  FileStack,
  FlaskConical,
  GraduationCap,
  HardHat,
  Handshake,
  History,
  Home,
  Languages,
  ListChecks,
  Lock,
  Menu,
  Moon,
  RotateCcw,
  Settings,
  ShieldAlert,
  BarChart3,
  Stethoscope,
  Sun,
  TriangleAlert,
  Users,
  MapPin,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isMembershipActive, ROLES, type Permission } from '../domain/permissions';
import { formatInstant, today as realToday } from '../domain/time';
import { LANG_LABEL, setLang, t, type Lang } from '../i18n';
import { getLoadResult, resetDemoData } from '../store/db';
import { useCtx, useLang, useTheme } from '../store/hooks';
import { accessibleCompanies } from '../services/context';
import { markAllRead, markRead, myNotifications, myTasks, openCount, switchIdentity, visibleExceptions } from '../services/opsService';
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

/** Permissions that open each section (also used by the route guards in App.tsx). */
export const SECTION_PERMS = {
  requirements: ['requirements.view'] as Permission[],
  employees: ['employees.view_all', 'team.view'] as Permission[],
  worksites: ['worksites.view', 'team.view', 'representative.view'] as Permission[],
  documents: ['evidence.view_all', 'team.view', 'own.view'] as Permission[],
  training: ['training.manage', 'employees.view_all', 'team.view', 'own.view'] as Permission[],
  ppe: ['ppe.manage', 'employees.view_all', 'team.view', 'own.view'] as Permission[],
  risk: ['risk.view', 'representative.view'] as Permission[],
  actions: ['actions.view_all', 'representative.view', 'team.view', 'own.view'] as Permission[],
  cae: ['cae.view', 'representative.view'] as Permission[],
  health: ['health.view_conclusions', 'health.manage'] as Permission[],
  exceptions: ['exceptions.manage', 'readiness.view_all', 'team.view', 'health.manage'] as Permission[],
  reports: ['reports.view', 'own.view', 'health.manage'] as Permission[],
  settings: ['settings.manage'] as Permission[],
  audit: ['audit.view'] as Permission[],
};

export function AppShell({ children }: { children: ReactNode }) {
  const ctx = useCtx();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  const active = !!ctx.membership && ctx.perms.size > 0;
  const tasks = active ? myTasks(ctx).length : 0;
  const exceptions = active ? openCount(visibleExceptions(ctx)) : 0;
  const ownProfile = !!ctx.employee && !ctx.can('employees.view_all') && !ctx.can('team.view');
  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Visión general',
      items: [
        { to: '/', label: 'Inicio', icon: Home, perm: [], end: true },
        { to: '/mis-tareas', label: 'Mis tareas', icon: ListChecks, perm: [], count: tasks || undefined },
        ...(ownProfile ? [{ to: `/empleados/${ctx.employee!.id}`, label: 'Mi expediente', icon: UserRound, perm: ['own.view'] as Permission[] }] : []),
      ],
    },
    {
      title: 'Requisitos y evidencias',
      items: [
        { to: '/requisitos', label: 'Requisitos PRL', icon: ClipboardCheck, perm: SECTION_PERMS.requirements },
        { to: '/empleados', label: 'Empleados', icon: Users, perm: SECTION_PERMS.employees, end: false },
        { to: '/centros', label: 'Centros de trabajo', icon: MapPin, perm: SECTION_PERMS.worksites },
        { to: '/documentacion', label: 'Documentación', icon: FileStack, perm: SECTION_PERMS.documents },
        { to: '/formacion', label: 'Formación e información', icon: GraduationCap, perm: SECTION_PERMS.training },
        { to: '/epi', label: 'Equipos de protección (EPI)', icon: HardHat, perm: SECTION_PERMS.ppe },
      ],
    },
    {
      title: 'Prevención',
      items: [
        { to: '/evaluaciones', label: 'Evaluaciones de riesgos', icon: TriangleAlert, perm: SECTION_PERMS.risk },
        { to: '/acciones', label: 'Acciones preventivas', icon: ClipboardList, perm: SECTION_PERMS.actions },
        { to: '/cae', label: 'Coordinación CAE', icon: Handshake, perm: SECTION_PERMS.cae },
        { to: '/salud', label: 'Aptitud y vigilancia de la salud', icon: Stethoscope, perm: SECTION_PERMS.health, restricted: true },
      ],
    },
    {
      title: 'Control',
      items: [
        { to: '/incidencias', label: 'Incidencias y revisiones', icon: ShieldAlert, perm: SECTION_PERMS.exceptions, count: exceptions || undefined },
        { to: '/informes', label: 'Informes y exportaciones', icon: BarChart3, perm: SECTION_PERMS.reports },
        { to: '/configuracion', label: 'Configuración', icon: Settings, perm: SECTION_PERMS.settings },
        { to: '/auditoria', label: 'Auditoría', icon: History, perm: SECTION_PERMS.audit },
        { to: '/fuentes', label: 'Fuentes y pruebas', icon: BookCheck, perm: [] },
      ],
    },
  ];
  const allowed = (p: Permission[]) => p.length === 0 || p.some((x) => ctx.can(x));

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label={t('Navegación de DatosPilot')}>
        <div className="sidebar-brand">
          <div className="portal">{t('Portal de Cumplimiento Pyme')}</div>
          <div className="module">DatosPilot</div>
          <div className="tiny" style={{ opacity: 0.75, marginTop: 2 }}>{t('PRL y Documentación')}</div>
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
                    <NavLink key={i.to} to={i.to} end={i.end ?? false} className={({ isActive }) => (isActive ? 'active' : '')}>
                      <i.icon size={16} aria-hidden />
                      <span className="grow">{t(i.label)}</span>
                      {i.restricted && <Lock size={12} aria-label={t('Área restringida')} />}
                      {i.count !== undefined && <span className="count" aria-label={t('Pendientes: {n}', { n: i.count })}>{i.count}</span>}
                    </NavLink>
                  ))}
                </div>
              );
            })}
        </nav>
        <div className="sidebar-foot">
          {t('Prototipo de interfaz · datos de demostración.')}
          <br />
          {t('Coordina evidencias; no sustituye al servicio de prevención ni certifica el cumplimiento legal o la seguridad de los puestos.')}
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
          <strong>{t('Prototipo con datos ficticios.')}</strong> {t('Los datos y archivos de demostración se guardan solo en este navegador (no es almacenamiento seguro). No se guardan informes clínicos.')}
        </span>
      </div>
      {load.message && (
        <div className="demo-banner" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">
          <AlertTriangle size={14} aria-hidden />
          {t(load.message.text, load.message.params)}
        </div>
      )}
    </>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="topbar">
      <Button className="mobile-nav-toggle" variant="ghost" iconOnly icon={Menu} aria-label={t('Abrir menú')} onClick={onMenu} />
      <CompanySwitcher />
      <div className="row" style={{ marginLeft: 'auto' }}>
        <ThemeToggle />
        <LanguageToggle />
        <NotificationsBell />
        <UserSwitcher />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro');
  return (
    <button type="button" className="btn ghost icon theme-toggle" style={{ position: 'relative', height: 40, width: 40 }} title={label} aria-label={label} onClick={toggleTheme}>
      {theme === 'dark' ? <Sun size={18} aria-hidden style={{ color: 'var(--warning)' }} /> : <Moon size={18} aria-hidden />}
    </button>
  );
}

/** Interface language switch (Spanish ⇄ English). Records and exports stay in Spanish. */
function LanguageToggle() {
  const lang = useLang();
  return (
    <div className="segmented lang-toggle" role="group" aria-label={t('Idioma de la interfaz')}>
      <Languages size={15} aria-hidden className="lang-icon" />
      {(['es', 'en'] as Lang[]).map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} title={l === 'en' ? t('Cambiar a inglés') : t('Cambiar a español')} aria-label={LANG_LABEL[l]} onClick={() => setLang(l)}>
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
      <button className="btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ height: 40 }}>
        <Building2 size={16} aria-hidden />
        <span style={{ textAlign: 'left', lineHeight: 1.2 }}>
          <span className="tiny muted" style={{ display: 'block' }}>{t('Empresa activa')}</span>
          <span className="strong">{ctx.company.tradeName}</span>
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="dropdown-menu" role="menu" style={{ left: 0, right: 'auto' }}>
          <div className="group">{t('Seleccione deliberadamente la empresa')}</div>
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
                <span className="strong" style={{ display: 'block' }}>{company.legalName}</span>
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
      <button className="btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ height: 40 }}>
        <span className="avatar" aria-hidden>{initials(ctx.user.name)}</span>
        <span style={{ textAlign: 'left', lineHeight: 1.2 }} className="hide-sm">
          <span className="strong" style={{ display: 'block' }}>{ctx.user.name}</span>
          <span className="tiny muted">{ctx.roles.length ? ctx.roles.map((r) => t(ROLES[r].label)).join(', ') : t('Sin acceso a esta empresa')}</span>
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="dropdown-menu" role="menu" style={{ minWidth: 360, maxHeight: '75vh', overflowY: 'auto' }}>
          <div className="group" style={{ paddingBottom: 6 }}>
            <Badge tone="warning" icon={FlaskConical}>{t('Cambio de usuario de demostración')}</Badge>
            <div className="tiny muted" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 4 }}>{t('Sustituye al inicio de sesión real (sin autenticación ni MFA en el prototipo). El cambio queda en la auditoría.')}</div>
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
                    <span className="avatar" aria-hidden>{initials(u.name)}</span>
                    <span className="grow">
                      <span className="strong" style={{ display: 'block' }}>{u.name}</span>
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
            <span className="grow">{t('Restablecer datos de demostración')}</span>
          </button>
        </div>
      )}
      {confirmReset && (
        <ConfirmDialog
          title={t('Restablecer datos de demostración')}
          message={t('Se borrarán todos los cambios hechos en este navegador (documentos, decisiones, configuración) y se cargará de nuevo el conjunto de datos inicial. Esta acción no se puede deshacer.')}
          confirmLabel={t('Restablecer')}
          danger
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            resetDemoData();
            setConfirmReset(false);
            setOpen(false);
            navigate('/');
            toast.success(t('Datos de demostración restablecidos'));
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
  const items = myNotifications(ctx);
  const unread = items.filter((n) => !n.readBy.includes(ctx.user.id)).length;
  return (
    <div className="dropdown" ref={ref}>
      <button className="btn ghost icon" style={{ position: 'relative', height: 40, width: 40 }} aria-label={t('Avisos: {n} sin leer', { n: unread })} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Bell size={18} aria-hidden />
        {unread > 0 && <span className="bell-count" aria-hidden>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown-menu" role="menu" style={{ width: 380 }}>
          <div className="row between" style={{ padding: '4px 8px 8px' }}>
            <span className="strong">{t('Avisos')}</span>
            <Button size="sm" variant="ghost" onClick={() => markAllRead()} disabled={unread === 0}>
              {t('Marcar todo leído')}
            </Button>
          </div>
          {items.length === 0 && <div className="item muted">{t('No hay avisos.')}</div>}
          {items.slice(0, 10).map((n) => (
            <button
              key={n.id}
              role="menuitem"
              className="item"
              onClick={() => {
                markRead(n.id);
                setOpen(false);
                navigate(n.link);
              }}
            >
              {!n.readBy.includes(ctx.user.id) ? <span className="unread-dot" aria-label={t('Sin leer')} /> : <span style={{ width: 8 }} />}
              <span className="grow">
                <span className={n.readBy.includes(ctx.user.id) ? '' : 'strong'} style={{ display: 'block' }}>{t(n.title)}</span>
                <span className="tiny muted">
                  {t(n.body)} · {formatInstant(n.createdAt)}
                </span>
              </span>
            </button>
          ))}
          <div className="tiny muted" style={{ padding: '6px 10px' }}>{t('Los avisos no incluyen datos de salud ni documentos restringidos.')}</div>
        </div>
      )}
    </div>
  );
}
