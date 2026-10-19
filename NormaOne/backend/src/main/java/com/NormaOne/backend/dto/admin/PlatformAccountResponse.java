package com.NormaOne.backend.dto.admin;

import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.services.UserAdministration;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One account in the Super Admin's cross-tenant directory (GET /api/super-admin/accounts), whatever
 * its role. Like the per-role views it never includes the Cognito sub, and — as for regular users —
 * no phone number. {@code moduleAccess} and {@code modulePermissions} are the stored module
 * assignment (per module: GET /api/super-admin/admins/{id}/modules).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PlatformAccountResponse(
        String id,
        String name,
        String email,
        UserRole role,
        UserStatus status,
        boolean linked,
        OrganizationSummary organization,
        List<ModuleApps> moduleAccess,
        List<ModulePermission> modulePermissions,
        Instant invitedAt,
        Instant activatedAt,
        Instant deactivatedAt,
        String statusReason,
        Instant createdAt,
        Instant updatedAt
) {
    public static PlatformAccountResponse of(user u, Tenant tenant) {
        UserRole role = UserAdministration.accountRole(u);
        return new PlatformAccountResponse(u.getId(), u.getName(), u.getEmail(), role, u.getStatus(),
                u.getCognitoSub() != null && !u.getCognitoSub().isBlank(),
                OrganizationSummary.of(u.getTenantId(), tenant),
                ModuleCatalog.storedModules(u.getModuleAccess()),
                ModuleCatalog.assignedPermissions(u.getModulePermissions(), u.getModuleAccess()),
                u.getInvitedAt(), u.getActivatedAt(), u.getDeactivatedAt(), u.getStatusReason(), u.getCreatedAt(), u.getUpdatedAt());
    }
}
