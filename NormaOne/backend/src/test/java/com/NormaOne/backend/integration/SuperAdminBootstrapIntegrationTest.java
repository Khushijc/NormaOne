package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;

import com.NormaOne.backend.bootstrap.SuperAdminBootstrap;
import com.NormaOne.backend.bootstrap.SuperAdminBootstrap.Outcome;
import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;

import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserStatusType;

/**
 * The one way a Super Admin comes to exist: SuperAdminBootstrap, enabled by server configuration.
 *
 * Runs against the application's own bootstrap bean and properties, with the configuration changed
 * per test and put back afterwards. Cognito is the base class's mock: AdminGetUser answers nothing
 * unless a test says otherwise, which is the "cannot verify" case.
 */
class SuperAdminBootstrapIntegrationTest extends IntegrationTestBase {

    private static final String SUB = "sub-platform";
    private static final String EMAIL = "ops@normaone.test";

    @Autowired
    private SuperAdminBootstrap bootstrap;

    @Autowired
    private NormaOneProperties properties;

    private NormaOneProperties.SuperAdmin cfg;

    @BeforeEach
    void configure() {
        cfg = new NormaOneProperties.SuperAdmin();
        properties.getBootstrap().setSuperAdmin(cfg);
    }

    @AfterEach
    void restore() {
        properties.getBootstrap().setSuperAdmin(new NormaOneProperties.SuperAdmin());
    }

    private void enable(NormaOneProperties.Verification verification) {
        cfg.setEnabled(true);
        cfg.setCognitoSub(SUB);
        cfg.setEmail(EMAIL);
        cfg.setName("Ops");
        cfg.setVerification(verification);
    }

    private void cognitoSays(String sub, String email, boolean verified, UserStatusType status) {
        when(cognito.adminGetUser(any(AdminGetUserRequest.class))).thenReturn(AdminGetUserResponse.builder()
                .userStatus(status)
                .userAttributes(
                        AttributeType.builder().name("sub").value(sub).build(),
                        AttributeType.builder().name("email").value(email).build(),
                        AttributeType.builder().name("email_verified").value(String.valueOf(verified)).build())
                .build());
    }

    private long superAdmins() {
        return mongo.count(new Query(Criteria.where("roles").is(UserRole.SUPER_ADMIN)), user.class);
    }

    // ==================== successful bootstrap ====================

    @Test
    void cognitoVerifiedAccountBecomesThePlatformSuperAdmin() throws Exception {
        enable(NormaOneProperties.Verification.COGNITO);
        cognitoSays(SUB, "OPS@normaone.test", true, UserStatusType.CONFIRMED);

        assertEquals(Outcome.PROVISIONED, bootstrap.provision());

        user platform = userRepository.findByCognitoSub(SUB).orElseThrow();
        assertNull(platform.getTenantId());
        assertEquals(Set.of(UserRole.SUPER_ADMIN), platform.getRoles());
        assertEquals(UserStatus.ACTIVE, platform.getStatus());
        assertEquals(EMAIL, platform.getEmail());
        assertEquals("Ops", platform.getName());
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.SUPER_ADMIN_PROVISIONED)
                .and("targetId").is(platform.getId())), AuditEvent.class));

        // And the ordinary authentication flow now treats that account as SUPER_ADMIN.
        mvc.perform(get("/api/users/me").with(as(SUB)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectiveRole").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.accountType").value("PLATFORM"))
                .andExpect(jsonPath("$.tenantId").doesNotExist());
        mvc.perform(get("/api/super-admin/dashboard").with(as(SUB))).andExpect(status().isOk());
    }

    @Test
    void tokenModeProvisionsAtTheConfiguredAccountsFirstSignIn() throws Exception {
        enable(NormaOneProperties.Verification.TOKEN);

        // At startup it only waits: nothing is written, and no AWS call is needed.
        assertEquals(Outcome.AWAITING_SIGN_IN, bootstrap.provision());
        assertEquals(0, superAdmins());

        mvc.perform(get("/api/users/me").with(asIdToken(SUB, "Ops@NormaOne.test", true)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectiveRole").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.accountType").value("PLATFORM"));
        user platform = userRepository.findByCognitoSub(SUB).orElseThrow();
        assertNull(platform.getTenantId());
        assertEquals(Set.of(UserRole.SUPER_ADMIN), platform.getRoles());
        mvc.perform(get("/api/super-admin/admins").with(as(SUB))).andExpect(status().isOk());

        // The first request of any kind does it — so the account cannot onboard an organization first.
        mvc.perform(post("/api/onboarding/tenant").with(asIdToken(SUB, EMAIL, true))
                        .contentType(MediaType.APPLICATION_JSON).content(onboardingBody("Ops Org", "ops-org")))
                .andExpect(status().isForbidden());
        assertEquals(0, mongo.count(new Query(), com.NormaOne.backend.model.core.Tenant.class));
    }

    // ==================== identity mismatch ====================

    @Test
    void cognitoModeRefusesAnythingButAConfirmedMatchingVerifiedAccount() {
        enable(NormaOneProperties.Verification.COGNITO);

        // Cognito cannot confirm the account at all (not found, or AdminGetUser not permitted).
        assertEquals(Outcome.IDENTITY_NOT_VERIFIED, bootstrap.provision());

        record Case(String sub, String email, boolean verified, UserStatusType status) {}
        for (Case c : List.of(
                new Case(SUB, "someone-else@normaone.test", true, UserStatusType.CONFIRMED),   // other email
                new Case("sub-other", EMAIL, true, UserStatusType.CONFIRMED),                 // other sub
                new Case(SUB, EMAIL, false, UserStatusType.CONFIRMED),                        // email not verified
                new Case(SUB, EMAIL, true, UserStatusType.UNCONFIRMED))) {                    // sign-up not confirmed
            cognitoSays(c.sub(), c.email(), c.verified(), c.status());
            assertEquals(Outcome.IDENTITY_NOT_VERIFIED, bootstrap.provision(), c.toString());
        }
        assertEquals(0, superAdmins());
        assertTrue(userRepository.findByCognitoSub(SUB).isEmpty());
    }

    @Test
    void tokenModeRefusesTokensThatDoNotProveTheConfiguredIdentity() throws Exception {
        enable(NormaOneProperties.Verification.TOKEN);

        // An access token carries no email to prove, a mismatched email, an unverified email.
        mvc.perform(get("/api/users/me").with(as(SUB)))
                .andExpect(jsonPath("$.effectiveRole").doesNotExist());
        mvc.perform(get("/api/users/me").with(asIdToken(SUB, "someone-else@normaone.test", true)))
                .andExpect(jsonPath("$.effectiveRole").doesNotExist());
        mvc.perform(get("/api/users/me").with(asIdToken(SUB, EMAIL, false)))
                .andExpect(jsonPath("$.effectiveRole").doesNotExist());
        // The configured email presented by a DIFFERENT Cognito account does nothing either.
        mvc.perform(get("/api/users/me").with(asIdToken("sub-impostor", EMAIL, true)))
                .andExpect(jsonPath("$.onboardingStatus").value("NOT_STARTED"));

        assertEquals(0, superAdmins());
        mvc.perform(get("/api/super-admin/dashboard").with(as(SUB))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/dashboard").with(as("sub-impostor"))).andExpect(status().isForbidden());
    }

    @Test
    void misconfiguredOrDisabledBootstrapDoesNothing() {
        assertEquals(Outcome.DISABLED, bootstrap.provision());
        cfg.setEnabled(true);
        cfg.setCognitoSub(SUB);
        assertEquals(Outcome.MISCONFIGURED, bootstrap.provision());
        cfg.setCognitoSub("  ");
        cfg.setEmail(EMAIL);
        assertEquals(Outcome.MISCONFIGURED, bootstrap.provision());
        assertEquals(0, superAdmins());
    }

    // ==================== duplicate execution and replacement ====================

    @Test
    void runningAgainChangesNothingAndNeverReactivates() {
        enable(NormaOneProperties.Verification.COGNITO);
        cognitoSays(SUB, EMAIL, true, UserStatusType.CONFIRMED);
        assertEquals(Outcome.PROVISIONED, bootstrap.provision());
        String id = userRepository.findByCognitoSub(SUB).orElseThrow().getId();

        assertEquals(Outcome.ALREADY_PROVISIONED, bootstrap.provision());
        cfg.setVerification(NormaOneProperties.Verification.TOKEN);
        assertEquals(Outcome.ALREADY_PROVISIONED, bootstrap.provision());
        assertEquals(1, superAdmins());
        assertEquals(id, userRepository.findByCognitoSub(SUB).orElseThrow().getId());

        // A deactivated Super Admin stays deactivated: the bootstrap is not a way back in.
        user platform = userRepository.findById(id).orElseThrow();
        platform.setStatus(UserStatus.DEACTIVATED);
        userRepository.save(platform);
        cfg.setVerification(NormaOneProperties.Verification.COGNITO);
        assertEquals(Outcome.ALREADY_PROVISIONED, bootstrap.provision());
        assertEquals(UserStatus.DEACTIVATED, userRepository.findById(id).orElseThrow().getStatus());
    }

    @Test
    void aSecondSuperAdminNeedsExplicitPermission() {
        superAdmin("sub-existing-root");
        enable(NormaOneProperties.Verification.COGNITO);
        cognitoSays(SUB, EMAIL, true, UserStatusType.CONFIRMED);

        assertEquals(Outcome.ANOTHER_SUPER_ADMIN_EXISTS, bootstrap.provision());
        assertTrue(userRepository.findByCognitoSub(SUB).isEmpty());

        cfg.setAllowAdditional(true);
        assertEquals(Outcome.PROVISIONED, bootstrap.provision());
        assertEquals(2, superAdmins());
        // The existing one is untouched.
        assertEquals(Set.of(UserRole.SUPER_ADMIN), userRepository.findByCognitoSub("sub-existing-root").orElseThrow().getRoles());
    }

    // ==================== accounts that must not become Super Admin ====================

    @Test
    void aTenantAccountIsNeverPromoted() throws Exception {
        onboard(SUB, EMAIL, "tango");
        enable(NormaOneProperties.Verification.COGNITO);
        cognitoSays(SUB, EMAIL, true, UserStatusType.CONFIRMED);

        assertEquals(Outcome.TENANT_ACCOUNT, bootstrap.provision());

        // In TOKEN mode its sign-in does not promote it either.
        cfg.setVerification(NormaOneProperties.Verification.TOKEN);
        mvc.perform(get("/api/users/me").with(asIdToken(SUB, EMAIL, true)))
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"));
        user account = userRepository.findByCognitoSub(SUB).orElseThrow();
        assertEquals(Set.of(UserRole.ADMIN), account.getRoles());
        assertTrue(account.getTenantId() != null);
        mvc.perform(get("/api/super-admin/dashboard").with(as(SUB))).andExpect(status().isForbidden());
        assertEquals(0, superAdmins());
    }

    @Test
    void anEmailThatBelongsToAnOrganizationIsRefused() throws Exception {
        // Somebody else's account in an organization already uses the configured email.
        onboard("sub-tenant-owner", EMAIL, "tango");
        enable(NormaOneProperties.Verification.COGNITO);
        cognitoSays(SUB, EMAIL, true, UserStatusType.CONFIRMED);

        assertEquals(Outcome.EMAIL_IN_USE, bootstrap.provision());
        assertEquals(0, superAdmins());
    }

    // ==================== unauthorized access ====================

    @Test
    void noRequestCanInvokeTheBootstrapOrClaimTheRole() throws Exception {
        String tenantId = onboard("sub-admin", "admin@a.test", "alpha");
        enable(NormaOneProperties.Verification.TOKEN);

        // There is no bootstrap endpoint: authenticated callers find nothing, anonymous ones get 401.
        for (String path : List.of("/api/super-admin/bootstrap", "/api/bootstrap", "/api/admin/bootstrap")) {
            mvc.perform(post(path).with(as("sub-admin")).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"cognitoSub\":\"sub-admin\",\"role\":\"SUPER_ADMIN\"}"))
                    .andExpect(result -> assertTrue(result.getResponse().getStatus() == 403 || result.getResponse().getStatus() == 404,
                            path + " answered " + result.getResponse().getStatus()));
            mvc.perform(post(path)).andExpect(status().isUnauthorized());
        }

        // Signing in as some other account does nothing, whatever the token says.
        mvc.perform(get("/api/users/me").with(asIdToken("sub-admin", "admin@a.test", true)))
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"));
        mvc.perform(get("/api/super-admin/dashboard").with(as("sub-admin"))).andExpect(status().isForbidden());

        // The ordinary APIs that create accounts still cannot assign SUPER_ADMIN.
        mvc.perform(post("/api/tenant/users").with(as("sub-admin")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"X\",\"email\":\"x@a.test\",\"role\":\"SUPER_ADMIN\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/onboarding/tenant").with(asVerified("sub-new", "new@b.test", "New"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"organizationName\":\"B\",\"subdomain\":\"bravo\",\"countryCode\":\"ES\",\"roles\":[\"SUPER_ADMIN\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.userRoles[0]").value("ADMIN"));

        assertEquals(0, superAdmins());
        assertTrue(tenantId != null);
    }
}
