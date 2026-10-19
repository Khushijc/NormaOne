package com.NormaOne.backend.dto.notification;

import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.notification.Notification;
import com.NormaOne.backend.model.notification.enums.NotificationAudience;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A notification as administrators see it (Tenant Admin, Super Admin).
 *
 * {@code status} is the stored recordState. {@code users} is the recipient list with read states:
 * on a single notification only (lists carry the counts). For a TENANT notification it is empty,
 * {@code readCount} counts the receipts and {@code eligibleCount} the members it reaches (INVITED
 * or ACTIVE, joined on or before it was created).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record NotificationResponse(
        String id,
        String tenantId,
        String subject,
        String body,
        NotificationAudience audience,
        RecordState status,
        Instant archivedAt,
        AttachmentInfo attachment,
        List<RecipientResponse> users,
        Integer recipientCount,
        Long readCount,
        Long eligibleCount,
        String createdBy,
        UserRole createdByRole,
        String updatedBy,
        Instant createdAt,
        Instant updatedAt
) {
    public static NotificationResponse of(Notification n, List<RecipientResponse> users, Integer recipientCount,
            Long readCount, Long eligibleCount) {
        return new NotificationResponse(n.getId(), n.getTenantId(), n.getSubject(), n.getBody(), n.getAudience(),
                n.getRecordState(), n.getArchivedAt(), AttachmentInfo.of(n.getAttachment()), users, recipientCount,
                readCount, eligibleCount, n.getCreatedByDocsId(), n.getCreatedByRole(), n.getUpdatedByDocsId(),
                n.getCreatedAt(), n.getUpdatedAt());
    }
}
