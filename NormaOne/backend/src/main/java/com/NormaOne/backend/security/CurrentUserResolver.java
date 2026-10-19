package com.NormaOne.backend.security;

import java.util.Collection;
import java.util.List;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.services.AccountLinkService;

/**
 * Resolves the caller from the validated JWT {@code sub} and the persisted user record.
 *
 * Roles, status and tenant always come from the database: JWT claims such as
 * {@code cognito:groups} and anything in a request body are never used for authorization.
 */
@Component
public class CurrentUserResolver {

    public static final String ROLE_PREFIX = "ROLE_";

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final AccountLinkService accountLinkService;

    public CurrentUserResolver(
            UserRepository userRepository,
            TenantRepository tenantRepository,
            AccountLinkService accountLinkService) {
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.accountLinkService = accountLinkService;
    }

    public CurrentUser resolve(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new IllegalArgumentException("Invalid JWT: missing subject (sub) claim.");
        }
        String sub = jwt.getSubject();
        user record = userRepository.findByCognitoSub(sub).orElse(null);
        if (record == null) {
            record = accountLinkService.findOrLink(jwt).orElse(null);
        }
        Tenant tenant = null;
        if (record != null && record.getTenantId() != null && !record.getTenantId().isBlank()) {
            tenant = tenantRepository.findById(record.getTenantId()).orElse(null);
        }
        return new CurrentUser(sub, record, tenant, effectiveRole(record, tenant));
    }

    /** Spring Security authorities for the caller (ROLE_SUPER_ADMIN, ROLE_ADMIN or ROLE_USER). */
    public Collection<GrantedAuthority> authorities(CurrentUser current) {
        if (current.role() == null) {
            return List.of();
        }
        return List.of(new SimpleGrantedAuthority(ROLE_PREFIX + current.role().name()));
    }

    /**
     * The canonical role the user may act with, or null.
     *
     * A platform role counts only on a platform-scoped record (no tenantId): assigning a tenant id
     * never grants platform access, and a platform role stored on a tenant user is ignored.
     * Tenant roles require a tenant id whose tenant is ACTIVE.
     */
    public static UserRole effectiveRole(user record, Tenant tenant) {
        if (record == null || record.getStatus() != UserStatus.ACTIVE) {
            return null;
        }
        if (record.getRecordState() != null && record.getRecordState() != RecordState.ACTIVE) {
            return null;
        }
        if (record.getRoles() == null || record.getRoles().isEmpty()) {
            return null;
        }
        boolean platformScoped = record.getTenantId() == null || record.getTenantId().isBlank();
        if (platformScoped) {
            return record.getRoles().stream().anyMatch(UserRole::isPlatformRole) ? UserRole.SUPER_ADMIN : null;
        }
        if (tenant == null || tenant.getStatus() != TenantStatus.ACTIVE) {
            return null;
        }
        boolean admin = record.getRoles().stream().map(UserRole::canonical).anyMatch(r -> r == UserRole.ADMIN);
        if (admin) {
            return UserRole.ADMIN;
        }
        boolean member = record.getRoles().stream().map(UserRole::canonical).anyMatch(r -> r == UserRole.USER);
        return member ? UserRole.USER : null;
    }
}
