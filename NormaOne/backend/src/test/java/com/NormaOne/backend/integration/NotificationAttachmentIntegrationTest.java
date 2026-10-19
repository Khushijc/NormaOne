package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.bson.Document;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;

import com.NormaOne.backend.config.NormaOneProperties;

/**
 * Attachments: content-checked uploads, downloads authorized exactly like viewing the notification,
 * replacement and removal deleting the old file, and tenant isolation of downloads.
 */
class NotificationAttachmentIntegrationTest extends NotificationTestBase {

    static final byte[] PDF = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);
    static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 'I', 'H', 'D', 'R'};

    @Autowired
    private NormaOneProperties properties;

    @BeforeEach
    void emptyStorage() throws Exception {
        deleteTree(storageRoot());
    }

    // ==================== upload and download ====================

    @Test
    void storesACheckedFileAndServesItOnlyAsADownload() throws Exception {
        String uma = member(tenantA, "uma");
        // The client claims text/plain; the content decides.
        String response = createWith("/api/tenant/notifications", ADMIN_A, selected("Policy", uma),
                new MockMultipartFile("attachment", "C:\\Users\\me\\Policy.pdf", "text/plain", PDF))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachment.fileName").value("Policy.pdf"))
                .andExpect(jsonPath("$.attachment.contentType").value("application/pdf"))
                .andExpect(jsonPath("$.attachment.sizeBytes").value(PDF.length))
                .andExpect(jsonPath("$.attachment.checksumSha256").value(sha256(PDF)))
                .andExpect(jsonPath("$.attachment.storageKey").doesNotExist())
                .andExpect(jsonPath("$.attachment.storageProvider").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        String id = json(response, "$.id");

        Document stored = raw(id).get("attachment", Document.class);
        assertEquals("LOCAL", stored.getString("storageProvider"));
        assertTrue(stored.getString("storageKey").startsWith("notifications/" + tenantA + "/" + id + "/"));
        assertEquals(userIdOf(ADMIN_A), stored.getString("uploadedByDocsId"));
        assertEquals(1, storedFiles());

        mvc.perform(get("/api/notifications/" + id).with(as("uma")))
                .andExpect(jsonPath("$.attachment.fileName").value("Policy.pdf"));
        byte[] downloaded = mvc.perform(get("/api/notifications/" + id + "/attachment").with(as("uma")))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/pdf"))
                .andExpect(header().string("Content-Disposition", containsString("attachment")))
                .andExpect(header().string("Content-Disposition", containsString("Policy.pdf")))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andReturn().getResponse().getContentAsByteArray();
        assertArrayEquals(PDF, downloaded);
        mvc.perform(get("/api/tenant/notifications/" + id + "/attachment").with(as(ADMIN_A))).andExpect(status().isOk());

        // Without an attachment there is nothing to download.
        String plain = sendAsTenantAdmin(ADMIN_A, selected("No file", uma));
        mvc.perform(get("/api/notifications/" + plain + "/attachment").with(as("uma"))).andExpect(status().isNotFound());
    }

    @Test
    void acceptsOfficeDocumentsByTheirPackageContents() throws Exception {
        createWith("/api/tenant/notifications", ADMIN_A, broadcast("Report"),
                new MockMultipartFile("attachment", "report.docx", "application/octet-stream", office("word/document.xml")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachment.contentType").value("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
        createWith("/api/tenant/notifications", ADMIN_A, broadcast("Figures"),
                new MockMultipartFile("attachment", "figures.xlsx", "application/octet-stream", office("xl/workbook.xml")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachment.contentType").value("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
        assertEquals(2, storedFiles());
    }

    // ==================== 14. invalid and oversized ====================

    @Test
    void rejectsFilesWhoseContentIsNotAcceptedOrTooLarge() throws Exception {
        String uma = member(tenantA, "uma");
        String path = "/api/tenant/notifications";
        createWith(path, ADMIN_A, selected("x", uma),
                new MockMultipartFile("attachment", "invoice.pdf", "application/pdf", "just text".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("not an accepted file type")));
        createWith(path, ADMIN_A, selected("x", uma), new MockMultipartFile("attachment", "invoice.pdf", "application/pdf", PNG))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("content is a PNG")));
        createWith(path, ADMIN_A, selected("x", uma), new MockMultipartFile("attachment", "empty.pdf", "application/pdf", new byte[0]))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("empty")));
        createWith(path, ADMIN_A, selected("x", uma),
                new MockMultipartFile("attachment", "fake.docx", "application/octet-stream", office("something/else.xml")))
                .andExpect(status().isBadRequest());
        createWith(path, ADMIN_A, selected("x", uma),
                new MockMultipartFile("attachment", "script.exe", "application/octet-stream", "MZ\u0090\u0000".getBytes(StandardCharsets.ISO_8859_1)))
                .andExpect(status().isBadRequest());

        byte[] big = new byte[10 * 1024 * 1024 + 1];
        System.arraycopy(PDF, 0, big, 0, PDF.length);
        createWith(path, ADMIN_A, selected("x", uma), new MockMultipartFile("attachment", "big.pdf", "application/pdf", big))
                .andExpect(status().isContentTooLarge())
                .andExpect(jsonPath("$.message", containsString("10 MB")));

        // Nothing was saved and no file was left behind.
        assertEquals(0, mongo.getCollection("notifications").countDocuments());
        assertEquals(0, storedFiles());

        // The notification part is still validated in a multipart request.
        createWith(path, ADMIN_A, "{\"subject\":\"\",\"body\":\"b\",\"audience\":\"TENANT\"}",
                new MockMultipartFile("attachment", "ok.pdf", "application/pdf", PDF))
                .andExpect(status().isBadRequest());
        assertEquals(0, storedFiles());
    }

    // ==================== replace and remove ====================

    @Test
    void replacingOrRemovingDeletesTheOldFile() throws Exception {
        String uma = member(tenantA, "uma");
        String id = json(createWith("/api/tenant/notifications", ADMIN_A, selected("Versioned", uma),
                new MockMultipartFile("attachment", "v1.pdf", "application/pdf", PDF))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        String firstKey = raw(id).get("attachment", Document.class).getString("storageKey");

        mvc.perform(multipart(HttpMethod.PUT, "/api/tenant/notifications/" + id + "/attachment")
                        .file(new MockMultipartFile("attachment", "chart.png", "image/png", PNG)).with(as(ADMIN_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attachment.fileName").value("chart.png"))
                .andExpect(jsonPath("$.attachment.contentType").value("image/png"));
        assertEquals(1, storedFiles());
        assertTrue(Files.notExists(storageRoot().resolve(firstKey)));

        mvc.perform(delete("/api/tenant/notifications/" + id + "/attachment").with(as(ADMIN_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attachment").doesNotExist());
        assertNull(raw(id).get("attachment"));
        assertEquals(0, storedFiles());

        // A platform notification's attachment is the Super Admin's to change; a refused upload stores nothing.
        String fromPlatform = sendAsSuperAdmin(tenantA, broadcast("Platform"));
        mvc.perform(multipart(HttpMethod.PUT, "/api/tenant/notifications/" + fromPlatform + "/attachment")
                        .file(new MockMultipartFile("attachment", "x.pdf", "application/pdf", PDF)).with(as(ADMIN_A)))
                .andExpect(status().isForbidden());
        assertEquals(0, storedFiles());
        mvc.perform(multipart(HttpMethod.PUT, "/api/super-admin/tenants/" + tenantA + "/notifications/" + fromPlatform + "/attachment")
                        .file(new MockMultipartFile("attachment", "x.pdf", "application/pdf", PDF)).with(as(ROOT)))
                .andExpect(status().isOk());
        mvc.perform(multipart(HttpMethod.PUT, "/api/tenant/notifications/" + id + "/attachment").with(as(ADMIN_A)))
                .andExpect(status().isBadRequest());
    }

    // ==================== 12. isolation of details and downloads ====================

    @Test
    void downloadsAreAuthorizedLikeTheNotificationItself() throws Exception {
        String uma = member(tenantA, "uma");
        member(tenantA, "luis");
        member(tenantB, "bea");
        String direct = json(createWith("/api/tenant/notifications", ADMIN_A, selected("For Uma", uma),
                new MockMultipartFile("attachment", "uma.pdf", "application/pdf", PDF))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        String everyone = json(createWith("/api/tenant/notifications", ADMIN_A, broadcast("For tenant A"),
                new MockMultipartFile("attachment", "all.pdf", "application/pdf", PDF))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");

        // Another tenant: its member, its admin, and the Super Admin through the wrong tenant's route.
        for (String id : new String[] {direct, everyone}) {
            mvc.perform(get("/api/notifications/" + id).with(as("bea"))).andExpect(status().isNotFound());
            mvc.perform(get("/api/notifications/" + id + "/attachment").with(as("bea"))).andExpect(status().isNotFound());
            mvc.perform(get("/api/tenant/notifications/" + id).with(as(ADMIN_B))).andExpect(status().isNotFound());
            mvc.perform(get("/api/tenant/notifications/" + id + "/attachment").with(as(ADMIN_B))).andExpect(status().isNotFound());
            mvc.perform(get("/api/super-admin/tenants/" + tenantB + "/notifications/" + id + "/attachment").with(as(ROOT)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications/" + id + "/attachment").with(as(ROOT)))
                    .andExpect(status().isOk());
        }
        // Same tenant, not a recipient.
        mvc.perform(get("/api/notifications/" + direct + "/attachment").with(as("luis"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/notifications/" + everyone + "/attachment").with(as("luis"))).andExpect(status().isOk());
        // Joined after the broadcast.
        Thread.sleep(20);
        member(tenantA, "newcomer");
        mvc.perform(get("/api/notifications/" + everyone + "/attachment").with(as("newcomer"))).andExpect(status().isNotFound());

        // Archived: gone for members, still available to administrators.
        patchJson("/api/tenant/notifications/" + direct + "/status", ADMIN_A, "{\"status\":\"ARCHIVED\"}").andExpect(status().isOk());
        mvc.perform(get("/api/notifications/" + direct + "/attachment").with(as("uma"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/tenant/notifications/" + direct + "/attachment").with(as(ADMIN_A))).andExpect(status().isOk());
        assertEquals(2, storedFiles());
    }

    // ==================== helpers ====================

    private ResultActions createWith(String path, String sub, String notificationJson, MockMultipartFile file) throws Exception {
        return mvc.perform(multipart(path)
                .file(new MockMultipartFile("notification", "", "application/json", notificationJson.getBytes(StandardCharsets.UTF_8)))
                .file(file)
                .with(as(sub)));
    }

    private Path storageRoot() {
        return Path.of(properties.getAttachments().getLocal().getDirectory()).toAbsolutePath().normalize();
    }

    private long storedFiles() throws Exception {
        Path root = storageRoot();
        if (Files.notExists(root)) {
            return 0;
        }
        try (Stream<Path> files = Files.walk(root)) {
            return files.filter(Files::isRegularFile).count();
        }
    }

    static void deleteTree(Path root) throws Exception {
        if (Files.notExists(root)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(root)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    /** A minimal Office Open XML package: [Content_Types].xml plus the given main part. */
    static byte[] office(String mainPart) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            for (String name : new String[] {"[Content_Types].xml", mainPart}) {
                zip.putNextEntry(new ZipEntry(name));
                zip.write("<xml/>".getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    private static String sha256(byte[] content) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
    }
}
