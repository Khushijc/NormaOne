package com.NormaOne.backend.dto.plans;

import java.time.Instant;

import com.NormaOne.backend.model.plans.SubscriptionHistory;
import com.NormaOne.backend.model.plans.enums.SubscriptionEventType;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.fasterxml.jackson.annotation.JsonInclude;

/** One entry of an organization's append-only subscription history. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SubscriptionHistoryResponse(
        String id,
        String tenantId,
        String subscriptionId,
        SubscriptionEventType eventType,
        Instant eventDate,
        String previousPlanId,
        Integer previousPlanVersion,
        String newPlanId,
        Integer newPlanVersion,
        SubscriptionStatus previousStatus,
        SubscriptionStatus newStatus,
        String performedBy,
        String reason,
        String notes
) {
    public static SubscriptionHistoryResponse of(SubscriptionHistory h) {
        return new SubscriptionHistoryResponse(h.getId(), h.getTenantId(), h.getTenantSubscriptionDocId(), h.getEventType(),
                h.getEventDate(), h.getPreviousPlanId(), h.getPreviousPlanVersion(), h.getNewPlanId(), h.getNewPlanVersion(),
                h.getPreviousStatus(), h.getNewStatus(), h.getPerformedBy(), h.getReason(), h.getNotes());
    }
}
