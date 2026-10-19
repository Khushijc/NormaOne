package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import static org.mockito.Mockito.when;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.oauth2.jwt.Jwt;

import com.NormaOne.backend.dto.user.UserProfileResponse;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.repositories.PlanDefinitionRepository;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;

import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private TenantRepository tenantRepository;

    @Mock
    private CognitoIdentityProviderClient cognitoClient;

    @Mock
    private AuditService auditService;

    @Mock
    private PackageService packageService;

    @Mock
    private PlanDefinitionRepository planRepository;

    private UserService userService;

    @BeforeEach
    void setUp() {
        CognitoIdentityLookup identityLookup = new CognitoIdentityLookup(cognitoClient, "eu-central-1_testPool");
        AccountLinkService accountLinkService = new AccountLinkService(userRepository, tenantRepository, identityLookup, auditService,
                // Bootstrap disabled (the default): it never touches the repository.
                new com.NormaOne.backend.bootstrap.SuperAdminBootstrap(new com.NormaOne.backend.config.NormaOneProperties(),
                        userRepository, identityLookup, auditService));
        // No subscription is stubbed (an empty Optional): no tenant here has module entitlements.
        userService = new UserService(accountLinkService, tenantRepository, identityLookup,
                new ModuleAccessService(packageService, planRepository, null, new com.NormaOne.backend.config.NormaOneProperties()));
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

    @Test
    void testGetCurrentUserWhenOnboarded() {
        String sub = "sub-12345";
        Jwt jwt = createMockJwt(sub, "ana@example.com", "Ana Garcia");

        user userDoc = user.builder()
                .id("user-001")
                .cognitoSub(sub)
                .name("Ana Garcia")
                .email("ana@example.com")
                .tenantId("tenant-001")
                .status(UserStatus.ACTIVE)
                .roles(Set.of(UserRole.ADMIN))
                .build();

        Tenant tenant = Tenant.builder()
                .id("tenant-001")
                .tenantName("Acme Global")
                .subdomain("acme")
                .status(TenantStatus.ACTIVE)
                .build();

        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.of(userDoc));
        when(tenantRepository.findById("tenant-001")).thenReturn(Optional.of(tenant));

        UserProfileResponse response = userService.getCurrentUser(jwt);

        assertNotNull(response);
        assertEquals("user-001", response.userId());
        assertEquals("sub-12345", response.cognitoSub());
        assertEquals("Ana Garcia", response.name());
        assertEquals("ana@example.com", response.email());
        assertEquals("tenant-001", response.tenantId());
        assertEquals("Acme Global", response.organizationName());
        assertEquals("acme", response.subdomain());
        assertFalse(response.requiresTenantSetup());
        assertTrue(response.roles().contains(UserRole.ADMIN));
        assertEquals("COMPLETED", response.onboardingStatus());
        assertEquals("TENANT", response.accountType());
        assertEquals(UserRole.ADMIN, response.effectiveRole());
        // The ADMIN role alone grants no application module.
        assertTrue(response.modules().isEmpty());
        assertTrue(response.modulePermissions().isEmpty());
    }

    @Test
    void testGetCurrentUserPreOnboarding() {
        String sub = "sub-fresh-user";
        Jwt jwt = createMockJwt(sub, "fresh@example.com", "Fresh User");

        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.empty());

        UserProfileResponse response = userService.getCurrentUser(jwt);

        assertNotNull(response);
        assertNull(response.userId());
        assertEquals("sub-fresh-user", response.cognitoSub());
        assertEquals("fresh@example.com", response.email());
        assertEquals("Fresh User", response.name());
        assertNull(response.tenantId());
        assertTrue(response.requiresTenantSetup());
        assertEquals("NOT_STARTED", response.onboardingStatus());
        assertNull(response.effectiveRole());
    }

    @Test
    void testInactiveUserHasNoEffectiveRole() {
        String sub = "sub-suspended";
        when(userRepository.findByCognitoSub(sub)).thenReturn(Optional.of(user.builder()
                .id("u-9").cognitoSub(sub).tenantId("tenant-001").status(UserStatus.SUSPENDED)
                .roles(Set.of(UserRole.ADMIN)).build()));
        when(tenantRepository.findById("tenant-001")).thenReturn(Optional.of(Tenant.builder()
                .id("tenant-001").subdomain("acme").status(TenantStatus.ACTIVE).build()));

        UserProfileResponse response = userService.getCurrentUser(createMockJwt(sub, "s@example.com", "S"));

        assertEquals(UserStatus.SUSPENDED, response.status());
        assertNull(response.effectiveRole());
    }

    @Test
    void testGetCurrentUserNullJwtThrowsException() {
        assertThrows(IllegalArgumentException.class, () -> userService.getCurrentUser(null));
    }
}
