package com.NormaOne.backend.bootstrap;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Component;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.repositories.PlanDefinitionRepository;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.services.AuditService;
import com.NormaOne.backend.services.PackageService;

/**
 * Seeds the BASIC package and (optionally) backfills tenants that have no package.
 *
 * Idempotent: the plan is inserted only when no document with the same planCode and planVersion
 * exists (unique index plan_code_version_uniq also stops concurrent instances inserting twice).
 * An existing plan document is never modified, so values changed by an administrator survive
 * restarts. The new plan is marked as the default only if no other plan is the default.
 */
@Component
@Order(20)
public class DefaultPackageInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DefaultPackageInitializer.class);

    private final PlanDefinitionRepository planRepository;
    private final TenantRepository tenantRepository;
    private final PackageService packageService;
    private final AuditService auditService;
    private final NormaOneProperties properties;

    public DefaultPackageInitializer(
            PlanDefinitionRepository planRepository,
            TenantRepository tenantRepository,
            PackageService packageService,
            AuditService auditService,
            NormaOneProperties properties) {
        this.planRepository = planRepository;
        this.tenantRepository = tenantRepository;
        this.packageService = packageService;
        this.auditService = auditService;
        this.properties = properties;
    }

    @Override
    public void run(ApplicationArguments args) {
        seedBasicPlan();
        if (properties.getPackages().isBackfillExistingTenants()) {
            backfillTenants();
        }
    }

    void seedBasicPlan() {
        NormaOneProperties.Basic basic = properties.getPackages().getBasic();
        Optional<PlanDefinition> existing = planRepository.findByPlanCodeAndPlanVersion(basic.getCode(), basic.getVersion());
        if (existing.isPresent()) {
            PlanDefinition plan = existing.get();
            if (plan.getStatus() != PlanStatus.ACTIVE) {
                log.warn("Package {} v{} exists but is {}; new organizations cannot be provisioned until it is ACTIVE.",
                        plan.getPlanCode(), plan.getPlanVersion(), plan.getStatus());
            }
            return;
        }
        Optional<PlanDefinition> currentDefault = planRepository.findFirstByDefaultPlanTrue();
        boolean makeDefault = currentDefault.isEmpty()
                && basic.getCode().equals(properties.getPackages().getDefaultPlanCode());
        PlanDefinition plan = PlanDefinition.builder()
                .planCode(basic.getCode())
                .planVersion(basic.getVersion())
                .name(basic.getName())
                .description(basic.getDescription())
                .status(PlanStatus.ACTIVE)
                .defaultPlan(makeDefault)
                .billingCycle(basic.getBillingCycle())
                .publiclyAvailable(true)
                .effectiveFrom(Instant.now())
                .trialDays(0)
                .listPrice(basic.getListPrice())
                .currencyCode(basic.getCurrencyCode())
                .maxEmployees(basic.getMaxEmployees())
                .moduleApps(new ArrayList<>(basic.getModuleApps()))
                .build();
        try {
            planRepository.insert(plan);
            log.info("Seeded package {} v{} (default: {})", basic.getCode(), basic.getVersion(), makeDefault);
        } catch (DuplicateKeyException race) {
            log.info("Package {} v{} was created concurrently; nothing to do", basic.getCode(), basic.getVersion());
        }
        if (currentDefault.isPresent() && !currentDefault.get().getPlanCode().equals(basic.getCode())) {
            log.warn("Plan {} is already marked as the default; {} was not marked as default.",
                    currentDefault.get().getPlanCode(), basic.getCode());
        }
    }

    /** Gives the default package to ACTIVE or SUSPENDED tenants that have no current package. */
    void backfillTenants() {
        List<Tenant> tenants = tenantRepository.findAll();
        int assigned = 0;
        for (Tenant tenant : tenants) {
            if (tenant.getStatus() != TenantStatus.ACTIVE && tenant.getStatus() != TenantStatus.SUSPENDED) {
                continue;
            }
            if (packageService.currentSubscription(tenant.getId()).isPresent()) {
                continue;
            }
            try {
                TenantSubscription s = packageService.assignDefaultPackage(tenant.getId(), SubscriptionSource.BACKFILL, AuditService.SYSTEM);
                auditService.recordAs(AuditService.SYSTEM, "SYSTEM", AuditAction.PACKAGE_ASSIGNED, tenant.getId(),
                        "SUBSCRIPTION", s.getId(), AuditService.details("planCode", s.getPlanCode(), "source", "BACKFILL"));
                assigned++;
            } catch (RuntimeException ex) {
                log.error("Could not assign the default package to existing tenant {}: {}", tenant.getId(), ex.getMessage());
            }
        }
        if (assigned > 0) {
            log.info("Assigned the default package to {} existing tenant(s) that had none", assigned);
        }
    }
}
