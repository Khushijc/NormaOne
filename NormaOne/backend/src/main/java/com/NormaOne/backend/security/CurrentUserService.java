package com.NormaOne.backend.security;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.model.core.enums.UserRole;

/**
 * Service-layer authorization: re-checks the caller's role against the database, independently
 * of the HTTP security rules, before any administrative operation.
 *
 * Platform and tenant administration are decided by role and tenant only: SUPER_ADMIN for the
 * platform, an ACTIVE ADMIN of an ACTIVE tenant for that tenant (always the tenant on the caller's
 * stored record). There is no second, general permission list. What a member may do inside an
 * application module is decided by module permissions alone (ModuleAccessService).
 */
@Service
public class CurrentUserService {

    private final CurrentUserResolver resolver;

    public CurrentUserService(CurrentUserResolver resolver) {
        this.resolver = resolver;
    }

    public CurrentUser current(Jwt jwt) {
        return resolver.resolve(jwt);
    }

    public CurrentUser requireSuperAdmin(Jwt jwt) {
        CurrentUser current = resolver.resolve(jwt);
        if (!current.isSuperAdmin()) {
            throw new AccessDeniedException("Platform administration requires the SUPER_ADMIN role.");
        }
        return current;
    }

    public CurrentUser requireTenantAdmin(Jwt jwt) {
        CurrentUser current = resolver.resolve(jwt);
        if (!current.isTenantAdmin() || current.tenantId() == null) {
            throw new AccessDeniedException("Tenant administration requires the ADMIN role.");
        }
        return current;
    }

    /**
     * A member of an ACTIVE tenant — ADMIN or USER — whose tenant comes from the stored user record.
     * A platform account (SUPER_ADMIN, no tenant) and an account without a role are refused.
     */
    public CurrentUser requireTenantMember(Jwt jwt) {
        CurrentUser current = resolver.resolve(jwt);
        boolean member = current.role() == UserRole.ADMIN || current.role() == UserRole.USER;
        if (!member || current.tenantId() == null) {
            throw new AccessDeniedException("This requires a member of an organization.");
        }
        return current;
    }
}
