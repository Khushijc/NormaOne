package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;

/**
 * The Super Admin module: administrators (managed), regular users (read only), roles instead of general permissions, the
 * dashboard and the audit trail — and that nobody else can reach any of it.
 *
 * The platform built before each test:
 *   sub-root      SUPER_ADMIN (no tenant)
 *   alpha         sub-admin-a ADMIN (ACTIVE) · sub-uma USER (ACTIVE, linked through an invitation)
 *   bravo         sub-admin-b ADMIN (ACTIVE) · pat@b.test USER (INVITED, not linked)
 */
class SuperAdminAccountsIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    private String tenantA;
    private String tenantB;
    private String rootId;
    private String adminA;
    private String adminB;
    private String uma;
    private String pat;

    @BeforeEach
    void platform() throws Exception {
        rootId = superAdmin(ROOT).getId();
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        adminB = userRepository.findByCognitoSub("sub-admin-b").orElseThrow().getId();
        uma = invite("sub-admin-a", "uma@a.test", "Uma", "USER");
        mvc.perform(get("/api/users/me").with(asVerified("sub-uma", "uma@a.test", "Uma")))
                .andExpect(jsonPath("$.effectiveRole").value("USER"));
        pat = invite("sub-admin-b", "pat@b.test", "Pat", "USER");
    }

    private String invite(String adminSub, String email, String name, String role) throws Exception {
        String body = mvc.perform(post("/api/tenant/users").with(as(adminSub)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\",\"email\":\"" + email + "\",\"role\":\"" + role + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json(body, "$.id");
    }

    private MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    // ==================== 1, 15. listing administrators, with filters and paging ====================

    @Test
    void listsAdministratorsWithFiltersAndPaging() throws Exception {
        mvc.perform(get("/api/super-admin/admins").with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].id", containsInAnyOrder(adminA, adminB)))
                .andExpect(jsonPath("$.content[*].role", containsInAnyOrder("ADMIN", "ADMIN")));
        mvc.perform(get("/api/super-admin/admins").param("tenantId", tenantA).with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].organization.id").value(tenantA))
                .andExpect(jsonPath("$.content[0].organization.name").value("Org alpha"))
                .andExpect(jsonPath("$.content[0].organization.status").value("ACTIVE"));
        mvc.perform(get("/api/super-admin/admins").param("search", "admin@b").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(adminB));
        mvc.perform(get("/api/super-admin/admins").param("status", "INVITED").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/super-admin/admins").param("size", "1").param("page", "1").with(as(ROOT)))
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.page").value(1));
        mvc.perform(get("/api/super-admin/admins").param("status", "NOPE").with(as(ROOT)))
                .andExpect(status().isBadRequest());
    }

    // ==================== 2. viewing one administrator ====================

    @Test
    void viewsOneAdministratorAndNothingElseThroughThatRoute() throws Exception {
        mvc.perform(get("/api/super-admin/admins/" + adminA).with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("admin@a.test"))
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.linked").value(true))
                // No general permission list: what an administrator may do follows from the role.
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.customPermissions").doesNotExist())
                .andExpect(jsonPath("$.moduleAccess", hasSize(6)))
                .andExpect(jsonPath("$.organization.subdomain").value("alpha"))
                .andExpect(jsonPath("$.cognitoSub").doesNotExist());
        // A regular user, a Super Admin and an unknown id are not administrators.
        for (String id : List.of(uma, rootId, "does-not-exist")) {
            mvc.perform(get("/api/super-admin/admins/" + id).with(as(ROOT))).andExpect(status().isNotFound());
        }
    }

    // ==================== 3, 5. creating an administrator ====================

    @Test
    void createsAnAdministratorAsAnInvitationThatLinksAtFirstSignIn() throws Exception {
        String body = mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\" Nora \",\"email\":\"Nora@A.test\","
                                + "\"phoneNumber\":\"+34 600 000 001\",\"permissions\":[\"USERS_VIEW\",\"USERS_MANAGE\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("INVITED"))
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.linked").value(false))
                .andExpect(jsonPath("$.name").value("Nora"))
                .andExpect(jsonPath("$.email").value("nora@a.test"))
                // A former "permissions" field in the body is ignored like any unknown field.
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.organization.id").value(tenantA))
                .andReturn().getResponse().getContentAsString();
        String noraId = json(body, "$.id");

        user stored = userRepository.findById(noraId).orElseThrow();
        assertEquals(Set.of(UserRole.ADMIN), stored.getRoles());
        assertEquals(tenantA, stored.getTenantId());
        assertNull(stored.getCognitoSub());
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.USER_INVITED).and("targetId").is(noraId)
                .and("actorUserId").is(rootId)), AuditEvent.class));

        // She registers and signs in: the invitation is linked, and the ADMIN role gives her every
        // tenant-administration operation of her own organization — there is nothing to narrow.
        mvc.perform(get("/api/users/me").with(asVerified("sub-nora", "nora@a.test", "Nora")))
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"))
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.modules", hasSize(6)));
        mvc.perform(get("/api/tenant/users").with(as("sub-nora"))).andExpect(status().isOk());
        mvc.perform(get("/api/tenant").with(as("sub-nora"))).andExpect(status().isOk());
        mvc.perform(get("/api/tenant/package").with(as("sub-nora"))).andExpect(status().isOk());
        mvc.perform(get("/api/tenant/notifications").with(as("sub-nora"))).andExpect(status().isOk());
        // …and nothing of another organization.
        mvc.perform(get("/api/tenant/users/" + adminB).with(as("sub-nora"))).andExpect(status().isNotFound());
    }

    // ==================== 13. invalid organizations and duplicate accounts ====================

    @Test
    void refusesBadOrganizationsDuplicatesAndInvalidInputWithoutWritingAnything() throws Exception {
        long before = userRepository.count();
        String admin = "\"name\":\"X\",\"email\":\"x@x.test\"";

        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)), "{\"tenantId\":\"no-such-tenant\"," + admin + "}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Organization not found."));
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)), "{" + admin + "}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.tenantId").exists());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"X\",\"email\":\"not-an-email\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.email").exists());
        // Same email in the same organization, and an email that is a live account elsewhere.
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"X\",\"email\":\"ADMIN@a.test\"}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantB + "\",\"name\":\"X\",\"email\":\"uma@a.test\"}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantB + "\",\"name\":\"X\",\"email\":\"" + ROOT + "@platform.example\"}"))
                .andExpect(status().isConflict());
        // An organization that is not ACTIVE cannot take an invitation: it could never be linked.
        mvc.perform(jsonBody(patch("/api/super-admin/tenants/" + tenantB + "/status").with(as(ROOT)),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Review\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)), "{\"tenantId\":\"" + tenantB + "\"," + admin + "}"))
                .andExpect(status().isConflict());

        assertEquals(before, userRepository.count());
    }

    // ==================== 4. updating an administrator ====================

    @Test
    void updatesOnlyTheAdministratorsNameAndPhone() throws Exception {
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + adminA).with(as(ROOT)),
                        "{\"name\":\"Ana Updated\",\"phoneNumber\":\"+34 600 111 222\",\"email\":\"evil@x.test\","
                                + "\"tenantId\":\"" + tenantB + "\",\"status\":\"DEACTIVATED\",\"permissions\":[\"USERS_VIEW\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Ana Updated"))
                .andExpect(jsonPath("$.phoneNumber").value("+34 600 111 222"));
        user after = userRepository.findById(adminA).orElseThrow();
        assertEquals("admin@a.test", after.getEmail());
        assertEquals(tenantA, after.getTenantId());
        assertEquals(UserStatus.ACTIVE, after.getStatus());

        // The phone number is cleared by leaving it out: PUT replaces the profile whole.
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + adminA).with(as(ROOT)), "{\"name\":\"Ana\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phoneNumber").doesNotExist());
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + adminA).with(as(ROOT)), "{\"name\":\"  \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.name").exists());
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + uma).with(as(ROOT)), "{\"name\":\"Hacked\"}"))
                .andExpect(status().isNotFound());
        assertEquals("Uma", userRepository.findById(uma).orElseThrow().getName());
    }

    // ==================== 5, 14. no general permissions: roles decide ====================

    @Test
    void generalPermissionRoutesAreGoneAndOldStoredListsGrantOrRemoveNothing() throws Exception {
        // The general permission routes no longer exist.
        mvc.perform(get("/api/super-admin/admins/" + adminA + "/permissions").with(as(ROOT))).andExpect(status().isNotFound());
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + adminA + "/permissions").with(as(ROOT)),
                        "{\"permissions\":[\"USERS_VIEW\"]}"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/super-admin/permissions").with(as(ROOT))).andExpect(status().isNotFound());

        // A narrowed list written by the former system is ignored: the ADMIN role decides.
        mongo.updateFirst(new Query(Criteria.where("id").is(adminA)),
                new org.springframework.data.mongodb.core.query.Update().set("permissions", List.of("USERS_VIEW")), user.class);
        mvc.perform(get("/api/tenant").with(as("sub-admin-a"))).andExpect(status().isOk());
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a"))).andExpect(status().isOk());
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")), "{\"name\":\"Q\",\"email\":\"q@a.test\"}"))
                .andExpect(status().isCreated());
        mvc.perform(get("/api/tenant/notifications").with(as("sub-admin-a"))).andExpect(status().isOk());
        // …and it gives a regular user nothing either.
        mongo.updateFirst(new Query(Criteria.where("id").is(uma)),
                new org.springframework.data.mongodb.core.query.Update().set("permissions",
                        List.of("ORGANIZATION_VIEW", "PACKAGE_VIEW", "USERS_VIEW", "USERS_MANAGE", "NOTIFICATIONS_MANAGE")), user.class);
        for (String path : List.of("/api/tenant", "/api/tenant/package", "/api/tenant/users", "/api/tenant/notifications")) {
            mvc.perform(get(path).with(as("sub-uma"))).andExpect(status().isForbidden());
        }
        mvc.perform(get("/api/users/me").with(as("sub-uma")))
                .andExpect(jsonPath("$.effectiveRole").value("USER"))
                .andExpect(jsonPath("$.permissions").doesNotExist());
        // The next save drops the obsolete field.
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + adminA).with(as(ROOT)), "{\"name\":\"Ana\"}")).andExpect(status().isOk());
        org.bson.Document raw = mongo.getCollection("users").find(new org.bson.Document("_id", new org.bson.types.ObjectId(adminA))).first();
        assertTrue(!raw.containsKey("permissions"), "the obsolete general list is not written back");
    }

    @Test
    void tenantAdministrationFollowsTheRoleWithinTheOwnTenantOnly() throws Exception {
        // An administrator invited by a Tenant Admin, or a promoted user, administers the organization.
        String invited = invite("sub-admin-a", "vic@a.test", "Vic", "ADMIN");
        assertEquals(Set.of(UserRole.ADMIN), userRepository.findById(invited).orElseThrow().getRoles());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma).with(as("sub-admin-a")), "{\"role\":\"ADMIN\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/tenant").with(as("sub-uma"))).andExpect(status().isOk());
        mvc.perform(get("/api/tenant/users/" + adminB).with(as("sub-uma"))).andExpect(status().isNotFound());
        // Demoted, the same person administers nothing at all.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma).with(as("sub-admin-a")), "{\"role\":\"USER\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/tenant").with(as("sub-uma"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/users").with(as("sub-uma"))).andExpect(status().isForbidden());
        // A permissions field in a body is ignored.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + invited).with(as("sub-admin-a")),
                        "{\"name\":\"Vic\",\"permissions\":[\"ORGANIZATION_VIEW\",\"PACKAGE_VIEW\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.permissions").doesNotExist());
        // A suspended administrator, or one of a suspended organization, has no tenant access.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + invited + "/status").with(as("sub-admin-a")),
                        "{\"status\":\"DEACTIVATED\",\"reason\":\"Left\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(patch("/api/super-admin/tenants/" + tenantB + "/status").with(as(ROOT)),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Review\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/tenant").with(as("sub-admin-b"))).andExpect(status().isForbidden());
        // And an administrator still cannot change their own role, or make anybody a Super Admin.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + adminA).with(as("sub-admin-a")), "{\"role\":\"USER\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma).with(as("sub-admin-a")), "{\"role\":\"SUPER_ADMIN\"}"))
                .andExpect(status().isForbidden());
    }

    // ==================== administrator status ====================

    @Test
    void changesAnAdministratorsStatusThroughTheAccountLifecycle() throws Exception {
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + adminA + "/status").with(as(ROOT)), "{\"status\":\"SUSPENDED\"}"))
                .andExpect(status().isBadRequest());
        // adminA is alpha's only active administrator: the Super Admin must confirm leaving none.
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + adminA + "/status").with(as(ROOT)),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Security review\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("only active administrator")));
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + adminA + "/status").with(as(ROOT)),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Security review\",\"confirmNoActiveAdmin\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUSPENDED"))
                .andExpect(jsonPath("$.statusReason").value("Security review"));
        mvc.perform(get("/api/tenant/users").with(as("sub-admin-a"))).andExpect(status().isForbidden());
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + adminA + "/status").with(as(ROOT)), "{\"status\":\"SUSPENDED\",\"reason\":\"x\"}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + adminA + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/tenant/users").with(as("sub-admin-a"))).andExpect(status().isOk());
        // Nothing is deleted: the record is still there, with its history.
        assertTrue(userRepository.findById(adminA).isPresent());
    }

    // ==================== 6, 7, 15. regular users, read only ====================

    @Test
    void listsAndViewsRegularUsersOnly() throws Exception {
        mvc.perform(get("/api/super-admin/users").with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].id", containsInAnyOrder(uma, pat)))
                .andExpect(jsonPath("$.content[*].id", not(hasItem(adminA))))
                .andExpect(jsonPath("$.content[*].id", not(hasItem(rootId))));
        mvc.perform(get("/api/super-admin/users").param("tenantId", tenantA).with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].organization.name").value("Org alpha"));
        mvc.perform(get("/api/super-admin/users").param("status", "INVITED").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(pat));
        mvc.perform(get("/api/super-admin/users").param("search", "UMA").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/super-admin/users").param("size", "1").with(as(ROOT)))
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.totalPages").value(2));

        mvc.perform(get("/api/super-admin/users/" + uma).with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("USER"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.linked").value(true))
                .andExpect(jsonPath("$.organization.subdomain").value("alpha"))
                .andExpect(jsonPath("$.cognitoSub").doesNotExist())
                .andExpect(jsonPath("$.phoneNumber").doesNotExist())
                .andExpect(jsonPath("$.permissions").doesNotExist());
        mvc.perform(get("/api/super-admin/users/" + adminA).with(as(ROOT))).andExpect(status().isNotFound());
        mvc.perform(get("/api/super-admin/users/" + rootId).with(as(ROOT))).andExpect(status().isNotFound());
    }

    // ==================== 8, 9. no regular-user mutation exists ====================

    @Test
    void cannotCreateUpdateDeleteOrChangeTheStatusOfARegularUser() throws Exception {
        long before = userRepository.count();
        user umaBefore = userRepository.findById(uma).orElseThrow();

        mvc.perform(jsonBody(post("/api/super-admin/users").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"New\",\"email\":\"new@a.test\"}"))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(jsonBody(put("/api/super-admin/users/" + uma).with(as(ROOT)), "{\"name\":\"Changed\"}"))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(jsonBody(patch("/api/super-admin/users/" + uma).with(as(ROOT)), "{\"name\":\"Changed\"}"))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(delete("/api/super-admin/users/" + uma).with(as(ROOT)))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(jsonBody(patch("/api/super-admin/users/" + uma + "/status").with(as(ROOT)),
                        "{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isNotFound());
        // And the administrator routes do not reach a regular user either.
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + uma + "/status").with(as(ROOT)),
                        "{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Uma\",\"email\":\"uma@a.test\"}"))
                .andExpect(status().isConflict());

        user umaAfter = userRepository.findById(uma).orElseThrow();
        assertEquals(before, userRepository.count());
        assertEquals(umaBefore.getName(), umaAfter.getName());
        assertEquals(umaBefore.getStatus(), umaAfter.getStatus());
        assertEquals(umaBefore.getRoles(), umaAfter.getRoles());
    }

    // ==================== 10, 11, 12. nobody else gets in ====================

    @Test
    void administratorsUsersAndAnonymousCallersAreRefused() throws Exception {
        // Built fresh for every caller: a request builder keeps the post-processors added to it, so
        // reusing one would carry the previous caller's token into the anonymous pass.
        java.util.function.Supplier<List<MockHttpServletRequestBuilder>> calls = () -> List.of(
                get("/api/super-admin/dashboard"),
                get("/api/super-admin/admins"),
                get("/api/super-admin/admins/" + adminA),
                jsonBody(post("/api/super-admin/admins"), "{\"tenantId\":\"" + tenantA + "\",\"name\":\"X\",\"email\":\"x@a.test\"}"),
                jsonBody(put("/api/super-admin/admins/" + adminA), "{\"name\":\"X\"}"),
                jsonBody(patch("/api/super-admin/admins/" + adminB + "/status"), "{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"),
                jsonBody(put("/api/super-admin/admins/" + adminA + "/modules"), "{\"modules\":[],\"permissions\":[]}"),
                get("/api/super-admin/admins/" + adminA + "/modules"),
                get("/api/super-admin/users"),
                get("/api/super-admin/users/" + uma),
                get("/api/super-admin/audit-events"));

        for (MockHttpServletRequestBuilder call : calls.get()) {
            mvc.perform(call.with(as("sub-admin-a"))).andExpect(status().isForbidden());
        }
        for (MockHttpServletRequestBuilder call : calls.get()) {
            mvc.perform(call.with(as("sub-uma"))).andExpect(status().isForbidden());
        }
        for (MockHttpServletRequestBuilder call : calls.get()) {
            mvc.perform(call).andExpect(status().isUnauthorized());
        }
        // Nothing changed: no new account, adminA's module access untouched, adminB still ACTIVE.
        assertEquals(4, userRepository.count() - 1);
        assertEquals(6, userRepository.findById(adminA).orElseThrow().getModuleAccess().size());
        assertEquals(UserStatus.ACTIVE, userRepository.findById(adminB).orElseThrow().getStatus());
    }

    // ==================== dashboard and audit ====================

    @Test
    void dashboardCountsComeFromTheStoredRecords() throws Exception {
        mvc.perform(get("/api/super-admin/dashboard").with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalOrganizations").value(2))
                .andExpect(jsonPath("$.organizationsByStatus.ACTIVE").value(2))
                .andExpect(jsonPath("$.totalAdmins").value(2))
                .andExpect(jsonPath("$.activeAdmins").value(2))
                .andExpect(jsonPath("$.inactiveAdmins").value(0))
                .andExpect(jsonPath("$.totalUsers").value(2))
                .andExpect(jsonPath("$.activeUsers").value(1))
                .andExpect(jsonPath("$.usersByStatus.INVITED").value(1))
                .andExpect(jsonPath("$.totalSuperAdmins").value(1))
                .andExpect(jsonPath("$.currentSubscriptionsByPlan.BASIC").value(2));

        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Leave\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + adminB + "/status").with(as(ROOT)),
                        "{\"status\":\"DEACTIVATED\",\"reason\":\"Left\",\"confirmNoActiveAdmin\":true}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/super-admin/dashboard").with(as(ROOT)))
                .andExpect(jsonPath("$.activeUsers").value(0))
                .andExpect(jsonPath("$.inactiveUsers").value(1))
                .andExpect(jsonPath("$.activeAdmins").value(1))
                .andExpect(jsonPath("$.inactiveAdmins").value(1))
                .andExpect(jsonPath("$.adminsByStatus.DEACTIVATED").value(1));
    }

    @Test
    void auditTrailIsReadableAndFilterable() throws Exception {
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + adminA + "/modules").with(as(ROOT)),
                        "{\"modules\":[\"FACTURAFLOW\"],\"permissions\":[\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isOk());

        mvc.perform(get("/api/super-admin/audit-events").param("tenantId", tenantA).with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].action", hasItem("TENANT_ONBOARDED")))
                .andExpect(jsonPath("$.content[*].action", hasItem("USER_MODULE_ACCESS_CHANGED")));
        mvc.perform(get("/api/super-admin/audit-events").param("action", "USER_MODULE_ACCESS_CHANGED").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].targetId").value(adminA))
                .andExpect(jsonPath("$.content[0].actorUserId").value(rootId))
                .andExpect(jsonPath("$.content[0].actorRole").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.content[0].details.permissionsTo").value("FACTURAFLOW_VIEW"));
        // The legacy action still filters (events stored by the former permission system stay readable); none is written now.
        mvc.perform(get("/api/super-admin/audit-events").param("action", "ADMIN_PERMISSIONS_CHANGED").with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/super-admin/audit-events").param("targetId", uma).with(as(ROOT)))
                .andExpect(jsonPath("$.content[*].action", hasItem("USER_LINKED")));
        mvc.perform(get("/api/super-admin/audit-events").param("action", "NOT_AN_ACTION").with(as(ROOT)))
                .andExpect(status().isBadRequest());
    }
}
