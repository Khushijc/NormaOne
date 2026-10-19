package com.NormaOne.backend.services;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.MongoTransactionManager;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.NormaOne.backend.config.MongoTopology;
import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.PackageUnavailableException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.PlanHistoryEntry;
import com.NormaOne.backend.model.plans.SubscriptionHistory;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.NormaOne.backend.model.plans.enums.SubscriptionEventType;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.NormaOne.backend.repositories.PlanDefinitionRepository;
import com.NormaOne.backend.repositories.SubscriptionHistoryRepository;
import com.NormaOne.backend.repositories.TenantSubscriptionRepository;
import com.mongodb.client.result.UpdateResult;

/**
 * Default package (BASIC) resolution, tenant package assignment and plan changes.
 *
 * Assignment is idempotent: a tenant has at most one current subscription, enforced by the
 * unique partial index tenant_current_subscription_uniq, so retries and concurrent requests
 * return the existing assignment instead of creating a second one.
 */
@Service
public class PackageService {

    private static final Logger log = LoggerFactory.getLogger(PackageService.class);

    private final PlanDefinitionRepository planRepository;
    private final TenantSubscriptionRepository subscriptionRepository;
    private final SubscriptionHistoryRepository historyRepository;
    private final NormaOneProperties properties;
    private final MongoTemplate mongoTemplate;
    private final MongoTopology topology;
    private final TransactionTemplate transactionTemplate;
    private final PlanHistoryService planHistory;

    public PackageService(
            PlanDefinitionRepository planRepository,
            TenantSubscriptionRepository subscriptionRepository,
            SubscriptionHistoryRepository historyRepository,
            NormaOneProperties properties,
            MongoTemplate mongoTemplate,
            MongoTopology topology,
            MongoTransactionManager transactionManager,
            PlanHistoryService planHistory) {
        this.planHistory = planHistory;
        this.planRepository = planRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.historyRepository = historyRepository;
        this.properties = properties;
        this.mongoTemplate = mongoTemplate;
        this.topology = topology;
        this.transactionTemplate = transactionManager != null ? new TransactionTemplate(transactionManager) : null;
    }

    /** The active default package (configured code, latest active version). */
    public PlanDefinition resolveDefaultPlan() {
        String code = properties.getPackages().getDefaultPlanCode();
        return planRepository.findFirstByPlanCodeAndStatusOrderByPlanVersionDesc(code, PlanStatus.ACTIVE)
                .orElseThrow(() -> new PackageUnavailableException(
                        "The default package '" + code + "' is not available. Organizations cannot be created until it is active."));
    }

    public Optional<TenantSubscription> currentSubscription(String tenantId) {
        return subscriptionRepository.findFirstByTenantIdAndCurrentTrue(tenantId);
    }

    /**
     * Assigns the default package to a tenant, or returns the tenant's existing current
     * assignment. Records a CREATED history entry for a new assignment.
     */
    public TenantSubscription assignDefaultPackage(String tenantId, SubscriptionSource source, String actorId) {
        Optional<TenantSubscription> existing = currentSubscription(tenantId);
        if (existing.isPresent()) {
            return existing.get();
        }
        PlanDefinition plan = resolveDefaultPlan();
        Instant now = Instant.now();
        TenantSubscription subscription = TenantSubscription.builder()
                .tenantId(tenantId)
                .planDocsId(plan.getId())
                .planVersion(plan.getPlanVersion())
                .planCode(plan.getPlanCode())
                .current(true)
                .status(SubscriptionStatus.ACTIVE)
                .startDate(now)
                .currentPeriodStart(now)
                .currentPeriodEnd(periodEnd(now, plan))
                .agreedPrice(plan.getListPrice())
                .currencyCode(plan.getCurrencyCode())
                .billingCycle(plan.getBillingCycle())
                .autoRenew(false)
                .assignmentSource(source)
                .assignedBy(actorId)
                .build();
        TenantSubscription saved;
        try {
            saved = subscriptionRepository.insert(subscription);
        } catch (DuplicateKeyException race) {
            // A concurrent request assigned the package first: return that assignment.
            log.info("Concurrent default-package assignment for tenant {}; returning the existing one", tenantId);
            return currentSubscription(tenantId).orElseThrow(() -> race);
        }
        historyRepository.insert(SubscriptionHistory.builder()
                .tenantId(tenantId)
                .tenantSubscriptionDocId(saved.getId())
                .eventType(SubscriptionEventType.CREATED)
                .eventDate(now)
                .newPlanId(plan.getId())
                .newPlanVersion(plan.getPlanVersion())
                .newStatus(SubscriptionStatus.ACTIVE)
                .performedBy(actorId)
                .reason("Default package assigned (" + source + ")")
                .build());
        return saved;
    }

    /**
     * Moves a tenant to {@code plan} (already checked ACTIVE by the caller) through the subscription
     * model's own workflow:
     * <ol>
     *   <li>the current subscription, if any, stops being current: CANCELLED, with cancelledAt,
     *       endedAt and the reason "Plan changed to CODE vN" — only if it is still the current one,
     *       so two concurrent changes cannot both succeed (409 for the second);</li>
     *   <li>a new current subscription is created from the plan's terms (status ACTIVE, source
     *       SUPER_ADMIN, the plan's price, currency and billing cycle as the agreed snapshot);</li>
     *   <li>a PLAN_CHANGED history entry records the previous and new plan versions and statuses
     *       (CREATED when the tenant had no subscription).</li>
     * </ol>
     * One MongoDB transaction where the deployment supports it; otherwise, if step 2 or 3 fails, the
     * previous subscription is restored and anything written is removed (best effort, as for
     * provisioning). No payment is taken: there is no billing integration.
     */
    public TenantSubscription changePackage(String tenantId, PlanDefinition plan, String actorId, String actorRole, String reason,
            String correlationId) {
        PlanChange change = new PlanChange(tenantId, plan, actorId, actorRole, reason, correlationId);
        if (transactionTemplate != null && topology.supportsTransactions()) {
            return transactionTemplate.execute(status -> doChangePackage(change, new ChangeProgress()));
        }
        ChangeProgress progress = new ChangeProgress();
        try {
            return doChangePackage(change, progress);
        } catch (RuntimeException ex) {
            compensate(progress);
            throw ex;
        }
    }

    /** Who moves which organization to which plan, and why; correlationId ties it to a plan-change request. */
    private record PlanChange(String tenantId, PlanDefinition plan, String actorId, String actorRole, String reason, String correlationId) {}

    private TenantSubscription doChangePackage(PlanChange change, ChangeProgress progress) {
        String tenantId = change.tenantId();
        PlanDefinition plan = change.plan();
        String actorId = change.actorId();
        String reason = change.reason();
        Instant now = Instant.now();
        TenantSubscription previous = currentSubscription(tenantId).orElse(null);
        if (previous != null && plan.getId().equals(previous.getPlanDocsId())) {
            throw new ConflictException("The organization is already on " + plan.getPlanCode() + " v" + plan.getPlanVersion() + ".");
        }
        if (previous != null) {
            String ended = "Plan changed to " + plan.getPlanCode() + " v" + plan.getPlanVersion();
            UpdateResult closed = mongoTemplate.updateFirst(
                    new Query(Criteria.where("id").is(previous.getId()).and("current").is(true)),
                    new Update().set("current", false).set("status", SubscriptionStatus.CANCELLED)
                            .set("cancelledAt", now).set("endedAt", now).set("cancellationReason", ended)
                            .set("updatedAt", now).set("updatedByDocsId", actorId).inc("version", 1),
                    TenantSubscription.class);
            if (closed.getModifiedCount() == 0) {
                throw new ConflictException("The organization's package changed meanwhile. Reload it and try again.");
            }
            progress.closed = previous;
        }
        TenantSubscription created;
        try {
            created = subscriptionRepository.insert(TenantSubscription.builder()
                    .tenantId(tenantId)
                    .planDocsId(plan.getId())
                    .planVersion(plan.getPlanVersion())
                    .planCode(plan.getPlanCode())
                    .current(true)
                    .status(SubscriptionStatus.ACTIVE)
                    .startDate(now)
                    .currentPeriodStart(now)
                    .currentPeriodEnd(periodEnd(now, plan))
                    .agreedPrice(plan.getListPrice())
                    .currencyCode(plan.getCurrencyCode())
                    .billingCycle(plan.getBillingCycle())
                    .autoRenew(false)
                    .assignmentSource(SubscriptionSource.SUPER_ADMIN)
                    .assignedBy(actorId)
                    .build());
        } catch (DuplicateKeyException race) {
            throw new ConflictException("The organization's package changed meanwhile. Reload it and try again.");
        }
        progress.createdId = created.getId();
        SubscriptionHistory entry = historyRepository.insert(SubscriptionHistory.builder()
                .tenantId(tenantId)
                .tenantSubscriptionDocId(created.getId())
                .eventType(previous == null ? SubscriptionEventType.CREATED : SubscriptionEventType.PLAN_CHANGED)
                .eventDate(now)
                .previousPlanId(previous != null ? previous.getPlanDocsId() : null)
                .previousPlanVersion(previous != null ? previous.getPlanVersion() : null)
                .newPlanId(plan.getId())
                .newPlanVersion(plan.getPlanVersion())
                .previousStatus(previous != null ? previous.getStatus() : null)
                .newStatus(SubscriptionStatus.ACTIVE)
                .performedBy(actorId)
                .reason(reason != null && !reason.isBlank() ? reason.strip() : "Package changed by a Super Admin")
                .build());
        progress.historyId = entry.getId();
        PlanHistoryEntry planEntry = planHistory.insert(PlanHistoryEntry.builder()
                .eventType(PlanHistoryEventType.TENANT_PLAN_CHANGED)
                .occurredAt(now)
                .tenantId(tenantId)
                .planId(plan.getId()).planCode(plan.getPlanCode()).planVersion(plan.getPlanVersion())
                .previousPlanId(previous != null ? previous.getPlanDocsId() : null)
                .previousPlanCode(previous != null ? previous.getPlanCode() : null)
                .previousPlanVersion(previous != null ? previous.getPlanVersion() : null)
                .actorUserId(actorId)
                .actorRole(change.actorRole())
                .reason(entry.getReason())
                .status(SubscriptionStatus.ACTIVE.name())
                .referenceType("SUBSCRIPTION")
                .referenceId(created.getId())
                .correlationId(change.correlationId())
                .build());
        progress.planHistoryId = planEntry.getId();
        return created;
    }

    /** Standalone MongoDB only: undo a plan change that failed half-way. */
    private void compensate(ChangeProgress progress) {
        try {
            planHistory.remove(progress.planHistoryId);
            if (progress.historyId != null) {
                historyRepository.deleteById(progress.historyId);
            }
            if (progress.createdId != null) {
                subscriptionRepository.deleteById(progress.createdId);
            }
            if (progress.closed != null) {
                TenantSubscription p = progress.closed;
                mongoTemplate.updateFirst(new Query(Criteria.where("id").is(p.getId()).and("current").is(false)),
                        new Update().set("current", true).set("status", p.getStatus()).set("cancelledAt", p.getCancelledAt())
                                .set("endedAt", p.getEndedAt()).set("cancellationReason", p.getCancellationReason()).inc("version", 1),
                        TenantSubscription.class);
            }
        } catch (RuntimeException ex) {
            log.error("Compensation of a failed package change for subscription {} did not complete; check the tenant's current subscription.",
                    progress.closed != null ? progress.closed.getId() : progress.createdId, ex);
        }
    }

    private static final class ChangeProgress {
        private TenantSubscription closed;
        private String createdId;
        private String historyId;
        private String planHistoryId;
    }

    /** The end of a committed term (the plan's durationMonths) from {@code start}; null for a rolling plan. */
    static Instant periodEnd(Instant start, PlanDefinition plan) {
        Integer months = plan.getDurationMonths();
        return months == null ? null : start.atZone(ZoneOffset.UTC).plusMonths(months).toInstant();
    }

    /** Compensation for a failed provisioning: removes the tenant's subscriptions and history. */
    public void removeTenantPackageData(String tenantId) {
        historyRepository.deleteByTenantId(tenantId);
        subscriptionRepository.deleteByTenantId(tenantId);
    }

    public TenantPackageResponse describe(String tenantId) {
        TenantSubscription subscription = currentSubscription(tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("No package is assigned to this organization."));
        PlanDefinition plan = planRepository.findById(subscription.getPlanDocsId()).orElse(null);
        return toResponse(subscription, plan);
    }

    public Optional<TenantPackageResponse> describeIfAssigned(String tenantId) {
        return currentSubscription(tenantId)
                .map(s -> toResponse(s, planRepository.findById(s.getPlanDocsId()).orElse(null)));
    }

    public static TenantPackageResponse toResponse(TenantSubscription s, PlanDefinition p) {
        TenantPackageResponse.PlanSummary plan = p == null ? null : new TenantPackageResponse.PlanSummary(
                p.getId(), p.getPlanCode(), p.getPlanVersion(), p.getName(), p.getDescription(), p.getStatus(),
                p.getDefaultPlan(), p.getListPrice(), p.getCurrencyCode(), p.getBillingCycle(), p.getTrialDays(),
                p.getMaxEmployees(), p.getMaxUsers(), p.getDurationMonths(), p.getModuleApps());
        return new TenantPackageResponse(
                s.getTenantId(), s.getId(), s.getStatus(), s.getAssignmentSource(), s.getStartDate(),
                s.getCurrentPeriodStart(), s.getCurrentPeriodEnd(), s.getAgreedPrice(), s.getCurrencyCode(),
                s.getBillingCycle(), s.getCreatedAt(), plan);
    }
}
