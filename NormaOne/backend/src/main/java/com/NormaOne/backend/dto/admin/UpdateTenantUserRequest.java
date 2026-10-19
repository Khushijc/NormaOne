package com.NormaOne.backend.dto.admin;

import com.NormaOne.backend.model.core.enums.UserRole;

import jakarta.validation.constraints.Size;

/**
 * Fields a Tenant Admin may change on a user of their tenant (null = unchanged).
 * Email, tenant, status and Cognito identity cannot be changed here; status has its own endpoint.
 * role: USER or ADMIN.
 */
public record UpdateTenantUserRequest(
        @Size(min = 1, max = 100, message = "Name must be 1 to 100 characters")
        String name,

        @Size(max = 30, message = "Phone number must not exceed 30 characters")
        String phoneNumber,

        UserRole role
) {}
