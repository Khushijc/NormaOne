package com.NormaOne.backend.dto.plans;

import java.math.BigDecimal;
import java.util.List;

import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A plan as a Tenant Admin sees it: the commercial terms and included modules, never platform-only
 * data (who created it, subscription counts, the default flag, the sale window).
 *
 * {@code current}: the organization is on this plan. {@code selectable}: it may be requested now
 * (ACTIVE and not the current one). The current plan is listed even when it is no longer ACTIVE, to
 * explain the existing subscription; {@code status} says so.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TenantPlanResponse(
        String id,
        String planCode,
        Integer planVersion,
        String name,
        String description,
        PlanStatus status,
        BigDecimal listPrice,
        String currencyCode,
        BillingCycle billingCycle,
        Integer durationMonths,
        Integer trialDays,
        Long maxEmployees,
        Integer maxUsers,
        /** The application modules the plan includes (the NORMAONE portal itself is always included). */
        List<ModuleApps> modules,
        boolean current,
        boolean selectable
) {
    public static TenantPlanResponse of(PlanDefinition p, boolean current) {
        return new TenantPlanResponse(p.getId(), p.getPlanCode(), p.getPlanVersion(), p.getName(), p.getDescription(), p.getStatus(),
                p.getListPrice(), p.getCurrencyCode(), p.getBillingCycle(), p.getDurationMonths(), p.getTrialDays(),
                p.getMaxEmployees(), p.getMaxUsers(), ModuleCatalog.applicationModules(p.getModuleApps()), current,
                p.getStatus() == PlanStatus.ACTIVE && !current);
    }
}
