package com.NormaOne.backend.services;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

import org.bson.types.ObjectId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.exceptions.AttachmentStorageException;
import com.NormaOne.backend.exceptions.AttachmentTooLargeException;
import com.NormaOne.backend.exceptions.InvalidAttachmentException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.notification.NotificationAttachment;
import com.NormaOne.backend.security.CurrentUser;

/**
 * The lifecycle of a notification's attachment file. Callers have already checked who may act.
 *
 * <ol>
 *   <li>Store: size limit, content check (AttachmentInspector), SHA-256, then the file is written
 *       under a key made of ids only — {@code notifications/<tenantId>/<notificationId>/<attachmentId>}.</li>
 *   <li>The caller then writes the metadata to MongoDB. If that fails it calls {@link #discard}, so
 *       no file is left without a notification.</li>
 *   <li>Replacing or removing an attachment discards the old file only after the database no longer
 *       refers to it. Archiving keeps the file: administrators can still open an archived
 *       notification and its attachment.</li>
 * </ol>
 * File names and contents are never logged; only ids.
 */
@Service
public class NotificationAttachments {

    private static final Logger log = LoggerFactory.getLogger(NotificationAttachments.class);

    private final NotificationAttachmentStorage storage;
    private final NormaOneProperties properties;

    public NotificationAttachments(NotificationAttachmentStorage storage, NormaOneProperties properties) {
        this.storage = storage;
        this.properties = properties;
    }

    /** Checks and stores an uploaded file; returns the metadata to save on the notification. */
    public NotificationAttachment store(String tenantId, String notificationId, MultipartFile file, CurrentUser actor) {
        long maxBytes = properties.getAttachments().getMaxSize().toBytes();
        if (file.getSize() > maxBytes) {
            // Before reading it: the size the container reports is enough to refuse.
            throw new AttachmentTooLargeException("The attachment is larger than the maximum of " + AttachmentInspector.describe(maxBytes) + ".");
        }
        byte[] content;
        try {
            content = file.getBytes();
        } catch (IOException ex) {
            throw new InvalidAttachmentException("The attachment could not be read.");
        }
        AttachmentInspector.Inspected inspected = AttachmentInspector.inspect(
                file.getOriginalFilename(), content, maxBytes, properties.getAttachments().getAllowedTypes());

        String attachmentId = new ObjectId().toHexString();
        String key = "notifications/" + tenantId + "/" + notificationId + "/" + attachmentId;
        try {
            storage.put(key, content, inspected.type().mimeType());
        } catch (RuntimeException ex) {
            log.error("Attachment {} for notification {} could not be stored: {}", attachmentId, notificationId,
                    ex.getClass().getSimpleName());
            throw new AttachmentStorageException("The attachment could not be stored. Nothing was saved; try again.", ex);
        }
        return NotificationAttachment.builder()
                .attachmentId(attachmentId)
                .fileName(inspected.fileName())
                .contentType(inspected.type().mimeType())
                .sizeBytes(content.length)
                .checksumSha256(inspected.checksumSha256())
                .storageProvider(storage.provider())
                .storageKey(key)
                .uploadedAt(Instant.now())
                .uploadedByDocsId(actor.userId())
                .build();
    }

    /**
     * Deletes a file no notification refers to any more (a failed save, a replaced or removed
     * attachment). Best effort: a failure is logged with the ids, and the request still succeeds.
     */
    public void discard(NotificationAttachment attachment) {
        if (attachment == null || attachment.getStorageKey() == null) {
            return;
        }
        if (!storage.provider().equals(attachment.getStorageProvider())) {
            log.warn("Attachment {} is in {} storage, not {}; its file was not deleted.", attachment.getAttachmentId(),
                    attachment.getStorageProvider(), storage.provider());
            return;
        }
        try {
            storage.delete(attachment.getStorageKey());
        } catch (RuntimeException ex) {
            log.warn("Attachment {} file could not be deleted ({}); remove {} manually.", attachment.getAttachmentId(),
                    ex.getClass().getSimpleName(), attachment.getStorageKey());
        }
    }

    /**
     * The download of an attachment the caller may see: a 302 to a short-lived signed URL (S3) or
     * the file itself (local), always as a download, never displayed inline, and never cached.
     */
    public ResponseEntity<?> download(NotificationAttachment attachment) {
        if (attachment == null) {
            throw new ResourceNotFoundException("This notification has no attachment.");
        }
        if (!storage.provider().equals(attachment.getStorageProvider())) {
            log.warn("Attachment {} is in {} storage, not {}.", attachment.getAttachmentId(), attachment.getStorageProvider(),
                    storage.provider());
            throw new ResourceNotFoundException("The attachment file is not available.");
        }
        NotificationAttachmentStorage.Download download =
                storage.download(attachment.getStorageKey(), attachment.getFileName(), attachment.getContentType());
        if (download instanceof NotificationAttachmentStorage.Redirect redirect) {
            return ResponseEntity.status(302)
                    .location(redirect.location())
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .build();
        }
        NotificationAttachmentStorage.Content content = (NotificationAttachmentStorage.Content) download;
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(attachment.getContentType()))
                .contentLength(attachment.getSizeBytes())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(attachment.getFileName(), StandardCharsets.UTF_8).build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(content.resource());
    }
}
