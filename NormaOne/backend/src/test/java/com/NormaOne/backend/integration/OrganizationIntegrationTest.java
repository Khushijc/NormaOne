package com.NormaOne.backend.integration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/**
 * GET /api/organization: every member sees their own organization, and only it — whatever the URL,
 * query string or body says.
 */
class OrganizationIntegrationTest extends IntegrationTestBase {

    private String tenantA;
    private String tenantB;

    @BeforeEach
    void twoOrganizations() throws Exception {
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        mvc.perform(post("/api/tenant/users").with(as("sub-admin-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"uma@a.test\"}"))
                .andExpect(status().isCreated());
        mvc.perform(get("/api/users/me").with(asVerified("sub-uma", "uma@a.test", "Uma")))
                .andExpect(jsonPath("$.effectiveRole").value("USER"));
    }

    @Test
    void aMemberSeesTheirOwnOrganization() throws Exception {
        for (String sub : new String[] {"sub-uma", "sub-admin-a"}) {
            mvc.perform(get("/api/organization").with(as(sub)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(tenantA))
                    .andExpect(jsonPath("$.name").value("Org alpha"))
                    .andExpect(jsonPath("$.subdomain").value("alpha"))
                    .andExpect(jsonPath("$.countryCode").value("ES"))
                    .andExpect(jsonPath("$.defaultLocale").value("ES_ES"))
                    .andExpect(jsonPath("$.status").value("ACTIVE"))
                    // Administration stays out of the member's view.
                    .andExpect(jsonPath("$.userCount").doesNotExist())
                    .andExpect(jsonPath("$.packageInfo").doesNotExist());
        }
    }

    @Test
    void noRequestCanReachAnotherOrganization() throws Exception {
        // Query string, body and path all ignored or unrouted: still tenant A.
        mvc.perform(get("/api/organization").param("tenantId", tenantB).with(as("sub-uma")))
                .andExpect(jsonPath("$.id").value(tenantA));
        mvc.perform(get("/api/organization").with(as("sub-uma")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantId\":\"" + tenantB + "\"}"))
                .andExpect(jsonPath("$.id").value(tenantA));
        mvc.perform(get("/api/organization/" + tenantB).with(as("sub-uma"))).andExpect(status().isNotFound());
        // And the organization lists stay closed to members.
        mvc.perform(get("/api/super-admin/tenants").with(as("sub-uma"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/tenants/" + tenantB).with(as("sub-admin-a"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant").with(as("sub-uma"))).andExpect(status().isForbidden());
    }

    @Test
    void accountsWithoutAnOrganizationAreRefused() throws Exception {
        superAdmin("sub-root");
        mvc.perform(get("/api/organization").with(as("sub-root"))).andExpect(status().isForbidden());
        // Signed in, never onboarded: no role.
        mvc.perform(get("/api/organization").with(asVerified("sub-new", "new@x.test", "New"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/organization")).andExpect(status().isUnauthorized());
        // The Super Admin keeps the platform-wide view.
        mvc.perform(get("/api/super-admin/tenants/" + tenantB).with(as("sub-root")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subdomain").value("bravo"));
    }
}
