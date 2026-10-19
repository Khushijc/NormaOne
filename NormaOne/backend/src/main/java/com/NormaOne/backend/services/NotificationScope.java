package com.NormaOne.backend.services;

import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.security.CurrentUser;

/**
 * Who is managing notifications, and in which tenant. Built only by NotificationService: from the
 * Tenant Admin's stored record (their own tenant) or from the Super Admin's route (a tenant that
 * exists). Never from a tenant id in a request body.
 */
public record NotificationScope(CurrentUser actor, Tenant tenant) {

    public String tenantId() {
        return tenant.getId();
    }

    /** A Super Admin, who may change notifications any administrator created. */
    public boolean platform() {
        return actor.isSuperAdmin();
    }
}
