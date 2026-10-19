package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;

class TenantAdminIntegrationTest extends IntegrationTestBase {

    private String tenantA;
    private String tenantB;
    private String adminAId;

    @BeforeEach
    void twoTenants() throws Exception {
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        adminAId = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
    }

    private String invite(String sub, String email, String role) throws Exception {
        String roleJson = role == null ? "" : ",\"role\":\"" + role + "\"";
        String body = mvc.perform(post("/api/tenant/users").with(as(sub)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Person\",\"email\":\"" + email + "\"" + roleJson + "}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json(body, "$.id");
    }

    @Test
    void tenantAdminCreatesAndViewsUsersInOwnTenantOnly() throws Exception {
        // tenantId in the body is ignored: the user is created in the caller's tenant.
        String body = mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Pablo\",\"email\":\"Pablo@A.test\",\"tenantId\":\"" + tenantB + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("INVITED"))
                .andExpect(jsonPath("$.effectiveRole").value("USER"))
                .andExpect(jsonPath("$.linked").value(false))
                .andReturn().getResponse().getContentAsString();
        assertEquals(tenantA, json(body, "$.tenantId"));
        assertEquals("pablo@a.test", json(body, "$.email"));

        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Pablo\",\"email\":\"pablo@a.test\"}"))
                .andExpect(status().isConflict());

        mvc.perform(get("/api/tenant/users").with(as("sub-admin-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[?(@.tenantId != '" + tenantA + "')]").isEmpty());
        mvc.perform(get("/api/tenant/users").param("search", "pablo").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/tenant").with(as("sub-admin-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(tenantA))
                .andExpect(jsonPath("$.packageCode").value("BASIC"));
    }

    @Test
    void tenantAdminCannotAccessAnotherTenantsUsers() throws Exception {
        String bUser = invite("sub-admin-b", "someone@b.test", null);
        String adminB = userRepository.findByCognitoSub("sub-admin-b").orElseThrow().getId();

        mvc.perform(get("/api/tenant/users/" + bUser).with(as("sub-admin-a"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/tenant/users/" + adminB).with(as("sub-admin-a"))).andExpect(status().isNotFound());
        mvc.perform(patch("/api/tenant/users/" + bUser).with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Hijacked\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(patch("/api/tenant/users/" + adminB + "/status").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isNotFound());
        assertEquals(UserStatus.ACTIVE, userRepository.findById(adminB).orElseThrow().getStatus());
    }

    @Test
    void tenantAdminCannotAssignSuperAdmin() throws Exception {
        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"X\",\"email\":\"x@a.test\",\"role\":\"SUPER_ADMIN\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"X\",\"email\":\"x@a.test\",\"role\":\"PLATFORM_ADMIN\"}"))
                .andExpect(status().isForbidden());
        String userId = invite("sub-admin-a", "y@a.test", "USER");
        mvc.perform(patch("/api/tenant/users/" + userId).with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"SUPER_ADMIN\"}"))
                .andExpect(status().isForbidden());
        assertFalse(userRepository.findById(userId).orElseThrow().getRoles().contains(UserRole.SUPER_ADMIN));
    }

    @Test
    void tenantAdminCannotChangeOwnTenantRoleOrStatus() throws Exception {
        mvc.perform(patch("/api/tenant/users/" + adminAId).with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Admin A\",\"tenantId\":\"" + tenantB + "\",\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantId").value(tenantA));
        assertEquals(tenantA, userRepository.findById(adminAId).orElseThrow().getTenantId());

        mvc.perform(patch("/api/tenant/users/" + adminAId).with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"USER\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(patch("/api/tenant/users/" + adminAId + "/status").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isForbidden());
        // There is no endpoint to change the tenant's package or the tenant record itself.
        mvc.perform(patch("/api/tenant/package").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"PRO\"}"))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(patch("/api/tenant").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subdomain\":\"hijack\"}"))
                .andExpect(status().isMethodNotAllowed());
    }

    @Test
    void invitedUserIsLinkedAtFirstSignInAndCanOnlySeeOwnProfile() throws Exception {
        String invitedId = invite("sub-admin-a", "lucia@a.test", null);

        // The person registers in Cognito with the invited email and signs in (verified email).
        mvc.perform(get("/api/users/me").with(asVerified("sub-lucia", "lucia@a.test", "Lucia")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(invitedId))
                .andExpect(jsonPath("$.tenantId").value(tenantA))
                .andExpect(jsonPath("$.effectiveRole").value("USER"))
                .andExpect(jsonPath("$.onboardingStatus").value("COMPLETED"));
        user linked = userRepository.findById(invitedId).orElseThrow();
        assertEquals("sub-lucia", linked.getCognitoSub());
        assertEquals(UserStatus.ACTIVE, linked.getStatus());

        // Ordinary USER: own profile only.
        mvc.perform(get("/api/users/me").with(as("sub-lucia"))).andExpect(status().isOk());
        mvc.perform(get("/api/tenant/users").with(as("sub-lucia"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/users/" + adminAId).with(as("sub-lucia"))).andExpect(status().isForbidden());
        mvc.perform(post("/api/tenant/users").with(as("sub-lucia")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"X\",\"email\":\"x@a.test\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/package").with(as("sub-lucia"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/tenants").with(as("sub-lucia"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/users/" + adminAId).with(as("sub-lucia"))).andExpect(status().isNotFound());

        // An unverified email never links an invitation.
        String other = invite("sub-admin-a", "marta@a.test", null);
        mvc.perform(get("/api/users/me").with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt()
                        .jwt(j -> j.subject("sub-marta").claim("email", "marta@a.test").claim("email_verified", false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(true));
        assertEquals(UserStatus.INVITED, userRepository.findById(other).orElseThrow().getStatus());
    }

    @Test
    void tenantAdminManagesStatusAndRolesWithinTenant() throws Exception {
        String userId = invite("sub-admin-a", "carla@a.test", null);
        mvc.perform(get("/api/users/me").with(asVerified("sub-carla", "carla@a.test", "Carla"))).andExpect(status().isOk());

        mvc.perform(patch("/api/tenant/users/" + userId + "/status").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"SUSPENDED\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(patch("/api/tenant/users/" + userId + "/status").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"SUSPENDED\",\"reason\":\"Leave\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUSPENDED"));
        mvc.perform(get("/api/users/me").with(as("sub-carla")))
                .andExpect(jsonPath("$.effectiveRole").doesNotExist());
        mvc.perform(patch("/api/tenant/users/" + userId + "/status").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch("/api/tenant/users/" + userId).with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"ADMIN\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"));
        mvc.perform(get("/api/tenant/users").with(as("sub-carla"))).andExpect(status().isOk());
        assertTrue(userRepository.findById(userId).orElseThrow().getRoles().contains(UserRole.ADMIN));
    }
}
