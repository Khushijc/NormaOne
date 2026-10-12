import {
  Languages,
  Bell,
  BookCheck,
  Building2,
  ChevronDown,
  Coins,
  FileText,
  FlaskConical,
  Gauge,
  History,
  Landmark,
  ListChecks,
  Menu,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
  BarChart3,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { formatDate, formatDateTime, today as realToday } from '../domain/dates';
import { isMembershipActive, ROLES, type Permission } from '../domain/permissions';
import { getLoadResult, getSaveError, setSession } from '../store/db';
import { LANG_LABEL, setLang, t, tKey, type Lang } from '../i18n';
import { useCtx, useDb, useLang, useTheme } from '../store/hooks';
import { accessibleCompanies } from '../services/context';
import { markAllRead, markRead, myTasks, refreshDerivedNotifications, visibleNotifications } from '../services/notificationService';
import { canViewExpense } from '../services/expenseService';
import { Badge, Button } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm: Permission | Permission[];
  count?: number;
}

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

const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function AppShell({ children }: { children: ReactNode }) {
  const ctx = useCtx();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    refreshDerivedNotifications();
  }, [ctx.company.id, ctx.user.id, ctx.today]);

  const tasks = ctx.membership ? myTasks(ctx) : [];
  const pendingExpenses = ctx.db.expenses.filter((e) => canViewExpense(ctx, e) && e.reviewStatus === 'submitted').length;
  const fiscalExceptions = ctx.db.invoices.filter((i) => i.companyId === ctx.company.id && (i.pendingOperationId || i.fiscalStatus === 'rejected' || i.fiscalStatus === 'needs_review')).length;

  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: tKey('Operaciones'),
      items: [
        { to: '/', label: tKey('Panel'), icon: Gauge, perm: 'dashboard.view' },
        { to: '/facturas', label: tKey('Facturas emitidas'), icon: FileText, perm: 'invoices.view' },
        { to: '/cobros', label: tKey('Cobros'), icon: Coins, perm: ['payments.record', 'reports.view'] },
        { to: '/gastos', label: tKey('Gastos y facturas recibidas'), icon: Receipt, perm: ['expenses.submit_own', 'expenses.view_all'], count: pendingExpenses || undefined },
        { to: '/tareas', label: tKey('Tareas y avisos'), icon: ListChecks, perm: ['dashboard.view', 'expenses.submit_own'], count: tasks.length || undefined },
      ],
    },
    {
      title: tKey('Terceros'),
      items: [
        { to: '/clientes', label: tKey('Clientes'), icon: Users, perm: 'customers.view' },
        { to: '/proveedores', label: tKey('Proveedores'), icon: Truck, perm: 'suppliers.view' },
      ],
    },
    {
      title: tKey('Control'),
      items: [
        { to: '/integracion-fiscal', label: tKey('Integración fiscal'), icon: ShieldCheck, perm: 'fiscal.view', count: fiscalExceptions || undefined },
        { to: '/gestoria', label: tKey('Gestoría y traspasos'), icon: Landmark, perm: 'handover.view' },
        { to: '/informes', label: tKey('Informes'), icon: BarChart3, perm: 'reports.view' },
        { to: '/auditoria', label: tKey('Auditoría'), icon: History, perm: 'audit.view' },
        { to: '/configuracion', label: tKey('Configuración'), icon: Settings, perm: 'settings.view' },
        { to: '/requisitos', label: tKey('Requisitos y pruebas'), icon: BookCheck, perm: ['dashboard.view', 'expenses.submit_own'] },
      ],
    },
  ];
  const allowed = (p: Permission | Permission[]) => (Array.isArray(p) ? p.some((x) => ctx.can(x)) : ctx.can(p));

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label={t('Navegación principal')}>
        <div className="sidebar-brand">
          <div className="portal">{t('Portal de Cumplimiento Pyme')}</div>
          <div className="module">{t('Facturas y Gastos')}</div>
        </div>
        <nav className="nav">
          {sections.map((s) => {
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
          {t('No es un sistema informático de facturación certificado ni conectado a la AEAT.')}
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
  const saveError = getSaveError();
  return (
    <>
      <div className="demo-banner" role="note">
        <FlaskConical size={14} aria-hidden />
        <span>
          <strong>{t('Prototipo con datos ficticios.')}</strong> {t('Proveedor fiscal, correo y extracción de documentos están')} <strong>{t('simulados')}</strong>;{' '}
          {t('nada se envía a la AEAT.')} {t('Los datos se guardan solo en este navegador.')}
          {ctx.session.demoDate && (
            <>
              {' '}
              <strong>{t('Fecha simulada: {d}', { d: formatDate(ctx.session.demoDate) })}</strong> {t('(real: {d}).', { d: formatDate(realToday()) })}
            </>
          )}
        </span>
      </div>
      {load.message && (
        <div className="demo-banner" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">
          {t(load.message)}
        </div>
      )}
      {saveError && (
        <div className="demo-banner" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">
          {t(saveError)}
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
      <GlobalSearch />
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

/** Interface language switch (Spanish ⇄ English). Records and documents stay in Spanish. */
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
          {companies.map(({ company, membership }) => (
            <button
              key={company.id}
              role="menuitem"
              className="item"
              aria-current={company.id === ctx.company.id}
              onClick={() => {
                setSession({ companyId: company.id });
                setOpen(false);
                navigate('/');
              }}
            >
              <Building2 size={16} aria-hidden />
              <span className="grow">
                <span className="strong" style={{ display: 'block' }}>{company.legalName}</span>
                <span className="tiny muted">{company.nif} · {membership.roles.map((r) => t(ROLES[r].label)).join(', ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserSwitcher() {
  const ctx = useCtx();
  const [open, setOpen] = useState(false);
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
          <span className="tiny muted">{ctx.membership ? ctx.membership.roles.map((r) => t(ROLES[r].label)).join(', ') : t('Sin acceso a esta empresa')}</span>
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="dropdown-menu" role="menu" style={{ minWidth: 340 }}>
          <div className="group" style={{ paddingBottom: 6 }}>
            <Badge tone="warning" icon={FlaskConical}>{t('Cambio de usuario de demostración')}</Badge>
            <div className="tiny muted" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 4 }}>
              {t('Sustituye al inicio de sesión real (sin autenticación ni MFA en el prototipo).')}
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
                      setSession({ userId: u.id, companyId: g.company.id });
                      setOpen(false);
                      navigate(m.roles.includes('employee') && m.roles.length === 1 ? '/gastos' : m.roles.includes('supervisor') ? '/gastos' : m.roles.includes('gestoria') ? '/gestoria' : '/');
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
                    {!active && <Badge tone="danger">{t('Revocado')}</Badge>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
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
  const items = ctx.membership ? visibleNotifications(ctx) : [];
  const unread = items.filter((n) => !n.readBy[ctx.user.id]).length;
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
            <div className="row">
              <Button size="sm" variant="ghost" onClick={() => markAllRead()} disabled={unread === 0}>{t('Marcar todo leído')}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setOpen(false); navigate('/tareas?tab=avisos'); }}>{t('Ver todos')}</Button>
            </div>
          </div>
          {items.length === 0 && <div className="item muted">{t('No hay avisos.')}</div>}
          {items.slice(0, 8).map((n) => (
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
              {!n.readBy[ctx.user.id] ? <span className="unread-dot" aria-label={t('Sin leer')} /> : <span style={{ width: 8 }} />}
              <span className="grow">
                <span className={n.readBy[ctx.user.id] ? '' : 'strong'} style={{ display: 'block' }}>{t(n.title)}</span>
                <span className="tiny muted">{t(n.body)} · {formatDateTime(n.createdAt)}</span>
              </span>
            </button>
          ))}
          <div className="tiny muted" style={{ padding: '6px 10px' }}>{t('Las vistas previas no muestran importes ni datos personales.')}</div>
        </div>
      )}
    </div>
  );
}

/** Scoped search across the active company only (PLT-02 / PLT-09). */
function GlobalSearch() {
  const ctx = useCtx();
  const db = useDb();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const navigate = useNavigate();
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out: { label: string; sub: string; to: string; icon: LucideIcon }[] = [];
    const cid = ctx.company.id;
    if (ctx.can('invoices.view')) {
      for (const i of db.invoices.filter((x) => x.companyId === cid && (x.number || ctx.can('invoices.view_drafts')))) {
        const c = db.customers.find((x) => x.id === i.customerId);
        if ((i.number ?? '').toLowerCase().includes(s) || c?.legalName.toLowerCase().includes(s)) out.push({ label: i.number ?? t('Borrador'), sub: c?.legalName ?? '', to: `/facturas/${i.id}`, icon: FileText });
      }
    }
    if (ctx.can('customers.view')) for (const c of db.customers.filter((x) => x.companyId === cid && (x.legalName.toLowerCase().includes(s) || x.idNumber.toLowerCase().includes(s)))) out.push({ label: c.legalName, sub: `${t('Cliente')} · ${c.idNumber}`, to: `/clientes/${c.id}`, icon: Users });
    if (ctx.can('suppliers.view')) for (const c of db.suppliers.filter((x) => x.companyId === cid && (x.legalName.toLowerCase().includes(s) || x.idNumber.toLowerCase().includes(s)))) out.push({ label: c.legalName, sub: `${t('Proveedor')} · ${c.idNumber}`, to: `/proveedores/${c.id}`, icon: Truck });
    for (const e of db.expenses.filter((x) => canViewExpense(ctx, x) && (x.documentNumber.toLowerCase().includes(s) || x.description.toLowerCase().includes(s) || x.merchantName.toLowerCase().includes(s)))) out.push({ label: e.documentNumber || e.description, sub: `${t('Gasto')} · ${e.description}`, to: `/gastos/${e.id}`, icon: Wallet });
    return out.slice(0, 12);
  }, [q, db, ctx]);
  return (
    <div className="dropdown grow" ref={ref} style={{ maxWidth: 420 }}>
      <label className="sr-only" htmlFor="global-search">{t('Buscar en la empresa activa')}</label>
      <div style={{ position: 'relative' }}>
        <Search size={15} aria-hidden style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
        <input
          id="global-search"
          className="input"
          style={{ paddingLeft: 32 }}
          placeholder={t('Buscar facturas, clientes, gastos…')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="dropdown-menu" role="listbox" style={{ left: 0, right: 0 }}>
          <div className="group">{t('Resultados en {name}', { name: ctx.company.tradeName })}</div>
          {results.length === 0 && <div className="item muted">{t('Sin resultados.')}</div>}
          {results.map((r, i) => (
            <button
              key={i}
              className="item"
              role="option"
              aria-selected={false}
              onClick={() => {
                setOpen(false);
                setQ('');
                navigate(r.to);
              }}
            >
              <r.icon size={15} aria-hidden />
              <span className="grow">
                <span className="strong" style={{ display: 'block' }}>{r.label}</span>
                <span className="tiny muted">{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
