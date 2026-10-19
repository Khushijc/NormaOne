
package com.NormaOne.backend.model.plans;

import java.time.Instant;

import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.TenantBase;
import com.NormaOne.backend.model.plans.enums.SubscriptionEventType;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
// import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * Historical record of subscription lifecycle events.
 *
 * Records plan changes, renewals, cancellations, suspensions,
 * reactivations and other important subscription transitions.
 *
 * History entries should be append-only under normal application
 * workflows and should not be silently overwritten.
 */
@Document(collection = "subscription_history")
@CompoundIndexes({
    @CompoundIndex(
        name = "subscription_history_timeline_idx",
        def = "{'tenantSubscriptionDocId': 1, 'eventDate': -1}"
    ),
    @CompoundIndex(
        name = "tenant_history_timeline_idx",
        def = "{'tenantId': 1, 'eventDate': -1}"
    )
})
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class SubscriptionHistory extends TenantBase {

    // ==================== SUBSCRIPTION REFERENCE ====================

    @NotBlank
    @Indexed
    private String tenantSubscriptionDocId;

    // ==================== EVENT DETAILS ====================

    @NotNull
    private SubscriptionEventType eventType;

    @NotNull
    private Instant eventDate;

    // ==================== PLAN CHANGES ====================

    private String previousPlanId;

    private Integer previousPlanVersion;

    private String newPlanId;

    private Integer newPlanVersion;

    // ==================== STATUS CHANGES ====================

    private SubscriptionStatus previousStatus;

    private SubscriptionStatus newStatus;

    // ==================== AUDIT DETAILS ====================

    /**
     * Identifier of the user or system that performed the action.
     */
    private String performedBy;

    /**
     * Reason for the subscription change, when applicable.
     */
    @Size(max = 500)
    private String reason;

    @Size(max = 2000)
    private String notes;
}
