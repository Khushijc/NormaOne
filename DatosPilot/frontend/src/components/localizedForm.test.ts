import { afterEach, describe, expect, it } from 'vitest';
import { setLangForTests } from '../i18n';
import { shown, shownFields, stored, storedFields } from './localizedForm';

describe('localized edit forms', () => {
  afterEach(() => setLangForTests('es'));

  it('shows stored Spanish in English and saves unchanged fields back as the Spanish original', () => {
    setLangForTests('en');
    const raw = { name: 'Calzado de seguridad', type: 'Protección de pies', description: 'Texto sin traducción' };
    const form = shownFields(raw, ['name', 'type', 'description']);
    expect(form.name).toBe('Safety footwear');
    expect(form.type).toBe('Foot protection');
    expect(form.description).toBe('Texto sin traducción');
    const saved = storedFields({ ...form, type: 'Feet' }, raw, ['name', 'type', 'description']);
    expect(saved).toEqual({ name: 'Calzado de seguridad', type: 'Feet', description: 'Texto sin traducción' });
  });

  it('is a no-op in Spanish and for new records', () => {
    expect(shown('Calzado de seguridad')).toBe('Calzado de seguridad');
    expect(stored('Calzado de seguridad', 'Calzado de seguridad')).toBe('Calzado de seguridad');
    setLangForTests('en');
    expect(stored('Safety footwear', null)).toBe('Safety footwear');
  });
});
