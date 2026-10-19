package com.NormaOne.backend.dto.admin;

import com.NormaOne.backend.model.core.enums.TenantStatus;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Activate or suspend a tenant. Only ACTIVE and SUSPENDED are accepted; a reason is required to suspend.
 */
public record TenantStatusRequest(
        @NotNull(message = "Status is required")
        TenantStatus status,

        @Size(max = 500, message = "Reason must not exceed 500 characters")
        String reason
) {}
