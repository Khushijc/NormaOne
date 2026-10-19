
package com.NormaOne.backend.model.plans;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;
import org.springframework.data.mongodb.core.mapping.FieldType;

import com.NormaOne.backend.model.base.AuditedDocument;
// import com.NormaOne.backend.model.plans.embedded.PlanFeature;
import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.model.plans.enums.PlanStatus;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * Platform-level, versioned definition of a NormaOne subscription plan.
 *
 * Defines available subscription plans, pricing, feature access,
 * usage limits and the period during which a plan can be sold.
 *
 * A published plan version should not be modified in place.
 * Create a new version when changing its commercial terms or features.
 *
 * TenantSubscription references this plan definition.
 *
 * Pricing is stored separately from invoice tax calculations.
 * Applicable Spanish IVA treatment is determined by the billing process.
 */
@Document(collection = "plan_definitions")
@CompoundIndexes({
    @CompoundIndex(
        name = "plan_code_version_uniq",
        def = "{'planCode': 1, 'planVersion': 1}",
        unique = true
    ),
    @CompoundIndex(
        name = "plan_status_effective_idx",
        def = "{'status': 1, 'effectiveFrom': -1, 'effectiveUntil': 1}"
    ),
    @CompoundIndex(
        name = "plan_default_uniq",
        def = "{'defaultPlan': 1}",
        unique = true,
        partialFilter = "{ 'defaultPlan': true }"
    )
})
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class PlanDefinition extends AuditedDocument {

    // ==================== PLAN IDENTITY ====================

    /**
     * Stable business identifier.
     * Examples: BASIC, PROFESSIONAL, ENTERPRISE.
     */
    @NotBlank
    @Size(max = 50)
    private String planCode;

    /**
     * Version of this plan code. A published version is not modified in place.
     */
    @NotNull
    @Positive
    @Builder.Default
    private Integer planVersion = 1;

    /**
     * True for the single plan assigned to every newly onboarded tenant.
     * At most one plan can be the default (unique partial index plan_default_uniq).
     */
    @NotNull
    @Builder.Default
    private Boolean defaultPlan = false;

    /**
     * Display name shown to customers.
     */
    @NotBlank
    @Size(max = 100)
    private String name;

    /**
     * Description of the subscription plan.
     */
    @Size(max = 1000)
    private String description;

    // ==================== PLAN LIFECYCLE ====================

    @NotNull
    @Builder.Default
    private PlanStatus status = PlanStatus.DRAFT;

    /**
     * Period between recurring subscription charges.
     */
    @NotNull
    private BillingCycle billingCycle;

    /**
     * Whether customers can select this plan through
     * the public pricing or registration pages.
     */
    @NotNull
    @Builder.Default
    private Boolean publiclyAvailable = false;

    /**
     * Start of the period during which this version can be sold.
     */
    private Instant effectiveFrom;

    /**
     * End of the period during which this version can be sold.
     */
    private Instant effectiveUntil;

    /**
     * Optional free-trial duration, in days.
     */
    @NotNull
    @PositiveOrZero
    @Builder.Default
    private Integer trialDays = 0;

    // ==================== PRICING ====================

    /**
     * Subscription price before applicable taxes.
     * Example: 49.99 EUR.
     */
    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal listPrice;

    /**
     * ISO 4217 currency code.
     * Default currency for the Spain-focused platform: EUR.
     */
    @NotBlank
    @Builder.Default
    private String currencyCode = "EUR";

    // ==================== USAGE LIMITS ====================

    /**
     * Maximum employees supported by the plan.
     * Used by modules such as JornadaPulse and PRL.
     */
    @NotNull
    @Positive
    private Long maxEmployees;


    /**
     * User-seat limit: the most user accounts an organization on this plan is meant to hold. Null means
     * no limit. Shown to Super Admins and Tenant Admins; not enforced at invitation yet.
     */
    @Positive
    private Integer maxUsers;

    /**
     * Committed term in months from the start of a subscription (sets its currentPeriodEnd). Null means
     * a rolling plan that runs until it is changed.
     */
    @Positive
    private Integer durationMonths;

    @Builder.Default
    private List<ModuleApps> moduleApps = new ArrayList<>();

    // NORMAONE, SAFEVOICE, JORNADAPULSE, BUZONDESK, DATOSPILOT, FACTURAFLOW, PREVENWORK
    // 7 Apps 
}
