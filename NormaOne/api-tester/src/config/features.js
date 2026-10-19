/**
 * Features the backend has code for but that are not switched on yet.
 *
 * EMAIL DELIVERY. The backend writes plan-change emails to its outbox (EmailOutboxService) and can send
 * them through Amazon SES or SMTP, but no sender is configured, so nothing is sent: emails wait as
 * PENDING. Notifications are in-app only — there is no email channel for them at all. Until email is
 * configured and verified, the screens say "Coming Soon" instead of showing a delivery status. Set this
 * to true once NORMAONE_EMAIL_FROM (and SES or SMTP) is configured and a real email has been received;
 * the plan-change screens then show the outbox's honest status (SENT, PENDING, FAILED) again.
 */
export const EMAIL_DELIVERY_AVAILABLE = false
