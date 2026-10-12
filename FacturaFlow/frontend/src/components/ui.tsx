import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  FlaskConical,
  Info,
  Loader2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { formatDate, formatDateTime } from '../domain/dates';
import { formatEUR } from '../domain/money';
import { BusinessRuleError, PermissionError } from '../domain/permissions';
import type { StatusMeta, Tone } from '../domain/status';
import { NotFoundError } from '../services/context';
import { t } from '../i18n';

// ─────────────────────────────── Toasts & action runner ───────────────────────────────

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  details?: string[];
}
interface ToastApi {
  push: (kind: ToastKind, title: string, details?: string[]) => void;
}
const ToastCtx = createContext<ToastApi>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, title: string, details?: string[]) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, title, details }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' || kind === 'warning' ? 9000 : 4500);
  }, []);
  const icons: Record<ToastKind, LucideIcon> = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((toast) => {
          const Icon = icons[toast.kind];
          return (
            <div key={toast.id} className={`toast ${toast.kind}`}>
              <Icon size={18} aria-hidden />
              <div className="grow">
                <div className="strong">{t(toast.title)}</div>
                {toast.details && toast.details.length > 0 && (
                  <ul>
                    {toast.details.map((d, i) => (
                      <li key={i}>{t(d)}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button className="btn ghost sm icon" aria-label={t('Cerrar aviso')} onClick={() => setItems((xs) => xs.filter((x) => x.id !== toast.id))}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const { push } = useContext(ToastCtx);
  return {
    success: (title: string, d?: string[]) => push('success', title, d),
    info: (title: string, d?: string[]) => push('info', title, d),
    warning: (title: string, d?: string[]) => push('warning', title, d),
    error: (e: unknown) => {
      const m = describeError(e);
      push('error', m.title, m.details);
    },
  };
}

export function describeError(e: unknown): { title: string; details: string[] } {
  if (e instanceof BusinessRuleError) return { title: t(e.message), details: e.details.map((d) => t(d)) };
  if (e instanceof PermissionError) return { title: t('Acción no permitida para su rol'), details: [t('El servidor real también rechazará esta acción (comprobación de permisos en backend).')] };
  if (e instanceof NotFoundError) return { title: t(e.message), details: [] };
  if (e instanceof Error) return { title: t(e.message), details: [] };
  return { title: t('Error inesperado'), details: [] };
}

/** Runs an async service call with pending state, success toast and error reporting. */
export function useAction() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T> | T, success?: string | ((r: T) => string | null)): Promise<T | undefined> => {
      setPending(true);
      try {
        const r = await fn();
        const msg = typeof success === 'function' ? success(r) : success;
        if (msg) toast.success(msg);
        return r;
      } catch (e) {
        toast.error(e);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  /** Like run(), but resolves to true on success (for services that return nothing). */
  const runOk = useCallback(
    async (fn: () => Promise<unknown> | unknown, success?: string): Promise<boolean> => {
      setPending(true);
      try {
        await fn();
        if (success) toast.success(success);
        return true;
      } catch (e) {
        toast.error(e);
        return false;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return { run, runOk, pending };
}

// ─────────────────────────────── Primitives ───────────────────────────────

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline' | 'accent';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  loading?: boolean;
  iconOnly?: boolean;
}
export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, iconOnly, children, className = '', disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'secondary' ? variant : '', size === 'sm' ? 'sm' : '', iconOnly ? 'icon' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 size={15} className="spin" aria-hidden /> : Icon ? <Icon size={15} aria-hidden /> : null}
      {children}
    </button>
  );
}

const TONE_ICON: Record<Tone, LucideIcon> = {
  neutral: Circle,
  info: Clock,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  accent: Info,
};

export function Badge({ tone = 'neutral', children, icon, title }: { tone?: Tone; children: ReactNode; icon?: LucideIcon | false; title?: string }) {
  const Icon = icon === false ? null : icon ?? TONE_ICON[tone];
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  );
}

/** Status badge: text + icon + colour (never colour alone), with the explanation as tooltip. */
export function StatusBadge({ meta, prefix }: { meta: StatusMeta; prefix?: string }) {
  return (
    <Badge tone={meta.tone} title={t(meta.help)}>
      {prefix && <span className="sr-only">{t(prefix)}: </span>}
      {t(meta.label)}
    </Badge>
  );
}

export function SimulatedTag({ label }: { label?: string }) {
  return (
    <Badge tone="warning" icon={FlaskConical} title={t('Comportamiento simulado en el prototipo. No hay conexión con la AEAT ni con un proveedor real.')}>
      {label ? t(label) : t('Simulado')}
    </Badge>
  );
}

export const Money = ({ cents, className = '' }: { cents: number | null | undefined; className?: string }) => <span className={`num ${className}`}>{formatEUR(cents)}</span>;
export const DateText = ({ date }: { date: string | null | undefined }) => <span className="nowrap">{formatDate(date)}</span>;
export const DateTimeText = ({ at }: { at: string | null | undefined }) => <span className="nowrap">{formatDateTime(at)}</span>;

export function Card({ title, actions, children, footer, flush, className = '', id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; footer?: ReactNode; flush?: boolean; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <div className="card-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row-wrap">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: ReactNode }) {
  useEffect(() => {
    if (typeof title === 'string') document.title = `${title} · ${t('Facturas y Gastos')}`;
  }, [title]);
  return (
    <header className="page-header">
      <div className="grow">
        {breadcrumbs && <nav className="breadcrumbs" aria-label={t('Ruta')}>{breadcrumbs}</nav>}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </header>
  );
}

export function Callout({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'neutral'; title?: ReactNode; children?: ReactNode; icon?: LucideIcon }) {
  const Icon = icon ?? (tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info);
  return (
    <div className={`callout ${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={16} aria-hidden />
      <div className="grow stack-sm" style={{ gap: 2 }}>
        {title && <div className="title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={28} className="icon" aria-hidden />
      <div className="strong">{title}</div>
      {children && <div className="small muted" style={{ maxWidth: 460 }}>{children}</div>}
      {action}
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─────────────────────────────── Form controls ───────────────────────────────

export function Field({ label, required, hint, error, children, className = '', htmlFor }: { label: ReactNode; required?: boolean; hint?: ReactNode; error?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="req" aria-hidden>*</span>}
        {required && <span className="sr-only"> ({t('obligatorio')})</span>}
      </label>
      {children}
      {error ? (
        <span className="error" role="alert">
          <XCircle size={12} aria-hidden /> {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

/** Field + control with generated id wiring. */
export function TextField({ label, required, hint, error, className, ...rest }: { label: ReactNode; required?: boolean; hint?: ReactNode; error?: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field label={label} required={required} hint={hint} error={error} className={className} htmlFor={id}>
      <input id={id} className={`input ${rest.inputMode === 'decimal' ? 'num' : ''}`} aria-invalid={!!error || undefined} aria-required={required || undefined} {...rest} />
    </Field>
  );
}

export function SelectField({ label, required, hint, error, className, children, ...rest }: { label: ReactNode; required?: boolean; hint?: ReactNode; error?: string; className?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Field label={label} required={required} hint={hint} error={error} className={className} htmlFor={id}>
      <select id={id} className="select" aria-invalid={!!error || undefined} aria-required={required || undefined} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function TextAreaField({ label, required, hint, error, className, ...rest }: { label: ReactNode; required?: boolean; hint?: ReactNode; error?: string; className?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field label={label} required={required} hint={hint} error={error} className={className} htmlFor={id}>
      <textarea id={id} className="textarea" aria-invalid={!!error || undefined} aria-required={required || undefined} {...rest} />
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>
        {label}
        {hint && <span className="hint small muted" style={{ display: 'block' }}>{hint}</span>}
      </span>
    </label>
  );
}

// ─────────────────────────────── Tabs ───────────────────────────────

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode; count?: number; hidden?: boolean }[]; value: T; onChange: (v: T) => void; label: string }) {
  const visible = tabs.filter((tab) => !tab.hidden);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;
    refs.current[n]?.focus();
    onChange(visible[n].id);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {visible.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          aria-selected={tab.id === value}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────── Modal & confirmation ───────────────────────────────

export function Modal({ title, onClose, children, footer, wide, description }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; description?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-modal-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const els = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
        if (els.length === 0) return;
        const firstEl = els[0], lastEl = els[els.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p className="small muted" style={{ marginTop: 4 }}>{description}</p>}
          </div>
          <button className="btn ghost sm icon" data-modal-close aria-label={t('Cerrar diálogo')} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation for consequential actions, optionally requiring a reason (recorded in the audit trail). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  requireReason,
  reasonLabel,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const missing = requireReason && !reason.trim();
  const submit = async () => {
    setTouched(true);
    if (missing) return;
    setBusy(true);
    try {
      const r = await onConfirm(reason.trim());
      if (r !== false) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={submit} loading={busy}>
            {confirmLabel ?? t('Confirmar')}
          </Button>
        </>
      }
    >
      {message && <div>{message}</div>}
      {children}
      {requireReason !== undefined && (
        <TextAreaField label={reasonLabel ?? t('Motivo (queda registrado en la auditoría)')} required={requireReason} value={reason} onChange={(e) => setReason(e.target.value)} error={touched && missing ? t('Obligatorio.') : undefined} rows={3} />
      )}
    </Modal>
  );
}

// ─────────────────────────────── Table helpers ───────────────────────────────

export type SortDir = 'asc' | 'desc';
export function SortHeader({ label, col, sort, onSort, num }: { label: string; col: string; sort: { col: string; dir: SortDir }; onSort: (col: string) => void; num?: boolean }) {
  const active = sort.col === col;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={num ? 'num' : ''} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="sort" onClick={() => onSort(col)}>
        {label}
        <Icon size={12} aria-hidden />
      </button>
    </th>
  );
}

export function useSort(initial: string, dir: SortDir = 'desc') {
  const [sort, setSort] = useState<{ col: string; dir: SortDir }>({ col: initial, dir });
  const onSort = (col: string) => setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  return { sort, onSort };
}

export function sortRows<T>(rows: T[], sort: { col: string; dir: SortDir }, get: (row: T, col: string) => string | number | null | undefined): T[] {
  const m = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = get(a, sort.col), vb = get(b, sort.col);
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')) * m;
  });
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <span>{t('{from}–{to} de {total}', { from, to, total })}</span>
      <div className="row">
        <label className="row small">
          {t('Filas')}
          <select className="select" style={{ width: 72, height: 30 }} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button size="sm" iconOnly icon={ChevronLeft} aria-label={t('Página anterior')} disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="small">{t('Página {page} de {pages}', { page, pages })}</span>
        <Button size="sm" iconOnly icon={ChevronRight} aria-label={t('Página siguiente')} disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </div>
  );
}

export function usePaged<T>(rows: T[], initialSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, pages);
  return {
    rows: rows.slice((safe - 1) * pageSize, safe * pageSize),
    props: { page: safe, pageSize, total: rows.length, onPage: setPage, onPageSize: (n: number) => { setPageSize(n); setPage(1); } },
    reset: () => setPage(1),
  };
}
