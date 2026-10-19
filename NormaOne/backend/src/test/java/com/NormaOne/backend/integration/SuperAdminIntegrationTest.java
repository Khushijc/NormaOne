package com.NormaOne.backend.integration;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.plans.TenantSubscription;


class SuperAdminIntegrationTest extends IntegrationTestBase {

    @Test
    void superAdminListsTenantsAndViewsTheirPackages() throws Exception {
        superAdmin("sub-root");
        String tenantId = onboard("sub-a", "a@a.test", "alpha");

        mvc.perform(get("/api/super-admin/tenants").with(as("sub-root")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(tenantId))
                .andExpect(jsonPath("$.content[0].packageCode").value("BASIC"));
        mvc.perform(get("/api/super-admin/tenants").param("search", "alp").with(as("sub-root")))
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/super-admin/tenants/" + tenantId + "/package").with(as("sub-root")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantId").value(tenantId))
                .andExpect(jsonPath("$.plan.planCode").value("BASIC"));
        mvc.perform(get("/api/super-admin/tenants/" + tenantId).with(as("sub-root")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userCount").value(1))
                .andExpect(jsonPath("$.packageInfo.status").value("ACTIVE"));
        mvc.perform(get("/api/super-admin/tenants/does-not-exist").with(as("sub-root"))).andExpect(status().isNotFound());
        // /summary is the earlier name of /dashboard and answers the same.
        mvc.perform(get("/api/super-admin/summary").with(as("sub-root")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalOrganizations").value(1))
                .andExpect(jsonPath("$.currentSubscriptionsByPlan.BASIC").value(1));
    }

    @Test
    void superAdminCreatesAndManagesTenants() throws Exception {
        user root = superAdmin("sub-root");
        String body = "{\"organizationName\":\"Beta S.L.\",\"subdomain\":\"beta\",\"countryCode\":\"ES\","
                + "\"initialAdmin\":{\"name\":\"Bea\",\"email\":\"Bea@Beta.test\"}}";
        String created = mvc.perform(post("/api/super-admin/tenants").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.packageCode").value("BASIC"))
                .andReturn().getResponse().getContentAsString();
        String tenantId = json(created, "$.id");

        user invited = mongo.findOne(new Query(Criteria.where("tenantId").is(tenantId)), user.class);
        assertEquals(UserStatus.INVITED, invited.getStatus());
        assertEquals("bea@beta.test", invited.getEmail());
        assertNull(invited.getCognitoSub());
        assertTrue(invited.getRoles().contains(UserRole.ADMIN));
        assertEquals(1, mongo.count(new Query(Criteria.where("tenantId").is(tenantId)), TenantSubscription.class));

        mvc.perform(post("/api/super-admin/tenants").with(as("sub-root")).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict());

        mvc.perform(patch("/api/super-admin/tenants/" + tenantId).with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"tenantName\":\"Beta Global\",\"city\":\"Valencia\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantName").value("Beta Global"))
                .andExpect(jsonPath("$.subdomain").value("beta"));

        mvc.perform(patch("/api/super-admin/tenants/" + tenantId + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"SUSPENDED\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(patch("/api/super-admin/tenants/" + tenantId + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DELETED\",\"reason\":\"x\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(patch("/api/super-admin/tenants/" + tenantId + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"SUSPENDED\",\"reason\":\"Unpaid\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUSPENDED"));
        mvc.perform(patch("/api/super-admin/tenants/" + tenantId + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        List<AuditEvent> events = mongo.find(new Query(Criteria.where("tenantId").is(tenantId)), AuditEvent.class);
        assertTrue(events.stream().anyMatch(e -> e.getAction() == AuditAction.TENANT_CREATED && root.getId().equals(e.getActorUserId())));
        assertTrue(events.stream().anyMatch(e -> e.getAction() == AuditAction.TENANT_STATUS_CHANGED));
        assertTrue(events.stream().anyMatch(e -> e.getAction() == AuditAction.PACKAGE_ASSIGNED));
    }

    @Test
    void suspendingATenantBlocksItsUsers() throws Exception {
        superAdmin("sub-root");
        String tenantId = onboard("sub-a", "a@a.test", "alpha");
        mvc.perform(get("/api/tenant/users").with(as("sub-a"))).andExpect(status().isOk());
        mvc.perform(patch("/api/super-admin/tenants/" + tenantId + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"SUSPENDED\",\"reason\":\"Review\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/tenant/users").with(as("sub-a"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/users/me").with(as("sub-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantStatus").value("SUSPENDED"));
    }

    @Test
    void superAdminDeactivatesAnAdministratorWithSafeguards() throws Exception {
        user root = superAdmin("sub-root");
        user otherRoot = superAdmin("sub-root-2");
        onboard("sub-a", "a@a.test", "alpha");
        onboard("sub-b", "b@b.test", "bravo");
        String adminA = userRepository.findByCognitoSub("sub-a").orElseThrow().getId();

        mvc.perform(get("/api/super-admin/admins").with(as("sub-root")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(get("/api/super-admin/admins/" + adminA).with(as("sub-root")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("a@a.test"))
                .andExpect(jsonPath("$.cognitoSub").doesNotExist());

        mvc.perform(patch("/api/super-admin/admins/" + adminA + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DEACTIVATED\",\"reason\":\"Left\"}"))
                .andExpect(status().isConflict());
        mvc.perform(patch("/api/super-admin/admins/" + adminA + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DEACTIVATED\",\"reason\":\"Left\",\"confirmNoActiveAdmin\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DEACTIVATED"));
        mvc.perform(get("/api/tenant/users").with(as("sub-a"))).andExpect(status().isForbidden());

        // Super Admin accounts are not administrators: the admin routes do not reach them.
        mvc.perform(patch("/api/super-admin/admins/" + root.getId() + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(patch("/api/super-admin/admins/" + otherRoot.getId() + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isNotFound());
        assertEquals(UserStatus.ACTIVE, userRepository.findById(otherRoot.getId()).orElseThrow().getStatus());
    }

    @Test
    void superAdminCannotBeCreatedOrPromotedThroughApis() throws Exception {
        superAdmin("sub-root");
        String tenantId = onboard("sub-a", "a@a.test", "alpha");
        String adminA = userRepository.findByCognitoSub("sub-a").orElseThrow().getId();

        // No role-assignment endpoint exists, on users or administrators.
        mvc.perform(patch("/api/super-admin/users/" + adminA).with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"roles\":[\"SUPER_ADMIN\"]}"))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(patch("/api/super-admin/admins/" + adminA).with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"roles\":[\"SUPER_ADMIN\"]}"))
                .andExpect(status().isMethodNotAllowed());
        // Extra fields on a status change or a profile update are ignored.
        mvc.perform(patch("/api/super-admin/admins/" + adminA + "/status").with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"SUSPENDED\",\"reason\":\"r\",\"confirmNoActiveAdmin\":true,\"roles\":[\"SUPER_ADMIN\"],\"tenantId\":null}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/super-admin/admins/" + adminA).with(as("sub-root"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"A\",\"roles\":[\"SUPER_ADMIN\"],\"role\":\"SUPER_ADMIN\",\"tenantId\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("ADMIN"));
        // Creating an administrator with a role in the body still creates an ADMIN.
        String created = mvc.perform(post("/api/super-admin/admins").with(as("sub-root")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantId\":\"" + tenantId + "\",\"name\":\"Z\",\"email\":\"z@a.test\",\"role\":\"SUPER_ADMIN\",\"roles\":[\"SUPER_ADMIN\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andReturn().getResponse().getContentAsString();

        for (String id : List.of(adminA, json(created, "$.id"))) {
            user after = userRepository.findById(id).orElseThrow();
            assertEquals(java.util.Set.of(UserRole.ADMIN), after.getRoles());
            assertEquals(tenantId, after.getTenantId());
        }
        assertEquals(1, mongo.count(new Query(Criteria.where("roles").is(UserRole.SUPER_ADMIN)), user.class));
    }

    @Test
    void nonSuperAdminsGet403FromPlatformApis() throws Exception {
        onboard("sub-a", "a@a.test", "alpha");
        mvc.perform(get("/api/super-admin/tenants").with(as("sub-a"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/users").with(as("sub-a"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/summary").with(as("sub-a"))).andExpect(status().isForbidden());
        mvc.perform(post("/api/super-admin/tenants").with(as("sub-a")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"organizationName\":\"Z\",\"subdomain\":\"zz\",\"countryCode\":\"ES\",\"initialAdmin\":{\"name\":\"Z\",\"email\":\"z@z.test\"}}"))
                .andExpect(status().isForbidden());
        assertEquals(1, mongo.count(new Query(), com.NormaOne.backend.model.core.Tenant.class));
    }

    // The bootstrap's own tests are in SuperAdminBootstrapIntegrationTest.
}
