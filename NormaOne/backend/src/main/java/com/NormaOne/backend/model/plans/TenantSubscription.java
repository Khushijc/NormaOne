
package com.NormaOne.backend.model.plans;

import java.time.Instant;

import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.TenantBase;
import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * Tenant-specific subscription to a versioned NormaOne plan.
 *
 * Tenant identity is inherited from TenantBase.
 *
 * The selected plan version is retained so that changes to future
 * plan definitions do not silently change existing subscriptions.
 *
 * Subscription lifecycle and billing dates are managed separately
 * from statutory invoice records.
 */
@Document(collection = "tenant_subscriptions")
@CompoundIndexes({
    @CompoundIndex(
        name = "tenant_subscription_status_idx",
        def = "{'tenantId': 1, 'status': 1}"
    ),
    @CompoundIndex(
        name = "subscription_renewal_idx",
        def = "{'status': 1, 'nextBillingDate': 1}"
    ),
    @CompoundIndex(
        name = "tenant_current_subscription_uniq",
        def = "{'tenantId': 1}",
        unique = true,
        partialFilter = "{ 'current': true }"
    )
})
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class TenantSubscription extends TenantBase {
 
    // ==================== PLAN REFERENCE ====================

    /**
     * ID of the PlanDefinition document.
     */
    @NotBlank
    @Indexed
    private String planDocsId;

    /**
     * Version selected by the tenant.
     */
    @NotNull
    @Positive
    private Integer planVersion;

    /**
     * Plan code at assignment time (snapshot, e.g. BASIC).
     */
    @Size(max = 50)
    private String planCode;

    /**
     * True for the tenant's current package assignment. At most one per tenant
     * (unique partial index tenant_current_subscription_uniq), so concurrent
     * onboarding retries cannot create two current subscriptions.
     */
    @NotNull
    @Builder.Default
    private Boolean current = true;

    /**
     * How the assignment was made: ONBOARDING, SUPER_ADMIN or BACKFILL.
     */
    private SubscriptionSource assignmentSource;

    /**
     * Application user (or "system") that made the assignment.
     */
    private String assignedBy;

    // ==================== SUBSCRIPTION LIFECYCLE ====================

    @NotNull
    @Builder.Default
    private SubscriptionStatus status = SubscriptionStatus.TRIAL;

    @NotNull
    private Instant startDate;

    private Instant trialStartDate;

    private Instant trialEndDate;

    private Instant currentPeriodStart;

    private Instant currentPeriodEnd;

    private Instant nextBillingDate;

    private Instant cancelledAt;

    private Instant endedAt;

    @Size(max = 500)
    private String cancellationReason;

    // ==================== COMMERCIAL SNAPSHOT ====================

    /**
     * Price agreed when this subscription was created.
     * Stored independently of later changes to PlanDefinition.
     */
    @NotNull
    private java.math.BigDecimal agreedPrice;

    /**
     * Currency of the agreed subscription price.
     * Normally EUR for the Spain-focused product.
     */
    @NotBlank
    @Builder.Default
    private String currencyCode = "EUR";

    /**
     * Billing interval agreed for this subscription.
     */
    @NotNull
    private BillingCycle billingCycle;

    // ==================== RENEWAL SETTINGS ====================

    @NotNull
    @Builder.Default
    private Boolean autoRenew = true;

    // ==================== PAYMENT REFERENCES ====================

    /**
     * References from the external payment provider.
     * Never store raw card details or CVV values here.
     */
    private String paymentCustomerReference;

    private String paymentSubscriptionReference;
}
