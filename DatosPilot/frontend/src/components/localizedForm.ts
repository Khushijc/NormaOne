/**
 * Edit forms in the interface language.
 *
 * Records are stored in Spanish. An edit form shows each stored text in the interface language
 * (`shown`), and on save a field the user left unchanged is written back as its stored Spanish
 * original (`stored`), so a translation is never saved into a record. Text the user actually
 * edits is saved as typed.
 */
import { t } from '../i18n';

type Texts<T> = { [K in keyof T]: T[K] extends string | null | undefined ? K : never }[keyof T];

/** The stored text in the interface language (unknown text stays as it is). */
export function shown(text: string | null | undefined): string {
  return text ? t(text) : '';
}

/** The value to save: the stored original when the displayed translation was left unchanged. */
export function stored(edited: string, original: string | null | undefined): string {
  return original && edited === t(original) ? original : edited;
}

/** Copy of `raw` with the given text fields shown in the interface language. */
export function shownFields<T extends object>(raw: T, keys: Texts<T>[]): T {
  const out = { ...raw };
  for (const k of keys) out[k] = shown(raw[k] as string | null | undefined) as T[typeof k];
  return out;
}

/** Copy of `edited` where unchanged text fields are restored to the stored originals in `raw`. */
export function storedFields<T extends object>(edited: T, raw: Partial<T> | null | undefined, keys: Texts<T>[]): T {
  if (!raw) return edited;
  const out = { ...edited };
  for (const k of keys) {
    const v = edited[k];
    if (typeof v === 'string') out[k] = stored(v, raw[k] as string | null | undefined) as T[typeof k];
  }
  return out;
}
