package com.NormaOne.backend.dto.plans;

import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.plans.PlanHistoryEntry;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;
import com.fasterxml.jackson.annotation.JsonInclude;

/** One plan history entry, read only. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PlanHistoryResponse(
        String id,
        PlanHistoryEventType eventType,
        Instant occurredAt,
        String tenantId,
        String planId,
        String planCode,
        Integer planVersion,
        String previousPlanId,
        String previousPlanCode,
        Integer previousPlanVersion,
        List<PlanHistoryEntry.FieldChange> changes,
        String actorUserId,
        String actorRole,
        String reason,
        String status,
        String referenceType,
        String referenceId,
        String correlationId
) {
    public static PlanHistoryResponse of(PlanHistoryEntry e) {
        return new PlanHistoryResponse(e.getId(), e.getEventType(), e.getOccurredAt(), e.getTenantId(), e.getPlanId(),
                e.getPlanCode(), e.getPlanVersion(), e.getPreviousPlanId(), e.getPreviousPlanCode(), e.getPreviousPlanVersion(),
                e.getChanges() == null || e.getChanges().isEmpty() ? null : e.getChanges(), e.getActorUserId(), e.getActorRole(),
                e.getReason(), e.getStatus(), e.getReferenceType(), e.getReferenceId(), e.getCorrelationId());
    }
}
