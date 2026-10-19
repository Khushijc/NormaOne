package com.NormaOne.backend.dto.notification;

import java.time.Instant;

import com.NormaOne.backend.model.notification.NotificationAttachment;

/**
 * An attachment as clients see it. The storage provider and key are not exposed: the file is
 * fetched through the notification's attachment endpoint, which checks access first.
 */
public record AttachmentInfo(
        String attachmentId,
        String fileName,
        String contentType,
        long sizeBytes,
        String checksumSha256,
        Instant uploadedAt
) {
    public static AttachmentInfo of(NotificationAttachment a) {
        return a == null ? null
                : new AttachmentInfo(a.getAttachmentId(), a.getFileName(), a.getContentType(), a.getSizeBytes(),
                        a.getChecksumSha256(), a.getUploadedAt());
    }
}
