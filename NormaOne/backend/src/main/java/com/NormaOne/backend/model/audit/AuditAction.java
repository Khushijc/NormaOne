package com.NormaOne.backend.model.audit;

public enum AuditAction {
    TENANT_ONBOARDED,
    TENANT_CREATED,
    TENANT_UPDATED,
    TENANT_STATUS_CHANGED,
    USER_INVITED,
    USER_LINKED,
    USER_UPDATED,
    USER_ROLE_CHANGED,
    USER_STATUS_CHANGED,
    USER_INVITATION_RESENT,
    /**
     * Legacy: written by the former general administrator permissions, which no longer exist. Kept
     * only so audit events already stored with it still load and can be filtered; never written now.
     */
    ADMIN_PERMISSIONS_CHANGED,
    USER_MODULE_ACCESS_CHANGED,
    USER_EMAIL_PREFERENCE_CHANGED,
    SUPER_ADMIN_PROVISIONED,
    PACKAGE_ASSIGNED,
    PACKAGE_CHANGED,
    PLAN_CREATED,
    PLAN_UPDATED,
    PLAN_STATUS_CHANGED,
    PLAN_CHANGE_REQUESTED,
    PLAN_CHANGE_APPROVED,
    PLAN_CHANGE_REJECTED,
    PLAN_CHANGE_CANCELLED,
    NOTIFICATION_CREATED,
    NOTIFICATION_UPDATED,
    NOTIFICATION_ARCHIVED,
    NOTIFICATION_RESTORED
}
