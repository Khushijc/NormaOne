package com.NormaOne.backend.integration;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import org.bson.Document;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.security.CognitoJwtAuthenticationConverter;

/**
 * Two onboarded organizations (A and B, each with its owner as ADMIN holding every permission) and
 * a platform Super Admin, plus helpers to add members and send notifications.
 */
abstract class NotificationTestBase extends IntegrationTestBase {

    protected static final String ADMIN_A = "notif-admin-a";
    protected static final String ADMIN_B = "notif-admin-b";
    protected static final String ROOT = "notif-root";

    protected String tenantA;
    protected String tenantB;

    @Autowired
    private CognitoJwtAuthenticationConverter productionConverter;

    /**
     * The authentication the resource server builds in production: the application's own converter,
     * so the details carry the caller's user id and auditing records it as createdByDocsId.
     */
    @Override
    protected RequestPostProcessor as(String sub) {
        return authentication(productionConverter.convert(token(sub)));
    }

    @BeforeEach
    void organizations() throws Exception {
        tenantA = onboard(ADMIN_A, "admin@notif-a.test", "notifa");
        tenantB = onboard(ADMIN_B, "admin@notif-b.test", "notifb");
        superAdmin(ROOT);
    }

    /** An ACTIVE member of a tenant, linked to Cognito subject {@code sub}. Returns the user id. */
    protected String member(String tenantId, String sub) {
        return member(tenantId, sub, UserRole.USER, UserStatus.ACTIVE);
    }

    protected String member(String tenantId, String sub, UserRole role, UserStatus status) {
        return userRepository.insert(user.builder()
                .tenantId(tenantId)
                .cognitoSub(sub)
                .name("Member " + sub)
                .email(sub + "@members.test")
                .status(status)
                .roles(Set.of(role))
                .recordState(RecordState.ACTIVE)
                .activatedAt(Instant.now())
                .build()).getId();
    }

    protected String userIdOf(String sub) {
        return userRepository.findByCognitoSub(sub).orElseThrow().getId();
    }

    protected static String selected(String subject, String... userIds) {
        String ids = Arrays.stream(userIds).map(id -> "\"" + id + "\"").collect(Collectors.joining(","));
        return "{\"subject\":\"" + subject + "\",\"body\":\"Body of " + subject + "\",\"audience\":\"SELECTED\",\"userIds\":[" + ids + "]}";
    }

    protected static String broadcast(String subject) {
        return "{\"subject\":\"" + subject + "\",\"body\":\"Body of " + subject + "\",\"audience\":\"TENANT\"}";
    }

    protected ResultActions postJson(String path, String sub, String body) throws Exception {
        return mvc.perform(post(path).with(as(sub)).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    protected ResultActions patchJson(String path, String sub, String body) throws Exception {
        return mvc.perform(patch(path).with(as(sub)).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    /** Sends a notification as a Tenant Admin (their own tenant) and returns its id. */
    protected String sendAsTenantAdmin(String adminSub, String body) throws Exception {
        String response = postJson("/api/tenant/notifications", adminSub, body)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return json(response, "$.id");
    }

    /** Sends a notification as the Super Admin into {@code tenantId} and returns its id. */
    protected String sendAsSuperAdmin(String tenantId, String body) throws Exception {
        String response = postJson("/api/super-admin/tenants/" + tenantId + "/notifications", ROOT, body)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return json(response, "$.id");
    }

    protected ResultActions markRead(String sub, String notificationId, boolean read) throws Exception {
        return patchJson("/api/notifications/" + notificationId + "/read-status", sub, "{\"read\":" + read + "}");
    }

    /** The stored document, exactly as MongoDB holds it. */
    protected Document raw(String notificationId) {
        return mongo.getCollection("notifications").find(new Document("_id", new ObjectId(notificationId))).first();
    }

    /** A JWT for calling services directly, as the resource server would hand it over. */
    protected static Jwt token(String sub) {
        return Jwt.withTokenValue("token").header("alg", "none").subject(sub).claim("token_use", "access").build();
    }
}
