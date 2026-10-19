package com.NormaOne.backend.dto.notification;

import java.time.Instant;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.notification.enums.NotificationAudience;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A notification in the signed-in member's inbox: the caller's own {@code readStatus} and
 * {@code readAt} only. The recipient list is never included. {@code createdByRole} says whether it
 * came from the organization (ADMIN) or the platform (SUPER_ADMIN).
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record NotificationInboxItem(
        String id,
        String subject,
        String body,
        NotificationAudience audience,
        boolean readStatus,
        Instant readAt,
        AttachmentInfo attachment,
        UserRole createdByRole,
        Instant createdAt,
        Instant updatedAt
) {}
