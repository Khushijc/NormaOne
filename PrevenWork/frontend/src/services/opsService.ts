/**
 * Operations & Session Management Service for PrevenWork.
 */
import { setSession, patchUiOnly, resetDemoData } from '../store/db';
import type { AppNotification, Company, Database, ID, Membership } from '../domain/types';

export function switchIdentity(userId: ID, companyId: ID) {
  setSession({ userId, companyId });
}

export function accessibleCompanies(
  db: Database,
  userId: ID
): { company: Company; membership: Membership; active: boolean }[] {
  const memberships = db.memberships.filter((m) => m.userId === userId);
  return memberships.map((m) => {
    const c = db.companies.find((comp) => comp.id === m.companyId)!;
    return {
      company: c,
      membership: m,
      active: m.status === 'active',
    };
  });
}

export function myNotifications(db: Database, userId: ID, companyId: ID): AppNotification[] {
  return db.notifications
    .filter((n) => n.companyId === companyId && n.recipientUserIds.includes(userId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function markNotificationRead(id: ID, userId: ID) {
  patchUiOnly('notifications', id, {
    readBy: [userId],
  });
}

export { resetDemoData };
