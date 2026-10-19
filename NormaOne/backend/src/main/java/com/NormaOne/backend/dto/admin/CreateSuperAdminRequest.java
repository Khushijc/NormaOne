package com.NormaOne.backend.dto.admin;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * POST /api/super-admin/super-admins. Invites another platform Super Admin.
 *
 * There is no role, tenant or permission field: the server always creates a platform account (no
 * tenant) with the SUPER_ADMIN role, and anything else in the body is ignored like any unknown field.
 * No password is accepted either: Cognito generates and emails a temporary one.
 */
public record CreateSuperAdminRequest(

        @NotBlank(message = "Name is required")
        @Size(max = 100, message = "Name must not exceed 100 characters")
        String name,

        @NotBlank(message = "Email is required")
        @Email(message = "Email must be a valid email address")
        @Size(max = 254, message = "Email must not exceed 254 characters")
        String email,

        @Size(max = 30, message = "Phone number must not exceed 30 characters")
        String phoneNumber
) {}
