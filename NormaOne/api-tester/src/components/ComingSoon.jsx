import { Badge } from './ui/Kit.jsx'

/** A subtle neutral "Coming Soon" badge, for a feature that is not available yet (config/features.js). */
export default function ComingSoon({ title = 'Not available yet' }) {
  return <Badge title={title}>Coming Soon</Badge>
}

/** "Email Notifications — Coming Soon", where a screen would otherwise talk about email delivery. */
export function EmailComingSoon() {
  return (
    <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      Email Notifications <ComingSoon title="Email delivery is not configured yet: nothing is emailed." />
    </span>
  )
}
