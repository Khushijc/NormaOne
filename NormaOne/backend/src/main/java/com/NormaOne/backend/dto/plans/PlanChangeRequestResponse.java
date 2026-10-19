package com.NormaOne.backend.dto.plans;

import java.time.Instant;

import com.NormaOne.backend.dto.admin.OrganizationSummary;
import com.NormaOne.backend.model.notification.OutboundEmail;
import com.NormaOne.backend.model.notification.enums.OutboundEmailStatus;
import com.NormaOne.backend.model.plans.PlanChangeRequest;
import com.NormaOne.backend.model.plans.enums.PlanChangeRequestStatus;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A plan-change request. {@code notification} is the Super Admin email about it: its delivery state
 * for everyone, and the attempts and last error for a Super Admin only.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PlanChangeRequestResponse(
        String id,
        OrganizationSummary organization,
        PlanChangeRequestStatus status,
        Person requestedBy,
        Instant requestedAt,
        String reason,
        PlanRef currentPlan,
        PlanRef requestedPlan,
        String decidedBy,
        String decidedByRole,
        Instant decidedAt,
        String decisionNote,
        String appliedSubscriptionId,
        Notification notification
) {
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Person(String userId, String name, String email) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PlanRef(String planId, String planCode, Integer planVersion, String name) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Notification(OutboundEmailStatus status, Integer attempts, Instant lastAttemptAt, Instant sentAt, String lastError) {}

    public static PlanChangeRequestResponse of(PlanChangeRequest r, OrganizationSummary organization, OutboundEmail email,
            boolean deliveryDetails) {
        Notification notification = email == null ? null : deliveryDetails
                ? new Notification(email.getStatus(), email.getAttempts(), email.getLastAttemptAt(), email.getSentAt(), email.getLastError())
                : new Notification(email.getStatus(), null, null, email.getSentAt(), null);
        return new PlanChangeRequestResponse(r.getId(), organization, r.getStatus(),
                new Person(r.getRequestedByUserId(), r.getRequestedByName(), r.getRequestedByEmail()), r.getRequestedAt(), r.getReason(),
                r.getCurrentPlanId() == null ? null
                        : new PlanRef(r.getCurrentPlanId(), r.getCurrentPlanCode(), r.getCurrentPlanVersion(), r.getCurrentPlanName()),
                new PlanRef(r.getRequestedPlanId(), r.getRequestedPlanCode(), r.getRequestedPlanVersion(), r.getRequestedPlanName()),
                r.getDecidedByUserId(), r.getDecidedByRole(), r.getDecidedAt(), r.getDecisionNote(), r.getAppliedSubscriptionId(),
                notification);
    }
}
