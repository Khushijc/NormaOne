package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;

/**
 * The module-assignment workflow end to end, starting from the situation the Tenant Admin screen shows
 * as "Never assigned · 0 of 0 assigned modules": an administrator created before default module
 * assignment, who holds no module permission. A Super Admin assigns theirs; only then can they grant
 * those permissions — and never more — to the users of their own organization. Nobody changes their
 * own module access, and nobody reaches another organization.
 *
 *   alpha   sub-owner-a ADMIN (registered owner: every permission) · sub-legacy ADMIN (never assigned) · sub-uma USER
 *   bravo   sub-owner-b ADMIN · sub-bea USER
 */
class ModuleAssignmentWorkflowIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    private String tenantA;
    private String legacy;
    private String uma;
    private String bea;

    @BeforeEach
    void platform() throws Exception {
        superAdmin(ROOT);
        tenantA = onboard("sub-owner-a", "owner@a.test", "alpha");
        String tenantB = onboard("sub-owner-b", "owner@b.test", "bravo");
        // An administrator from before default module assignment: no module lists, no marker.
        legacy = userRepository.insert(user.builder().tenantId(tenantA).cognitoSub("sub-legacy").name("Legacy Admin")
                .email("legacy@a.test").status(UserStatus.ACTIVE).roles(Set.of(UserRole.ADMIN)).recordState(RecordState.ACTIVE)
                .moduleAccess(List.of()).modulePermissions(List.of()).build()).getId();
        uma = invite("sub-owner-a", "uma@a.test", "sub-uma");
        bea = invite("sub-owner-b", "bea@b.test", "sub-bea");
        assertNotNull(tenantB);
    }

    private static MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private String invite(String adminSub, String email, String sub) throws Exception {
        String id = json(mvc.perform(jsonBody(post("/api/tenant/users").with(as(adminSub)),
                        "{\"name\":\"" + sub + "\",\"email\":\"" + email + "\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(get("/api/users/me").with(asVerified(sub, email, sub))).andExpect(jsonPath("$.effectiveRole").value("USER"));
        return id;
    }

    @Test
    void aNeverAssignedAdministratorIsWhatTheScreenReports() throws Exception {
        // The data behind "Never assigned · 0 of 0 assigned modules · 0 module permissions".
        mvc.perform(get("/api/tenant/users/" + legacy + "/modules").with(as("sub-legacy")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedAt").doesNotExist())
                .andExpect(jsonPath("$.assignedModules", hasSize(0)))
                .andExpect(jsonPath("$.assignedPermissions", hasSize(0)))
                .andExpect(jsonPath("$.effectiveModules", hasSize(0)));
        mvc.perform(get("/api/users/me").with(as("sub-legacy")))
                .andExpect(jsonPath("$.modules", hasSize(0))).andExpect(jsonPath("$.modulePermissions", hasSize(0)));
    }

    @Test
    void nobodyChangesTheirOwnModuleAccessThroughEitherRoute() throws Exception {
        mvc.perform(jsonBody(put("/api/tenant/users/" + legacy + "/modules").with(as("sub-legacy")),
                        "{\"modules\":[\"FACTURAFLOW\"],\"permissions\":[\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message", containsString("your own module access")));
        mvc.perform(jsonBody(put("/api/tenant/users/" + legacy + "/modules/FACTURAFLOW").with(as("sub-legacy")), "{\"permissions\":[\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isForbidden());
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + legacy + "/modules").with(as("sub-legacy")),
                        "{\"modules\":[\"FACTURAFLOW\"],\"permissions\":[\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isForbidden());
        assertTrue(userRepository.findById(legacy).orElseThrow().getModulePermissions().isEmpty());
    }

    @Test
    void anAdministratorWhoHoldsNothingGrantsNothingUntilASuperAdminAssignsTheirs() throws Exception {
        // Holding nothing: no permission can be given or taken away (uma holds FACTURAFLOW_VIEW by default).
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-legacy")),
                        "{\"permissions\":[\"FACTURAFLOW_VIEW\",\"FACTURAFLOW_CREATE\"]}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message", containsString("FACTURAFLOW_CREATE")));
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-legacy")), "{\"permissions\":[]}"))
                .andExpect(status().isForbidden());

        // The Super Admin assigns the administrator's modules and permissions.
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + legacy + "/modules").with(as(ROOT)),
                        "{\"modules\":[\"FACTURAFLOW\",\"JORNADAPULSE\"],\"permissions\":[\"FACTURAFLOW_VIEW\",\"FACTURAFLOW_CREATE\",\"JORNADAPULSE_VIEW\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedAt").exists())
                .andExpect(jsonPath("$.assignedModules", hasSize(2)))
                .andExpect(jsonPath("$.effectiveModules", hasSize(2)))
                .andExpect(jsonPath("$.effectivePermissions", hasSize(3)));
        mvc.perform(get("/api/users/me").with(as("sub-legacy"))).andExpect(jsonPath("$.modulePermissions", hasSize(3)));

        // Now they grant what they hold, to a user of their own organization…
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-legacy")),
                        "{\"permissions\":[\"FACTURAFLOW_VIEW\",\"FACTURAFLOW_CREATE\"]}"))
                .andExpect(status().isOk());
        assertTrue(userRepository.findById(uma).orElseThrow().getModulePermissions().contains("FACTURAFLOW_CREATE"));
        // …never what they do not hold…
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-legacy")),
                        "{\"permissions\":[\"FACTURAFLOW_VIEW\",\"FACTURAFLOW_APPROVE\"]}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.message", containsString("FACTURAFLOW_APPROVE")));
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/modules/JORNADAPULSE").with(as("sub-legacy")),
                        "{\"permissions\":[\"JORNADAPULSE_VIEW\",\"JORNADAPULSE_CREATE\"]}"))
                .andExpect(status().isForbidden());
        // …and never a permission of another module.
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-legacy")), "{\"permissions\":[\"JORNADAPULSE_VIEW\"]}"))
                .andExpect(status().isBadRequest());
        assertEquals(false, userRepository.findById(uma).orElseThrow().getModulePermissions().contains("FACTURAFLOW_APPROVE"));
    }

    @Test
    void theSuperAdminAssignsOnlyValidModulesAndPermissions() throws Exception {
        String path = "/api/super-admin/admins/" + legacy + "/modules";
        mvc.perform(jsonBody(put(path).with(as(ROOT)), "{\"modules\":[\"NORMAONE\"],\"permissions\":[]}")).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(put(path).with(as(ROOT)), "{\"modules\":[\"FACTURAFLOW\"],\"permissions\":[\"PREVENWORK_VIEW\"]}")).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(put(path).with(as(ROOT)), "{\"modules\":[\"PAYROLL\"],\"permissions\":[]}")).andExpect(status().isBadRequest());
        // A regular user is not an administrator: not reachable on the administrator route.
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + uma + "/modules").with(as(ROOT)), "{\"modules\":[],\"permissions\":[]}"))
                .andExpect(status().isNotFound());
        assertTrue(userRepository.findById(legacy).orElseThrow().getModuleAccess().isEmpty());
    }

    @Test
    void assignmentsStayInsideTheOrganizationAndUsersAssignNothing() throws Exception {
        // Another organization's user: not found, whoever asks from alpha.
        mvc.perform(get("/api/tenant/users/" + bea + "/modules").with(as("sub-owner-a"))).andExpect(status().isNotFound());
        mvc.perform(jsonBody(put("/api/tenant/users/" + bea + "/modules/FACTURAFLOW").with(as("sub-owner-a")), "{\"permissions\":[\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isNotFound());
        // A USER has no assignment route at all.
        mvc.perform(jsonBody(put("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-uma")), "{\"permissions\":[\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isForbidden());
        // Another administrator of the same organization may assign the legacy administrator's modules,
        // within what they hold themselves (the registered owner holds every permission).
        mvc.perform(jsonBody(put("/api/tenant/users/" + legacy + "/modules/SAFEVOICE").with(as("sub-owner-a")), "{\"permissions\":[\"SAFEVOICE_VIEW\",\"SAFEVOICE_MANAGE\"]}"))
                .andExpect(status().isOk());
        assertTrue(userRepository.findById(legacy).orElseThrow().getModulePermissions().contains("SAFEVOICE_MANAGE"));
        assertEquals(List.of("FACTURAFLOW_VIEW", "JORNADAPULSE_VIEW", "DATOSPILOT_VIEW", "PREVENWORK_VIEW", "BUZONDESK_VIEW", "SAFEVOICE_VIEW"),
                userRepository.findById(bea).orElseThrow().getModulePermissions(), "bravo's user is untouched");
    }
}
