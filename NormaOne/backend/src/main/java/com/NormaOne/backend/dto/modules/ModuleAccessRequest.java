package com.NormaOne.backend.dto.modules;

import java.util.Set;

import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;

import jakarta.validation.constraints.NotNull;

/**
 * Replaces a user's module assignment. Both lists are required and may be empty (no module access).
 * Only the six application modules can be assigned, and every permission must belong to an assigned
 * module; values outside the catalog are refused with 400 naming the allowed ones.
 */
public record ModuleAccessRequest(
        @NotNull(message = "modules is required (it may be an empty list)")
        Set<ModuleApps> modules,

        @NotNull(message = "permissions is required (it may be an empty list)")
        Set<ModulePermission> permissions
) {}
