package com.NormaOne.backend.integration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.mock.web.MockPart;
import org.springframework.test.web.servlet.ResultActions;

import com.NormaOne.backend.config.NormaOneProperties;

/**
 * How browsers and API tools actually send a notification with an attachment, and who may touch the
 * attachment of a notification a Super Admin sent.
 *
 * A page that does {@code formData.append("notification", JSON.stringify(body))}, a Postman form-data
 * text field and {@code curl -F} all send the JSON part with no Content-Type of its own. That used to
 * be answered 415; it must be read like a JSON body, with the same validation.
 */
class NotificationMultipartIntegrationTest extends NotificationTestBase {

    private static final byte[] PDF = NotificationAttachmentIntegrationTest.PDF;

    @Autowired
    private NormaOneProperties properties;

    @BeforeEach
    void emptyStorage() throws Exception {
        NotificationAttachmentIntegrationTest.deleteTree(Path.of(properties.getAttachments().getLocal().getDirectory()));
    }

    private ResultActions sendUntyped(String path, String sub, String json, MockMultipartFile file) throws Exception {
        var request = multipart(path).part(new MockPart("notification", json.getBytes(StandardCharsets.UTF_8)));
        if (file != null) {
            request.file(file);
        }
        return mvc.perform(request.with(as(sub)));
    }

    private static MockMultipartFile pdf() {
        return new MockMultipartFile("attachment", "Policy.pdf", "application/pdf", PDF);
    }

    // ==================== the JSON part ====================

    @Test
    void aJsonPartWithoutItsOwnContentTypeIsAccepted() throws Exception {
        String uma = member(tenantA, "uma");
        sendUntyped("/api/tenant/notifications", ADMIN_A, selected("Plain field", uma), pdf())
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.subject").value("Plain field"))
                .andExpect(jsonPath("$.tenantId").value(tenantA))
                .andExpect(jsonPath("$.attachment.contentType").value("application/pdf"));
        // Without a file part too, and on the Super Admin's route.
        sendUntyped("/api/super-admin/tenants/" + tenantA + "/notifications", ROOT, broadcast("From the platform"), null)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.createdByRole").value("SUPER_ADMIN"));
        // A part declared as JSON keeps working exactly as before.
        mvc.perform(multipart("/api/tenant/notifications")
                        .file(new MockMultipartFile("notification", "", MediaType.APPLICATION_JSON_VALUE,
                                broadcast("Typed").getBytes(StandardCharsets.UTF_8)))
                        .with(as(ADMIN_A)))
                .andExpect(status().isCreated());
    }

    @Test
    void anUntypedPartIsValidatedLikeAJsonBody() throws Exception {
        long before = mongo.count(new org.springframework.data.mongodb.core.query.Query(), "notifications");
        sendUntyped("/api/tenant/notifications", ADMIN_A, "{\"subject\":\"\",\"body\":\"B\",\"audience\":\"TENANT\"}", pdf())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.subject").exists());
        sendUntyped("/api/tenant/notifications", ADMIN_A, "{not json", pdf())
                .andExpect(status().isBadRequest());
        sendUntyped("/api/tenant/notifications", ADMIN_A, "{\"subject\":\"S\",\"body\":\"B\",\"audience\":\"EVERYONE\"}", null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("SELECTED")));
        // A part that says it is something other than JSON is still refused.
        mvc.perform(multipart("/api/tenant/notifications")
                        .file(new MockMultipartFile("notification", "", MediaType.TEXT_PLAIN_VALUE,
                                broadcast("Text").getBytes(StandardCharsets.UTF_8)))
                        .with(as(ADMIN_A)))
                .andExpect(status().isUnsupportedMediaType());
        // Missing part.
        mvc.perform(multipart("/api/tenant/notifications").file(pdf()).with(as(ADMIN_A))).andExpect(status().isBadRequest());
        // Authorization is unchanged: a regular user cannot send this way either.
        member(tenantA, "uma");
        sendUntyped("/api/tenant/notifications", "uma", broadcast("Nope"), null).andExpect(status().isForbidden());
        sendUntyped("/api/super-admin/tenants/" + tenantA + "/notifications", ADMIN_A, broadcast("Nope"), null)
                .andExpect(status().isForbidden());

        org.junit.jupiter.api.Assertions.assertEquals(before,
                mongo.count(new org.springframework.data.mongodb.core.query.Query(), "notifications"));
        try (var files = Files.walk(Path.of(properties.getAttachments().getLocal().getDirectory()))) {
            org.junit.jupiter.api.Assertions.assertEquals(0, files.filter(Files::isRegularFile).count(),
                    "a refused request leaves no file behind");
        } catch (java.nio.file.NoSuchFileException none) {
            // Nothing was ever written.
        }
    }

    // ==================== attachment authorization ====================

    @Test
    void aSuperAdminsAttachmentFollowsItsNotificationsRules() throws Exception {
        String ana = member(tenantA, "ana");
        member(tenantA, "ben");
        member(tenantB, "bea");
        String id = json(sendUntyped("/api/super-admin/tenants/" + tenantA + "/notifications", ROOT, selected("Signed contract", ana), pdf())
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        String file = "/attachment";

        // Recipients and the tenant's notification managers may download; nobody else finds it.
        mvc.perform(get("/api/notifications/" + id + file).with(as("ana"))).andExpect(status().isOk());
        mvc.perform(get("/api/notifications/" + id + file).with(as("ben"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/notifications/" + id + file).with(as("bea"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/tenant/notifications/" + id + file).with(as(ADMIN_A))).andExpect(status().isOk());
        mvc.perform(get("/api/tenant/notifications/" + id + file).with(as(ADMIN_B))).andExpect(status().isNotFound());
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications/" + id + file).with(as(ROOT))).andExpect(status().isOk());
        mvc.perform(get("/api/super-admin/tenants/" + tenantB + "/notifications/" + id + file).with(as(ROOT))).andExpect(status().isNotFound());
        mvc.perform(get("/api/notifications/" + id + file)).andExpect(status().isUnauthorized());

        // Only a Super Admin replaces or removes the platform's attachment.
        mvc.perform(multipart(HttpMethod.PUT, "/api/tenant/notifications/" + id + file).file(pdf()).with(as(ADMIN_A)))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/tenant/notifications/" + id + file).with(as(ADMIN_A))).andExpect(status().isForbidden());
        mvc.perform(delete("/api/tenant/notifications/" + id + file).with(as(ADMIN_B))).andExpect(status().isNotFound());
        mvc.perform(get("/api/notifications/" + id + file).with(as("ana"))).andExpect(status().isOk());
        mvc.perform(delete("/api/super-admin/tenants/" + tenantA + "/notifications/" + id + file).with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attachment").doesNotExist());
        mvc.perform(get("/api/notifications/" + id + file).with(as("ana"))).andExpect(status().isNotFound());
    }
}
