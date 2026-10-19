package com.NormaOne.backend.dto.plans;

import com.NormaOne.backend.model.plans.enums.PlanStatus;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * PATCH /api/super-admin/plans/{planId}/status. DRAFT → ACTIVE or ARCHIVED; ACTIVE ⇄ INACTIVE;
 * ACTIVE or INACTIVE → ARCHIVED. ARCHIVED is final. Existing subscriptions keep their plan whatever
 * its status; the status only decides whether it can be assigned from now on.
 */
public record PlanStatusRequest(
        @NotNull(message = "Status is required: ACTIVE, INACTIVE or ARCHIVED")
        PlanStatus status,

        @Size(max = 500, message = "Reason must not exceed 500 characters")
        String reason
) {}
