package com.NormaOne.backend.dto.modules;

import java.util.Set;

import com.NormaOne.backend.model.modules.ModulePermission;

import jakarta.validation.constraints.NotNull;

/**
 * Assigns one module (named in the path) with exactly these permissions; the user's other modules
 * are not touched. Every permission must belong to that module; [] keeps the module assigned with no
 * permission in it. Values outside the catalog are refused with 400.
 */
public record ModulePermissionsRequest(
        @NotNull(message = "permissions is required (it may be an empty list)")
        Set<ModulePermission> permissions
) {}
