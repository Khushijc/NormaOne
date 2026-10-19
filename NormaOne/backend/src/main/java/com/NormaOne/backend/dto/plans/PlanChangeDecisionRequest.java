package com.NormaOne.backend.dto.plans;

import jakarta.validation.constraints.Size;

/** A Super Admin's approval or rejection of a plan-change request. A note is required to reject. */
public record PlanChangeDecisionRequest(
        @Size(max = 500, message = "Note must not exceed 500 characters")
        String note
) {}
