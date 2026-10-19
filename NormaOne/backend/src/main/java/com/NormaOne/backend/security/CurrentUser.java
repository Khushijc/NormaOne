package com.NormaOne.backend.security;

import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.user;

/**
 * The authenticated caller as known to the application: the Cognito subject from the validated
 * JWT, the persisted user record (if any), its tenant (if any) and the canonical role it may act
 * with right now.
 *
 * {@code role} is null when the caller has no usable role: no user record yet (onboarding not
 * completed), an inactive account, or a tenant that is not ACTIVE.
 */
public record CurrentUser(String cognitoSub, user user, Tenant tenant, UserRole role) {

    public boolean hasRecord() {
        return user != null;
    }

    public boolean isSuperAdmin() {
        return role == UserRole.SUPER_ADMIN;
    }

    public boolean isTenantAdmin() {
        return role == UserRole.ADMIN;
    }

    public String userId() {
        return user != null ? user.getId() : null;
    }

    /** Tenant id from the persisted user record (never from a request). */
    public String tenantId() {
        return user != null ? user.getTenantId() : null;
    }
}
