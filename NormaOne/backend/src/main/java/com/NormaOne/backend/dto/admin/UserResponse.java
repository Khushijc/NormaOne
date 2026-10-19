package com.NormaOne.backend.dto.admin;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A user as seen by administrators. The Cognito subject is not exposed; {@code linked} says
 * whether the record is attached to a Cognito account (false for a pending invitation).
 * {@code moduleAccess} and {@code modulePermissions} are the stored module assignment; per module,
 * with plan entitlement, it is GET /api/tenant/users/{id}/modules.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserResponse(
        String id,
        String tenantId,
        String name,
        String email,
        String phoneNumber,
        UserStatus status,
        Set<UserRole> roles,
        UserRole effectiveRole,
        boolean linked,
        Instant invitedAt,
        Instant activatedAt,
        Instant deactivatedAt,
        String statusReason,
        Instant createdAt,
        Instant updatedAt,
        /** Only on the answer to an invitation or a resend: how it reached the person. */
        InvitationInfo invitation,
        List<ModuleApps> moduleAccess,
        List<ModulePermission> modulePermissions
) {
    /** {@code effectiveRole} is the canonical role stored on the record (status and tenant status not applied). */
    public static UserResponse of(user u) {
        UserRole canonical = u.getRoles() == null ? null : u.getRoles().stream()
                .map(UserRole::canonical)
                .min((a, b) -> Integer.compare(a.ordinal(), b.ordinal()))
                .orElse(null);
        return new UserResponse(u.getId(), u.getTenantId(), u.getName(), u.getEmail(), u.getPhoneNumber(),
                u.getStatus(), u.getRoles(), canonical, u.getCognitoSub() != null && !u.getCognitoSub().isBlank(),
                u.getInvitedAt(), u.getActivatedAt(), u.getDeactivatedAt(), u.getStatusReason(),
                u.getCreatedAt(), u.getUpdatedAt(), null,
                ModuleCatalog.storedModules(u.getModuleAccess()),
                ModuleCatalog.assignedPermissions(u.getModulePermissions(), u.getModuleAccess()));
    }

    public UserResponse withInvitation(InvitationInfo info) {
        return new UserResponse(id, tenantId, name, email, phoneNumber, status, roles, effectiveRole, linked, invitedAt,
                activatedAt, deactivatedAt, statusReason, createdAt, updatedAt, info, moduleAccess, modulePermissions);
    }
}
