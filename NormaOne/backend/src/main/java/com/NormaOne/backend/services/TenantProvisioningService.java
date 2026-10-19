package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.MongoTransactionManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.NormaOne.backend.config.MongoTopology;
import com.NormaOne.backend.exceptions.DuplicateSubdomainException;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;

/**
 * Creates a tenant with its default package and first administrator.
 *
 * Sequence: tenant (PROVISIONING) -> default package assignment -> administrator user -> tenant ACTIVE.
 *
 * On a replica set or sharded cluster the sequence runs in one MongoDB transaction. On a
 * standalone server (no transactions) a failure triggers compensation: the administrator user,
 * the package assignment and its history, and the tenant are deleted. Compensation is
 * best-effort: if the process stops mid-way, a PROVISIONING tenant can remain; it is never
 * usable (users of a non-ACTIVE tenant get no role) and self-service onboarding recovers it on
 * the owner's retry (see OnboardingService).
 */
@Service
public class TenantProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(TenantProvisioningService.class);

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final PackageService packageService;
    private final MongoTopology topology;
    private final TransactionTemplate transactionTemplate;

    public TenantProvisioningService(
            TenantRepository tenantRepository,
            UserRepository userRepository,
            PackageService packageService,
            MongoTopology topology,
            MongoTransactionManager transactionManager) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.packageService = packageService;
        this.topology = topology;
        this.transactionTemplate = transactionManager != null ? new TransactionTemplate(transactionManager) : null;
    }

    /** Tenant fields supplied by onboarding or by a Super Admin. */
    public record TenantDraft(
            String tenantName,
            String accountHolderName,
            String subdomain,
            CountryCode countryCode,
            TenantLocale defaultLocale,
            TenantTimeZone defaultTimeZone,
            String emailAddress,
            String phoneNumber,
            String addressLine,
            String city,
            String postalCode,
            String logoUrl,
            String onboardedByCognitoSub) {}

    /**
     * The first administrator: linked to the caller's Cognito identity (self-service onboarding,
     * status ACTIVE) or an invitation without a Cognito identity (Super Admin creation, status INVITED).
     */
    public record AdminSeed(String name, String email, String phoneNumber, String cognitoSub) {}

    public record Provisioned(Tenant tenant, user admin, TenantSubscription subscription) {}

    public Provisioned provision(TenantDraft draft, AdminSeed admin, SubscriptionSource source, String actorId) {
        if (transactionTemplate != null && topology.supportsTransactions()) {
            return transactionTemplate.execute(status -> doProvision(draft, admin, source, actorId, new Progress()));
        }
        Progress progress = new Progress();
        try {
            return doProvision(draft, admin, source, actorId, progress);
        } catch (RuntimeException ex) {
            compensate(progress);
            throw ex;
        }
    }

    private Provisioned doProvision(TenantDraft d, AdminSeed a, SubscriptionSource source, String actorId, Progress progress) {
        Instant now = Instant.now();
        Tenant tenant = Tenant.builder()
                .tenantName(d.tenantName())
                .accountHolderName(d.accountHolderName())
                .subdomain(d.subdomain())
                .countryCode(d.countryCode())
                .defaultLocale(resolveLocale(d.defaultLocale(), d.countryCode()))
                .defaultTimeZone(resolveTimeZone(d.defaultTimeZone(), d.countryCode()))
                .emailAddress(d.emailAddress())
                .phoneNumber(d.phoneNumber())
                .addressLine(d.addressLine())
                .city(d.city())
                .postalCode(d.postalCode())
                .logoUrl(d.logoUrl())
                .status(TenantStatus.PROVISIONING)
                .onboardedByCognitoSub(d.onboardedByCognitoSub())
                .createdAt(now)
                .updatedAt(now)
                .build();
        Tenant saved;
        try {
            saved = tenantRepository.save(tenant);
        } catch (DuplicateKeyException ex) {
            throw new DuplicateSubdomainException(
                    "Subdomain '" + d.subdomain() + "' is already taken. Please choose a different subdomain.");
        }
        progress.tenantId = saved.getId();

        TenantSubscription subscription = packageService.assignDefaultPackage(saved.getId(), source, actorId);
        progress.packageAssigned = true;

        boolean linked = a.cognitoSub() != null && !a.cognitoSub().isBlank();
        user adminDoc = user.builder()
                .tenantId(saved.getId())
                .cognitoSub(linked ? a.cognitoSub() : null)
                .name(a.name())
                .email(a.email())
                .phoneNumber(a.phoneNumber())
                .status(linked ? UserStatus.ACTIVE : UserStatus.INVITED)
                .roles(Set.of(UserRole.ADMIN))
                .recordState(RecordState.ACTIVE)
                .activatedAt(linked ? now : null)
                .invitedAt(linked ? null : now)
                .createdAt(now)
                .updatedAt(now)
                .build();
        // The organization's first administrator, with all six modules. The owner who registered it
        // themselves gets every module permission; one a Super Admin invited gets the ADMIN defaults.
        if (source == SubscriptionSource.ONBOARDING) {
            ModuleAssignmentService.applyOwnerDefaults(adminDoc);
        } else {
            ModuleAssignmentService.applyDefaults(adminDoc, UserRole.ADMIN, null);
        }
        user savedAdmin = userRepository.save(adminDoc);
        progress.userId = savedAdmin.getId();

        saved.setStatus(TenantStatus.ACTIVE);
        saved.setActivatedAt(now);
        Tenant active = tenantRepository.save(saved);
        if (active == null) {
            active = saved;
        }
        log.info("Provisioned tenant {} ({}) with package {} and administrator {}",
                active.getId(), active.getSubdomain(), subscription != null ? subscription.getPlanCode() : null, savedAdmin.getId());
        return new Provisioned(active, savedAdmin, subscription);
    }

    /** Best-effort removal of everything created by a failed provisioning (standalone MongoDB only). */
    private void compensate(Progress progress) {
        if (progress.tenantId == null) {
            return;
        }
        if (progress.userId != null) {
            try {
                userRepository.deleteById(progress.userId);
            } catch (RuntimeException ex) {
                log.error("Compensation: failed to delete user {} of tenant {}", progress.userId, progress.tenantId, ex);
            }
        }
        if (progress.packageAssigned) {
            try {
                packageService.removeTenantPackageData(progress.tenantId);
            } catch (RuntimeException ex) {
                log.error("Compensation: failed to delete package assignment of tenant {}", progress.tenantId, ex);
            }
        }
        try {
            tenantRepository.deleteById(progress.tenantId);
            log.warn("Rolled back tenant {} after a provisioning failure", progress.tenantId);
        } catch (RuntimeException ex) {
            log.error("Compensation: failed to delete tenant {}; it stays PROVISIONING and unusable", progress.tenantId, ex);
        }
    }

    /** Removes an abandoned PROVISIONING tenant and anything attached to it (owner's retry only). */
    public void discardAbandoned(Tenant tenant) {
        Progress progress = new Progress();
        progress.tenantId = tenant.getId();
        progress.packageAssigned = true;
        userRepository.deleteByTenantId(tenant.getId());
        compensate(progress);
    }

    public static TenantLocale resolveLocale(TenantLocale requested, CountryCode countryCode) {
        if (requested != null) {
            return requested;
        }
        return switch (countryCode) {
            case ES -> TenantLocale.ES_ES;
            case MX -> TenantLocale.ES_MX;
            case IN -> TenantLocale.EN_IN;
            case US, CA, GB -> TenantLocale.EN_US;
        };
    }

    public static TenantTimeZone resolveTimeZone(TenantTimeZone requested, CountryCode countryCode) {
        if (requested != null) {
            return requested;
        }
        return switch (countryCode) {
            case ES -> TenantTimeZone.EUROPE_MADRID;
            case IN -> TenantTimeZone.ASIA_KOLKATA;
            case US, CA -> TenantTimeZone.AMERICA_NEW_YORK;
            case GB -> TenantTimeZone.UTC;
            case MX -> TenantTimeZone.AMERICA_NEW_YORK;
        };
    }

    private static final class Progress {
        private String tenantId;
        private boolean packageAssigned;
        private String userId;
    }
}
