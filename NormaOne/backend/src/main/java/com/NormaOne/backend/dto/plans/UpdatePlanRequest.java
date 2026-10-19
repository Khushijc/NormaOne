package com.NormaOne.backend.dto.plans;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.ModuleApps;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * PATCH /api/super-admin/plans/{planId}. Only the fields sent are changed.
 *
 * Any plan that is not ARCHIVED may change its metadata: name, description, publiclyAvailable and the
 * sale period. Commercial terms and features — billingCycle, trialDays, listPrice, currencyCode,
 * maxEmployees, moduleApps — change only while the plan is a DRAFT; for a published plan they are a
 * new version (POST /api/super-admin/plans with the same planCode), so existing subscriptions never
 * change silently. planCode, planVersion, status and defaultPlan are not editable here.
 */
public record UpdatePlanRequest(

        @Size(min = 1, max = 100, message = "Name must be 1 to 100 characters")
        String name,

        @Size(max = 1000, message = "Description must not exceed 1000 characters")
        String description,

        Boolean publiclyAvailable,

        Instant effectiveFrom,

        Instant effectiveUntil,

        BillingCycle billingCycle,

        @PositiveOrZero(message = "Trial days must be zero or more")
        Integer trialDays,

        @DecimalMin(value = "0.00", message = "List price must not be negative")
        @Digits(integer = 10, fraction = 2, message = "List price must have at most 2 decimals")
        BigDecimal listPrice,

        @Pattern(regexp = "^[A-Za-z]{3}$", message = "Currency must be an ISO 4217 code, e.g. EUR")
        String currencyCode,

        @Positive(message = "Maximum employees must be positive")
        Long maxEmployees,

        @Positive(message = "User-seat limit must be positive")
        @Max(value = 1000000, message = "User-seat limit must not exceed 1000000")
        Integer maxUsers,

        @Positive(message = "Duration must be a positive number of months")
        @Max(value = 120, message = "Duration must not exceed 120 months")
        Integer durationMonths,

        List<ModuleApps> moduleApps
) {}
