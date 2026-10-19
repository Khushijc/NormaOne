package com.NormaOne.backend.dto.plans;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A Tenant Admin asks for their organization to move to another plan. There is deliberately no tenant
 * field: the organization is the requesting administrator's own (a tenantId sent anyway is ignored).
 */
public record CreatePlanChangeRequest(
        @NotBlank(message = "Plan id is required")
        @Size(max = 64, message = "Plan id must not exceed 64 characters")
        String planId,

        @Size(max = 500, message = "Reason must not exceed 500 characters")
        String reason
) {}
