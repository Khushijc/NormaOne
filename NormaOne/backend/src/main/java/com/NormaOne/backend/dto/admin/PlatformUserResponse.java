package com.NormaOne.backend.dto.admin;

import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A regular user as the Super Admin sees it: read-only, and only what platform administration
 * needs — who, which organization, what state. No phone number (contact is the organization's
 * business), no Cognito sub, no administrator permissions (a USER has none); the module assignment
 * its organization gave it is shown, read only.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PlatformUserResponse(
        String id,
        String name,
        String email,
        String role,
        UserStatus status,
        boolean linked,
        OrganizationSummary organization,
        Instant invitedAt,
        Instant activatedAt,
        Instant deactivatedAt,
        String statusReason,
        Instant createdAt,
        Instant updatedAt,
        /** Assigned application modules (stored; read only here — the organization's administrators assign them). */
        List<ModuleApps> moduleAccess,
        /** Assigned module permissions (stored). */
        List<ModulePermission> modulePermissions
) {
    public static PlatformUserResponse of(user u, Tenant tenant) {
        return new PlatformUserResponse(u.getId(), u.getName(), u.getEmail(), "USER", u.getStatus(),
                u.getCognitoSub() != null && !u.getCognitoSub().isBlank(),
                OrganizationSummary.of(u.getTenantId(), tenant),
                u.getInvitedAt(), u.getActivatedAt(), u.getDeactivatedAt(), u.getStatusReason(), u.getCreatedAt(), u.getUpdatedAt(),
                ModuleCatalog.storedModules(u.getModuleAccess()),
                ModuleCatalog.assignedPermissions(u.getModulePermissions(), u.getModuleAccess()));
    }
}
