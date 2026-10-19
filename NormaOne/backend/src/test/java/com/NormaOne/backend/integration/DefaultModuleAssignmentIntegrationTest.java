package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.Date;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import org.bson.Document;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.bootstrap.ModuleAccessBackfill;
import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleAction;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.services.ModuleAccessService;

import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;

/**
 * Default module assignment: every new tenant account — whoever creates it — gets all six modules,
 * with permissions from the role policy (never all of them); administrators manage them module by
 * module within their own scope and tenant; and existing accounts are only ever backfilled on purpose.
 *
 *   sub-root     SUPER_ADMIN
 *   alpha        sub-admin-a ADMIN (onboarded) · sub-uma USER (invited by sub-admin-a, linked)
 *   bravo        sub-admin-b ADMIN (onboarded)
 * Tenant alpha is on a plan with all six modules, so assignments are enforced, not just stored.
 */
class DefaultModuleAssignmentIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";
    private static final List<String> SIX = List.of("FACTURAFLOW", "JORNADAPULSE", "DATOSPILOT", "PREVENWORK", "BUZONDESK", "SAFEVOICE");

    @Autowired
    private ModuleAccessService moduleAccessService;

    @Autowired
    private ModuleAccessBackfill backfill;

    @Autowired
    private NormaOneProperties properties;

    private String tenantA;
    private String tenantB;
    private String adminA;
    private String uma;

    @BeforeEach
    void platform() throws Exception {
        superAdmin(ROOT);
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        uma = invite("sub-admin-a", "{\"name\":\"Uma\",\"email\":\"uma@a.test\",\"role\":\"USER\"}");
        mvc.perform(get("/api/users/me").with(asVerified("sub-uma", "uma@a.test", "Uma"))).andExpect(jsonPath("$.effectiveRole").value("USER"));
        String plan = json(mvc.perform(json(post("/api/super-admin/plans").with(as(ROOT)),
                        "{\"planCode\":\"FULL\",\"name\":\"Full\",\"billingCycle\":\"MONTHLY\",\"listPrice\":0,\"maxEmployees\":50,"
                                + "\"moduleApps\":[\"NORMAONE\",\"FACTURAFLOW\",\"JORNADAPULSE\",\"DATOSPILOT\",\"PREVENWORK\",\"BUZONDESK\",\"SAFEVOICE\"]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(json(patch("/api/super-admin/plans/" + plan + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}")).andExpect(status().isOk());
        mvc.perform(json(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)), "{\"planId\":\"" + plan + "\"}"))
                .andExpect(status().isOk());
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private String invite(String adminSub, String body) throws Exception {
        return json(mvc.perform(json(post("/api/tenant/users").with(as(adminSub)), body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
    }

    private static Jwt token(String sub) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(sub).claim("token_use", "access").build();
    }

    private static List<String> names(Set<ModulePermission> permissions) {
        return permissions.stream().sorted().map(Enum::name).toList();
    }

    private static final List<String> ADMIN_DEFAULTS = names(ModuleCatalog.defaultPermissionsFor(UserRole.ADMIN));
    private static final List<String> USER_DEFAULTS = names(ModuleCatalog.defaultPermissionsFor(UserRole.USER));
    private static final List<String> OWNER_PERMISSIONS = names(ModuleCatalog.ownerPermissions());

    // ==================== 1, 2, 8. defaults at creation ====================

    @Test
    void theOwnerWhoRegistersGetsEveryModulePermissionAndInvitedAdministratorsTheAdminDefaults() throws Exception {
        // The owner who registered the organization (self-service onboarding): every permission of
        // all six modules, DELETE included, so they can grant any of them.
        user owner = userRepository.findById(adminA).orElseThrow();
        assertEquals(SIX, owner.getModuleAccess());
        assertEquals(OWNER_PERMISSIONS, owner.getModulePermissions());
        assertNotNull(owner.getModuleAccessAssignedAt());
        assertTrue(owner.getModulePermissions().contains("PREVENWORK_DELETE"));
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.PREVENWORK_DELETE));

        // Created by a Super Admin for a named tenant.
        String nora = json(mvc.perform(json(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantB + "\",\"name\":\"Nora\",\"email\":\"nora@b.test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.organization.id").value(tenantB))
                .andExpect(jsonPath("$.moduleAccess", contains(SIX.toArray())))
                .andReturn().getResponse().getContentAsString(), "$.id");
        user stored = userRepository.findById(nora).orElseThrow();
        assertEquals(tenantB, stored.getTenantId());
        assertEquals(Set.of(UserRole.ADMIN), stored.getRoles());
        assertEquals(ADMIN_DEFAULTS, stored.getModulePermissions());

        // The first administrator of an organization a Super Admin creates is invited, not the owner
        // who registered it: the ADMIN defaults.
        mvc.perform(json(post("/api/super-admin/tenants").with(as(ROOT)),
                        "{\"organizationName\":\"Gamma\",\"subdomain\":\"gamma\",\"countryCode\":\"ES\","
                                + "\"initialAdmin\":{\"name\":\"Gil\",\"email\":\"gil@gamma.test\"}}"))
                .andExpect(status().isCreated());
        user gil = userRepository.findByEmail("gil@gamma.test").get(0);
        assertEquals(SIX, gil.getModuleAccess());
        assertEquals(ADMIN_DEFAULTS, gil.getModulePermissions());

        // Tenant bravo stays on BASIC (the portal only): its administrator's six modules are all
        // available anyway, with their own module permissions, while plan entitlement is not enforced.
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-b"))).andExpect(jsonPath("$.plan.planCode").value("BASIC"));
        mvc.perform(get("/api/users/me").with(as("sub-admin-b")))
                .andExpect(jsonPath("$.modules", contains(SIX.toArray())))
                .andExpect(jsonPath("$.modulePermissions", org.hamcrest.Matchers.hasItem("PREVENWORK_DELETE")))
                .andExpect(jsonPath("$.modulePermissions", hasSize(OWNER_PERMISSIONS.size())))
                .andExpect(jsonPath("$.permissions").doesNotExist());
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-admin-b"), ModulePermission.BUZONDESK_MANAGE));

        // The Cognito invitation flow is unchanged.
        verify(cognito, atLeastOnce()).adminCreateUser(any(AdminCreateUserRequest.class));
    }

    @Test
    void aNewUserGetsAllSixModulesWithViewOnly() throws Exception {
        user stored = userRepository.findById(uma).orElseThrow();
        assertEquals(tenantA, stored.getTenantId());
        assertEquals(SIX, stored.getModuleAccess());
        assertEquals(USER_DEFAULTS, stored.getModulePermissions());
        assertTrue(stored.getModulePermissions().stream().allMatch(p -> p.endsWith("_VIEW")), "no administrative permission");

        // /api/users/me: the six module ids, usable on this plan, and VIEW in each.
        mvc.perform(get("/api/users/me").with(as("sub-uma")))
                .andExpect(jsonPath("$.modules", contains(SIX.toArray())))
                .andExpect(jsonPath("$.modulePermissions", contains("FACTURAFLOW_VIEW", "JORNADAPULSE_VIEW", "DATOSPILOT_VIEW",
                        "PREVENWORK_VIEW", "BUZONDESK_VIEW", "SAFEVOICE_VIEW")))
                .andExpect(jsonPath("$.accountType").value("TENANT"))
                .andExpect(jsonPath("$.tenantId").value(tenantA))
                .andExpect(jsonPath("$.roles", contains("USER")));
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.JORNADAPULSE_VIEW));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.JORNADAPULSE_CREATE));

        // An ADMIN invited by a Tenant Admin gets the ADMIN defaults (all held by the inviter).
        String ivan = invite("sub-admin-a", "{\"name\":\"Ivan\",\"email\":\"ivan@a.test\",\"role\":\"ADMIN\"}");
        assertEquals(ADMIN_DEFAULTS, userRepository.findById(ivan).orElseThrow().getModulePermissions());
    }

    @Test
    void theOwnerChoosesTheModulePermissionsOfTheAdministratorsAndUsersTheyInvite() throws Exception {
        // Any permission the owner holds can be given at the invitation, DELETE included.
        String ada = invite("sub-admin-a", "{\"name\":\"Ada\",\"email\":\"ada@a.test\",\"role\":\"ADMIN\","
                + "\"moduleAccess\":[\"PREVENWORK\",\"FACTURAFLOW\"],"
                + "\"modulePermissions\":[\"PREVENWORK_VIEW\",\"PREVENWORK_DELETE\",\"FACTURAFLOW_VIEW\"]}");
        user adaStored = userRepository.findById(ada).orElseThrow();
        assertEquals(List.of("FACTURAFLOW", "PREVENWORK"), adaStored.getModuleAccess());
        assertEquals(List.of("FACTURAFLOW_VIEW", "PREVENWORK_VIEW", "PREVENWORK_DELETE"), adaStored.getModulePermissions());
        String una = invite("sub-admin-a", "{\"name\":\"Una\",\"email\":\"una@a.test\",\"role\":\"USER\","
                + "\"moduleAccess\":[\"JORNADAPULSE\"],\"modulePermissions\":[\"JORNADAPULSE_VIEW\",\"JORNADAPULSE_CREATE\"]}");
        assertEquals(List.of("JORNADAPULSE_VIEW", "JORNADAPULSE_CREATE"), userRepository.findById(una).orElseThrow().getModulePermissions());

        // And changed afterwards, module by module, to any permission the owner holds.
        mvc.perform(json(put("/api/tenant/users/" + uma + "/modules/PREVENWORK").with(as("sub-admin-a")),
                        "{\"permissions\":[\"PREVENWORK_VIEW\",\"PREVENWORK_MANAGE\",\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.modules[3].effectivePermissions", contains("PREVENWORK_VIEW", "PREVENWORK_DELETE", "PREVENWORK_MANAGE")));
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.PREVENWORK_DELETE));

        // An invited administrator (ADMIN defaults, no DELETE) cannot hand out DELETE.
        String ivo = invite("sub-admin-a", "{\"name\":\"Ivo\",\"email\":\"ivo@a.test\",\"role\":\"ADMIN\"}");
        mvc.perform(get("/api/users/me").with(asVerified("sub-ivo", "ivo@a.test", "Ivo"))).andExpect(jsonPath("$.effectiveRole").value("ADMIN"));
        assertEquals(ADMIN_DEFAULTS, userRepository.findById(ivo).orElseThrow().getModulePermissions());
        mvc.perform(json(post("/api/tenant/users").with(as("sub-ivo")), "{\"name\":\"Ned\",\"email\":\"ned@a.test\",\"role\":\"USER\","
                        + "\"moduleAccess\":[\"PREVENWORK\"],\"modulePermissions\":[\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isForbidden());
        assertTrue(userRepository.findByEmail("ned@a.test").isEmpty());
    }

    @Test
    void aSuperAdminNeverReceivesTenantModules() throws Exception {
        mvc.perform(get("/api/users/me").with(as(ROOT)))
                .andExpect(jsonPath("$.effectiveRole").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.accountType").value("PLATFORM"))
                .andExpect(jsonPath("$.modules", hasSize(0)))
                .andExpect(jsonPath("$.modulePermissions", hasSize(0)));
        String sara = json(mvc.perform(json(post("/api/super-admin/super-admins").with(as(ROOT)),
                        "{\"name\":\"Sara\",\"email\":\"sara@platform.test\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        user stored = userRepository.findById(sara).orElseThrow();
        assertTrue(stored.getModuleAccess().isEmpty());
        assertTrue(stored.getModulePermissions().isEmpty());
        assertNull(stored.getModuleAccessAssignedAt());
        assertEquals(List.of(), ModuleCatalog.defaultModulesFor(UserRole.SUPER_ADMIN));
        assertTrue(ModuleCatalog.defaultPermissionsFor(UserRole.SUPER_ADMIN).isEmpty());
        // A platform account is not reachable through the administrator routes either.
        mvc.perform(get("/api/super-admin/admins/" + sara + "/modules").with(as(ROOT))).andExpect(status().isNotFound());
    }

    // ==================== 3, 4, 5. stored once, per module, validated ====================

    @Test
    void explicitAssignmentsAreValidatedAndStoredWithoutDuplicates() throws Exception {
        // Duplicates in a request are stored once, in catalog order.
        String vic = invite("sub-admin-a", "{\"name\":\"Vic\",\"email\":\"vic@a.test\",\"role\":\"USER\","
                + "\"moduleAccess\":[\"SAFEVOICE\",\"FACTURAFLOW\",\"FACTURAFLOW\"],"
                + "\"modulePermissions\":[\"FACTURAFLOW_VIEW\",\"FACTURAFLOW_VIEW\",\"FACTURAFLOW_CREATE\"]}");
        user stored = userRepository.findById(vic).orElseThrow();
        assertEquals(List.of("FACTURAFLOW", "SAFEVOICE"), stored.getModuleAccess());
        assertEquals(List.of("FACTURAFLOW_VIEW", "FACTURAFLOW_CREATE"), stored.getModulePermissions());

        // A retried invitation does not create a second record.
        mvc.perform(json(post("/api/tenant/users").with(as("sub-admin-a")),
                        "{\"name\":\"Vic\",\"email\":\"vic@a.test\",\"role\":\"USER\"}"))
                .andExpect(status().isConflict());
        assertEquals(1, userRepository.findByEmail("vic@a.test").size());

        // Assigning the same module twice changes nothing and duplicates nothing.
        String path = "/api/tenant/users/" + vic + "/modules/FACTURAFLOW";
        for (int i = 0; i < 2; i++) {
            mvc.perform(json(put(path).with(as("sub-admin-a")), "{\"permissions\":[\"FACTURAFLOW_VIEW\"]}")).andExpect(status().isOk());
        }
        assertEquals(List.of("FACTURAFLOW", "SAFEVOICE"), userRepository.findById(vic).orElseThrow().getModuleAccess());
        assertEquals(List.of("FACTURAFLOW_VIEW"), userRepository.findById(vic).orElseThrow().getModulePermissions());

        // Cross-module and unknown values are refused, and nothing changes.
        mvc.perform(json(put(path).with(as("sub-admin-a")), "{\"permissions\":[\"JORNADAPULSE_VIEW\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("JORNADAPULSE_VIEW")));
        mvc.perform(json(put("/api/tenant/users/" + vic + "/modules").with(as("sub-admin-a")),
                        "{\"modules\":[\"FACTURAFLOW\"],\"permissions\":[\"DATOSPILOT_VIEW\"]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(put("/api/tenant/users/" + vic + "/modules/NORMAONE").with(as("sub-admin-a")), "{\"permissions\":[]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(put("/api/tenant/users/" + vic + "/modules/PAYROLL").with(as("sub-admin-a")), "{\"permissions\":[]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(put(path).with(as("sub-admin-a")), "{\"permissions\":[\"FACTURAFLOW_PAY\"]}")).andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/tenant/users").with(as("sub-admin-a")),
                        "{\"name\":\"W\",\"email\":\"w@a.test\",\"moduleAccess\":[\"FACTURAFLOW\"],\"modulePermissions\":[\"PREVENWORK_VIEW\"]}"))
                .andExpect(status().isBadRequest());
        assertTrue(userRepository.findByEmail("w@a.test").isEmpty());
        assertEquals(List.of("FACTURAFLOW_VIEW"), userRepository.findById(vic).orElseThrow().getModulePermissions());

        // The grouped view lists all six modules with only their own permissions.
        mvc.perform(get("/api/tenant/users/" + vic + "/modules").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.modules", hasSize(6)))
                .andExpect(jsonPath("$.modules[0].assigned").value(true))
                .andExpect(jsonPath("$.modules[0].permissions", contains("FACTURAFLOW_VIEW")))
                .andExpect(jsonPath("$.modules[1].assigned").value(false))
                .andExpect(jsonPath("$.modules[1].permissions", hasSize(0)))
                .andExpect(jsonPath("$.assignedAt").exists());
    }

    // ==================== 7. revocation ====================

    @Test
    void revocationsApplyToTheNextRequest() throws Exception {
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.FACTURAFLOW_VIEW));

        // Revoke one module.
        mvc.perform(delete("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-admin-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedModules", not(org.hamcrest.Matchers.hasItem("FACTURAFLOW"))));
        mvc.perform(get("/api/users/me").with(as("sub-uma")))
                .andExpect(jsonPath("$.modules", hasSize(5)))
                .andExpect(jsonPath("$.modules", not(org.hamcrest.Matchers.hasItem("FACTURAFLOW"))))
                .andExpect(jsonPath("$.modulePermissions", not(org.hamcrest.Matchers.hasItem("FACTURAFLOW_VIEW"))));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.FACTURAFLOW_VIEW));

        // Revoke a permission while keeping the module.
        mvc.perform(json(put("/api/tenant/users/" + uma + "/modules/JORNADAPULSE").with(as("sub-admin-a")), "{\"permissions\":[]}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/users/me").with(as("sub-uma")))
                .andExpect(jsonPath("$.modules[0]").value("JORNADAPULSE"))
                .andExpect(jsonPath("$.modulePermissions", not(org.hamcrest.Matchers.hasItem("JORNADAPULSE_VIEW"))));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.JORNADAPULSE_VIEW));

        // Grant back a permission beyond the default (the inviter holds it), and it applies at once.
        mvc.perform(json(put("/api/tenant/users/" + uma + "/modules/JORNADAPULSE").with(as("sub-admin-a")),
                        "{\"permissions\":[\"JORNADAPULSE_VIEW\",\"JORNADAPULSE_CREATE\"]}"))
                .andExpect(status().isOk());
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.JORNADAPULSE_CREATE));
        assertTrue(mongo.count(new Query(Criteria.where("action").is(AuditAction.USER_MODULE_ACCESS_CHANGED).and("targetId").is(uma)),
                AuditEvent.class) >= 3);

        // A role change resets module permissions to the new role's defaults (inside the assigned modules).
        mvc.perform(json(patch("/api/tenant/users/" + uma).with(as("sub-admin-a")), "{\"role\":\"ADMIN\"}")).andExpect(status().isOk());
        user promoted = userRepository.findById(uma).orElseThrow();
        assertTrue(promoted.getModulePermissions().contains("JORNADAPULSE_APPROVE"));
        assertTrue(promoted.getModulePermissions().stream().noneMatch(p -> p.startsWith("FACTURAFLOW")), "revoked module stays revoked");
        mvc.perform(json(patch("/api/tenant/users/" + uma).with(as("sub-admin-a")), "{\"role\":\"USER\"}")).andExpect(status().isOk());
        user demoted = userRepository.findById(uma).orElseThrow();
        assertTrue(demoted.getModulePermissions().stream().allMatch(p -> p.endsWith("_VIEW")), "a demoted administrator keeps no admin permission");
    }

    // ==================== 9. scope and isolation ====================

    @Test
    void administratorsManageOnlyTheirOwnTenantWithinTheirOwnScope() throws Exception {
        // Another tenant's administrator does not find the user; a USER has no tenant route at all.
        mvc.perform(get("/api/tenant/users/" + uma + "/modules").with(as("sub-admin-b"))).andExpect(status().isNotFound());
        mvc.perform(json(put("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-admin-b")), "{\"permissions\":[]}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/tenant/users/" + uma + "/modules/FACTURAFLOW").with(as("sub-admin-b"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/tenant/users/" + uma + "/modules").with(as("sub-uma"))).andExpect(status().isForbidden());
        mvc.perform(json(put("/api/tenant/users/" + uma + "/modules").with(as("sub-uma")),
                        "{\"modules\":[\"PREVENWORK\"],\"permissions\":[\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isForbidden());
        // Nobody changes their own module access, and the Super Admin route is not a tenant admin's.
        mvc.perform(json(put("/api/tenant/users/" + adminA + "/modules/PREVENWORK").with(as("sub-admin-a")),
                        "{\"permissions\":[\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isForbidden());
        mvc.perform(json(put("/api/super-admin/admins/" + adminA + "/modules/PREVENWORK").with(as("sub-admin-a")),
                        "{\"permissions\":[\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isForbidden());
        // A Tenant Admin cannot grant what they do not hold — DELETE is not an ADMIN default, so an
        // invited administrator does not hold it (the owner does).
        invite("sub-admin-a", "{\"name\":\"Ian\",\"email\":\"ian@a.test\",\"role\":\"ADMIN\"}");
        mvc.perform(get("/api/users/me").with(asVerified("sub-ian", "ian@a.test", "Ian"))).andExpect(jsonPath("$.effectiveRole").value("ADMIN"));
        mvc.perform(json(put("/api/tenant/users/" + uma + "/modules/PREVENWORK").with(as("sub-ian")),
                        "{\"permissions\":[\"PREVENWORK_VIEW\",\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message", containsString("PREVENWORK_DELETE")));
        assertTrue(userRepository.findById(uma).orElseThrow().getModulePermissions().stream().noneMatch(p -> p.endsWith("_DELETE")));

        // The Super Admin may; and a narrowed administrator invites within the narrower scope.
        mvc.perform(json(put("/api/super-admin/admins/" + adminA + "/modules").with(as(ROOT)),
                        "{\"modules\":[\"FACTURAFLOW\",\"PREVENWORK\"],\"permissions\":[\"FACTURAFLOW_VIEW\",\"PREVENWORK_VIEW\",\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isOk());
        String zoe = invite("sub-admin-a", "{\"name\":\"Zoe\",\"email\":\"zoe@a.test\",\"role\":\"USER\"}");
        user zoeStored = userRepository.findById(zoe).orElseThrow();
        assertEquals(SIX, zoeStored.getModuleAccess(), "all six modules, even outside the inviter's own");
        assertEquals(List.of("FACTURAFLOW_VIEW", "PREVENWORK_VIEW"), zoeStored.getModulePermissions(), "USER defaults within the inviter's scope");
        mvc.perform(json(put("/api/tenant/users/" + zoe + "/modules/JORNADAPULSE").with(as("sub-admin-a")),
                        "{\"permissions\":[\"JORNADAPULSE_VIEW\"]}"))
                .andExpect(status().isForbidden());
        // Removing a permission the caller does not hold is refused too: Uma's JORNADAPULSE_VIEW stays.
        mvc.perform(delete("/api/tenant/users/" + uma + "/modules/JORNADAPULSE").with(as("sub-admin-a"))).andExpect(status().isForbidden());
        assertTrue(userRepository.findById(uma).orElseThrow().getModulePermissions().contains("JORNADAPULSE_VIEW"));
        mvc.perform(json(put("/api/tenant/users/" + zoe + "/modules/PREVENWORK").with(as("sub-admin-a")),
                        "{\"permissions\":[\"PREVENWORK_VIEW\",\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isOk());

        // Tenant B never sees tenant A's assignments through /api/users/me or the user list.
        mvc.perform(get("/api/users/me").with(as("sub-admin-b"))).andExpect(jsonPath("$.tenantId").value(tenantB));
        mvc.perform(get("/api/tenant/users").with(as("sub-admin-b")))
                .andExpect(jsonPath("$.content[*].id", not(org.hamcrest.Matchers.hasItem(uma))));
    }

    @Test
    void theSuperAdminManagesAnAdministratorModuleByModule() throws Exception {
        String base = "/api/super-admin/admins/" + adminA + "/modules";
        mvc.perform(json(put(base + "/PREVENWORK").with(as(ROOT)), "{\"permissions\":[\"PREVENWORK_VIEW\",\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.modules[3].moduleId").value("PREVENWORK"))
                .andExpect(jsonPath("$.modules[3].permissions", contains("PREVENWORK_VIEW", "PREVENWORK_DELETE")));
        // Only that module changed.
        assertTrue(userRepository.findById(adminA).orElseThrow().getModulePermissions().contains("FACTURAFLOW_MANAGE"));
        mvc.perform(delete(base + "/SAFEVOICE").with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.modules[5].assigned").value(false));
        mvc.perform(get("/api/users/me").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.modules", hasSize(5)))
                .andExpect(jsonPath("$.modules", not(org.hamcrest.Matchers.hasItem("SAFEVOICE"))))
                .andExpect(jsonPath("$.modulePermissions", org.hamcrest.Matchers.hasItems("PREVENWORK_VIEW", "PREVENWORK_DELETE")));
        mvc.perform(json(put(base + "/BUZONDESK").with(as(ROOT)), "{\"permissions\":[\"SAFEVOICE_VIEW\"]}")).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/super-admin/admins/" + uma + "/modules/SAFEVOICE").with(as(ROOT))).andExpect(status().isNotFound());
    }

    // ==================== 10. existing records ====================

    @Test
    void theBackfillGivesDefaultsOnlyToAccountsThatNeverHadAnyAndRunsOnce() throws Exception {
        Date created = Date.from(Instant.now().minusSeconds(3600));
        // Never assigned: no module fields at all (written before module access existed).
        insertRaw("sub-old-admin", "old-admin@a.test", "TENANT_ADMIN", null, null, created, false);
        // Never assigned: the empty lists every save writes, no marker.
        insertRaw("sub-old-user", "old-user@a.test", "USER", List.of(), List.of(), created, false);
        // Customized before the marker existed: a narrow assignment.
        insertRaw("sub-custom", "custom@a.test", "USER", List.of("FACTURAFLOW"), List.of("FACTURAFLOW_VIEW"), created, false);
        // Deliberately emptied (recorded in the audit trail).
        String emptied = insertRaw("sub-emptied", "emptied@a.test", "USER", List.of(), List.of(), created, false);
        mongo.insert(AuditEvent.builder().action(AuditAction.USER_MODULE_ACCESS_CHANGED).occurredAt(Instant.now())
                .actorUserId("someone").tenantId(tenantA).targetType("USER").targetId(emptied).build());
        // Assigned with the marker: never touched, however narrow.
        insertRaw("sub-marked", "marked@a.test", "USER", List.of(), List.of(), created, true);
        // Never assigned, and the owner who registered their organization: every permission, as a newly
        // registered owner gets.
        Document oldTenant = new Document("tenantName", "Old org").append("subdomain", "old-org").append("status", "ACTIVE")
                .append("onboardedByCognitoSub", "sub-old-owner").append("createdAt", created);
        mongo.getCollection("tenants").insertOne(oldTenant);
        insertRaw(oldTenant.getObjectId("_id").toHexString(), "sub-old-owner", "old-owner@old.test", "ADMIN", null, null, created, false);
        List<String> umaBefore = userRepository.findById(uma).orElseThrow().getModulePermissions();

        // Off by default: the startup run does nothing.
        assertTrue(!properties.getModules().isBackfillDefaults());
        backfill.run(null);
        assertNull(userRepository.findByCognitoSub("sub-old-admin").orElseThrow().getModuleAccessAssignedAt());

        ModuleAccessBackfill.Result first = backfill.backfill();
        assertEquals(2, first.assignedAdmins());
        assertEquals(1, first.assignedUsers());
        user oldAdmin = userRepository.findByCognitoSub("sub-old-admin").orElseThrow();
        assertEquals(SIX, oldAdmin.getModuleAccess());
        assertEquals(ADMIN_DEFAULTS, oldAdmin.getModulePermissions());
        user oldOwner = userRepository.findByCognitoSub("sub-old-owner").orElseThrow();
        assertEquals(SIX, oldOwner.getModuleAccess());
        assertEquals(OWNER_PERMISSIONS, oldOwner.getModulePermissions());
        assertEquals(USER_DEFAULTS, userRepository.findByCognitoSub("sub-old-user").orElseThrow().getModulePermissions());
        assertEquals(List.of("FACTURAFLOW"), userRepository.findByCognitoSub("sub-custom").orElseThrow().getModuleAccess());
        assertTrue(userRepository.findByCognitoSub("sub-emptied").orElseThrow().getModuleAccess().isEmpty());
        assertTrue(userRepository.findByCognitoSub("sub-marked").orElseThrow().getModuleAccess().isEmpty());
        assertEquals(umaBefore, userRepository.findById(uma).orElseThrow().getModulePermissions());
        // The Super Admin keeps its platform-level account, with no module.
        assertTrue(userRepository.findByCognitoSub(ROOT).orElseThrow().getModuleAccess().isEmpty());
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.USER_MODULE_ACCESS_CHANGED)
                .and("targetId").is(oldAdmin.getId()).and("details.source").is("BACKFILL")), AuditEvent.class));

        // Idempotent.
        ModuleAccessBackfill.Result second = backfill.backfill();
        assertEquals(0, second.assignedAdmins() + second.assignedUsers());
        mvc.perform(get("/api/users/me").with(as("sub-old-user")))
                .andExpect(jsonPath("$.modules", hasSize(6)))
                .andExpect(jsonPath("$.modulePermissions", org.hamcrest.Matchers.hasItem("FACTURAFLOW_VIEW")));
    }

    private String insertRaw(String sub, String email, String role, List<String> modules, List<String> permissions, Date created,
            boolean marked) {
        return insertRaw(tenantA, sub, email, role, modules, permissions, created, marked);
    }

    private String insertRaw(String tenantId, String sub, String email, String role, List<String> modules, List<String> permissions,
            Date created, boolean marked) {
        Document doc = new Document("tenantId", tenantId).append("cognitoSub", sub).append("name", sub).append("email", email)
                .append("status", UserStatus.ACTIVE.name()).append("roles", List.of(role))
                .append("recordState", RecordState.ACTIVE.name()).append("createdAt", created);
        if (modules != null) {
            doc.append("moduleAccess", modules);
        }
        if (permissions != null) {
            doc.append("modulePermissions", permissions);
        }
        if (marked) {
            doc.append("moduleAccessAssignedAt", Date.from(Instant.now()));
        }
        mongo.getCollection("users").insertOne(doc);
        return doc.getObjectId("_id").toHexString();
    }

    @Test
    void theRolePolicyNeverGrantsEveryPermission() {
        Set<ModulePermission> admin = ModuleCatalog.defaultPermissionsFor(UserRole.ADMIN);
        Set<ModulePermission> user = ModuleCatalog.defaultPermissionsFor(UserRole.USER);
        assertTrue(admin.size() < ModulePermission.values().length);
        assertTrue(admin.stream().noneMatch(p -> p.action() == ModuleAction.DELETE));
        assertEquals(EnumSet.copyOf(ModuleCatalog.modules().stream()
                .map(m -> ModulePermission.valueOf(m.id().name() + "_VIEW")).toList()), user);
        assertEquals(user, ModuleCatalog.defaultPermissionsFor(UserRole.EMPLOYEE), "legacy role names follow their canonical role");
        assertEquals(admin, ModuleCatalog.defaultPermissionsFor(UserRole.TENANT_ADMIN));
        assertTrue(ModuleCatalog.defaultPermissionsFor(null).isEmpty());
        // Only the owner who registers the organization gets every permission.
        assertEquals(EnumSet.allOf(ModulePermission.class), ModuleCatalog.ownerPermissions());
        assertEquals(SIX, ModuleCatalog.defaultModulesFor(UserRole.USER).stream().map(Enum::name).toList());
        assertEquals(SIX, ModuleCatalog.defaultModulesFor(UserRole.ADMIN).stream().map(Enum::name).toList());
    }
}
