package com.NormaOne.backend.dto.modules;

import java.util.List;

import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.services.ModuleAccessService;

/**
 * One module of a user's access, with the permissions that belong to that module only.
 *
 * {@code permissions} is what is assigned to the user in this module (stored). {@code entitled} says
 * whether the module is usable under the current entitlement policy — always true while plan
 * entitlement is not enforced. {@code available} is assigned AND entitled AND the account active —
 * whether the module can be used now; {@code effectivePermissions} is what the backend will allow in
 * it now (empty unless available). {@code inPlan} only reports whether the organization's current
 * plan lists the module; it blocks nothing while the plan is not enforced. Navigation should use
 * {@code available}; the backend enforces {@code effectivePermissions} whatever the client shows.
 */
public record ModuleAssignmentView(
        ModuleApps moduleId,
        String moduleName,
        String label,
        int order,
        boolean assigned,
        boolean entitled,
        boolean available,
        boolean inPlan,
        List<ModulePermission> permissions,
        List<ModulePermission> effectivePermissions
) {
    /** All six modules of {@code access}, assigned or not (to show what can be assigned). */
    public static List<ModuleAssignmentView> of(ModuleAccessService.ModuleAccess access) {
        return ModuleCatalog.modules().stream()
                .map(m -> {
                    boolean assigned = access.assignedModules().contains(m.id());
                    boolean entitled = access.entitledModules().contains(m.id());
                    return new ModuleAssignmentView(m.id(), m.name(), m.label(), m.order(), assigned, entitled,
                            assigned && entitled && access.active(), access.planModules().contains(m.id()),
                            access.assignedIn(m.id()), access.effectiveIn(m.id()));
                })
                .toList();
    }
}
