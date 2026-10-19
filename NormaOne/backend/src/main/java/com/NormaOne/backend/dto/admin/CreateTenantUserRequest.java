package com.NormaOne.backend.dto.admin;

import java.util.Set;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Tenant Admin invitation of a user into their own tenant. The tenant is always the caller's
 * own; a tenantId in the body is ignored. role: USER (default) or ADMIN.
 */
public record CreateTenantUserRequest(
        @NotBlank(message = "Name is required")
        @Size(max = 100, message = "Name must not exceed 100 characters")
        String name,

        @NotBlank(message = "Email is required")
        @Email(message = "Email must be a valid email address")
        @Size(max = 254, message = "Email must not exceed 254 characters")
        String email,

        @Size(max = 30, message = "Phone number must not exceed 30 characters")
        String phoneNumber,

        UserRole role,

        /**
         * Optional application modules. When neither this nor {@code modulePermissions} is sent, all six
         * are assigned with the role's default permissions (USER: VIEW; ADMIN: all but DELETE), never
         * more than the inviting administrator holds.
         */
        Set<ModuleApps> moduleAccess,

        /** Optional module permissions, each inside {@code moduleAccess} and held by the inviting administrator. */
        Set<ModulePermission> modulePermissions
) {}
