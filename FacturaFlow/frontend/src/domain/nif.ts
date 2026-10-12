/**
 * Spanish tax identifier validation (format + control character only).
 *
 * - DNI-based NIF: 8 digits + control letter = "TRWAGMYFPDXBNJZSQVHLCKE"[number mod 23].
 * - NIE: X/Y/Z + 7 digits + control letter (X→0, Y→1, Z→2, then the DNI rule).
 * - K/L/M NIF (Spanish individuals without DNI): letter + 7 digits + letter. The control
 *   formula is not officially published → format check only.
 * - Legal-entity NIF: letter + 7 digits + control character (RD 1065/2007 arts. 18-23,
 *   Orden EHA/451/2008). The control-character algorithm in common use is NOT published
 *   by AEAT (research: UNRESOLVED) → a mismatch is reported as a warning, never a block.
 *
 * A structurally valid NIF is not proof that it exists or is registered: the backend
 * must check it against the AEAT census service (not connected in this prototype).
 */

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const ENTITY_LETTERS = 'ABCDEFGHJNPQRSUVW';
const ENTITY_CONTROL_LETTERS = 'JABCDEFGHI';
/** Entity types whose control character must be a letter. */
const ENTITY_LETTER_CONTROL = 'NPQRSW';
/** Entity types whose control character must be a digit. */
const ENTITY_DIGIT_CONTROL = 'ABEH';

export type NifKind = 'DNI' | 'NIE' | 'KLM' | 'ENTITY';

export interface NifResult {
  valid: boolean;
  /** Structurally valid but the control character could not be confirmed against an official rule. */
  uncertain?: boolean;
  normalised: string;
  kind: NifKind | null;
  message: string;
}

export function normaliseNif(raw: string): string {
  return raw.toUpperCase().replace(/[\s.\-/]/g, '');
}

export function validateNif(raw: string): NifResult {
  const v = normaliseNif(raw);
  if (!v) return { valid: false, normalised: v, kind: null, message: 'El NIF es obligatorio.' };
  if (v.startsWith('ES') && v.length === 11) {
    return { ...validateNif(v.slice(2)), message: 'Introduzca el NIF sin el prefijo "ES" (el prefijo corresponde al NIF-IVA).' , valid: false };
  }

  if (/^\d{8}[A-Z]$/.test(v)) {
    const expected = DNI_LETTERS[Number(v.slice(0, 8)) % 23];
    return expected === v[8]
      ? { valid: true, normalised: v, kind: 'DNI', message: 'NIF de persona física (DNI) con letra de control correcta.' }
      : { valid: false, normalised: v, kind: 'DNI', message: `Letra de control incorrecta: se esperaba "${expected}".` };
  }

  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const n = Number('XYZ'.indexOf(v[0]) + v.slice(1, 8));
    const expected = DNI_LETTERS[n % 23];
    return expected === v[8]
      ? { valid: true, normalised: v, kind: 'NIE', message: 'NIE con letra de control correcta.' }
      : { valid: false, normalised: v, kind: 'NIE', message: `Letra de control del NIE incorrecta: se esperaba "${expected}".` };
  }

  if (/^[KLM]\d{7}[A-Z]$/.test(v)) {
    return { valid: true, uncertain: true, normalised: v, kind: 'KLM', message: 'NIF especial (K/L/M): formato correcto; la letra de control no puede comprobarse con una regla oficial publicada.' };
  }

  if (/^[A-Z]\d{7}[0-9A-J]$/.test(v)) {
    const type = v[0];
    if (!ENTITY_LETTERS.includes(type)) {
      return { valid: false, normalised: v, kind: 'ENTITY', message: `"${type}" no es una letra de tipo de entidad válida.` };
    }
    const digits = v.slice(1, 8).split('').map(Number);
    let sum = 0;
    digits.forEach((d, i) => {
      if (i % 2 === 1) sum += d;
      else {
        const dbl = d * 2;
        sum += Math.floor(dbl / 10) + (dbl % 10);
      }
    });
    const controlDigit = (10 - (sum % 10)) % 10;
    const controlLetter = ENTITY_CONTROL_LETTERS[controlDigit];
    const actual = v[8];
    let ok: boolean;
    if (ENTITY_LETTER_CONTROL.includes(type)) ok = actual === controlLetter;
    else if (ENTITY_DIGIT_CONTROL.includes(type)) ok = actual === String(controlDigit);
    else ok = actual === String(controlDigit) || actual === controlLetter;
    return ok
      ? { valid: true, normalised: v, kind: 'ENTITY', message: 'NIF de persona jurídica o entidad con dígito de control correcto.' }
      : {
          valid: true,
          uncertain: true,
          normalised: v,
          kind: 'ENTITY',
          message: `El carácter de control no coincide con el algoritmo de uso común (se esperaba "${ENTITY_LETTER_CONTROL.includes(type) ? controlLetter : controlDigit}"). Ese algoritmo no está publicado oficialmente: verifique el NIF en el censo de la AEAT.`,
        };
  }

  return { valid: false, normalised: v, kind: null, message: 'Formato no reconocido (DNI 12345678Z, NIE X1234567L o entidad B12345678).' };
}

/** EU VAT number (NIF-IVA) — structural check only; VIES verification is a future backend integration. */
export function validateEuVat(raw: string): NifResult {
  const v = normaliseNif(raw);
  const ok = /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[0-9A-Z]{2,12}$/.test(v);
  return ok
    ? { valid: true, normalised: v, kind: null, message: 'Formato de NIF-IVA plausible. Verificación VIES no conectada (simulada).' }
    : { valid: false, normalised: v, kind: null, message: 'NIF-IVA no válido: debe empezar por el código de país de la UE (p. ej. FR, DE, PT).' };
}

/** Builds a valid DNI letter for demo-data generation and tests. */
export function dniWithLetter(eightDigits: string): string {
  return eightDigits + DNI_LETTERS[Number(eightDigits) % 23];
}
