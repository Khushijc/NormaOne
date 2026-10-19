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
 * A tenant administrator as the Super Admin sees it. What they may do in their organization follows
 * from the ADMIN role; what they may do in the application modules is {@code moduleAccess} and
 * {@code modulePermissions}, per module at GET /api/super-admin/admins/{id}/modules. The Cognito sub
 * is never included — {@code linked} says whether one exists.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminResponse(
        String id,
        String name,
        String email,
        String phoneNumber,
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
        /** Only on the answer to an invitation or a resend: how it reached the person. */
        InvitationInfo invitation,
        /** Assigned application modules (stored). */
        List<ModuleApps> moduleAccess,
        /** Assigned module permissions (stored), inside the assigned modules only. */
        List<ModulePermission> modulePermissions
) {
    public static AdminResponse of(user u, Tenant tenant) {
        return new AdminResponse(u.getId(), u.getName(), u.getEmail(), u.getPhoneNumber(), "ADMIN", u.getStatus(),
                u.getCognitoSub() != null && !u.getCognitoSub().isBlank(),
                OrganizationSummary.of(u.getTenantId(), tenant),
                u.getInvitedAt(), u.getActivatedAt(), u.getDeactivatedAt(), u.getStatusReason(), u.getCreatedAt(), u.getUpdatedAt(),
                null,
                ModuleCatalog.storedModules(u.getModuleAccess()),
                ModuleCatalog.assignedPermissions(u.getModulePermissions(), u.getModuleAccess()));
    }

    public AdminResponse withInvitation(InvitationInfo info) {
        return new AdminResponse(id, name, email, phoneNumber, role, status, linked,
                organization, invitedAt, activatedAt, deactivatedAt, statusReason, createdAt, updatedAt, info,
                moduleAccess, modulePermissions);
    }
}
