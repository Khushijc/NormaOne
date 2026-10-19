package com.NormaOne.backend.dto.plans;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.ModuleApps;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * POST /api/super-admin/plans. A new plan, or a new version of an existing plan code.
 *
 * The plan is created as DRAFT and is never the default; activate it with PATCH …/status. Without
 * {@code planVersion} the next free version of {@code planCode} is used. A published version is not
 * changed in place: new pricing, limits or modules are a new version.
 */
public record CreatePlanRequest(

        @NotBlank(message = "Plan code is required")
        @Size(max = 50, message = "Plan code must not exceed 50 characters")
        @Pattern(regexp = "^[A-Za-z0-9_-]+$", message = "Plan code may contain only letters, digits, '_' and '-'")
        String planCode,

        @Positive(message = "Plan version must be positive")
        Integer planVersion,

        @NotBlank(message = "Name is required")
        @Size(max = 100, message = "Name must not exceed 100 characters")
        String name,

        @Size(max = 1000, message = "Description must not exceed 1000 characters")
        String description,

        @NotNull(message = "Billing cycle is required: MONTHLY, QUARTERLY or YEARLY")
        BillingCycle billingCycle,

        Boolean publiclyAvailable,

        Instant effectiveFrom,

        Instant effectiveUntil,

        @PositiveOrZero(message = "Trial days must be zero or more")
        Integer trialDays,

        @NotNull(message = "List price is required (0.00 for a free plan)")
        @DecimalMin(value = "0.00", message = "List price must not be negative")
        @Digits(integer = 10, fraction = 2, message = "List price must have at most 2 decimals")
        BigDecimal listPrice,

        @Pattern(regexp = "^[A-Za-z]{3}$", message = "Currency must be an ISO 4217 code, e.g. EUR")
        String currencyCode,

        @NotNull(message = "Maximum employees is required")
        @Positive(message = "Maximum employees must be positive")
        Long maxEmployees,

        /** User-seat limit; omitted = no limit. Shown to Tenant Admins, not enforced at invitation yet. */
        @Positive(message = "User-seat limit must be positive")
        @Max(value = 1000000, message = "User-seat limit must not exceed 1000000")
        Integer maxUsers,

        /** Committed term in months; omitted = a rolling plan. */
        @Positive(message = "Duration must be a positive number of months")
        @Max(value = 120, message = "Duration must not exceed 120 months")
        Integer durationMonths,

        /** NORMAONE (the portal) and any of the six application modules. */
        List<ModuleApps> moduleApps
) {}
