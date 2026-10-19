package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MvcResult;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.dto.onboarding.OnboardingStatusResponse;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.security.AuthCookies;

import jakarta.servlet.http.Cookie;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthenticationResultType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ChallengeNameType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.RespondToAuthChallengeRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.RespondToAuthChallengeResponse;

/**
 * End-to-end integration tests covering the required account workflows:
 * 1. Configured Super Admin -> PLATFORM, PLATFORM_ACCOUNT, requiresTenantSetup = false.
 * 2. Super Admin -> platform overview, never tenant onboarding, consistent login response.
 * 3. Tenant Admin with incomplete setup -> onboarding.
 * 4. Tenant Admin with completed setup -> own organization overview.
 * 5. Invited User with a Cognito password-change challenge -> change-password flow.
 * 6. Invited User after password change -> own profile and authorized resources.
 * 7. An ordinary user cannot gain Super Admin privileges via untrusted data.
 * 8. Tenant isolation and authorization checks continue to work.
 */
class AccountWorkflowIntegrationTest extends IntegrationTestBase {

    private static final String CSRF = "X-Requested-With";

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @Autowired
    private NormaOneProperties properties;

    @BeforeEach
    void setupJwtDecoder() {
        when(jwtDecoder.decode(any())).thenAnswer(invocation -> {
            String tokenValue = invocation.getArgument(0);
            if ("sa-token".equals(tokenValue)) {
                return buildIdToken("sa-token", "a3042882-b061-702a-02a3-096dfe6df1a2", "khushijc2106@gmail.com", "SUPER_ADMIN");
            }
            if ("admin-complete-token".equals(tokenValue)) {
                return buildIdToken("admin-complete-token", "sub-admin-done", "admindone@test.org", "Admin Done");
            }
            if ("user-token".equals(tokenValue)) {
                return buildIdToken("user-token", "sub-invited-user", "invited@test.org", "Invited User");
            }
            if ("unonboarded-token".equals(tokenValue)) {
                return buildIdToken("unonboarded-token", "sub-unonboarded", "newowner@test.org", "New Owner");
            }
            throw new BadJwtException("Invalid token: " + tokenValue);
        });
    }

    @AfterEach
    void resetBootstrapProperties() {
        properties.getBootstrap().setSuperAdmin(new NormaOneProperties.SuperAdmin());
    }

    private static Jwt buildIdToken(String tokenValue, String sub, String email, String name) {
        return Jwt.withTokenValue(tokenValue)
                .header("alg", "RS256")
                .subject(sub)
                .claim("token_use", "id")
                .claim("email", email)
                .claim("name", name)
                .claim("email_verified", true)
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .build();
    }

    // ==================== 1. Configured Super Admin ====================

    @Test
    void test1_configuredSuperAdminHasPlatformAccountAndNoTenantSetupRequired() throws Exception {
        NormaOneProperties.SuperAdmin cfg = new NormaOneProperties.SuperAdmin();
        cfg.setEnabled(true);
        cfg.setCognitoSub("a3042882-b061-702a-02a3-096dfe6df1a2");
        cfg.setEmail("khushijc2106@gmail.com");
        cfg.setName("SUPER_ADMIN");
        cfg.setVerification(NormaOneProperties.Verification.TOKEN);
        properties.getBootstrap().setSuperAdmin(cfg);

        // Pre-existing document with stale/old sub
        user existing = userRepository.insert(user.builder()
                .cognitoSub("33541892-9081-7035-a8d9-c5b944d11f56")
                .name("Platform Administrator")
                .email("khushijc2106@gmail.com")
                .status(UserStatus.ACTIVE)
                .roles(Set.of(UserRole.SUPER_ADMIN))
                .build());

        mvc.perform(get("/api/users/me").with(asVerified("a3042882-b061-702a-02a3-096dfe6df1a2", "khushijc2106@gmail.com", "SUPER_ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountType").value("PLATFORM"))
                .andExpect(jsonPath("$.onboardingStatus").value("PLATFORM_ACCOUNT"))
                .andExpect(jsonPath("$.requiresTenantSetup").value(false))
                .andExpect(jsonPath("$.effectiveRole").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.cognitoSub").value("a3042882-b061-702a-02a3-096dfe6df1a2"))
                .andExpect(jsonPath("$.tenantId").doesNotExist());

        // Verifies no duplicate was created and the existing record was updated
        assertEquals(1, userRepository.count());
        user updated = userRepository.findById(existing.getId()).orElseThrow();
        assertEquals("a3042882-b061-702a-02a3-096dfe6df1a2", updated.getCognitoSub());
    }

    // ==================== 2. Super Admin Navigation and Isolation ====================

    @Test
    void test2_superAdminBypassesTenantOnboardingAndLoginDoesNotContradict() throws Exception {
        NormaOneProperties.SuperAdmin cfg = new NormaOneProperties.SuperAdmin();
        cfg.setEnabled(true);
        cfg.setCognitoSub("a3042882-b061-702a-02a3-096dfe6df1a2");
        cfg.setEmail("khushijc2106@gmail.com");
        cfg.setName("SUPER_ADMIN");
        cfg.setVerification(NormaOneProperties.Verification.TOKEN);
        properties.getBootstrap().setSuperAdmin(cfg);

        when(cognito.initiateAuth(any(InitiateAuthRequest.class))).thenReturn(InitiateAuthResponse.builder()
                .authenticationResult(AuthenticationResultType.builder()
                        .idToken("sa-token").accessToken("sa-access").refreshToken("sa-refresh").expiresIn(3600).build())
                .build());

        // 1. Login returns requiresTenantSetup: false
        mvc.perform(post("/api/auth/login")
                        .header(CSRF, "NormaOne")
                        .header("X-Token-Delivery", "body")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"khushijc2106@gmail.com\",\"password\":\"StrongPass123!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(false));

        // 2. GET /api/users/me also returns requiresTenantSetup: false (no contradiction)
        mvc.perform(get("/api/users/me").with(asVerified("a3042882-b061-702a-02a3-096dfe6df1a2", "khushijc2106@gmail.com", "SUPER_ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(false))
                .andExpect(jsonPath("$.accountType").value("PLATFORM"))
                .andExpect(jsonPath("$.onboardingStatus").value("PLATFORM_ACCOUNT"));

        // 3. Super Admin dashboard is accessible
        mvc.perform(get("/api/super-admin/dashboard").with(as("a3042882-b061-702a-02a3-096dfe6df1a2")))
                .andExpect(status().isOk());

        // 4. Tenant onboarding endpoint is forbidden for platform accounts
        mvc.perform(post("/api/onboarding/tenant")
                        .with(asVerified("a3042882-b061-702a-02a3-096dfe6df1a2", "khushijc2106@gmail.com", "SUPER_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(onboardingBody("Platform Org", "platformorg")))
                .andExpect(status().isForbidden());
    }

    // ==================== 3. Tenant Admin Incomplete Setup ====================

    @Test
    void test3_tenantAdminWithIncompleteSetupRequiresOnboarding() throws Exception {
        when(cognito.initiateAuth(any(InitiateAuthRequest.class))).thenReturn(InitiateAuthResponse.builder()
                .authenticationResult(AuthenticationResultType.builder()
                        .idToken("unonboarded-token").accessToken("acc").refreshToken("ref").expiresIn(3600).build())
                .build());

        // Login response indicates tenant setup required
        mvc.perform(post("/api/auth/login")
                        .header(CSRF, "NormaOne")
                        .header("X-Token-Delivery", "body")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"newowner@test.org\",\"password\":\"Pass123!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(true));

        // /api/users/me returns NOT_STARTED and requiresTenantSetup: true
        mvc.perform(get("/api/users/me").with(asVerified("sub-unonboarded", "newowner@test.org", "New Owner")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(true))
                .andExpect(jsonPath("$.onboardingStatus").value(OnboardingStatusResponse.NOT_STARTED))
                .andExpect(jsonPath("$.accountType").value("NONE"));

        // Tenant protected endpoints are inaccessible
        mvc.perform(get("/api/tenant").with(as("sub-unonboarded"))).andExpect(status().isForbidden());
    }

    // ==================== 4. Tenant Admin Completed Setup ====================

    @Test
    void test4_tenantAdminWithCompletedSetupLandsOnOwnOrganizationOverview() throws Exception {
        // Complete tenant onboarding
        String tenantId = onboard("sub-admin-done", "admindone@test.org", "donetenant");

        when(cognito.initiateAuth(any(InitiateAuthRequest.class))).thenReturn(InitiateAuthResponse.builder()
                .authenticationResult(AuthenticationResultType.builder()
                        .idToken("admin-complete-token").accessToken("acc").refreshToken("ref").expiresIn(3600).build())
                .build());

        // Login response indicates no tenant setup required
        mvc.perform(post("/api/auth/login")
                        .header(CSRF, "NormaOne")
                        .header("X-Token-Delivery", "body")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"admindone@test.org\",\"password\":\"Pass123!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(false));

        // /api/users/me has COMPLETED onboarding and ADMIN role
        mvc.perform(get("/api/users/me").with(asVerified("sub-admin-done", "admindone@test.org", "Admin Done")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(false))
                .andExpect(jsonPath("$.onboardingStatus").value(OnboardingStatusResponse.COMPLETED))
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"))
                .andExpect(jsonPath("$.tenantId").value(tenantId));

        // Can access own organization and tenant overview
        mvc.perform(get("/api/tenant").with(as("sub-admin-done"))).andExpect(status().isOk());
    }

    // ==================== 5. Invited User Password Change Challenge ====================

    @Test
    void test5_invitedUserWithCognitoChallengeMustCompletePasswordChange() throws Exception {
        String tenantId = onboard("sub-owner", "owner@test.org", "invitest");

        // Admin invites user
        mvc.perform(post("/api/tenant/users")
                        .with(as("sub-owner"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Invited User\",\"email\":\"invited@test.org\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated());

        when(cognito.initiateAuth(any(InitiateAuthRequest.class))).thenReturn(InitiateAuthResponse.builder()
                .challengeName(ChallengeNameType.NEW_PASSWORD_REQUIRED)
                .session("challenge-session-token")
                .build());

        // Login with temporary password returns NEW_PASSWORD_REQUIRED and no session
        MvcResult loginResult = mvc.perform(post("/api/auth/login")
                        .header(CSRF, "NormaOne")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"invited@test.org\",\"password\":\"TempPass123!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.challenge").value("NEW_PASSWORD_REQUIRED"))
                .andExpect(jsonPath("$.tokenType").doesNotExist())
                .andReturn();

        List<String> cookies = loginResult.getResponse().getHeaders(HttpHeaders.SET_COOKIE);
        assertTrue(cookies.stream().anyMatch(c -> c.startsWith(AuthCookies.CHALLENGE_COOKIE + "=")));

        // Protected endpoints remain blocked while in challenge state
        mvc.perform(get("/api/users/me").cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, "challenge-session-token")))
                .andExpect(status().isUnauthorized());

        // Password policy is public
        mvc.perform(get("/api/auth/password-policy")).andExpect(status().isOk());
    }

    // ==================== 6. Invited User After Password Change ====================

    @Test
    void test6_invitedUserAfterPasswordChangeAccessesOwnProfileAndResources() throws Exception {
        String tenantId = onboard("sub-owner2", "owner2@test.org", "invitest2");

        // Admin invites user
        mvc.perform(post("/api/tenant/users")
                        .with(as("sub-owner2"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Invited User\",\"email\":\"invited@test.org\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated());

        when(cognito.respondToAuthChallenge(any(RespondToAuthChallengeRequest.class))).thenReturn(RespondToAuthChallengeResponse.builder()
                .authenticationResult(AuthenticationResultType.builder()
                        .idToken("user-token").accessToken("user-acc").refreshToken("user-ref").expiresIn(3600).build())
                .build());

        // Completes password challenge
        mvc.perform(post("/api/auth/new-password")
                        .header(CSRF, "NormaOne")
                        .cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, "challenge-session-token"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"invited@test.org\",\"newPassword\":\"PermanentPass123!\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(false));

        // GET /api/users/me links invitation and provides USER role
        mvc.perform(get("/api/users/me").with(asVerified("sub-invited-user", "invited@test.org", "Invited User")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(false))
                .andExpect(jsonPath("$.effectiveRole").value("USER"))
                .andExpect(jsonPath("$.tenantId").value(tenantId));

        // Can access own organization details read-only
        mvc.perform(get("/api/organization").with(as("sub-invited-user"))).andExpect(status().isOk());

        // Forbidden from admin endpoints
        mvc.perform(get("/api/tenant").with(as("sub-invited-user"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/dashboard").with(as("sub-invited-user"))).andExpect(status().isForbidden());
    }

    // ==================== 7. Untrusted Role Privilege Escalation Prevention ====================

    @Test
    void test7_ordinaryUserCannotGainSuperAdminPrivilegesViaUntrustedData() throws Exception {
        // Ordinary user attempts to claim Super Admin by sending name "SUPER_ADMIN"
        mvc.perform(get("/api/users/me").with(asVerified("sub-attacker", "attacker@test.org", "SUPER_ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectiveRole").doesNotExist())
                .andExpect(jsonPath("$.accountType").value("NONE"));

        // Attacker attempts to onboard with injected SUPER_ADMIN role
        mvc.perform(post("/api/onboarding/tenant")
                        .with(asVerified("sub-attacker", "attacker@test.org", "SUPER_ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"organizationName\":\"Attacker Org\",\"subdomain\":\"attackorg\",\"countryCode\":\"ES\",\"roles\":[\"SUPER_ADMIN\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.userRoles[0]").value("ADMIN")); // Assigned normal ADMIN role, never SUPER_ADMIN

        // Attacker cannot access platform endpoints
        mvc.perform(get("/api/super-admin/dashboard").with(as("sub-attacker")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/super-admins").with(as("sub-attacker")))
                .andExpect(status().isForbidden());
    }

    // ==================== 8. Tenant Isolation and Authorization ====================

    @Test
    void test8_tenantIsolationAndAuthorizationChecksAreEnforced() throws Exception {
        String tenantA = onboard("sub-admin-a", "admin@a.test", "tenanta");
        String tenantB = onboard("sub-admin-b", "admin@b.test", "tenantb");

        // Admin A invites a user in Tenant A
        String body = mvc.perform(post("/api/tenant/users")
                        .with(as("sub-admin-a"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"User A\",\"email\":\"usera@a.test\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String userAId = json(body, "$.id");

        // Admin B CANNOT view User A (404 isolation)
        mvc.perform(get("/api/tenant/users/" + userAId).with(as("sub-admin-b")))
                .andExpect(status().isNotFound());

        // Admin B CANNOT modify User A status
        mvc.perform(patch("/api/tenant/users/" + userAId + "/status")
                        .with(as("sub-admin-b"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"SUSPENDED\",\"reason\":\"Attack\"}"))
                .andExpect(status().isNotFound());
    }
}
