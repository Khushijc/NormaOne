package com.NormaOne.backend.services;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.dto.onboarding.OnboardingStatusResponse;
import com.NormaOne.backend.dto.onboarding.TenantOnboardingRequest;
import com.NormaOne.backend.dto.onboarding.TenantOnboardingResponse;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.DuplicateSubdomainException;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.exceptions.UserAlreadyOnboardedException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CurrentUserResolver;

/**
 * Self-service tenant onboarding: the authenticated (verified) Cognito user creates their
 * organization, becomes its ADMIN and the organization receives the default package.
 *
 * Identity comes only from the validated JWT. Onboarding is idempotent: a retry with the same
 * subdomain returns the existing organization (completing any unfinished step), a different
 * subdomain is rejected, and concurrent requests cannot create two tenants or two package
 * assignments for the same user (unique indexes on subdomain, cognitoSub and current subscription).
 */
@Service
public class OnboardingService {

    private static final Logger log = LoggerFactory.getLogger(OnboardingService.class);

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final CognitoIdentityLookup identityLookup;
    private final AccountLinkService accountLinkService;
    private final TenantProvisioningService provisioningService;
    private final PackageService packageService;
    private final AuditService auditService;
    private final NormaOneProperties properties;

    public OnboardingService(
            TenantRepository tenantRepository,
            UserRepository userRepository,
            CognitoIdentityLookup identityLookup,
            AccountLinkService accountLinkService,
            TenantProvisioningService provisioningService,
            PackageService packageService,
            AuditService auditService,
            NormaOneProperties properties) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.identityLookup = identityLookup;
        this.accountLinkService = accountLinkService;
        this.provisioningService = provisioningService;
        this.packageService = packageService;
        this.auditService = auditService;
        this.properties = properties;
    }

    public TenantOnboardingResponse onboardTenant(TenantOnboardingRequest request, Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new IllegalArgumentException("Invalid JWT security context: missing subject (sub) claim.");
        }
        if (jwt.hasClaim("email_verified") && !Boolean.parseBoolean(String.valueOf(jwt.getClaims().get("email_verified")))) {
            throw new ForbiddenOperationException("Verify your email address before creating an organization.");
        }

        String cognitoSub = jwt.getSubject();
        String normalizedSubdomain = request.subdomain().trim().toLowerCase(Locale.ROOT);

        // 1. Idempotency: the caller already has a user record (or a pending invitation that links now).
        Optional<user> existingUserOpt = accountLinkService.findOrLink(jwt);
        if (existingUserOpt.isPresent()) {
            return resumeOrReject(existingUserOpt.get(), normalizedSubdomain, cognitoSub);
        }

        // 2. Subdomain availability, recovering this user's own abandoned provisioning if any.
        Optional<Tenant> taken = tenantRepository.findBySubdomain(normalizedSubdomain);
        if (taken.isPresent()) {
            recoverOrReject(taken.get(), normalizedSubdomain, cognitoSub);
        }

        // 3. Identity attributes from the JWT (or Cognito) for names and contact email.
        CognitoIdentityLookup.Identity identity = identityLookup.forJwt(jwt);
        String accountHolderName = resolveAccountHolderName(request, identity);
        String contactEmail = resolveContactEmail(request, identity);
        String userName = identity.name() != null && !identity.name().isBlank() ? identity.name() : accountHolderName;
        String userEmail = identity.email() != null && !identity.email().isBlank() ? identity.email() : contactEmail;

        TenantProvisioningService.TenantDraft draft = new TenantProvisioningService.TenantDraft(
                request.organizationName().trim(), accountHolderName, normalizedSubdomain, request.countryCode(),
                request.defaultLocale(), request.defaultTimeZone(), contactEmail, request.phoneNumber(),
                request.addressLine(), request.city(), request.postalCode(), request.logoUrl(), cognitoSub);
        TenantProvisioningService.AdminSeed admin = new TenantProvisioningService.AdminSeed(
                userName, userEmail, request.phoneNumber(), cognitoSub);

        TenantProvisioningService.Provisioned provisioned;
        try {
            provisioned = provisioningService.provision(draft, admin, SubscriptionSource.ONBOARDING, cognitoSub);
        } catch (DuplicateSubdomainException | DuplicateKeyException race) {
            // A concurrent request by the same user may have completed onboarding first.
            Optional<user> now = userRepository.findByCognitoSub(cognitoSub);
            if (now.isPresent()) {
                return resumeOrReject(now.get(), normalizedSubdomain, cognitoSub);
            }
            throw race;
        }

        Tenant tenant = provisioned.tenant();
        user savedUser = provisioned.admin();
        auditService.recordAs(savedUser.getId(), "ADMIN", AuditAction.TENANT_ONBOARDED, tenant.getId(), "TENANT",
                tenant.getId(), AuditService.details("subdomain", tenant.getSubdomain()));
        auditPackage(savedUser.getId(), provisioned.subscription());
        log.info("Successfully onboarded tenant {} ({}) for user {} (cognitoSub: {})",
                tenant.getId(), tenant.getSubdomain(), savedUser.getId(), cognitoSub);
        return mapToResponse(tenant, savedUser, provisioned.subscription());
    }

    /** Current onboarding state of the caller (links a pending invitation first). */
    public OnboardingStatusResponse status(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new IllegalArgumentException("Invalid JWT: missing subject (sub) claim.");
        }
        Optional<user> record = accountLinkService.findOrLink(jwt);
        if (record.isEmpty()) {
            return new OnboardingStatusResponse(false, OnboardingStatusResponse.NOT_STARTED, true, "NONE",
                    null, null, null, null, null, null);
        }
        user u = record.get();
        if (u.getTenantId() == null || u.getTenantId().isBlank()) {
            return new OnboardingStatusResponse(true, OnboardingStatusResponse.PLATFORM_ACCOUNT, false, "PLATFORM",
                    u.getStatus(), roleName(u, null), null, null, null, null);
        }
        Tenant tenant = tenantRepository.findById(u.getTenantId()).orElse(null);
        String state = tenant == null ? OnboardingStatusResponse.NOT_STARTED
                : tenant.getStatus() == TenantStatus.PROVISIONING ? OnboardingStatusResponse.IN_PROGRESS
                : OnboardingStatusResponse.COMPLETED;
        TenantPackageResponse pkg = tenant != null ? packageService.describeIfAssigned(tenant.getId()).orElse(null) : null;
        return new OnboardingStatusResponse(
                OnboardingStatusResponse.COMPLETED.equals(state), state, tenant == null, "TENANT",
                u.getStatus(), roleName(u, tenant), u.getTenantId(), tenant != null ? tenant.getStatus() : null,
                pkg != null && pkg.plan() != null ? pkg.plan().planCode() : null, pkg != null ? pkg.status() : null);
    }

    private TenantOnboardingResponse resumeOrReject(user existingUser, String subdomain, String cognitoSub) {
        if (existingUser.getTenantId() == null || existingUser.getTenantId().isBlank()) {
            throw new ForbiddenOperationException(
                    "Platform administrator accounts do not belong to an organization and cannot onboard one.");
        }
        Tenant existingTenant = tenantRepository.findById(existingUser.getTenantId()).orElseThrow(() -> new ConflictException(
                "This account is linked to an organization that no longer exists. Contact support."));
        if (!existingTenant.getSubdomain().equalsIgnoreCase(subdomain)) {
            throw new UserAlreadyOnboardedException(
                    "User is already associated with organization '" + existingTenant.getTenantName()
                            + "' (subdomain: " + existingTenant.getSubdomain() + "). A user cannot create multiple organizations.");
        }
        log.info("Idempotent retry for cognitoSub {} on subdomain {}", cognitoSub, subdomain);
        if (existingUser.getStatus() != UserStatus.ACTIVE) {
            // Return the existing organization but change nothing for an inactive account.
            return mapToResponse(existingTenant, existingUser, packageService.currentSubscription(existingTenant.getId()).orElse(null));
        }
        // Complete any step a previous attempt did not finish (package assignment, activation).
        TenantSubscription subscription = null;
        if (existingTenant.getStatus() == TenantStatus.PROVISIONING || existingTenant.getStatus() == TenantStatus.ACTIVE) {
            boolean hadPackage = packageService.currentSubscription(existingTenant.getId()).isPresent();
            subscription = packageService.assignDefaultPackage(existingTenant.getId(), SubscriptionSource.ONBOARDING,
                    existingUser.getId());
            if (!hadPackage && subscription != null) {
                auditPackage(existingUser.getId(), subscription);
            }
        }
        if (existingTenant.getStatus() == TenantStatus.PROVISIONING) {
            existingTenant.setStatus(TenantStatus.ACTIVE);
            existingTenant.setActivatedAt(Instant.now());
            Tenant saved = tenantRepository.save(existingTenant);
            if (saved != null) {
                existingTenant = saved;
            }
        }
        return mapToResponse(existingTenant, existingUser, subscription);
    }

    private void recoverOrReject(Tenant tenant, String subdomain, String cognitoSub) {
        boolean ownAbandoned = tenant.getStatus() == TenantStatus.PROVISIONING
                && cognitoSub.equals(tenant.getOnboardedByCognitoSub());
        if (!ownAbandoned) {
            throw new DuplicateSubdomainException(
                    "Subdomain '" + subdomain + "' is already taken. Please choose a different subdomain.");
        }
        Instant created = tenant.getCreatedAt() != null ? tenant.getCreatedAt() : Instant.EPOCH;
        Duration age = Duration.between(created, Instant.now());
        if (age.getSeconds() < properties.getOnboarding().getStaleProvisioningSeconds()) {
            throw new ConflictException("Onboarding for this organization is already in progress. Retry in a moment.");
        }
        log.warn("Discarding abandoned PROVISIONING tenant {} ({}) before the owner's retry", tenant.getId(), subdomain);
        provisioningService.discardAbandoned(tenant);
    }

    private void auditPackage(String actorUserId, TenantSubscription subscription) {
        if (subscription == null) {
            return;
        }
        auditService.recordAs(actorUserId, "ADMIN", AuditAction.PACKAGE_ASSIGNED, subscription.getTenantId(),
                "SUBSCRIPTION", subscription.getId(),
                AuditService.details("planCode", subscription.getPlanCode(), "source", String.valueOf(subscription.getAssignmentSource())));
    }

    private static String roleName(user u, Tenant tenant) {
        var role = CurrentUserResolver.effectiveRole(u, tenant);
        return role != null ? role.name() : null;
    }

    private String resolveAccountHolderName(TenantOnboardingRequest request, CognitoIdentityLookup.Identity identity) {
        if (request.accountHolderName() != null && !request.accountHolderName().isBlank()) {
            return request.accountHolderName().trim();
        }
        if (identity.name() != null && !identity.name().isBlank()) {
            return identity.name().trim();
        }
        return request.organizationName().trim() + " Admin";
    }

    private String resolveContactEmail(TenantOnboardingRequest request, CognitoIdentityLookup.Identity identity) {
        if (request.emailAddress() != null && !request.emailAddress().isBlank()) {
            return request.emailAddress().trim().toLowerCase(Locale.ROOT);
        }
        if (identity.email() != null && !identity.email().isBlank()) {
            return identity.email().trim().toLowerCase(Locale.ROOT);
        }
        return "admin@" + request.subdomain().trim().toLowerCase(Locale.ROOT) + ".com";
    }

    private TenantOnboardingResponse mapToResponse(Tenant tenant, user userDoc, TenantSubscription subscription) {
        return new TenantOnboardingResponse(
                tenant.getId(),
                tenant.getTenantName(),
                tenant.getSubdomain(),
                tenant.getStatus(),
                tenant.getCountryCode(),
                tenant.getDefaultLocale(),
                tenant.getDefaultTimeZone(),
                tenant.getAccountHolderName(),
                tenant.getEmailAddress(),
                tenant.getPhoneNumber(),
                tenant.getAddressLine(),
                tenant.getCity(),
                tenant.getPostalCode(),
                tenant.getLogoUrl(),
                userDoc.getId(),
                userDoc.getName(),
                userDoc.getEmail(),
                userDoc.getRoles(),
                tenant.getCreatedAt() != null ? tenant.getCreatedAt() : Instant.now(),
                subscription != null ? subscription.getPlanCode() : null,
                subscription != null ? subscription.getId() : null,
                subscription != null ? subscription.getStatus() : null
        );
    }
}
