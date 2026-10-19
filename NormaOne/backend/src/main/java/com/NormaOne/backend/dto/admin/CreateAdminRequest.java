package com.NormaOne.backend.dto.admin;

import java.util.Set;

import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * POST /api/super-admin/admins. Invites a tenant administrator into an existing organization.
 *
 * There is no role field: the role is always ADMIN, set by the server. A {@code roles}, {@code role}
 * or former {@code permissions} property in the body is ignored like any other unknown field, so
 * neither SUPER_ADMIN nor a general permission can be requested here. The only permissions are the
 * module permissions below; values outside the catalogue are a 400 naming the allowed ones.
 */
public record CreateAdminRequest(

        @NotBlank(message = "Organization id is required")
        @Size(max = 64, message = "Organization id must not exceed 64 characters")
        String tenantId,

        @NotBlank(message = "Name is required")
        @Size(max = 100, message = "Name must not exceed 100 characters")
        String name,

        @NotBlank(message = "Email is required")
        @Email(message = "Email must be a valid email address")
        @Size(max = 254, message = "Email must not exceed 254 characters")
        String email,

        @Size(max = 30, message = "Phone number must not exceed 30 characters")
        String phoneNumber,

        /**
         * Optional application modules to assign (ModuleCatalog). When neither this nor
         * {@code modulePermissions} is sent, all six are assigned with the ADMIN defaults (every
         * permission except DELETE); an explicit [] assigns none.
         */
        Set<ModuleApps> moduleAccess,

        /** Optional module permissions; each must belong to a module in {@code moduleAccess}. */
        Set<ModulePermission> modulePermissions
) {}
