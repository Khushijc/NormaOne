package com.NormaOne.backend.dto.admin;

import com.NormaOne.backend.model.core.enums.UserStatus;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Change a user's status: ACTIVE, SUSPENDED or DEACTIVATED (INVITED is set only by creating an
 * invitation). A reason is required to suspend or deactivate.
 *
 * {@code confirmNoActiveAdmin} is read only by the Super Admin's administrator route: true confirms
 * suspending or deactivating an organization's only active administrator (for example a compromised
 * account), after which the Super Admin invites a replacement. The tenant API never allows that and
 * ignores the field.
 */
public record UserStatusRequest(
        @NotNull(message = "Status is required")
        UserStatus status,

        @Size(max = 500, message = "Reason must not exceed 500 characters")
        String reason,

        Boolean confirmNoActiveAdmin
) {
    public UserStatusRequest(UserStatus status, String reason) {
        this(status, reason, null);
    }
}
