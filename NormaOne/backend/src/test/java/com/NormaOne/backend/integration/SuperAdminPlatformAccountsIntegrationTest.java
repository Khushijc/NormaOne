package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.bootstrap.SuperAdminBootstrap;
import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.services.UserAdministration;

import software.amazon.awssdk.awscore.exception.AwsErrorDetails;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.CognitoIdentityProviderException;

/**
 * Super Admins managing platform accounts: inviting other Super Admins (who link as platform accounts
 * and never see tenant onboarding), their lifecycle, the cross-tenant account directory — and that
 * no tenant account, public route or the bootstrap can be used to gain the role.
 *
 *   sub-root     SUPER_ADMIN (no tenant)
 *   alpha        sub-admin-a ADMIN · sub-uma USER (linked through an invitation)
 */
class SuperAdminPlatformAccountsIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    @Autowired
    private SuperAdminBootstrap bootstrap;

    @Autowired
    private NormaOneProperties properties;

    private String rootId;
    private String tenantA;
    private String adminA;
    private String uma;

    @BeforeEach
    void platform() throws Exception {
        rootId = superAdmin(ROOT).getId();
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        uma = json(mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")),
                        "{\"name\":\"Uma\",\"email\":\"uma@a.test\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(get("/api/users/me").with(asVerified("sub-uma", "uma@a.test", "Uma"))).andExpect(jsonPath("$.effectiveRole").value("USER"));
        clearInvocations(cognito);
    }

    private static MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private String inviteSuperAdmin(String asSub, String name, String email) throws Exception {
        return json(mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(asSub)),
                        "{\"name\":\"" + name + "\",\"email\":\"" + email + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
    }

    private long platformSuperAdmins() {
        return mongo.count(new Query(UserAdministration.superAdminScope()), user.class);
    }

    // ==================== creating a Super Admin ====================

    @Test
    void aSuperAdminInvitesAnotherWhoLinksAsAPlatformAccountAndNeverSeesOnboarding() throws Exception {
        // Role, tenant and permission fields in the body are ignored: the server decides all three.
        String body = mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)),
                        "{\"name\":\" Sara \",\"email\":\"Sara@Platform.test\",\"phoneNumber\":\"+34 600 000 009\","
                                + "\"tenantId\":\"" + tenantA + "\",\"role\":\"USER\",\"roles\":[\"ADMIN\"],\"permissions\":[\"USERS_VIEW\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.status").value("INVITED"))
                .andExpect(jsonPath("$.linked").value(false))
                .andExpect(jsonPath("$.name").value("Sara"))
                .andExpect(jsonPath("$.email").value("sara@platform.test"))
                .andExpect(jsonPath("$.invitation.delivery").value("TEMPORARY_PASSWORD"))
                .andExpect(jsonPath("$.cognitoSub").doesNotExist())
                .andExpect(jsonPath("$.tenantId").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        String saraId = json(body, "$.id");

        user stored = userRepository.findById(saraId).orElseThrow();
        assertNull(stored.getTenantId(), "a platform account has no tenant");
        assertEquals(Set.of(UserRole.SUPER_ADMIN), stored.getRoles());
        assertTrue(stored.getModuleAccess().isEmpty());
        assertNull(stored.getCognitoSub());
        verify(cognito).adminCreateUser(argThat((AdminCreateUserRequest r) -> "sara@platform.test".equals(r.username())));
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.USER_INVITED).and("targetId").is(saraId)
                .and("actorUserId").is(rootId).and("details.role").is("SUPER_ADMIN")), AuditEvent.class));

        // Her first sign-in links the invitation: a platform account, not an onboarding candidate.
        mvc.perform(get("/api/users/me").with(asVerified("sub-sara", "sara@platform.test", "Sara")))
                .andExpect(jsonPath("$.effectiveRole").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.accountType").value("PLATFORM"))
                .andExpect(jsonPath("$.onboardingStatus").value("PLATFORM_ACCOUNT"))
                .andExpect(jsonPath("$.requiresTenantSetup").value(false))
                .andExpect(jsonPath("$.tenantId").doesNotExist())
                .andExpect(jsonPath("$.modules", hasSize(0)));
        mvc.perform(get("/api/onboarding/status").with(as("sub-sara")))
                .andExpect(jsonPath("$.onboardingStatus").value("PLATFORM_ACCOUNT"))
                .andExpect(jsonPath("$.requiresTenantSetup").value(false));
        mvc.perform(jsonBody(post("/api/onboarding/tenant").with(asVerified("sub-sara", "sara@platform.test", "Sara")),
                        onboardingBody("Sara Org", "saraorg")))
                .andExpect(status().isForbidden());
        user linked = userRepository.findById(saraId).orElseThrow();
        assertEquals(UserStatus.ACTIVE, linked.getStatus());
        assertEquals("sub-sara", linked.getCognitoSub());
        assertNull(linked.getTenantId());

        // She is a full Super Admin: platform routes, and creating a Tenant Admin for a named tenant.
        mvc.perform(get("/api/super-admin/dashboard").with(as("sub-sara"))).andExpect(status().isOk());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as("sub-sara")),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Nora\",\"email\":\"nora@a.test\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.organization.id").value(tenantA));

        mvc.perform(get("/api/super-admin/super-admins").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].email", containsInAnyOrder("sara@platform.test", ROOT + "@platform.example")))
                .andExpect(jsonPath("$.content[*].cognitoSub").isEmpty());
        mvc.perform(get("/api/super-admin/super-admins/" + saraId).with(as(ROOT)))
                .andExpect(jsonPath("$.linked").value(true))
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        // A Tenant Admin's id is not a Super Admin.
        mvc.perform(get("/api/super-admin/super-admins/" + adminA).with(as(ROOT))).andExpect(status().isNotFound());
    }

    @Test
    void refusesDuplicatesAndOrganizationAccountsWithoutWritingAnything() throws Exception {
        userRepository.insert(user.builder().tenantId(tenantA).cognitoSub("sub-gone").name("Gone").email("gone@a.test")
                .status(UserStatus.DEACTIVATED).roles(Set.of(UserRole.USER)).recordState(RecordState.ACTIVE)
                .activatedAt(Instant.now()).build());
        long before = userRepository.count();

        for (String email : new String[] {"admin@a.test", "UMA@a.test", ROOT + "@platform.example", "gone@a.test"}) {
            mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)), "{\"name\":\"X\",\"email\":\"" + email + "\"}"))
                    .andExpect(status().isConflict());
        }
        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)), "{\"name\":\"X\",\"email\":\"not-an-email\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.email").exists());
        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)), "{\"email\":\"x@platform.test\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.name").exists());

        assertEquals(before, userRepository.count());
        verify(cognito, never()).adminCreateUser(any(AdminCreateUserRequest.class));

        // A deactivated platform account is reactivated, never duplicated.
        String sara = inviteSuperAdmin(ROOT, "Sara", "sara@platform.test");
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + sara + "/status").with(as(ROOT)),
                        "{\"status\":\"DEACTIVATED\",\"reason\":\"Created by mistake\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)), "{\"name\":\"Sara\",\"email\":\"sara@platform.test\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("Reactivate")));
    }

    @Test
    void aCognitoFailureLeavesNoSuperAdminBehind() throws Exception {
        when(cognito.adminCreateUser(any(AdminCreateUserRequest.class))).thenThrow((CognitoIdentityProviderException)
                CognitoIdentityProviderException.builder().statusCode(400)
                        .awsErrorDetails(AwsErrorDetails.builder().errorCode("AccessDeniedException").errorMessage("not allowed").build())
                        .build());
        long before = platformSuperAdmins();

        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(ROOT)), "{\"name\":\"Sara\",\"email\":\"sara@platform.test\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.message", containsString("Nothing was saved")))
                .andExpect(jsonPath("$.message", is(org.hamcrest.Matchers.not(containsString("not allowed")))));

        assertEquals(before, platformSuperAdmins());
        assertTrue(userRepository.findByEmail("sara@platform.test").isEmpty());
        // Retrying once Cognito works again succeeds: nothing was left half-created.
        when(cognito.adminCreateUser(any(AdminCreateUserRequest.class))).thenReturn(null);
        inviteSuperAdmin(ROOT, "Sara", "sara@platform.test");
    }

    // ==================== who may do it ====================

    @Test
    void onlyAnActiveSuperAdminCanCreateOrSeePlatformAccounts() throws Exception {
        userRepository.insert(user.builder().cognitoSub("sub-suspended-root").name("Old").email("old@platform.example")
                .status(UserStatus.SUSPENDED).roles(Set.of(UserRole.SUPER_ADMIN)).recordState(RecordState.ACTIVE).build());
        long before = platformSuperAdmins();
        String create = "{\"name\":\"Eve\",\"email\":\"eve@evil.test\"}";

        for (String sub : new String[] {"sub-admin-a", "sub-uma", "sub-suspended-root"}) {
            mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as(sub)), create)).andExpect(status().isForbidden());
            mvc.perform(get("/api/super-admin/super-admins").with(as(sub))).andExpect(status().isForbidden());
            mvc.perform(get("/api/super-admin/accounts").with(as(sub))).andExpect(status().isForbidden());
        }
        // Signed in to Cognito but not onboarded: no role at all.
        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(asVerified("sub-new", "new@x.test", "New")), create))
                .andExpect(status().isForbidden());
        // Anonymous.
        mvc.perform(jsonBody(post("/api/super-admin/super-admins"), create)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/super-admin/accounts")).andExpect(status().isUnauthorized());

        assertEquals(before, platformSuperAdmins());
        verify(cognito, never()).adminCreateUser(any(AdminCreateUserRequest.class));
    }

    @Test
    void tenantAccountsCannotEscalateToSuperAdmin() throws Exception {
        long before = platformSuperAdmins();

        // Tenant APIs refuse the platform role, under either name.
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")),
                        "{\"name\":\"X\",\"email\":\"x@a.test\",\"role\":\"SUPER_ADMIN\"}"))
                .andExpect(status().isForbidden());
        for (String role : new String[] {"SUPER_ADMIN", "PLATFORM_ADMIN"}) {
            mvc.perform(jsonBody(patch("/api/tenant/users/" + uma).with(as("sub-admin-a")), "{\"role\":\"" + role + "\"}"))
                    .andExpect(status().isForbidden());
        }
        assertEquals(Set.of(UserRole.USER), userRepository.findById(uma).orElseThrow().getRoles());

        // A Super Admin creating a Tenant Admin cannot smuggle a role in either.
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantA + "\",\"name\":\"N\",\"email\":\"n@a.test\",\"roles\":[\"SUPER_ADMIN\"],\"role\":\"SUPER_ADMIN\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("ADMIN"));

        // A platform role written straight onto a tenant record grants nothing and is not listed.
        userRepository.insert(user.builder().tenantId(tenantA).cognitoSub("sub-sneaky").name("Sneaky").email("sneaky@a.test")
                .status(UserStatus.ACTIVE).roles(Set.of(UserRole.SUPER_ADMIN)).recordState(RecordState.ACTIVE).build());
        mvc.perform(get("/api/super-admin/dashboard").with(as("sub-sneaky"))).andExpect(status().isForbidden());
        mvc.perform(jsonBody(post("/api/super-admin/super-admins").with(as("sub-sneaky")), "{\"name\":\"E\",\"email\":\"e@x.test\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/super-admins").with(as(ROOT))).andExpect(jsonPath("$.totalElements").value(1));

        assertEquals(before, platformSuperAdmins());
    }

    @Test
    void theBootstrapStaysClosedOnceASuperAdminExists() throws Exception {
        inviteSuperAdmin(ROOT, "Sara", "sara@platform.test");
        NormaOneProperties.SuperAdmin cfg = new NormaOneProperties.SuperAdmin();
        cfg.setEnabled(true);
        cfg.setCognitoSub("sub-configured");
        cfg.setEmail("configured@platform.test");
        cfg.setVerification(NormaOneProperties.Verification.TOKEN);
        properties.getBootstrap().setSuperAdmin(cfg);
        try {
            assertEquals(SuperAdminBootstrap.Outcome.ANOTHER_SUPER_ADMIN_EXISTS, bootstrap.provision());
            Jwt token = Jwt.withTokenValue("t").header("alg", "none").subject("sub-configured").claim("token_use", "id")
                    .claim("email", "configured@platform.test").claim("email_verified", true).build();
            assertTrue(bootstrap.provisionFromToken(token).isEmpty());
            mvc.perform(get("/api/users/me").with(asVerified("sub-configured", "configured@platform.test", "Configured")))
                    .andExpect(jsonPath("$.accountType").value("NONE"))
                    .andExpect(jsonPath("$.effectiveRole").doesNotExist());
        } finally {
            properties.getBootstrap().setSuperAdmin(new NormaOneProperties.SuperAdmin());
        }
        assertEquals(2, platformSuperAdmins());
    }

    // ==================== lifecycle ====================

    @Test
    void superAdminLifecycleNeverLocksOutTheCaller() throws Exception {
        String sara = inviteSuperAdmin(ROOT, "Sara", "sara@platform.test");

        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + rootId + "/status").with(as(ROOT)),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Self\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/super-admin/super-admins/" + sara + "/resend-invitation").with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invitation").exists());

        // Revoking the invitation: she then signs in to nothing.
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + sara + "/status").with(as(ROOT)), "{\"status\":\"DEACTIVATED\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + sara + "/status").with(as(ROOT)),
                        "{\"status\":\"DEACTIVATED\",\"reason\":\"Not needed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DEACTIVATED"));
        mvc.perform(post("/api/super-admin/super-admins/" + sara + "/resend-invitation").with(as(ROOT))).andExpect(status().isConflict());
        mvc.perform(get("/api/users/me").with(asVerified("sub-sara", "sara@platform.test", "Sara")))
                .andExpect(jsonPath("$.effectiveRole").doesNotExist());
        assertNull(userRepository.findById(sara).orElseThrow().getCognitoSub());

        // Re-enabling restores the invitation, which then links.
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + sara + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}"))
                .andExpect(jsonPath("$.status").value("INVITED"));
        mvc.perform(get("/api/users/me").with(asVerified("sub-sara", "sara@platform.test", "Sara")))
                .andExpect(jsonPath("$.effectiveRole").value("SUPER_ADMIN"));

        // Suspending a linked Super Admin removes her access at once; she cannot change the caller either.
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + rootId + "/status").with(as("sub-sara")),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"Takeover\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/super-admin/dashboard").with(as(ROOT))).andExpect(status().isForbidden());
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + rootId + "/status").with(as("sub-sara")),
                        "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/super-admin/dashboard").with(as(ROOT))).andExpect(status().isOk());

        // The status route only reaches Super Admins.
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + adminA + "/status").with(as(ROOT)),
                        "{\"status\":\"SUSPENDED\",\"reason\":\"x\"}"))
                .andExpect(status().isNotFound());
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.USER_STATUS_CHANGED).and("targetId").is(rootId)
                .and("details.role").is("SUPER_ADMIN")), AuditEvent.class));
    }

    // ==================== the account directory ====================

    @Test
    void theAccountDirectoryFiltersAcrossTenantsByRoleTenantStatusAndModule() throws Exception {
        String tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantB + "\",\"name\":\"Mia\",\"email\":\"mia@b.test\","
                                + "\"moduleAccess\":[\"FACTURAFLOW\"],\"modulePermissions\":[\"FACTURAFLOW_VIEW\"]}"))
                .andExpect(status().isCreated());

        // root, admin-a, uma, admin-b, mia
        mvc.perform(get("/api/super-admin/accounts").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(5))
                .andExpect(jsonPath("$.content[*].cognitoSub").isEmpty())
                .andExpect(jsonPath("$.content[*].phoneNumber").isEmpty());
        mvc.perform(get("/api/super-admin/accounts?role=SUPER_ADMIN").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].role").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.content[0].organization").doesNotExist());
        mvc.perform(get("/api/super-admin/accounts?role=ADMIN").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.content[*].role", everyItem(is("ADMIN"))))
                .andExpect(jsonPath("$.content[*].adminPermissions").isEmpty())
                .andExpect(jsonPath("$.content[0].moduleAccess").isArray());
        // A legacy role name filters as its canonical role.
        mvc.perform(get("/api/super-admin/accounts?role=TENANT_ADMIN").with(as(ROOT))).andExpect(jsonPath("$.totalElements").value(3));
        mvc.perform(get("/api/super-admin/accounts?role=USER").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(uma))
                .andExpect(jsonPath("$.content[0].adminPermissions").doesNotExist());
        mvc.perform(get("/api/super-admin/accounts?tenantId=" + tenantA).with(as(ROOT))).andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(get("/api/super-admin/accounts?status=INVITED").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].email").value("mia@b.test"));
        // Every tenant account has FacturaFlow (all six by default; Mia was created with it alone), and
        // Mia is the only one without SafeVoice. The platform account has no module.
        mvc.perform(get("/api/super-admin/accounts?module=FACTURAFLOW").with(as(ROOT))).andExpect(jsonPath("$.totalElements").value(4));
        mvc.perform(get("/api/super-admin/accounts?module=SAFEVOICE").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.content[*].email", org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem("mia@b.test"))));
        mvc.perform(get("/api/super-admin/accounts?role=ADMIN&tenantId=" + tenantB + "&status=INVITED").with(as(ROOT)))
                .andExpect(jsonPath("$.content[0].moduleAccess", org.hamcrest.Matchers.contains("FACTURAFLOW")))
                .andExpect(jsonPath("$.content[0].modulePermissions", org.hamcrest.Matchers.contains("FACTURAFLOW_VIEW")));
        mvc.perform(get("/api/super-admin/accounts?search=UMA").with(as(ROOT))).andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/super-admin/accounts?role=ADMIN&tenantId=" + tenantB + "&page=0&size=1").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.content", hasSize(1)));

        // NORMAONE is the portal, not a module; unknown values are refused.
        mvc.perform(get("/api/super-admin/accounts?module=NORMAONE").with(as(ROOT))).andExpect(status().isBadRequest());
        mvc.perform(get("/api/super-admin/accounts?module=PAYROLL").with(as(ROOT))).andExpect(status().isBadRequest());
        mvc.perform(get("/api/super-admin/accounts?role=OWNER").with(as(ROOT))).andExpect(status().isBadRequest());
        mvc.perform(get("/api/super-admin/accounts?size=101").with(as(ROOT))).andExpect(status().isBadRequest());

        // The Tenant Admin's own user list is unchanged and still tenant-scoped.
        mvc.perform(get("/api/tenant/users").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].email", containsInAnyOrder("admin@a.test", "uma@a.test")));
    }
}
