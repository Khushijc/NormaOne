package com.NormaOne.backend.dto.modules;

import java.time.Instant;
import java.util.List;

import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.services.ModuleAccessService;

/**
 * A user's module access, for the administrators who manage it.
 *
 * {@code modules} lists all six modules — assigned or not — each with its own permissions, so a
 * screen can show and edit them module by module. The flat fields say the same thing in lists:
 * {@code assigned*} is what is stored on the user; {@code entitledModules} is what the current
 * entitlement policy allows (all six while {@code planEnforced} is false); {@code planModules} only
 * reports what the organization's plan lists; {@code effective*} is what the user can use now
 * (assigned AND entitled AND an active ADMIN or USER). {@code assignedAt} is when the assignment was
 * last made (null: never).
 */
public record ModuleAccessResponse(
        String userId,
        boolean active,
        boolean planEnforced,
        Instant assignedAt,
        List<ModuleAssignmentView> modules,
        List<ModuleApps> assignedModules,
        List<ModulePermission> assignedPermissions,
        List<ModuleApps> entitledModules,
        List<ModuleApps> planModules,
        List<ModuleApps> effectiveModules,
        List<ModulePermission> effectivePermissions
) {
    public static ModuleAccessResponse of(String userId, Instant assignedAt, ModuleAccessService.ModuleAccess access) {
        return new ModuleAccessResponse(userId, access.active(), access.planEnforced(), assignedAt,
                ModuleAssignmentView.of(access),
                access.assignedModules(), access.assignedPermissions().stream().sorted().toList(),
                access.entitledModules(), access.planModules(), access.effectiveModules(),
                access.effectivePermissions().stream().sorted().toList());
    }
}
