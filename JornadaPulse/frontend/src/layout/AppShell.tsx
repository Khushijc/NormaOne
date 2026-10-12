import {
  AlertTriangle,
  Bell,
  BookCheck,
  CalendarDays,
  ChevronDown,
  Building2,
  Clock3,
  FileClock,
  FlaskConical,
  History,
  Home,
  Languages,
  ListChecks,
  Menu,
  PlaneTakeoff,
  RotateCcw,
  Settings,
  ShieldAlert,
  BarChart3,
  Users,
  WifiOff,
  CalendarRange,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isMembershipActive, ROLES, type Permission } from '../domain/permissions';
import { formatInstant, today as realToday } from '../domain/time';
import { LANG_LABEL, setLang, t, type Lang } from '../i18n';
import { getLoadResult, resetDemoData, setDemoSwitches } from '../store/db';
import { useCtx, useLang, useTheme } from '../store/hooks';
import { accessibleCompanies } from '../services/context';
import { markAllRead, markRead, myNotifications, pendingActions, switchIdentity } from '../services/opsService';
import { Badge, Button, Checkbox, ConfirmDialog, useToast } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm: Permission[];
  count?: number;
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
  myDay: ['time.clock_own'] as Permission[],
  records: ['time.view_own', 'time.view_team', 'time.view_all', 'representative.view'] as Permission[],
  calendar: ['time.view_own', 'time.view_team', 'time.view_all'] as Permission[],
  absences: ['absences.request_own', 'absences.review_team', 'absences.view_all'] as Permission[],
  corrections: ['corrections.request_own', 'corrections.review_team', 'corrections.review_all', 'corrections.propose'] as Permission[],
  team: ['employees.view_team', 'employees.view_all'] as Permission[],
  planning: ['shifts.manage_team', 'shifts.manage_all', 'policies.view'] as Permission[],
  exceptions: ['anomalies.view_all', 'anomalies.manage_team'] as Permission[],
  reports: ['reports.own', 'reports.team', 'reports.all', 'representative.view'] as Permission[],
  settings: ['settings.manage', 'policies.manage'] as Permission[],
  audit: ['audit.view'] as Permission[],
};

export function AppShell({ children }: { children: ReactNode }) {
  const ctx = useCtx();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  const pending = ctx.membership ? pendingActions(ctx) : null;
  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Mi trabajo',
      items: [
        { to: '/', label: 'Inicio', icon: Home, perm: [] },
        { to: '/mi-jornada', label: 'Mi jornada', icon: Clock3, perm: SECTION_PERMS.myDay, count: pending?.myNotRecorded || undefined },
        { to: '/registros', label: 'Registros horarios', icon: FileClock, perm: SECTION_PERMS.records },
        { to: '/calendario', label: 'Calendario', icon: CalendarDays, perm: SECTION_PERMS.calendar },
        { to: '/ausencias', label: 'Ausencias', icon: PlaneTakeoff, perm: SECTION_PERMS.absences, count: pending?.absences || undefined },
        { to: '/correcciones', label: 'Solicitudes de corrección', icon: ListChecks, perm: SECTION_PERMS.corrections, count: (pending ? pending.corrections + pending.myProposals : 0) || undefined },
      ],
    },
    {
      title: 'Gestión',
      items: [
        { to: '/equipo', label: 'Equipo', icon: Users, perm: SECTION_PERMS.team },
        { to: '/turnos', label: 'Turnos y horarios', icon: CalendarRange, perm: SECTION_PERMS.planning },
        { to: '/incidencias', label: 'Incidencias', icon: ShieldAlert, perm: SECTION_PERMS.exceptions, count: pending?.anomalies || undefined },
        { to: '/informes', label: 'Informes y exportaciones', icon: BarChart3, perm: SECTION_PERMS.reports },
        { to: '/configuracion', label: 'Configuración', icon: Settings, perm: SECTION_PERMS.settings },
        { to: '/auditoria', label: 'Auditoría', icon: History, perm: SECTION_PERMS.audit },
        { to: '/requisitos', label: 'Requisitos y pruebas', icon: BookCheck, perm: [] },
      ],
    },
  ];
  const allowed = (p: Permission[]) => p.length === 0 || p.some((x) => ctx.can(x));

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label={t('Navegación de JornadaPulse')}>
        <div className="sidebar-brand">
          <div className="portal">{t('Portal de Cumplimiento Pyme')}</div>
          <div className="module">JornadaPulse</div>
          <div className="tiny" style={{ opacity: 0.75, marginTop: 2 }}>{t('Registro de jornada y ausencias')}</div>
        </div>
        <nav className="nav">
          {ctx.membership &&
            sections.map((s) => {
              const items = s.items.filter((i) => allowed(i.perm));
              if (!items.length) return null;
              return (
                <div key={s.title} style={{ display: 'contents' }}>
                  <div className="nav-section">{t(s.title)}</div>
                  {items.map((i) => (
                    <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                      <i.icon size={16} aria-hidden />
                      {t(i.label)}
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
          {t('No certifica el cumplimiento de la normativa laboral; las reglas configurables requieren revisión profesional.')}
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
  const ctx = useCtx();
  const load = getLoadResult();
  return (
    <>
      <div className="demo-banner" role="note">
        <FlaskConical size={14} aria-hidden />
        <span>
          <strong>{t('Prototipo con datos ficticios.')}</strong> {t('Los registros se guardan solo en este navegador (no es almacenamiento seguro). Sin biometría ni geolocalización.')}
        </span>
      </div>
      {ctx.switches.simulateClockFailure && (
        <div className="demo-banner" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="status">
          <WifiOff size={14} aria-hidden />
          <span>
            <strong>{t('Fallo de conexión simulado activo.')}</strong> {t('Los fichajes no se registrarán y se mostrarán como «No registrado».')}
          </span>
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setDemoSwitches({ simulateClockFailure: false })}>
            {t('Desactivar')}
          </button>
        </div>
      )}
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

/** Theme toggle (light ⇄ dark). */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="btn ghost icon theme-toggle"
      style={{ position: 'relative', height: 40, width: 40 }}
      title={theme === 'dark' ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro')}
      aria-label={theme === 'dark' ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro')}
      onClick={toggleTheme}
    >
      {theme === 'dark' ? (
        <Sun size={18} aria-hidden style={{ color: 'var(--warning)' }} />
      ) : (
        <Moon size={18} aria-hidden />
      )}
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
          <div style={{ padding: '4px 10px 8px' }}>
            <Checkbox
              label={t('Simular fallo de conexión al fichar')}
              hint={t('Los siguientes fichajes no se registrarán («No registrado»).')}
              checked={ctx.switches.simulateClockFailure}
              onChange={(v) => setDemoSwitches({ simulateClockFailure: v })}
            />
          </div>
          <button role="menuitem" className="item" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={15} aria-hidden />
            <span className="grow">{t('Restablecer datos de demostración')}</span>
          </button>
        </div>
      )}
      {confirmReset && (
        <ConfirmDialog
          title={t('Restablecer datos de demostración')}
          message={t('Se borrarán todos los cambios hechos en este navegador (fichajes, solicitudes, configuración) y se cargará de nuevo el conjunto de datos inicial. Esta acción no se puede deshacer.')}
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
  const items = ctx.membership ? myNotifications(ctx) : [];
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
          <div className="tiny muted" style={{ padding: '6px 10px' }}>{t('Los avisos no muestran motivos de ausencia ni datos de salud.')}</div>
        </div>
      )}
    </div>
  );
}
