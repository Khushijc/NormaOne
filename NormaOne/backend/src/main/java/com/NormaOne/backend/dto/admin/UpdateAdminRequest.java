package com.NormaOne.backend.dto.admin;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * PUT /api/super-admin/admins/{id}: the administrator's editable profile, replaced whole.
 *
 * Only these two fields can change. The email belongs to the Cognito account, the organization is
 * fixed for the life of the record, and permissions have an endpoint of their own — so none of them
 * is here, and sending them changes nothing. A missing or blank phone number clears it.
 */
public record UpdateAdminRequest(

        @NotBlank(message = "Name is required")
        @Size(max = 100, message = "Name must not exceed 100 characters")
        String name,

        @Size(max = 30, message = "Phone number must not exceed 30 characters")
        String phoneNumber
) {}
