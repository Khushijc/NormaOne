import { Field, Input } from './ui/Kit.jsx'
import Select from './ui/Select.jsx'
import { COUNTRY_CODES, LOCALES, TIME_ZONES } from '../config/enums.js'

/**
 * The organization fields three requests share: onboarding, the Super Admin's create, and the
 * Super Admin's edit. One form, so the three cannot drift apart in what they offer.
 *
 * THE ENUMS ARE DROPDOWNS OF THE BACKEND'S OWN CONSTANTS (config/enums.js). Typing "ES" for the
 * locale is the mistake this exists to make impossible — the backend wants ES_ES and answers a bare
 * ES with 400. "Default from country" sends nothing, and the backend picks from countryCode.
 *
 * `mode` decides the first fields: `create` asks for a subdomain and country (both fixed once the
 * tenant exists — there is no endpoint to change them); `edit` asks for the name under its stored
 * field name, tenantName, which is what UpdateTenantRequest calls it.
 */
const blankOption = (label) => ({ value: '', label })

export default function TenantFields({ form, onChange, errors = {}, mode = 'create' }) {
  const set = (key) => (event) => onChange({ ...form, [key]: event.target.value })
  const choose = (key) => (value) => onChange({ ...form, [key]: value })
  const nameKey = mode === 'edit' ? 'tenantName' : 'organizationName'

  return (
    <div className="stack">
      <div className="field-grid">
        <Field label="Organization name" required={mode === 'create'} error={errors[nameKey]}>
          <Input value={form[nameKey] ?? ''} error={errors[nameKey]} onChange={set(nameKey)} />
        </Field>
        {mode === 'create' ? (
          <Field
            label="Subdomain"
            required
            hint="2–50: lowercase letters, digits, inner hyphens. Unique, and fixed once created."
            error={errors.subdomain}
          >
            <Input className="input mono" value={form.subdomain ?? ''} error={errors.subdomain} onChange={set('subdomain')} />
          </Field>
        ) : null}
        {mode === 'create' ? (
          <Field label="Country" required error={errors.countryCode}>
            <Select label="Country" value={form.countryCode ?? ''} onChange={choose('countryCode')} options={COUNTRY_CODES} />
          </Field>
        ) : null}
        <Field label="Account holder" error={errors.accountHolderName}>
          <Input value={form.accountHolderName ?? ''} error={errors.accountHolderName} onChange={set('accountHolderName')} />
        </Field>
        <Field label="Language" hint="TenantLocale" error={errors.defaultLocale}>
          <Select
            label="Language"
            value={form.defaultLocale ?? ''}
            onChange={choose('defaultLocale')}
            options={[blankOption(mode === 'create' ? 'Default from country' : 'Leave as it is'), ...LOCALES]}
          />
        </Field>
        <Field label="Time zone" hint="TenantTimeZone" error={errors.defaultTimeZone}>
          <Select
            label="Time zone"
            value={form.defaultTimeZone ?? ''}
            onChange={choose('defaultTimeZone')}
            options={[blankOption(mode === 'create' ? 'Default from country' : 'Leave as it is'), ...TIME_ZONES]}
          />
        </Field>
        <Field label="Email" error={errors.emailAddress}>
          <Input type="email" value={form.emailAddress ?? ''} error={errors.emailAddress} onChange={set('emailAddress')} />
        </Field>
        <Field label="Phone" error={errors.phoneNumber}>
          <Input value={form.phoneNumber ?? ''} error={errors.phoneNumber} onChange={set('phoneNumber')} />
        </Field>
      </div>

      <div className="field-split">Address — optional</div>
      <div className="field-grid">
        <Field label="Address" error={errors.addressLine} wide>
          <Input value={form.addressLine ?? ''} error={errors.addressLine} onChange={set('addressLine')} />
        </Field>
        <Field label="City" error={errors.city}>
          <Input value={form.city ?? ''} error={errors.city} onChange={set('city')} />
        </Field>
        <Field label="Postcode" error={errors.postalCode}>
          <Input value={form.postalCode ?? ''} error={errors.postalCode} onChange={set('postalCode')} />
        </Field>
        <Field label="Logo URL" error={errors.logoUrl} wide>
          <Input value={form.logoUrl ?? ''} error={errors.logoUrl} onChange={set('logoUrl')} />
        </Field>
      </div>
    </div>
  )
}
