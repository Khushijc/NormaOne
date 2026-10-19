package com.NormaOne.backend.dto.tenant;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A tenant's current package assignment and the plan it references.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TenantPackageResponse(
        String tenantId,
        String subscriptionId,
        SubscriptionStatus status,
        SubscriptionSource assignmentSource,
        Instant startDate,
        Instant currentPeriodStart,
        Instant currentPeriodEnd,
        BigDecimal agreedPrice,
        String currencyCode,
        BillingCycle billingCycle,
        Instant assignedAt,
        PlanSummary plan,
        /** User seats: the plan's limit (null = no limit) and the seats in use. Present on the package reads. */
        Seats seats
) {
    public TenantPackageResponse(String tenantId, String subscriptionId, SubscriptionStatus status, SubscriptionSource assignmentSource,
            Instant startDate, Instant currentPeriodStart, Instant currentPeriodEnd, BigDecimal agreedPrice, String currencyCode,
            BillingCycle billingCycle, Instant assignedAt, PlanSummary plan) {
        this(tenantId, subscriptionId, status, assignmentSource, startDate, currentPeriodStart, currentPeriodEnd, agreedPrice,
                currencyCode, billingCycle, assignedAt, plan, null);
    }

    /** The same package with its seat usage. */
    public TenantPackageResponse withSeats(Seats seats) {
        return new TenantPackageResponse(tenantId, subscriptionId, status, assignmentSource, startDate, currentPeriodStart,
                currentPeriodEnd, agreedPrice, currencyCode, billingCycle, assignedAt, plan, seats);
    }

    /** {@code limit} null = no limit; {@code used} counts ACTIVE, INVITED and SUSPENDED accounts (SeatService). */
    public record Seats(Integer limit, long used) {}


    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PlanSummary(
            String planId,
            String planCode,
            Integer planVersion,
            String name,
            String description,
            PlanStatus status,
            Boolean defaultPlan,
            BigDecimal listPrice,
            String currencyCode,
            BillingCycle billingCycle,
            Integer trialDays,
            Long maxEmployees,
            Integer maxUsers,
            Integer durationMonths,
            List<ModuleApps> moduleApps
    ) {}
}
