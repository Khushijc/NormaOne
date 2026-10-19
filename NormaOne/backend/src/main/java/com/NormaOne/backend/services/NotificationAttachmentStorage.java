package com.NormaOne.backend.services;

import java.net.URI;

import org.springframework.core.io.Resource;

/**
 * Where notification attachment files live. Keys are built by the server from ids only
 * (NotificationAttachments); callers check visibility before asking for a download.
 * Implementations: LocalNotificationAttachmentStorage (development), S3NotificationAttachmentStorage
 * (production, private bucket). Chosen by normaone.attachments.storage (AttachmentStorageConfig).
 */
public interface NotificationAttachmentStorage {

    /** LOCAL or S3, recorded on each attachment as its storageProvider. */
    String provider();

    void put(String key, byte[] content, String contentType);

    void delete(String key);

    /** The file for an authorized download: a short-lived redirect (S3) or the bytes themselves (local). */
    Download download(String key, String fileName, String contentType);

    /** One of the two shapes a download takes. */
    sealed interface Download permits Redirect, Content {}

    /** Send the browser to a short-lived, signed URL for the object. */
    record Redirect(URI location) implements Download {}

    /** Stream these bytes from the API itself. */
    record Content(Resource resource) implements Download {}
}
