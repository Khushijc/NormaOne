package com.NormaOne.backend.security;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.services.UserAdministration;

/** Pure rules: effective role resolution, assignable roles, status transitions, token audience. */
class AuthorizationRulesTest {

    private static final Tenant ACTIVE_TENANT = Tenant.builder().id("t1").status(TenantStatus.ACTIVE).build();

    private static user tenantUser(UserStatus status, UserRole... roles) {
        return user.builder().id("u1").tenantId("t1").cognitoSub("s1").status(status).roles(Set.of(roles)).build();
    }

    @Test
    void platformRoleCountsOnlyOnPlatformScopedRecord() {
        user platform = user.builder().id("sa").cognitoSub("x").status(UserStatus.ACTIVE).roles(Set.of(UserRole.SUPER_ADMIN)).build();
        assertEquals(UserRole.SUPER_ADMIN, CurrentUserResolver.effectiveRole(platform, null));

        // A SUPER_ADMIN role stored on a tenant user is not honoured as platform access.
        user tampered = tenantUser(UserStatus.ACTIVE, UserRole.SUPER_ADMIN);
        assertNull(CurrentUserResolver.effectiveRole(tampered, ACTIVE_TENANT));

        // Legacy PLATFORM_ADMIN maps to SUPER_ADMIN.
        user legacy = user.builder().id("pa").cognitoSub("y").status(UserStatus.ACTIVE).roles(Set.of(UserRole.PLATFORM_ADMIN)).build();
        assertEquals(UserRole.SUPER_ADMIN, CurrentUserResolver.effectiveRole(legacy, null));
    }

    @Test
    void tenantRolesNeedActiveUserAndActiveTenant() {
        assertEquals(UserRole.ADMIN, CurrentUserResolver.effectiveRole(tenantUser(UserStatus.ACTIVE, UserRole.ADMIN), ACTIVE_TENANT));
        assertEquals(UserRole.USER, CurrentUserResolver.effectiveRole(tenantUser(UserStatus.ACTIVE, UserRole.EMPLOYEE), ACTIVE_TENANT));
        assertNull(CurrentUserResolver.effectiveRole(tenantUser(UserStatus.DEACTIVATED, UserRole.ADMIN), ACTIVE_TENANT));
        assertNull(CurrentUserResolver.effectiveRole(tenantUser(UserStatus.INVITED, UserRole.USER), ACTIVE_TENANT));
        Tenant suspended = Tenant.builder().id("t1").status(TenantStatus.SUSPENDED).build();
        assertNull(CurrentUserResolver.effectiveRole(tenantUser(UserStatus.ACTIVE, UserRole.ADMIN), suspended));
        assertNull(CurrentUserResolver.effectiveRole(null, null));
    }

    @Test
    void superAdminIsNeverAssignableAndOnlyTenantRolesAre() {
        assertThrows(ForbiddenOperationException.class, () -> UserAdministration.assignableTenantRole(UserRole.SUPER_ADMIN));
        assertThrows(ForbiddenOperationException.class, () -> UserAdministration.assignableTenantRole(UserRole.PLATFORM_ADMIN));
        assertThrows(IllegalArgumentException.class, () -> UserAdministration.assignableTenantRole(UserRole.HR_MANAGER));
        assertEquals(UserRole.USER, UserAdministration.assignableTenantRole(null));
        assertEquals(UserRole.ADMIN, UserAdministration.assignableTenantRole(UserRole.ADMIN));
    }

    @Test
    void statusTransitionsAreValidated() {
        user active = tenantUser(UserStatus.ACTIVE, UserRole.USER);
        assertThrows(IllegalArgumentException.class, () -> UserAdministration.applyStatus(active, UserStatus.DEACTIVATED, " "));
        assertThrows(IllegalArgumentException.class, () -> UserAdministration.applyStatus(active, UserStatus.INVITED, "x"));
        assertThrows(ConflictException.class, () -> UserAdministration.applyStatus(active, UserStatus.ACTIVE, null));
        UserAdministration.applyStatus(active, UserStatus.DEACTIVATED, "Left the company");
        assertEquals(UserStatus.DEACTIVATED, active.getStatus());
        UserAdministration.applyStatus(active, UserStatus.ACTIVE, null);
        assertEquals(UserStatus.ACTIVE, active.getStatus());

        user invitation = user.builder().id("i1").tenantId("t1").status(UserStatus.INVITED).roles(Set.of(UserRole.USER)).build();
        assertThrows(ConflictException.class, () -> UserAdministration.applyStatus(invitation, UserStatus.SUSPENDED, "x"));
        UserAdministration.applyStatus(invitation, UserStatus.DEACTIVATED, "Revoked");
        UserAdministration.applyStatus(invitation, UserStatus.ACTIVE, null);
        // An unlinked invitation is restored to INVITED, never made ACTIVE without a Cognito identity.
        assertEquals(UserStatus.INVITED, invitation.getStatus());
    }

    @Test
    void tokensFromOtherAppClientsAreRejected() {
        CognitoTokenValidator validator = new CognitoTokenValidator("my-client");
        assertFalse(validator.validate(token("access", "client_id", "my-client")).hasErrors());
        assertTrue(validator.validate(token("access", "client_id", "other-client")).hasErrors());
        assertFalse(validator.validate(token("id", "aud", List.of("my-client"))).hasErrors());
        assertTrue(validator.validate(token("id", "aud", List.of("other-client"))).hasErrors());
        assertTrue(validator.validate(token("refresh", "client_id", "my-client")).hasErrors());
    }

    @Test
    void thereIsNoGeneralPermissionSystemOnlyRolesAndModulePermissions() {
        // The former general permissions (ORGANIZATION_VIEW, USERS_MANAGE, …) are gone, not merely unused.
        assertThrows(ClassNotFoundException.class, () -> Class.forName("com.NormaOne.backend.model.core.enums.AdminPermission"));
        assertTrue(Arrays.stream(user.class.getDeclaredFields()).noneMatch(f -> f.getName().equals("permissions")),
                "the user record keeps no general permission list");
        // Tenant administration is checked by role alone: no permission-taking overload remains.
        assertTrue(Arrays.stream(CurrentUserService.class.getMethods())
                .filter(m -> m.getName().equals("requireTenantAdmin"))
                .allMatch(m -> m.getParameterCount() == 1 && m.getParameterTypes()[0] == Jwt.class));
        assertTrue(Arrays.stream(CurrentUser.class.getMethods()).noneMatch(m -> m.getName().toLowerCase().contains("permission")));
        // A tenant ADMIN acts as ADMIN whatever an old document stored; a USER never does.
        assertEquals(UserRole.ADMIN, CurrentUserResolver.effectiveRole(tenantUser(UserStatus.ACTIVE, UserRole.ADMIN), ACTIVE_TENANT));
        assertTrue(new CurrentUser("s1", tenantUser(UserStatus.ACTIVE, UserRole.ADMIN), ACTIVE_TENANT, UserRole.ADMIN).isTenantAdmin());
        assertFalse(new CurrentUser("s1", tenantUser(UserStatus.ACTIVE, UserRole.USER), ACTIVE_TENANT, UserRole.USER).isTenantAdmin());
    }

    @Test
    void adminAndRegularUserScopesAreDisjoint() {
        user admin = tenantUser(UserStatus.ACTIVE, UserRole.ADMIN);
        user legacyAdmin = tenantUser(UserStatus.ACTIVE, UserRole.TENANT_ADMIN);
        user regular = tenantUser(UserStatus.ACTIVE, UserRole.EMPLOYEE);
        user both = tenantUser(UserStatus.ACTIVE, UserRole.ADMIN, UserRole.USER);
        user platform = user.builder().id("p").status(UserStatus.ACTIVE).roles(Set.of(UserRole.SUPER_ADMIN)).build();

        assertTrue(UserAdministration.isAdminAccount(admin) && !UserAdministration.isRegularUser(admin));
        assertTrue(UserAdministration.isAdminAccount(legacyAdmin));
        assertTrue(UserAdministration.isRegularUser(regular) && !UserAdministration.isAdminAccount(regular));
        // ADMIN outranks USER on one record: it is an administrator, never also a regular user.
        assertTrue(UserAdministration.isAdminAccount(both) && !UserAdministration.isRegularUser(both));
        assertFalse(UserAdministration.isAdminAccount(platform) || UserAdministration.isRegularUser(platform));
    }

    private static Jwt token(String use, String claim, Object value) {
        return Jwt.withTokenValue("t").header("alg", "RS256").subject("s").claim("token_use", use).claim(claim, value)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
    }
}
