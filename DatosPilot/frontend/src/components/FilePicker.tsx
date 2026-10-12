import { Paperclip, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { DemoFile } from '../domain/types';
import { t } from '../i18n';
import { DEMO_FILE_MAX_BYTES } from '../services/evidenceService';
import { Field } from './ui';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.txt';
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Demo file picker. The file never leaves the browser: small files (≤ 150 KB) are kept as a data
 * URL in localStorage so the download demo works; larger files are kept as metadata only. This
 * is NOT secure storage, and the screen says so.
 */
export function FilePicker({ value, onChange, label, error }: { value: DemoFile | null; onChange: (f: DemoFile | null) => void; label?: string; error?: string }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const pick = (file: File | undefined) => {
    setReadError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setReadError(t('Archivo demasiado grande para la demostración (máx. 10 MB).'));
      return;
    }
    const base: DemoFile = { name: file.name, size: file.size, type: file.type || 'application/octet-stream', dataUrl: null };
    if (file.size > DEMO_FILE_MAX_BYTES) {
      onChange(base);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange({ ...base, dataUrl: typeof reader.result === 'string' ? reader.result : null });
    reader.onerror = () => {
      setReadError(t('No se pudo leer el archivo; se guardarán solo sus metadatos.'));
      onChange(base);
    };
    reader.readAsDataURL(file);
  };
  return (
    <Field label={label ?? t('Archivo (demostración)')} htmlFor={id} error={error ?? readError ?? undefined} hint={t('Archivo de demostración: se guarda solo en este navegador (no es almacenamiento seguro). Los mayores de 150 KB se guardan solo como metadatos.')}>
      <div className="row-wrap">
        <input ref={ref} id={id} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn" onClick={() => ref.current?.click()}>
          <Paperclip size={15} aria-hidden /> {value ? t('Cambiar archivo') : t('Seleccionar archivo')}
        </button>
        {value && (
          <span className="row small">
            {value.name} · {Math.max(1, Math.round(value.size / 1024))} KB {value.dataUrl ? '' : `(${t('solo metadatos')})`}
            <button type="button" className="btn ghost sm icon" aria-label={t('Quitar archivo')} onClick={() => onChange(null)}>
              <X size={14} aria-hidden />
            </button>
          </span>
        )}
      </div>
    </Field>
  );
}
