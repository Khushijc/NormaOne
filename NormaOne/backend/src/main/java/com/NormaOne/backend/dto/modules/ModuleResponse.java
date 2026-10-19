package com.NormaOne.backend.dto.modules;

import java.util.List;
import java.util.stream.Stream;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.modules.ModuleAction;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;

/**
 * One application module of the static catalog, with the permissions defined for it. {@code label}
 * is the Spanish display name; {@code requirementsDocumented} false marks provisional permissions.
 */
public record ModuleResponse(
        ModuleApps id,
        int order,
        String name,
        String label,
        String description,
        boolean requirementsDocumented,
        List<PermissionInfo> permissions
) {
    /** {@code defaultFor}: the roles that receive this permission by default with a new account. */
    public record PermissionInfo(ModulePermission id, ModuleApps module, ModuleAction action, String label, String description,
            List<UserRole> defaultFor) {

        public static PermissionInfo of(ModulePermission p) {
            List<UserRole> roles = Stream.of(UserRole.ADMIN, UserRole.USER)
                    .filter(role -> ModuleCatalog.defaultPermissionsFor(role).contains(p)).toList();
            return new PermissionInfo(p, p.module(), p.action(), p.label(), p.description(), roles);
        }
    }

    public static ModuleResponse of(ModuleCatalog.ModuleDefinition m) {
        return new ModuleResponse(m.id(), m.order(), m.name(), m.label(), m.description(), m.requirementsDocumented(),
                m.permissions().stream().map(PermissionInfo::of).toList());
    }

    public static List<ModuleResponse> catalogue() {
        return ModuleCatalog.modules().stream().map(ModuleResponse::of).toList();
    }
}
