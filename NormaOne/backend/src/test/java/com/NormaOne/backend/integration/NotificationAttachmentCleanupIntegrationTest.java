package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.notification.Notification;
import com.NormaOne.backend.repositories.NotificationRepository;

/**
 * When the notification cannot be saved after its attachment file was stored, the file is deleted
 * again: no object is left that no notification refers to. The repository is mocked to fail; the
 * storage is the real local one.
 */
class NotificationAttachmentCleanupIntegrationTest extends NotificationTestBase {

    @MockitoBean
    private NotificationRepository notificationRepository;

    @Autowired
    private NormaOneProperties properties;

    @Test
    void aFailedSaveDeletesTheStoredFile() throws Exception {
        Path root = Path.of(properties.getAttachments().getLocal().getDirectory()).toAbsolutePath().normalize();
        NotificationAttachmentIntegrationTest.deleteTree(root);
        when(notificationRepository.insert(any(Notification.class)))
                .thenThrow(new DataAccessResourceFailureException("MongoDB is unavailable"));

        mvc.perform(multipart("/api/tenant/notifications")
                        .file(new MockMultipartFile("notification", "", "application/json",
                                broadcast("Lost").getBytes(StandardCharsets.UTF_8)))
                        .file(new MockMultipartFile("attachment", "lost.pdf", "application/pdf", NotificationAttachmentIntegrationTest.PDF))
                        .with(as(ADMIN_A)))
                .andExpect(status().isInternalServerError());

        verify(notificationRepository).insert(any(Notification.class));
        assertEquals(0, regularFiles(root), "the stored file was removed after the save failed");
    }

    private static long regularFiles(Path root) throws Exception {
        if (Files.notExists(root)) {
            return 0;
        }
        try (Stream<Path> files = Files.walk(root)) {
            return files.filter(Files::isRegularFile).count();
        }
    }
}
