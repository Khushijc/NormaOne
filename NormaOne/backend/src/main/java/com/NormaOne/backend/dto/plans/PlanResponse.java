package com.NormaOne.backend.dto.plans;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A subscription plan ("package") version as the Super Admin sees it. {@code currentSubscriptions}
 * is the number of organizations currently on this exact version (single-plan reads only).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PlanResponse(
        String id,
        String planCode,
        Integer planVersion,
        String name,
        String description,
        PlanStatus status,
        Boolean defaultPlan,
        BillingCycle billingCycle,
        Boolean publiclyAvailable,
        Instant effectiveFrom,
        Instant effectiveUntil,
        Integer trialDays,
        BigDecimal listPrice,
        String currencyCode,
        Long maxEmployees,
        Integer maxUsers,
        Integer durationMonths,
        List<ModuleApps> moduleApps,
        Long currentSubscriptions,
        /** False when a newer version of the same plan code exists: a historical version. */
        Boolean latestVersion,
        Instant createdAt,
        Instant updatedAt,
        String createdBy,
        String updatedBy
) {
    public static PlanResponse of(PlanDefinition p, Long currentSubscriptions, boolean latestVersion) {
        return new PlanResponse(p.getId(), p.getPlanCode(), p.getPlanVersion(), p.getName(), p.getDescription(), p.getStatus(),
                p.getDefaultPlan(), p.getBillingCycle(), p.getPubliclyAvailable(), p.getEffectiveFrom(), p.getEffectiveUntil(),
                p.getTrialDays(), p.getListPrice(), p.getCurrencyCode(), p.getMaxEmployees(), p.getMaxUsers(), p.getDurationMonths(),
                p.getModuleApps(), currentSubscriptions, latestVersion, p.getCreatedAt(), p.getUpdatedAt(), p.getCreatedByDocsId(),
                p.getUpdatedByDocsId());
    }
}
