import {
  AlertTriangle,
  CheckCircle2,
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
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { PersistenceError } from '../store/db';
import type { Tone } from '../domain/status';
import { t } from '../i18n';

// ─────────────────────────────── Toasts ───────────────────────────────

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
  const icons: Record<ToastKind, LucideIcon> = {
    success: CheckCircle2,
    error: XCircle,
    info: Info,
    warning: AlertTriangle,
  };
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
              <button
                className="btn ghost sm icon"
                aria-label={t('Cerrar aviso')}
                onClick={() => setItems((xs) => xs.filter((x) => x.id !== toast.id))}
              >
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

export function describeError(e: unknown): { title: string; details?: string[] } {
  if (e instanceof BusinessRuleError) return { title: e.message, details: e.details };
  if (e instanceof PermissionError) return { title: e.message };
  if (e instanceof NotFoundError) return { title: e.message };
  if (e instanceof PersistenceError) return { title: 'Fallo al guardar datos', details: [e.message] };
  if (e instanceof Error) return { title: e.message };
  return { title: 'Ha ocurrido un error inesperado.' };
}

// ─────────────────────────────── Buttons & Badges ───────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconOnly?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconOnly,
  loading,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    variant,
    size !== 'md' ? size : '',
    iconOnly ? 'icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={16} className="spin" aria-hidden /> : Icon && <Icon size={16} aria-hidden />}
      {!iconOnly && children}
    </button>
  );
}

export function Badge({
  tone = 'neutral',
  icon: Icon,
  children,
  title,
  className = '',
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span className={`badge ${tone} ${className}`} title={title}>
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  );
}

// ─────────────────────────────── Cards & Layouts ───────────────────────────────

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  subtext,
  tone = 'neutral',
  icon: Icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  subtext?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="stat-head">
        <span className="stat-label">{t(label)}</span>
        {Icon && <Icon size={18} className="stat-icon" aria-hidden />}
      </div>
      <div className="stat-val">{value}</div>
      {subtext && <div className="stat-sub">{subtext}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`stat-card ${tone} clickable`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`stat-card ${tone}`}>
      {content}
    </div>
  );
}

export function StatusBadge({
  meta,
  prefix,
  className = '',
}: {
  meta: { label: string; tone: Tone; help?: string };
  prefix?: string;
  className?: string;
}) {
  return (
    <Badge tone={meta.tone} title={meta.help ? t(meta.help) : undefined} className={className}>
      {prefix && <span className="sr-only">{t(prefix)}: </span>}
      {t(meta.label)}
    </Badge>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
  icon: CustomIcon,
  className = '',
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'neutral';
  title?: ReactNode;
  children?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const icons: Record<string, LucideIcon> = {
    info: Info,
    warning: AlertTriangle,
    danger: XCircle,
    success: CheckCircle2,
    neutral: Info,
  };
  const Icon = CustomIcon ?? icons[tone] ?? Info;
  return (
    <div className={`callout ${tone} ${className}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={16} aria-hidden />
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {title && <div className="strong">{title}</div>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={36} className="empty-icon" aria-hidden />}
      <h3 className="empty-title">{t(title)}</h3>
      {children && <p className="empty-text">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

// ─────────────────────────────── Form Primitives ───────────────────────────────

export interface FormFieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, hint, error, required, children, className = '' }: FormFieldProps) {
  const id = useId();
  return (
    <div className={`form-field ${error ? 'has-error' : ''} ${className}`}>
      {label && (
        <label className="form-label" htmlFor={id}>
          {t(label)}
          {required && <span className="req" aria-label="obligatorio"> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <span className="form-hint">{t(hint)}</span>}
      {error && <span className="form-error">{t(error)}</span>}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error, className = '', ...rest }: InputProps) {
  return <input className={`input ${error ? 'error' : ''} ${className}`} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function Select({ error, className = '', children, ...rest }: SelectProps) {
  return (
    <select className={`select ${error ? 'error' : ''} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ error, className = '', ...rest }: TextareaProps) {
  return <textarea className={`textarea ${error ? 'error' : ''} ${className}`} {...rest} />;
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className={`checkbox-label ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="strong">{t(label)}</span>
        {hint && <span className="tiny muted d-block">{t(hint)}</span>}
      </span>
    </label>
  );
}

// ─────────────────────────────── Modals, Drawers & Dialogs ───────────────────────────────

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  maxWidth = 640,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-box"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
        ref={ref}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{t(title)}</h3>
            {description && <p className="modal-desc">{t(description)}</p>}
          </div>
          <button className="btn ghost sm icon" onClick={onClose} aria-label={t('Cerrar')}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 620,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="drawer-box"
        style={{ width: `min(${width}px, 94vw)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-header">
          <div className="grow">
            <h3 className="drawer-title">{t(title)}</h3>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button className="btn ghost sm icon" onClick={onClose} aria-label={t('Cerrar panel')}>
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      maxWidth={460}
      footer={
        <div className="row end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t(cancelLabel)}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {t(confirmLabel)}
          </Button>
        </div>
      }
    >
      <div className="py-2 text-sm">{typeof message === 'string' ? t(message) : message}</div>
    </Modal>
  );
}

// ─────────────────────────────── Tabs ───────────────────────────────

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`tab-btn ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {t(tab.label)}
          {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────── Tables ───────────────────────────────

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`table-container ${className}`}>
      <table className="table">{children}</table>
    </div>
  );
}
