package com.NormaOne.backend.dto.admin;

import java.time.Instant;

import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A platform Super Admin as another Super Admin sees it. The Cognito sub is never included —
 * {@code linked} says whether one exists — and neither is any credential.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SuperAdminResponse(
        String id,
        String name,
        String email,
        String phoneNumber,
        String role,
        UserStatus status,
        boolean linked,
        Instant invitedAt,
        Instant activatedAt,
        Instant deactivatedAt,
        String statusReason,
        Instant createdAt,
        Instant updatedAt,
        /** Only on the answer to an invitation or a resend: how it reached the person. */
        InvitationInfo invitation
) {
    public static SuperAdminResponse of(user u) {
        return new SuperAdminResponse(u.getId(), u.getName(), u.getEmail(), u.getPhoneNumber(), "SUPER_ADMIN", u.getStatus(),
                u.getCognitoSub() != null && !u.getCognitoSub().isBlank(),
                u.getInvitedAt(), u.getActivatedAt(), u.getDeactivatedAt(), u.getStatusReason(), u.getCreatedAt(), u.getUpdatedAt(),
                null);
    }

    public SuperAdminResponse withInvitation(InvitationInfo info) {
        return new SuperAdminResponse(id, name, email, phoneNumber, role, status, linked, invitedAt, activatedAt, deactivatedAt,
                statusReason, createdAt, updatedAt, info);
    }
}
