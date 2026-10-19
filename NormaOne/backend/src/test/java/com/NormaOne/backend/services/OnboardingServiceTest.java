package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import org.mockito.Mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.oauth2.jwt.Jwt;

import com.NormaOne.backend.config.MongoTopology;
import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.dto.onboarding.TenantOnboardingRequest;
import com.NormaOne.backend.dto.onboarding.TenantOnboardingResponse;
import com.NormaOne.backend.exceptions.DuplicateSubdomainException;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.exceptions.UserAlreadyOnboardedException;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;

import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;

@ExtendWith(MockitoExtension.class)
class OnboardingServiceTest {

    @Mock
    private TenantRepository tenantRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private CognitoIdentityProviderClient cognitoClient;

    @Mock
    private PackageService packageService;

    @Mock
    private AuditService auditService;

    @Mock
    private MongoTopology topology;

    private OnboardingService onboardingService;

    @BeforeEach
    void setUp() {
        CognitoIdentityLookup identityLookup = new CognitoIdentityLookup(cognitoClient, "eu-central-1_testPool");
        AccountLinkService accountLinkService = new AccountLinkService(userRepository, tenantRepository, identityLookup, auditService,
                // Bootstrap disabled (the default): it never touches the repository.
                new com.NormaOne.backend.bootstrap.SuperAdminBootstrap(new com.NormaOne.backend.config.NormaOneProperties(),
                        userRepository, identityLookup, auditService));
        TenantProvisioningService provisioning = new TenantProvisioningService(
                tenantRepository, userRepository, packageService, topology, null);
        onboardingService = new OnboardingService(
                tenantRepository,
                userRepository,
                identityLookup,
                accountLinkService,
                provisioning,
                packageService,
                auditService,
                new NormaOneProperties()
        );
    }

    private Jwt createMockJwt(String sub, String email, String name) {
        return Jwt.withTokenValue("mock-token")
                .header("alg", "RS256")
                .subject(sub)
                .claim("email", email)
                .claim("name", name)
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .build();
    }

    private static TenantSubscription basicSubscription(String tenantId) {
        return TenantSubscription.builder()
                .id("sub-001")
                .tenantId(tenantId)
                .planDocsId("plan-basic")
                .planVersion(1)
                .planCode("BASIC")
                .status(SubscriptionStatus.ACTIVE)
                .assignmentSource(SubscriptionSource.ONBOARDING)
                .build();
    }

    private static TenantOnboardingRequest simpleRequest(String name, String subdomain) {
        return new TenantOnboardingRequest(name, subdomain, CountryCode.ES,
                null, null, null, null, null, null, null, null, null);
    }

    @Test
    void testSuccessfulOnboarding() {
        String sub = "user-cognito-sub-123";
        Jwt jwt = createMockJwt(sub, "ana@example.com", "Ana Garcia");

        TenantOnboardingRequest request = new TenantOnboardingRequest(
                "Acme Corp",
                "acme",
                CountryCode.ES,
                TenantLocale.ES_ES,
                TenantTimeZone.EUROPE_MADRID,
                "Ana Garcia",
                "admin@acme.com",
                "+34612345678",
                "Calle Mayor 10",
                "Madrid",
                "28001",
                null
        );

        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.empty());
        when(tenantRepository.findBySubdomain("acme")).thenReturn(Optional.empty());

        Tenant savedTenant = Tenant.builder()
                .id("tenant-id-001")
                .tenantName("Acme Corp")
                .subdomain("acme")
                .countryCode(CountryCode.ES)
                .defaultLocale(TenantLocale.ES_ES)
                .defaultTimeZone(TenantTimeZone.EUROPE_MADRID)
                .accountHolderName("Ana Garcia")
                .emailAddress("admin@acme.com")
                .status(TenantStatus.PROVISIONING)
                .build();
        when(tenantRepository.save(any(Tenant.class))).thenReturn(savedTenant);
        when(packageService.assignDefaultPackage("tenant-id-001", SubscriptionSource.ONBOARDING, sub))
                .thenReturn(basicSubscription("tenant-id-001"));

        user savedUser = user.builder()
                .id("user-id-001")
                .tenantId("tenant-id-001")
                .cognitoSub(sub)
                .name("Ana Garcia")
                .email("ana@example.com")
                .roles(Set.of(UserRole.ADMIN))
                .status(UserStatus.ACTIVE)
                .build();
        when(userRepository.save(any(user.class))).thenReturn(savedUser);

        TenantOnboardingResponse response = onboardingService.onboardTenant(request, jwt);

        assertNotNull(response);
        assertEquals("tenant-id-001", response.tenantId());
        assertEquals("Acme Corp", response.organizationName());
        assertEquals("acme", response.subdomain());
        assertEquals(TenantStatus.ACTIVE, response.status());
        assertEquals("user-id-001", response.userId());
        assertEquals("ana@example.com", response.userEmail());
        assertTrue(response.userRoles().contains(UserRole.ADMIN));
        assertEquals("BASIC", response.packageCode());
        assertEquals(SubscriptionStatus.ACTIVE, response.subscriptionStatus());

        verify(userRepository).save(any(user.class));
        verify(packageService).assignDefaultPackage("tenant-id-001", SubscriptionSource.ONBOARDING, sub);
        verify(auditService).recordAs(eq("user-id-001"), anyString(), eq(com.NormaOne.backend.model.audit.AuditAction.TENANT_ONBOARDED),
                eq("tenant-id-001"), eq("TENANT"), eq("tenant-id-001"), any());
    }

    @Test
    void testDuplicateSubdomainThrowsException() {
        String sub = "user-cognito-sub-123";
        Jwt jwt = createMockJwt(sub, "test@example.com", "Test User");

        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.empty());
        when(tenantRepository.findBySubdomain("acme")).thenReturn(Optional.of(Tenant.builder()
                .id("other-tenant").subdomain("acme").status(TenantStatus.ACTIVE).onboardedByCognitoSub("someone-else").build()));

        assertThrows(DuplicateSubdomainException.class, () ->
                onboardingService.onboardTenant(simpleRequest("Acme Corp", "acme"), jwt));

        verify(tenantRepository, never()).save(any());
        verify(userRepository, never()).save(any());
        verify(packageService, never()).assignDefaultPackage(any(), any(), any());
    }

    @Test
    void testAlreadyOnboardedUserDifferentSubdomainThrowsException() {
        String sub = "user-cognito-sub-123";
        Jwt jwt = createMockJwt(sub, "test@example.com", "Test User");

        user existingUser = user.builder()
                .id("existing-user-id")
                .tenantId("existing-tenant-id")
                .cognitoSub(sub)
                .build();
        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.of(existingUser));

        Tenant existingTenant = Tenant.builder()
                .id("existing-tenant-id")
                .tenantName("Existing Corp")
                .subdomain("existingcorp")
                .build();
        when(tenantRepository.findById("existing-tenant-id")).thenReturn(Optional.of(existingTenant));

        assertThrows(UserAlreadyOnboardedException.class, () ->
                onboardingService.onboardTenant(simpleRequest("New Corp", "newcorp"), jwt));

        verify(tenantRepository, never()).save(any());
    }

    @Test
    void testIdempotentRetryReturnsExistingTenant() {
        String sub = "user-cognito-sub-123";
        Jwt jwt = createMockJwt(sub, "ana@example.com", "Ana Garcia");

        TenantOnboardingRequest request = new TenantOnboardingRequest(
                "Acme Corp",
                "acme",
                CountryCode.ES,
                TenantLocale.ES_ES,
                TenantTimeZone.EUROPE_MADRID,
                "Ana Garcia",
                null,
                null,
                null,
                null,
                null,
                null
        );

        user existingUser = user.builder()
                .id("user-id-001")
                .tenantId("tenant-id-001")
                .name("Ana Garcia")
                .email("ana@example.com")
                .roles(Set.of(UserRole.ADMIN))
                .status(UserStatus.ACTIVE)
                .cognitoSub(sub)
                .build();
        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.of(existingUser));

        Tenant existingTenant = Tenant.builder()
                .id("tenant-id-001")
                .tenantName("Acme Corp")
                .subdomain("acme")
                .countryCode(CountryCode.ES)
                .defaultLocale(TenantLocale.ES_ES)
                .defaultTimeZone(TenantTimeZone.EUROPE_MADRID)
                .status(TenantStatus.ACTIVE)
                .build();
        when(tenantRepository.findById("tenant-id-001")).thenReturn(Optional.of(existingTenant));
        TenantSubscription existingSubscription = basicSubscription("tenant-id-001");
        when(packageService.currentSubscription("tenant-id-001")).thenReturn(Optional.of(existingSubscription));
        when(packageService.assignDefaultPackage("tenant-id-001", SubscriptionSource.ONBOARDING, "user-id-001"))
                .thenReturn(existingSubscription);

        TenantOnboardingResponse response = onboardingService.onboardTenant(request, jwt);

        assertNotNull(response);
        assertEquals("tenant-id-001", response.tenantId());
        assertEquals("acme", response.subdomain());
        assertEquals("BASIC", response.packageCode());
        verify(tenantRepository, never()).save(any());
        verify(userRepository, never()).save(any());
    }

    @Test
    void testRollbackTenantWhenUserSaveFails() {
        String sub = "user-cognito-sub-123";
        Jwt jwt = createMockJwt(sub, "ana@example.com", "Ana Garcia");

        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.empty());
        when(tenantRepository.findBySubdomain("acme")).thenReturn(Optional.empty());

        Tenant savedTenant = Tenant.builder()
                .id("tenant-id-rollback")
                .subdomain("acme")
                .build();
        when(tenantRepository.save(any(Tenant.class))).thenReturn(savedTenant);
        when(packageService.assignDefaultPackage("tenant-id-rollback", SubscriptionSource.ONBOARDING, sub))
                .thenReturn(basicSubscription("tenant-id-rollback"));

        when(userRepository.save(any(user.class))).thenThrow(new RuntimeException("MongoDB connection timeout"));

        assertThrows(RuntimeException.class, () ->
                onboardingService.onboardTenant(simpleRequest("Acme Corp", "acme"), jwt));

        verify(packageService).removeTenantPackageData("tenant-id-rollback");
        verify(tenantRepository).deleteById("tenant-id-rollback");
    }

    @Test
    void testRollbackWhenPackageAssignmentFails() {
        String sub = "user-cognito-sub-123";
        Jwt jwt = createMockJwt(sub, "ana@example.com", "Ana Garcia");

        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.empty());
        when(tenantRepository.findBySubdomain("acme")).thenReturn(Optional.empty());
        when(tenantRepository.save(any(Tenant.class))).thenReturn(Tenant.builder().id("tenant-x").subdomain("acme").build());
        when(packageService.assignDefaultPackage("tenant-x", SubscriptionSource.ONBOARDING, sub))
                .thenThrow(new com.NormaOne.backend.exceptions.PackageUnavailableException("BASIC not active"));

        assertThrows(com.NormaOne.backend.exceptions.PackageUnavailableException.class, () ->
                onboardingService.onboardTenant(simpleRequest("Acme Corp", "acme"), jwt));

        verify(userRepository, never()).save(any());
        verify(tenantRepository).deleteById("tenant-x");
    }

    @Test
    void testPlatformAdminCannotOnboard() {
        String sub = "super-admin-sub";
        Jwt jwt = createMockJwt(sub, "root@example.com", "Root");
        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.of(user.builder()
                .id("sa-1").cognitoSub(sub).roles(Set.of(UserRole.SUPER_ADMIN)).status(UserStatus.ACTIVE).build()));

        assertThrows(ForbiddenOperationException.class, () ->
                onboardingService.onboardTenant(simpleRequest("Root Org", "root"), jwt));
        verify(tenantRepository, never()).save(any());
    }

    @Test
    void testUnverifiedEmailCannotOnboard() {
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "RS256").subject("sub-unverified")
                .claim("email", "x@example.com").claim("email_verified", false)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();

        assertThrows(ForbiddenOperationException.class, () ->
                onboardingService.onboardTenant(simpleRequest("X Org", "xorg"), jwt));
        verify(tenantRepository, never()).save(any());
    }

    @Test
    void testAbandonedProvisioningOfSameUserIsRecovered() {
        String sub = "user-cognito-sub-123";
        Jwt jwt = createMockJwt(sub, "ana@example.com", "Ana Garcia");

        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.empty());
        Tenant abandoned = Tenant.builder().id("stale-tenant").subdomain("acme").status(TenantStatus.PROVISIONING)
                .onboardedByCognitoSub(sub).createdAt(Instant.now().minusSeconds(3600)).build();
        when(tenantRepository.findBySubdomain("acme")).thenReturn(Optional.of(abandoned));
        when(tenantRepository.save(any(Tenant.class))).thenReturn(Tenant.builder().id("tenant-new").subdomain("acme").build());
        when(packageService.assignDefaultPackage("tenant-new", SubscriptionSource.ONBOARDING, sub))
                .thenReturn(basicSubscription("tenant-new"));
        when(userRepository.save(any(user.class))).thenReturn(user.builder().id("u-new").tenantId("tenant-new")
                .cognitoSub(sub).roles(Set.of(UserRole.ADMIN)).status(UserStatus.ACTIVE).build());

        TenantOnboardingResponse response = onboardingService.onboardTenant(simpleRequest("Acme Corp", "acme"), jwt);

        assertEquals("tenant-new", response.tenantId());
        verify(userRepository).deleteByTenantId("stale-tenant");
        verify(packageService).removeTenantPackageData("stale-tenant");
        verify(tenantRepository).deleteById("stale-tenant");
    }
}
