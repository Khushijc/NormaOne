package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.notification.OutboundEmail;
import com.NormaOne.backend.model.plans.PlanChangeRequest;

/**
 * Email-notification preferences: an account changes its own; a Tenant Admin changes the USER accounts
 * of their own organization; nobody reaches across organizations or changes another administrator's;
 * and every email follows its recipient's saved preference while in-app delivery never does.
 *
 *   sub-root            SUPER_ADMIN
 *   alpha   sub-admin-a ADMIN (owner) · sub-ivo ADMIN · sub-uma USER · sub-una USER
 *   bravo   sub-admin-b ADMIN (owner) · sub-bea USER
 */
class EmailPreferenceIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";
    private static final String OFF = "{\"enabled\":false}";
    private static final String ON = "{\"enabled\":true}";

    private String adminA;
    private String ivo;
    private String uma;
    private String una;
    private String bea;

    @BeforeEach
    void platform() throws Exception {
        superAdmin(ROOT);
        onboard("sub-admin-a", "admin@a.test", "alpha");
        onboard("sub-admin-b", "admin@b.test", "bravo");
        adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        ivo = invite("sub-admin-a", "Ivo", "ivo@a.test", "ADMIN", "sub-ivo");
        uma = invite("sub-admin-a", "Uma", "uma@a.test", "USER", "sub-uma");
        una = invite("sub-admin-a", "Una", "una@a.test", "USER", "sub-una");
        bea = invite("sub-admin-b", "Bea", "bea@b.test", "USER", "sub-bea");
    }

    private static MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private String invite(String adminSub, String name, String email, String role, String sub) throws Exception {
        String id = json(mvc.perform(jsonBody(post("/api/tenant/users").with(as(adminSub)),
                        "{\"name\":\"" + name + "\",\"email\":\"" + email + "\",\"role\":\"" + role + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(get("/api/users/me").with(asVerified(sub, email, name))).andExpect(jsonPath("$.effectiveRole").value(role));
        return id;
    }

    private Boolean stored(String userId) {
        return userRepository.findById(userId).orElseThrow().getEmailNotificationsEnabled();
    }

    // ==================== the default ====================

    @Test
    void accountsWithoutAPreferenceHaveEmailEnabledByDefault() throws Exception {
        assertNull(stored(uma), "nothing stored for an existing account");
        mvc.perform(get("/api/users/me/email-preference").with(as("sub-uma")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(uma))
                .andExpect(jsonPath("$.emailNotificationsEnabled").value(true))
                .andExpect(jsonPath("$.explicit").value(false))
                // Email is not configured: the preference is stored, nothing is emailed (Coming Soon).
                .andExpect(jsonPath("$.emailDeliveryAvailable").value(false));
        mvc.perform(get("/api/users/me").with(as("sub-uma"))).andExpect(jsonPath("$.emailNotificationsEnabled").value(true));
        mvc.perform(get("/api/tenant/users").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.content[?(@.id=='" + uma + "')].emailNotificationsEnabled", hasItem(true)));
    }

    // ==================== own preference ====================

    @Test
    void anAdminAUserAndASuperAdminEachChangeTheirOwnPreference() throws Exception {
        for (String sub : List.of("sub-admin-a", "sub-uma", ROOT)) {
            mvc.perform(jsonBody(put("/api/users/me/email-preference").with(as(sub)), OFF))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.emailNotificationsEnabled").value(false))
                    .andExpect(jsonPath("$.explicit").value(true));
            mvc.perform(get("/api/users/me/email-preference").with(as(sub))).andExpect(jsonPath("$.emailNotificationsEnabled").value(false));
            mvc.perform(jsonBody(put("/api/users/me/email-preference").with(as(sub)), ON))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.emailNotificationsEnabled").value(true));
        }
        mvc.perform(get("/api/users/me/email-preference").with(as(ROOT))).andExpect(jsonPath("$.role").value("SUPER_ADMIN"));
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.USER_EMAIL_PREFERENCE_CHANGED).and("targetId").is(adminA)
                .and("details.by").is("SELF").and("details.to").is("disabled")), AuditEvent.class));
        // Validation.
        mvc.perform(jsonBody(put("/api/users/me/email-preference").with(as("sub-uma")), "{}")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/users/me/email-preference")).andExpect(status().isUnauthorized());
    }

    @Test
    void aUserChangesOnlyTheirOwnPreferenceWhateverTheyCall() throws Exception {
        // The own route has no user id: an id in the body changes nothing but the caller's own record.
        mvc.perform(jsonBody(put("/api/users/me/email-preference").with(as("sub-uma")), "{\"enabled\":false,\"userId\":\"" + una + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.userId").value(uma));
        assertEquals(Boolean.FALSE, stored(uma));
        assertNull(stored(una));
        // The administrators' route is not a user's, for anyone's id.
        for (String target : List.of(una, uma, adminA, bea)) {
            mvc.perform(jsonBody(put("/api/tenant/users/" + target + "/email-preference").with(as("sub-uma")), OFF)).andExpect(status().isForbidden());
            mvc.perform(get("/api/tenant/users/" + target + "/email-preference").with(as("sub-uma"))).andExpect(status().isForbidden());
        }
        assertNull(stored(una));
        assertNull(stored(adminA));
        assertNull(stored(bea));
        // A suspended account changes nothing.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")), "{\"status\":\"SUSPENDED\",\"reason\":\"Leave\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(put("/api/users/me/email-preference").with(as("sub-uma")), ON)).andExpect(status().isForbidden());
        assertEquals(Boolean.FALSE, stored(uma));
    }

    // ==================== a Tenant Admin and their team ====================

    @Test
    void anAdminChangesAUserOfTheirOwnOrganization() throws Exception {
        mvc.perform(get("/api/tenant/users/" + uma + "/email-preference").with(as("sub-admin-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Uma")).andExpect(jsonPath("$.role").value("USER"))
                .andExpect(jsonPath("$.emailNotificationsEnabled").value(true));
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/email-preference").with(as("sub-admin-a")), OFF))
                .andExpect(status().isOk()).andExpect(jsonPath("$.emailNotificationsEnabled").value(false));
        assertEquals(Boolean.FALSE, stored(uma));
        // Persisted, and what everyone reads.
        mvc.perform(get("/api/users/me/email-preference").with(as("sub-uma"))).andExpect(jsonPath("$.emailNotificationsEnabled").value(false));
        mvc.perform(get("/api/tenant/users/" + uma).with(as("sub-admin-a"))).andExpect(jsonPath("$.emailNotificationsEnabled").value(false));
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.USER_EMAIL_PREFERENCE_CHANGED).and("targetId").is(uma)
                .and("actorUserId").is(adminA).and("details.by").is("ADMIN")), AuditEvent.class));
        // The user can turn it back on themselves.
        mvc.perform(jsonBody(put("/api/users/me/email-preference").with(as("sub-uma")), ON)).andExpect(status().isOk());
        assertEquals(Boolean.TRUE, stored(uma));
    }

    @Test
    void anAdminCannotReachAnotherOrganizationOrAnotherAdministrator() throws Exception {
        // Another organization's user: not found, whatever the admin sends.
        mvc.perform(jsonBody(put("/api/tenant/users/" + bea + "/email-preference").with(as("sub-admin-a")),
                        "{\"enabled\":false,\"tenantId\":\"anything\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/tenant/users/" + bea + "/email-preference").with(as("sub-admin-a"))).andExpect(status().isNotFound());
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/email-preference").with(as("sub-admin-b")), OFF)).andExpect(status().isNotFound());
        assertNull(stored(bea));
        assertNull(stored(uma));
        // Another administrator of the same organization, and their own account, through the team route.
        mvc.perform(jsonBody(put("/api/tenant/users/" + ivo + "/email-preference").with(as("sub-admin-a")), OFF)).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/users/" + ivo + "/email-preference").with(as("sub-admin-a"))).andExpect(status().isForbidden());
        mvc.perform(jsonBody(put("/api/tenant/users/" + adminA + "/email-preference").with(as("sub-admin-a")), OFF)).andExpect(status().isForbidden());
        assertNull(stored(ivo));
        assertNull(stored(adminA));
        // A Super Admin has no tenant route.
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/email-preference").with(as(ROOT)), OFF)).andExpect(status().isForbidden());
        assertNull(stored(uma));
    }

    // ==================== delivery ====================

    @Test
    void notificationEmailsFollowEachRecipientsPreferenceAndInAppIsUnaffected() throws Exception {
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/email-preference").with(as("sub-admin-a")), OFF)).andExpect(status().isOk());
        when(emailSender.configured()).thenReturn(true);

        String selected = json(mvc.perform(jsonBody(post("/api/tenant/notifications").with(as("sub-admin-a")),
                        "{\"subject\":\"Policy\",\"body\":\"Read it\",\"audience\":\"SELECTED\",\"userIds\":[\"" + uma + "\",\"" + una + "\"]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        // One email, to the recipient with email on; none for the one who turned it off.
        List<OutboundEmail> emails = mongo.find(new Query(Criteria.where("referenceId").is(selected)), OutboundEmail.class);
        assertEquals(1, emails.size());
        assertEquals(List.of("una@a.test"), emails.get(0).getRecipients());
        // In-app delivery is the same for both.
        mvc.perform(get("/api/notifications/unread-count").with(as("sub-uma"))).andExpect(jsonPath("$.unreadCount").value(1));
        mvc.perform(get("/api/notifications/" + selected).with(as("sub-uma"))).andExpect(status().isOk());
        mvc.perform(get("/api/notifications/unread-count").with(as("sub-una"))).andExpect(jsonPath("$.unreadCount").value(1));

        // Everyone in the organization: every member with email on gets their own email.
        String everyone = json(mvc.perform(jsonBody(post("/api/tenant/notifications").with(as("sub-admin-a")),
                        "{\"subject\":\"Holiday\",\"body\":\"Office closed\",\"audience\":\"TENANT\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        List<String> to = mongo.find(new Query(Criteria.where("referenceId").is(everyone)), OutboundEmail.class).stream()
                .flatMap(e -> e.getRecipients().stream()).toList();
        assertTrue(to.containsAll(List.of("admin@a.test", "ivo@a.test", "una@a.test")), to.toString());
        assertFalse(to.contains("uma@a.test"), "uma turned email off");
        assertFalse(to.stream().anyMatch(address -> address.endsWith("@b.test")), "never another organization");
        mvc.perform(get("/api/notifications/" + everyone).with(as("sub-uma"))).andExpect(status().isOk());
    }

    @Test
    void whileEmailIsNotConfiguredNothingIsQueuedForNotificationsComingSoon() throws Exception {
        String id = json(mvc.perform(jsonBody(post("/api/tenant/notifications").with(as("sub-admin-a")),
                        "{\"subject\":\"Hi\",\"body\":\"In-app only for now\",\"audience\":\"TENANT\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        assertEquals(0, mongo.count(new Query(Criteria.where("referenceId").is(id)), OutboundEmail.class));
        mvc.perform(get("/api/notifications/unread-count").with(as("sub-uma"))).andExpect(jsonPath("$.unreadCount").value(1));
        mvc.perform(get("/api/users/me/email-preference").with(as("sub-uma"))).andExpect(jsonPath("$.emailDeliveryAvailable").value(false));
        org.mockito.Mockito.verify(emailSender, org.mockito.Mockito.never()).send(anyList(), anyString(), anyString());
    }

    @Test
    void planChangeEmailsSkipSuperAdminsWhoTurnedEmailOff() throws Exception {
        superAdmin("sub-root-2");
        String plan = json(mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)),
                        "{\"planCode\":\"PRO\",\"name\":\"Pro\",\"billingCycle\":\"MONTHLY\",\"listPrice\":10,\"maxEmployees\":5}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + plan + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}")).andExpect(status().isOk());
        mvc.perform(jsonBody(put("/api/users/me/email-preference").with(as("sub-root-2")), OFF)).andExpect(status().isOk());

        String first = json(mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{\"planId\":\"" + plan + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        OutboundEmail email = mongo.findOne(new Query(Criteria.where("referenceId").is(first)), OutboundEmail.class);
        assertEquals(List.of(ROOT + "@platform.example"), email.getRecipients());

        // Every Super Admin turned email off: the request is saved as usual and no email is queued.
        mvc.perform(jsonBody(put("/api/users/me/email-preference").with(as(ROOT)), OFF)).andExpect(status().isOk());
        String second = json(mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-b")), "{\"planId\":\"" + plan + "\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn().getResponse().getContentAsString(), "$.id");
        assertEquals(0, mongo.count(new Query(Criteria.where("referenceId").is(second)), OutboundEmail.class));
        assertEquals(2, mongo.count(new Query(), PlanChangeRequest.class));
    }
}
