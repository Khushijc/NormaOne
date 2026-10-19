package com.NormaOne.backend.model.notification.enums;

/**
 * Who a notification is for. Always inside one tenant: there is no platform-wide audience.
 */
public enum NotificationAudience {
    /** The users listed in {@code Notification.users}, each with their own read state. */
    SELECTED,
    /**
     * Every eligible member of the notification's tenant who joined on or before it was created.
     * {@code Notification.users} stays empty; read state lives in {@code notification_receipts}.
     */
    TENANT
}
