package com.NormaOne.backend.dto.notification;

import java.util.List;

import com.NormaOne.backend.model.notification.Notification;
import com.NormaOne.backend.model.notification.enums.NotificationAudience;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * A new notification. SELECTED needs {@code userIds} (members of the target tenant); TENANT takes
 * none and reaches every eligible member of that one tenant.
 *
 * The backend builds the recipients ({@code readStatus: false, readAt: null}): a {@code users}
 * array with read states, a {@code tenantId} or a {@code createdBy} in the body is ignored. The
 * tenant is the caller's own (Tenant Admin) or the one in the path (Super Admin).
 */
public record CreateNotificationRequest(
        @NotBlank(message = "Subject is required")
        @Size(max = Notification.SUBJECT_MAX, message = "Subject must not exceed 200 characters")
        String subject,

        @NotBlank(message = "Body is required")
        @Size(max = Notification.BODY_MAX, message = "Body must not exceed 10000 characters")
        String body,

        @NotNull(message = "Audience is required: SELECTED or TENANT")
        NotificationAudience audience,

        List<@NotBlank(message = "A user id must not be blank") @Size(max = 64, message = "A user id must not exceed 64 characters") String> userIds
) {}
