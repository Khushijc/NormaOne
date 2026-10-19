import { detailPath } from '../paths.js'

/**
 * The two places notifications are managed from, as the scope NotificationParts reads: which eight
 * endpoints, which path parameters, where a notification's page is, and whose member lists the
 * recipient picker offers. Kept out of the .jsx files so they stay component-only (fast refresh).
 */

/** A Tenant Admin: their own tenant, which the backend takes from their record — no id anywhere. */
export const tenantNotificationScope = {
  ids: {
    create: 'tenant-notif-create',
    list: 'tenant-notif-list',
    get: 'tenant-notif-get',
    update: 'tenant-notif-update',
    status: 'tenant-notif-status',
    'attachment-put': 'tenant-notif-attachment-put',
    'attachment-delete': 'tenant-notif-attachment-delete',
    'attachment-get': 'tenant-notif-attachment-get',
  },
  pathParams: {},
  platform: false,
  detailPath: (id) => detailPath('tenant', 'notifications', 'notifications', id),
  memberSources: [{ endpointId: 'tenant-list-users', query: {} }],
}

/**
 * A Super Admin, in the tenant chosen on the list page. The tenant id travels in the page address
 * (?tenant=), so a notification's page can be reloaded or linked.
 */
export function platformNotificationScope(tenantId) {
  return {
    ids: {
      create: 'sa-notif-create',
      list: 'sa-notif-list',
      get: 'sa-notif-get',
      update: 'sa-notif-update',
      status: 'sa-notif-status',
      'attachment-put': 'sa-notif-attachment-put',
      'attachment-delete': 'sa-notif-attachment-delete',
      'attachment-get': 'sa-notif-attachment-get',
    },
    pathParams: { tenantId },
    platform: true,
    detailPath: (id) => `${detailPath('platform', 'notifications', 'notifications', id)}?tenant=${encodeURIComponent(tenantId)}`,
    // Regular users and administrators are two lists on the platform side.
    memberSources: [
      { endpointId: 'sa-list-users', query: { tenantId } },
      { endpointId: 'sa-list-admins', query: { tenantId } },
    ],
  }
}

/** Who sent a notification, as a member reads it. */
export const senderOf = (role) => (role === 'SUPER_ADMIN' ? 'NormaOne (platform)' : 'Your organization')
