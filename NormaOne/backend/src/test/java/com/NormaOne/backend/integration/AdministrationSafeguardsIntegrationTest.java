package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.enums.UserStatus;

import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminDisableUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminEnableUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminUserGlobalSignOutRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.CognitoIdentityProviderException;

/**
 * Organization audit logs, cross-tenant isolation, and removing access: users and administrators by a
 * Tenant Admin, administrators and Super Admins by a Super Admin — with the safeguards that keep an
 * organization and the platform administrable, and Cognito kept in step.
 *
 *   sub-root, sub-root-2   SUPER_ADMIN
 *   alpha                  sub-admin-a ADMIN (owner) · sub-uma USER
 *   bravo                  sub-admin-b ADMIN (owner) · sub-bea USER
 */
class AdministrationSafeguardsIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    private String tenantA;
    private String tenantB;
    private String adminA;
    private String uma;
    private String bea;

    @BeforeEach
    void platform() throws Exception {
        superAdmin(ROOT);
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        uma = invite("sub-admin-a", "Uma", "uma@a.test", "USER", "sub-uma");
        bea = invite("sub-admin-b", "Bea", "bea@b.test", "USER", "sub-bea");
    }

    private static MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    /** Invites someone and links them at their first request; returns their id. */
    private String invite(String adminSub, String name, String email, String role, String sub) throws Exception {
        String id = json(mvc.perform(jsonBody(post("/api/tenant/users").with(as(adminSub)),
                        "{\"name\":\"" + name + "\",\"email\":\"" + email + "\",\"role\":\"" + role + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(get("/api/users/me").with(asVerified(sub, email, name))).andExpect(jsonPath("$.effectiveRole").value(role));
        return id;
    }

    private static String statusBody(String status, String reason) {
        return "{\"status\":\"" + status + "\"" + (reason != null ? ",\"reason\":\"" + reason + "\"" : "") + "}";
    }

    // ==================== 8. organization audit logs ====================

    @Test
    void aTenantAdminReadsOnlyTheirOwnOrganizationsAuditLog() throws Exception {
        // Activity in both organizations and on the platform.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")), statusBody("SUSPENDED", "Leave")))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + bea + "/status").with(as("sub-admin-b")), statusBody("SUSPENDED", "Leave")))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)),
                        "{\"planCode\":\"PRO\",\"name\":\"Pro\",\"billingCycle\":\"MONTHLY\",\"listPrice\":10,\"maxEmployees\":5}"))
                .andExpect(status().isCreated());

        mvc.perform(get("/api/tenant/audit-events?size=100").with(as("sub-admin-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.content[*].tenantId", everyItem(is(tenantA))))
                .andExpect(jsonPath("$.content[*].action", hasItem("USER_INVITED")))
                .andExpect(jsonPath("$.content[*].action", hasItem("USER_STATUS_CHANGED")))
                .andExpect(jsonPath("$.content[*].action", not(hasItem("PLAN_CREATED"))))
                .andExpect(jsonPath("$.content[*].targetId", not(hasItem(bea))));
        // A tenantId in the query is not a filter the endpoint has: still alpha's log only.
        mvc.perform(get("/api/tenant/audit-events?tenantId=" + tenantB + "&size=100").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.content[*].tenantId", everyItem(is(tenantA))));
        // Filters: action, actor, target, dates.
        mvc.perform(get("/api/tenant/audit-events?action=USER_STATUS_CHANGED").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].targetId").value(uma))
                .andExpect(jsonPath("$.content[0].actorUserId").value(adminA))
                .andExpect(jsonPath("$.content[0].details.reason").value("Leave"));
        mvc.perform(get("/api/tenant/audit-events?targetId=" + bea).with(as("sub-admin-a"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/tenant/audit-events?actorUserId=" + adminA + "&targetType=USER").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.content[*].actorUserId", everyItem(is(adminA))));
        mvc.perform(get("/api/tenant/audit-events?from=" + Instant.now().plusSeconds(3600)).with(as("sub-admin-a")))
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/tenant/audit-events?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z").with(as("sub-admin-a")))
                .andExpect(status().isBadRequest());

        // Nobody else reads it through the tenant route; the platform-wide log stays the Super Admin's.
        mvc.perform(get("/api/tenant/audit-events").with(as("sub-uma"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/audit-events").with(as(ROOT))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/audit-events")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/super-admin/audit-events?tenantId=" + tenantB).with(as("sub-admin-a"))).andExpect(status().isForbidden());
        // The Super Admin's log takes the same date and target-type filters.
        mvc.perform(get("/api/super-admin/audit-events?tenantId=" + tenantB + "&targetType=USER&to=" + Instant.now().plusSeconds(60))
                        .with(as(ROOT)))
                .andExpect(jsonPath("$.content[*].tenantId", everyItem(is(tenantB))));
    }

    // ==================== 9, 10. no reaching across organizations; users are not admins ====================

    @Test
    void anAdminCannotReachAnotherOrganizationsUsersByChangingIds() throws Exception {
        mvc.perform(get("/api/tenant/users/" + uma).with(as("sub-admin-b"))).andExpect(status().isNotFound());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-b")), statusBody("DEACTIVATED", "x")))
                .andExpect(status().isNotFound());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma).with(as("sub-admin-b")), "{\"name\":\"Hacked\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + adminA + "/status").with(as("sub-admin-b")), statusBody("DEACTIVATED", "x")))
                .andExpect(status().isNotFound());
        assertEquals(UserStatus.ACTIVE, userRepository.findById(uma).orElseThrow().getStatus());
        verify(cognito, never()).adminDisableUser(any(AdminDisableUserRequest.class));

        // A regular user has no administration route at all.
        mvc.perform(get("/api/tenant/users").with(as("sub-uma"))).andExpect(status().isForbidden());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + adminA + "/status").with(as("sub-uma")), statusBody("DEACTIVATED", "x")))
                .andExpect(status().isForbidden());
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-uma")), "{\"name\":\"X\",\"email\":\"x@a.test\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/admins").with(as("sub-uma"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/super-admins").with(as("sub-uma"))).andExpect(status().isForbidden());
    }

    // ==================== B4. removal revokes Cognito access ====================

    @Test
    void removingAUserSignsThemOutAndDisablesTheirCognitoAccount() throws Exception {
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")), statusBody("DEACTIVATED", "Left the company")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DEACTIVATED"));
        verify(cognito).adminDisableUser(argThat((AdminDisableUserRequest r) -> "uma@a.test".equals(r.username())));
        verify(cognito).adminUserGlobalSignOut(argThat((AdminUserGlobalSignOutRequest r) -> "uma@a.test".equals(r.username())));
        // The record stays (soft removal), access is gone, and the audit says what Cognito did.
        assertTrue(userRepository.findById(uma).isPresent());
        mvc.perform(get("/api/organization").with(as("sub-uma"))).andExpect(status().isForbidden());
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.USER_STATUS_CHANGED).and("targetId").is(uma)
                .and("details.identityProvider").is("DONE")), AuditEvent.class));

        // Reactivating re-enables the Cognito account first.
        when(cognito.adminGetUser(any(AdminGetUserRequest.class))).thenReturn(AdminGetUserResponse.builder().enabled(false).build());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")), statusBody("ACTIVE", null)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ACTIVE"));
        verify(cognito).adminEnableUser(argThat((AdminEnableUserRequest r) -> "uma@a.test".equals(r.username())));
        mvc.perform(get("/api/organization").with(as("sub-uma"))).andExpect(status().isOk());
    }

    @Test
    void suspendingSignsOutWithoutDisablingAndCognitoFailuresAreHandledSafely() throws Exception {
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")), statusBody("SUSPENDED", "Leave")))
                .andExpect(status().isOk());
        verify(cognito).adminUserGlobalSignOut(argThat((AdminUserGlobalSignOutRequest r) -> "uma@a.test".equals(r.username())));
        verify(cognito, never()).adminDisableUser(any(AdminDisableUserRequest.class));

        // Cognito down while removing: access is removed in the application anyway, and the audit says FAILED.
        when(cognito.adminDisableUser(any(AdminDisableUserRequest.class)))
                .thenThrow((CognitoIdentityProviderException) CognitoIdentityProviderException.builder().message("down").build());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")), statusBody("DEACTIVATED", "Left")))
                .andExpect(status().isOk());
        assertEquals(UserStatus.DEACTIVATED, userRepository.findById(uma).orElseThrow().getStatus());
        mvc.perform(get("/api/organization").with(as("sub-uma"))).andExpect(status().isForbidden());
        assertTrue(mongo.exists(new Query(Criteria.where("targetId").is(uma).and("details.identityProvider").is("FAILED")), AuditEvent.class));

        // Cognito down while restoring: refused with 502 and nothing changes.
        when(cognito.adminGetUser(any(AdminGetUserRequest.class)))
                .thenThrow((CognitoIdentityProviderException) CognitoIdentityProviderException.builder().message("down").build());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")), statusBody("ACTIVE", null)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.message", containsString("re-enable")));
        assertEquals(UserStatus.DEACTIVATED, userRepository.findById(uma).orElseThrow().getStatus());
    }

    // ==================== 13. the last Tenant Admin ====================

    @Test
    void theLastActiveTenantAdminCannotBeRemovedWithoutARecoveryPath() throws Exception {
        // Not by themselves, by status or by role.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + adminA + "/status").with(as("sub-admin-a")), statusBody("DEACTIVATED", "x")))
                .andExpect(status().isForbidden());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + adminA).with(as("sub-admin-a")), "{\"role\":\"USER\"}"))
                .andExpect(status().isForbidden());

        // A second administrator may remove the first — and then cannot be removed, being the last one.
        String ivo = invite("sub-admin-a", "Ivo", "ivo@a.test", "ADMIN", "sub-ivo");
        mvc.perform(jsonBody(patch("/api/tenant/users/" + adminA + "/status").with(as("sub-ivo")), statusBody("DEACTIVATED", "Handover")))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + ivo + "/status").with(as("sub-ivo")), statusBody("DEACTIVATED", "x")))
                .andExpect(status().isForbidden());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + ivo).with(as("sub-ivo")), "{\"role\":\"USER\"}")).andExpect(status().isForbidden());

        // The Super Admin refuses to leave the organization with no active administrator unless told so…
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + ivo + "/status").with(as(ROOT)), statusBody("DEACTIVATED", "Compromised")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("only active administrator")));
        assertEquals(UserStatus.ACTIVE, userRepository.findById(ivo).orElseThrow().getStatus());
        // …and when told so, the way back stays open: the tenant is untouched and a new administrator can be invited.
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + ivo + "/status").with(as(ROOT)),
                        "{\"status\":\"DEACTIVATED\",\"reason\":\"Compromised\",\"confirmNoActiveAdmin\":true}"))
                .andExpect(status().isOk());
        assertTrue(mongo.exists(new Query(Criteria.where("targetId").is(ivo).and("details.leftWithoutActiveAdmin").is("true")), AuditEvent.class));
        mvc.perform(get("/api/super-admin/tenants/" + tenantA).with(as(ROOT))).andExpect(jsonPath("$.status").value("ACTIVE"));
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Nina\",\"email\":\"nina@a.test\"}"))
                .andExpect(status().isCreated());
        mvc.perform(get("/api/users/me").with(asVerified("sub-nina", "nina@a.test", "Nina"))).andExpect(jsonPath("$.effectiveRole").value("ADMIN"));
        mvc.perform(get("/api/tenant/users").with(as("sub-nina"))).andExpect(status().isOk());
    }

    // ==================== 11, 12. Super Admins ====================

    @Test
    void superAdminsAreAddedThroughCognitoAndRemovedWithSafeguards() throws Exception {
        String sara = json(mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)),
                        "{\"name\":\"Sara\",\"email\":\"sara@platform.test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("INVITED"))
                .andExpect(jsonPath("$.invitation.temporaryPassword").doesNotExist())
                .andExpect(jsonPath("$.temporaryPassword").doesNotExist())
                .andReturn().getResponse().getContentAsString(), "$.id");
        verify(cognito).adminCreateUser(argThat((AdminCreateUserRequest r) -> "sara@platform.test".equals(r.username())));
        // No duplicate assignment or account.
        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)), "{\"name\":\"Sara\",\"email\":\"SARA@platform.test\"}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)), "{\"name\":\"A\",\"email\":\"admin@a.test\"}"))
                .andExpect(status().isConflict());

        // Never yourself — so the final active Super Admin (the caller, here) is never removed.
        String rootId = userRepository.findByCognitoSub(ROOT).orElseThrow().getId();
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + rootId + "/status").with(as(ROOT)), statusBody("DEACTIVATED", "x")))
                .andExpect(status().isForbidden());

        // Removing another active Super Admin: deactivated, signed out and disabled in Cognito, record kept.
        String other = superAdmin("sub-root-2").getId();
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + other + "/status").with(as(ROOT)), statusBody("DEACTIVATED", "Left")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DEACTIVATED"));
        verify(cognito).adminDisableUser(argThat((AdminDisableUserRequest r) -> "sub-root-2@platform.example".equals(r.username())));
        mvc.perform(get("/api/super-admin/dashboard").with(as("sub-root-2"))).andExpect(status().isForbidden());
        assertTrue(userRepository.findById(other).isPresent());

        // Now the caller is the only active Super Admin: the remaining one cannot remove itself, and
        // revoking a pending invitation does not count against the platform's active Super Admins.
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + sara + "/status").with(as(ROOT)), statusBody("DEACTIVATED", "Not needed")))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + rootId + "/status").with(as(ROOT)), statusBody("SUSPENDED", "x")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/super-admins?status=ACTIVE").with(as(ROOT))).andExpect(jsonPath("$.totalElements").value(1));

        // Tenant accounts manage no Super Admin.
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + rootId + "/status").with(as("sub-admin-a")), statusBody("DEACTIVATED", "x")))
                .andExpect(status().isForbidden());
        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as("sub-admin-a")), "{\"name\":\"E\",\"email\":\"e@x.test\"}"))
                .andExpect(status().isForbidden());
    }
}
