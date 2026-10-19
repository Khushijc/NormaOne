package com.NormaOne.backend.model.notification;

import java.time.Instant;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Metadata of a notification's attachment, embedded in the notification. The file itself is in
 * object storage (NotificationAttachmentStorage) under {@code storageKey}, which is never sent to
 * clients: downloads go through the API, which checks visibility first.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NotificationAttachment {

    private String attachmentId;

    /** The uploaded file's name, without any path, for display and the download's file name. */
    private String fileName;

    /** The content type of the detected file type (AttachmentType), not the one the client sent. */
    private String contentType;

    private long sizeBytes;

    /** Hex SHA-256 of the stored bytes. */
    private String checksumSha256;

    /** LOCAL or S3: the storage the object was written to. */
    private String storageProvider;

    private String storageKey;

    private Instant uploadedAt;

    private String uploadedByDocsId;
}
