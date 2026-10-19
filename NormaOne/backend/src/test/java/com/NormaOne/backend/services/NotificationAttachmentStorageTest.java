package com.NormaOne.backend.services;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.exceptions.AttachmentStorageException;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.notification.NotificationAttachment;
import com.NormaOne.backend.security.CurrentUser;

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** The storage implementations and their failure handling, without AWS or MongoDB. */
class NotificationAttachmentStorageTest {

    private static final byte[] PDF = "%PDF-1.4\n%%EOF".getBytes(StandardCharsets.US_ASCII);

    @Test
    void s3DownloadsAreShortLivedPresignedUrlsThatForceADownload() {
        // Signing is local: no request reaches AWS. The credentials are placeholders for the signature only.
        StaticCredentialsProvider placeholder = StaticCredentialsProvider.create(AwsBasicCredentials.create("TESTKEY", "TESTSECRET"));
        try (S3Presigner presigner = S3Presigner.builder().region(Region.EU_CENTRAL_1).credentialsProvider(placeholder).build();
                S3Client client = S3Client.builder().region(Region.EU_CENTRAL_1).credentialsProvider(placeholder).build()) {
            // Not closed itself: closing it would close the client and presigner the try block owns.
            @SuppressWarnings("resource")
            S3NotificationAttachmentStorage storage = new S3NotificationAttachmentStorage(
                    client, presigner, "normaone-attachments", "prod/", Duration.ofSeconds(60));

            NotificationAttachmentStorage.Download download =
                    storage.download("notifications/t1/n1/a1", "Política 2026.pdf", "application/pdf");
            URI url = assertInstanceOf(NotificationAttachmentStorage.Redirect.class, download).location();
            String query = URLDecoder.decode(url.getRawQuery(), StandardCharsets.UTF_8);
            assertEquals("https", url.getScheme());
            assertTrue(url.getHost().startsWith("normaone-attachments."), url.getHost());
            assertTrue(url.getPath().endsWith("/prod/notifications/t1/n1/a1"), url.getPath());
            assertTrue(query.contains("X-Amz-Expires=60"), query);
            assertTrue(query.contains("response-content-disposition=attachment"), query);
            assertTrue(query.contains("response-content-type=application/pdf"), query);
            assertEquals("S3", storage.provider());
        }
    }

    @Test
    void localStorageStaysInsideItsDirectory(@TempDir Path root) {
        LocalNotificationAttachmentStorage storage = new LocalNotificationAttachmentStorage(root);
        storage.put("notifications/t1/n1/a1", PDF, "application/pdf");
        assertTrue(root.resolve("notifications/t1/n1/a1").toFile().isFile());
        assertInstanceOf(NotificationAttachmentStorage.Content.class, storage.download("notifications/t1/n1/a1", "a.pdf", "application/pdf"));
        assertThrows(IllegalStateException.class, () -> storage.put("../outside", PDF, "application/pdf"));
        assertThrows(IllegalStateException.class, () -> storage.put("/absolute/key", PDF, "application/pdf"));
        storage.delete("notifications/t1/n1/a1");
        assertTrue(root.resolve("notifications/t1/n1/a1").toFile().exists() == false);
    }

    @Test
    void aStorageFailureIsReportedAndNothingIsReturned() {
        NotificationAttachmentStorage failing = new NotificationAttachmentStorage() {
            @Override
            public String provider() {
                return "S3";
            }

            @Override
            public void put(String key, byte[] content, String contentType) {
                throw new IllegalStateException("bucket unreachable");
            }

            @Override
            public void delete(String key) {
            }

            @Override
            public Download download(String key, String fileName, String contentType) {
                throw new UnsupportedOperationException();
            }
        };
        NotificationAttachments attachments = new NotificationAttachments(failing, new NormaOneProperties());
        CurrentUser actor = new CurrentUser("sub", user.builder().id("u1").tenantId("t1").roles(Set.of(UserRole.ADMIN)).build(),
                null, UserRole.ADMIN);
        AttachmentStorageException refused = assertThrows(AttachmentStorageException.class,
                () -> attachments.store("t1", "n1", new MockMultipartFile("attachment", "a.pdf", "application/pdf", PDF), actor));
        assertTrue(refused.getMessage().contains("Nothing was saved"));
    }

    @Test
    void anAttachmentFromAnotherStorageIsNotServed(@TempDir Path root) {
        NotificationAttachments attachments = new NotificationAttachments(new LocalNotificationAttachmentStorage(root), new NormaOneProperties());
        NotificationAttachment elsewhere = NotificationAttachment.builder().attachmentId("a1").storageProvider("S3")
                .storageKey("notifications/t1/n1/a1").fileName("a.pdf").contentType("application/pdf").build();
        assertThrows(com.NormaOne.backend.exceptions.ResourceNotFoundException.class, () -> attachments.download(elsewhere));
        assertThrows(com.NormaOne.backend.exceptions.ResourceNotFoundException.class, () -> attachments.download(null));
        // Discarding it is skipped rather than deleting a key in the wrong store.
        attachments.discard(elsewhere);
    }
}
