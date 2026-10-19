package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.Date;
import java.util.List;

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

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.services.ModuleAccessService;

/**
 * Module access end to end: the static catalog over HTTP, the rule that neither a role nor a plan
 * grants a module by itself, server-side enforcement, assignment validation, and documents written
 * before module access existed (or with values it does not know).
 */
class ModuleAccessIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    @Autowired
    private ModuleAccessService moduleAccessService;

    @Autowired
    private NormaOneProperties properties;

    private String tenantA;
    private String adminA;
    private String uma;

    @BeforeEach
    void platform() throws Exception {
        superAdmin(ROOT);
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        uma = json(mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")),
                        "{\"name\":\"Uma\",\"email\":\"uma@a.test\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(get("/api/users/me").with(asVerified("sub-uma", "uma@a.test", "Uma"))).andExpect(jsonPath("$.effectiveRole").value("USER"));
    }

    private static MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static Jwt token(String sub) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(sub).claim("token_use", "access").build();
    }

    /** An ACTIVE plan with these modules, assigned to tenant A. */
    private void moveTenantAToPlanWith(String modulesJson) throws Exception {
        String plan = json(mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)),
                        "{\"planCode\":\"PRO\",\"name\":\"Pro\",\"billingCycle\":\"MONTHLY\",\"listPrice\":10,\"maxEmployees\":20,"
                                + "\"moduleApps\":" + modulesJson + "}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + plan + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)), "{\"planId\":\"" + plan + "\"}"))
                .andExpect(status().isOk());
    }

    // ==================== the catalog ====================

    @Test
    void theCatalogIsReadableByEveryActiveAccountAndNobodyElse() throws Exception {
        mvc.perform(get("/api/modules")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/modules").with(asVerified("sub-new", "new@x.test", "New"))).andExpect(status().isForbidden());
        for (String sub : new String[] {ROOT, "sub-admin-a", "sub-uma"}) {
            mvc.perform(get("/api/modules").with(as(sub))).andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(6)));
        }
        mvc.perform(get("/api/modules").with(as("sub-uma")))
                .andExpect(jsonPath("$[*].id", contains("FACTURAFLOW", "JORNADAPULSE", "DATOSPILOT", "PREVENWORK", "BUZONDESK", "SAFEVOICE")))
                .andExpect(jsonPath("$[0].name").value("FacturaFlow"))
                .andExpect(jsonPath("$[0].label").value("Facturación y Cumplimiento"))
                .andExpect(jsonPath("$[0].requirementsDocumented").value(true))
                .andExpect(jsonPath("$[0].permissions[0].id").value("FACTURAFLOW_VIEW"))
                .andExpect(jsonPath("$[0].permissions[0].module").value("FACTURAFLOW"))
                .andExpect(jsonPath("$[0].permissions[0].action").value("VIEW"))
                // The default policy comes from the backend: VIEW for both roles, DELETE for nobody.
                .andExpect(jsonPath("$[0].permissions[0].defaultFor", contains("ADMIN", "USER")))
                .andExpect(jsonPath("$[0].permissions[1].defaultFor", contains("ADMIN")))
                .andExpect(jsonPath("$[3].permissions[?(@.id=='PREVENWORK_DELETE')].defaultFor[*]", hasSize(0)))
                .andExpect(jsonPath("$[4].requirementsDocumented").value(false))
                .andExpect(jsonPath("$[4].permissions[*].id", contains("BUZONDESK_VIEW", "BUZONDESK_MANAGE")));
    }

    // ==================== availability without plan enforcement (the default for now) ====================

    @Test
    void onBasicEveryAssignedModuleIsAvailableWhilePlanEntitlementIsNotEnforced() throws Exception {
        assertFalse(properties.getModules().isEnforcePlanEntitlement(), "plan entitlement is off by default");
        // BASIC lists only the portal, yet every assigned module is available to the active account.
        mvc.perform(get("/api/users/me").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"))
                // Just the module ids the account can use now — all six.
                .andExpect(jsonPath("$.modules", contains("FACTURAFLOW", "JORNADAPULSE", "DATOSPILOT", "PREVENWORK", "BUZONDESK", "SAFEVOICE")))
                // The owner who registered the organization holds every module permission.
                .andExpect(jsonPath("$.modulePermissions", hasSize(ModulePermission.values().length)));
        mvc.perform(get("/api/users/me").with(as("sub-uma")))
                .andExpect(jsonPath("$.modules", hasSize(6)))
                .andExpect(jsonPath("$.modulePermissions", contains("FACTURAFLOW_VIEW", "JORNADAPULSE_VIEW", "DATOSPILOT_VIEW",
                        "PREVENWORK_VIEW", "BUZONDESK_VIEW", "SAFEVOICE_VIEW")));
        // The administrators' module route keeps the per-module detail; the plan is reported and blocks nothing.
        mvc.perform(get("/api/super-admin/admins/" + adminA + "/modules").with(as(ROOT)))
                .andExpect(jsonPath("$.modules[*].assigned", everyItem(is(true))))
                .andExpect(jsonPath("$.modules[*].entitled", everyItem(is(true))))
                .andExpect(jsonPath("$.modules[*].available", everyItem(is(true))))
                .andExpect(jsonPath("$.modules[*].inPlan", everyItem(is(false))))
                .andExpect(jsonPath("$.modules[0].effectivePermissions", hasSize(6)))
                .andExpect(jsonPath("$.planEnforced").value(false))
                .andExpect(jsonPath("$.planModules", hasSize(0)))
                .andExpect(jsonPath("$.entitledModules", hasSize(6)))
                .andExpect(jsonPath("$.effectiveModules", hasSize(6)));

        // Authorization uses the stored module permissions — and only those.
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.PREVENWORK_MANAGE));
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.SAFEVOICE_VIEW));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.SAFEVOICE_MANAGE));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.PREVENWORK_DELETE));
        // A revocation applies to the very next check.
        mvc.perform(delete("/api/tenant/users/" + uma + "/modules/SAFEVOICE").with(as("sub-admin-a"))).andExpect(status().isOk());
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.SAFEVOICE_VIEW));
        mvc.perform(get("/api/users/me").with(as("sub-uma"))).andExpect(jsonPath("$.modules", hasSize(5)));

        // Account status still applies: a suspended user, or a suspended organization, uses nothing.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + uma + "/status").with(as("sub-admin-a")),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Leave\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/users/me").with(as("sub-uma")))
                .andExpect(jsonPath("$.modules", hasSize(0)))
                .andExpect(jsonPath("$.modulePermissions", hasSize(0)));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.FACTURAFLOW_VIEW));
        mvc.perform(jsonBody(patch("/api/super-admin/tenants/" + tenantA + "/status").with(as(ROOT)),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Review\"}"))
                .andExpect(status().isOk());
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.FACTURAFLOW_VIEW));
        // A Super Admin has no tenant and no module.
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token(ROOT), ModulePermission.FACTURAFLOW_VIEW));
    }

    // ==================== plan enforcement, when switched back on ====================

    @Test
    void withPlanEnforcementOnAssignedModulesAreUsableOnlyWhenThePlanIncludesThem() throws Exception {
        properties.getModules().setEnforcePlanEntitlement(true);
        try {
            assignedModulesNeedThePlan();
        } finally {
            properties.getModules().setEnforcePlanEntitlement(false);
        }
    }

    private void assignedModulesNeedThePlan() throws Exception {
        // Onboarding assigned all six modules with every permission, but BASIC provides only the portal.
        mvc.perform(get("/api/users/me").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"))
                .andExpect(jsonPath("$.modules", hasSize(0)))
                .andExpect(jsonPath("$.modulePermissions", hasSize(0)));
        mvc.perform(get("/api/super-admin/admins/" + adminA + "/modules").with(as(ROOT)))
                .andExpect(jsonPath("$.planEnforced").value(true))
                .andExpect(jsonPath("$.modules[0].moduleId").value("FACTURAFLOW"))
                .andExpect(jsonPath("$.modules[0].assigned").value(true))
                .andExpect(jsonPath("$.modules[0].entitled").value(false))
                .andExpect(jsonPath("$.modules[0].available").value(false))
                .andExpect(jsonPath("$.modules[0].permissions", hasSize(6)))
                .andExpect(jsonPath("$.modules[0].effectivePermissions", hasSize(0)));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.FACTURAFLOW_VIEW));

        // Narrowed by the Super Admin to two modules; still nothing usable on BASIC.
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + adminA + "/modules").with(as(ROOT)),
                        "{\"modules\":[\"DATOSPILOT\",\"FACTURAFLOW\"],\"permissions\":[\"FACTURAFLOW_EXPORT\",\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedModules", contains("FACTURAFLOW", "DATOSPILOT")))
                .andExpect(jsonPath("$.assignedPermissions", contains("FACTURAFLOW_VIEW", "FACTURAFLOW_EXPORT")))
                .andExpect(jsonPath("$.entitledModules", hasSize(0)))
                .andExpect(jsonPath("$.effectiveModules", hasSize(0)))
                .andExpect(jsonPath("$.effectivePermissions", hasSize(0)));
        mvc.perform(get("/api/users/me").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.modules", hasSize(0)))
                .andExpect(jsonPath("$.modulePermissions", hasSize(0)));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.FACTURAFLOW_VIEW));
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.USER_MODULE_ACCESS_CHANGED).and("targetId").is(adminA)),
                AuditEvent.class));

        // The plan now includes FacturaFlow (not DatosPilot): exactly the assigned FacturaFlow permissions apply.
        moveTenantAToPlanWith("[\"NORMAONE\",\"FACTURAFLOW\",\"JORNADAPULSE\"]");
        mvc.perform(get("/api/super-admin/admins/" + adminA + "/modules").with(as(ROOT)))
                .andExpect(jsonPath("$.entitledModules", contains("FACTURAFLOW", "JORNADAPULSE")))
                .andExpect(jsonPath("$.effectiveModules", contains("FACTURAFLOW")))
                .andExpect(jsonPath("$.effectivePermissions", contains("FACTURAFLOW_VIEW", "FACTURAFLOW_EXPORT")));
        mvc.perform(get("/api/users/me").with(as("sub-admin-a")))
                // DatosPilot is assigned but not in the plan, so only FacturaFlow is listed.
                .andExpect(jsonPath("$.modules", contains("FACTURAFLOW")))
                .andExpect(jsonPath("$.modulePermissions", contains("FACTURAFLOW_VIEW", "FACTURAFLOW_EXPORT")));
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.FACTURAFLOW_VIEW));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.FACTURAFLOW_APPROVE));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.JORNADAPULSE_VIEW));
        // Uma was invited with the USER defaults: VIEW in every module, so VIEW in the two the plan has.
        mvc.perform(get("/api/users/me").with(as("sub-uma")))
                .andExpect(jsonPath("$.modules", contains("FACTURAFLOW", "JORNADAPULSE")))
                .andExpect(jsonPath("$.modulePermissions", contains("FACTURAFLOW_VIEW", "JORNADAPULSE_VIEW")));
        assertDoesNotThrow(() -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.JORNADAPULSE_VIEW));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-uma"), ModulePermission.JORNADAPULSE_CREATE));
        // A record that was never assigned modules gets nothing from the plan or its role alone.
        userRepository.insert(user.builder().tenantId(tenantA).cognitoSub("sub-unassigned").name("Unassigned")
                .email("unassigned@a.test").status(com.NormaOne.backend.model.core.enums.UserStatus.ACTIVE)
                .roles(java.util.Set.of(com.NormaOne.backend.model.core.enums.UserRole.ADMIN))
                .recordState(com.NormaOne.backend.model.core.enums.RecordState.ACTIVE).build());
        mvc.perform(get("/api/users/me").with(as("sub-unassigned")))
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"))
                .andExpect(jsonPath("$.modules", hasSize(0)));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-unassigned"), ModulePermission.JORNADAPULSE_VIEW));
        // A Super Admin belongs to no tenant and has no module access.
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token(ROOT), ModulePermission.FACTURAFLOW_VIEW));

        // A suspended organization uses nothing.
        mvc.perform(jsonBody(patch("/api/super-admin/tenants/" + tenantA + "/status").with(as(ROOT)),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Review\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/users/me").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.modules", hasSize(0)))
                .andExpect(jsonPath("$.modulePermissions", hasSize(0)));
        assertThrows(AccessDeniedException.class,
                () -> moduleAccessService.requireModulePermission(token("sub-admin-a"), ModulePermission.FACTURAFLOW_VIEW));
    }

    // ==================== assignment rules ====================

    @Test
    void assignmentsAreValidatedAndReachOnlyAdministrators() throws Exception {
        String path = "/api/super-admin/admins/" + adminA + "/modules";
        List<String> modulesBefore = userRepository.findById(adminA).orElseThrow().getModuleAccess();
        List<String> permissionsBefore = userRepository.findById(adminA).orElseThrow().getModulePermissions();
        mvc.perform(jsonBody(put(path).with(as(ROOT)), "{\"modules\":[\"NORMAONE\"],\"permissions\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("NORMAONE")));
        mvc.perform(jsonBody(put(path).with(as(ROOT)), "{\"modules\":[\"FACTURAFLOW\"],\"permissions\":[\"PREVENWORK_DELETE\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("PREVENWORK_DELETE")));
        mvc.perform(jsonBody(put(path).with(as(ROOT)), "{\"modules\":[\"PAYROLL\"],\"permissions\":[]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(jsonBody(put(path).with(as(ROOT)), "{\"modules\":[\"FACTURAFLOW\"],\"permissions\":[\"FACTURAFLOW_DELETE\"]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(jsonBody(put(path).with(as(ROOT)), "{\"modules\":[\"FACTURAFLOW\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.permissions").exists());
        // Only tenant administrators are reached here; regular users belong to their organization.
        mvc.perform(jsonBody(put("/api/super-admin/admins/" + uma + "/modules").with(as(ROOT)), "{\"modules\":[],\"permissions\":[]}"))
                .andExpect(status().isNotFound());
        // Nobody but a Super Admin assigns modules through this route.
        mvc.perform(jsonBody(put(path).with(as("sub-admin-a")), "{\"modules\":[\"FACTURAFLOW\"],\"permissions\":[\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isForbidden());
        mvc.perform(get(path).with(as("sub-uma"))).andExpect(status().isForbidden());
        // Every refusal left the stored assignment exactly as it was.
        user stored = userRepository.findById(adminA).orElseThrow();
        assertEquals(modulesBefore, stored.getModuleAccess());
        assertEquals(permissionsBefore, stored.getModulePermissions());
        assertEquals(6, stored.getModuleAccess().size());

        // Creating a Tenant Admin can assign modules explicitly, under the same rules.
        long before = userRepository.count();
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Jo\",\"email\":\"jo@a.test\","
                                + "\"moduleAccess\":[\"NORMAONE\"],\"modulePermissions\":[]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Jo\",\"email\":\"jo@a.test\",\"modulePermissions\":[\"JORNADAPULSE_VIEW\"]}"))
                .andExpect(status().isBadRequest());
        assertEquals(before, userRepository.count());
        String jo = json(mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Jo\",\"email\":\"jo@a.test\","
                                + "\"moduleAccess\":[\"JORNADAPULSE\"],\"modulePermissions\":[\"JORNADAPULSE_VIEW\",\"JORNADAPULSE_APPROVE\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.organization.id").value(tenantA))
                .andExpect(jsonPath("$.moduleAccess", contains("JORNADAPULSE")))
                .andExpect(jsonPath("$.modulePermissions", contains("JORNADAPULSE_VIEW", "JORNADAPULSE_APPROVE")))
                .andReturn().getResponse().getContentAsString(), "$.id");
        user created = userRepository.findById(jo).orElseThrow();
        assertEquals(tenantA, created.getTenantId());
        assertEquals(List.of("JORNADAPULSE"), created.getModuleAccess());
        // Without module fields, an invited administrator gets all six modules with the ADMIN defaults
        // (no DELETE — unlike the owner who registers an organization); an explicit empty assignment
        // means no module.
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Kim\",\"email\":\"kim@a.test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.moduleAccess", hasSize(6)))
                .andExpect(jsonPath("$.modulePermissions", hasSize(ModulePermission.values().length - 1)))
                .andExpect(jsonPath("$.permissions").doesNotExist());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Lia\",\"email\":\"lia@a.test\",\"moduleAccess\":[]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.moduleAccess", hasSize(0)));
    }

    // ==================== existing documents ====================

    @Test
    void documentsWithoutOrWithUnknownModuleValuesAreReadSafely() throws Exception {
        moveTenantAToPlanWith("[\"NORMAONE\",\"FACTURAFLOW\"]");
        Date created = Date.from(Instant.now().minusSeconds(60));
        // Written before module access existed: no module fields at all, and a legacy role name.
        mongo.getCollection("users").insertOne(new Document("tenantId", tenantA).append("cognitoSub", "sub-legacy")
                .append("name", "Legacy").append("email", "legacy@a.test").append("status", "ACTIVE")
                .append("roles", List.of("EMPLOYEE")).append("recordState", "ACTIVE").append("createdAt", created));
        // Written by something else: values this catalog does not know grant nothing.
        mongo.getCollection("users").insertOne(new Document("tenantId", tenantA).append("cognitoSub", "sub-foreign")
                .append("name", "Foreign").append("email", "foreign@a.test").append("status", "ACTIVE")
                .append("roles", List.of("USER")).append("recordState", "ACTIVE").append("createdAt", created)
                .append("moduleAccess", List.of("FACTURAFLOW", "PAYROLL", "NORMAONE"))
                .append("modulePermissions", List.of("FACTURAFLOW_VIEW", "PAYROLL_RUN", "USERS_MANAGE")));

        mvc.perform(get("/api/users/me").with(as("sub-legacy")))
                .andExpect(jsonPath("$.effectiveRole").value("USER"))
                .andExpect(jsonPath("$.modules", hasSize(0)));
        mvc.perform(get("/api/users/me").with(as("sub-foreign")))
                .andExpect(jsonPath("$.modules", contains("FACTURAFLOW")))
                .andExpect(jsonPath("$.modulePermissions", contains("FACTURAFLOW_VIEW")));
        String foreignId = userRepository.findByCognitoSub("sub-foreign").orElseThrow().getId();
        mvc.perform(get("/api/super-admin/users/" + foreignId).with(as(ROOT)))
                .andExpect(jsonPath("$.moduleAccess", contains("FACTURAFLOW")))
                .andExpect(jsonPath("$.modulePermissions", contains("FACTURAFLOW_VIEW")));
        // The stored values are left as they were: nothing is rewritten on read.
        Document raw = mongo.getCollection("users").find(new Document("cognitoSub", "sub-foreign")).first();
        assertEquals(List.of("FACTURAFLOW", "PAYROLL", "NORMAONE"), raw.getList("moduleAccess", String.class));
    }
}
