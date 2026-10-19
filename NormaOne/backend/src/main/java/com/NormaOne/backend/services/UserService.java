package com.NormaOne.backend.services;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.onboarding.OnboardingStatusResponse;
import com.NormaOne.backend.dto.user.UserProfileResponse;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.security.CurrentUserResolver;

/**
 * The caller's own profile ({@code GET /api/users/me}). Every authenticated user, whatever their
 * role, sees only their own record: the identity always comes from the validated JWT.
 */
@Service
public class UserService {

    private final AccountLinkService accountLinkService;
    private final TenantRepository tenantRepository;
    private final CognitoIdentityLookup identityLookup;
    private final ModuleAccessService moduleAccessService;

    public UserService(
            AccountLinkService accountLinkService,
            TenantRepository tenantRepository,
            CognitoIdentityLookup identityLookup,
            ModuleAccessService moduleAccessService) {
        this.accountLinkService = accountLinkService;
        this.tenantRepository = tenantRepository;
        this.identityLookup = identityLookup;
        this.moduleAccessService = moduleAccessService;
    }

    public UserProfileResponse getCurrentUser(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new IllegalArgumentException("Invalid JWT: missing subject (sub) claim.");
        }

        String cognitoSub = jwt.getSubject();
        Optional<user> userOpt = accountLinkService.findOrLink(jwt);

        if (userOpt.isPresent()) {
            user userDoc = userOpt.get();
            boolean platform = userDoc.getTenantId() == null || userDoc.getTenantId().isBlank();
            Tenant tenant = platform ? null : tenantRepository.findById(userDoc.getTenantId()).orElse(null);
            UserRole effectiveRole = CurrentUserResolver.effectiveRole(userDoc, tenant);
            String onboardingStatus = platform ? OnboardingStatusResponse.PLATFORM_ACCOUNT
                    : tenant == null ? OnboardingStatusResponse.NOT_STARTED
                    : tenant.getStatus() == TenantStatus.PROVISIONING ? OnboardingStatusResponse.IN_PROGRESS
                    : OnboardingStatusResponse.COMPLETED;
            ModuleAccessService.ModuleAccess modules = moduleAccessService.accessOf(userDoc, effectiveRole);

            return new UserProfileResponse(
                    userDoc.getId(),
                    cognitoSub,
                    userDoc.getName(),
                    userDoc.getEmail(),
                    userDoc.getPhoneNumber(),
                    userDoc.getStatus(),
                    userDoc.getRoles(),
                    userDoc.getTenantId(),
                    tenant != null ? tenant.getTenantName() : null,
                    tenant != null ? tenant.getSubdomain() : null,
                    !platform && tenant == null,
                    userDoc.getCreatedAt(),
                    onboardingStatus,
                    platform ? "PLATFORM" : "TENANT",
                    effectiveRole,
                    tenant != null ? tenant.getStatus() : null,
                    modules.effectiveModules(),
                    modules.effectivePermissions().stream().sorted().toList()
            );
        }

        // Authenticated in Cognito, but tenant onboarding is not completed yet.
        CognitoIdentityLookup.Identity identity = identityLookup.forJwt(jwt);
        return new UserProfileResponse(
                null,
                cognitoSub,
                identity.name(),
                identity.email(),
                null,
                null,
                Set.of(),
                null,
                null,
                null,
                true, // requiresTenantSetup: no user record exists in MongoDB yet
                null,
                OnboardingStatusResponse.NOT_STARTED,
                "NONE",
                null,
                null,
                List.of(),
                List.of()
        );
    }
}
