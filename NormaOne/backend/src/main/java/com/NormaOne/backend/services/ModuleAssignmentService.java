package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.Collection;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.modules.ModuleAccessResponse;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserResolver;

/**
 * Writes users' module assignments — the only place that does — for both who may manage them:
 * a Super Admin (tenant administrators, unrestricted) and a Tenant Admin (users of their own tenant,
 * within their own scope). Callers have already checked the role, the tenant and the target.
 *
 * <ul>
 *   <li><b>Defaults at creation</b> ({@link #applyDefaults}): all six modules, with the role's default
 *       permissions (ModuleCatalog.defaultPermissionsFor), capped by the granting administrator's own
 *       permissions when one grants them. The owner who registers the organization themselves gets
 *       every permission ({@link #applyOwnerDefaults}). Platform accounts get nothing.</li>
 *   <li><b>Validation</b>: only the six application modules; every permission inside an assigned
 *       module (ModuleCatalog.validateAssignment). Values outside the catalog never reach here — the
 *       request DTOs carry enums, which Jackson refuses with 400.</li>
 *   <li><b>Scope</b>: with a scope (a Tenant Admin), every permission added <i>or removed</i> must be
 *       one the granter holds, so nobody hands out — or strips — what they were not given. Modules
 *       themselves grant nothing and may be assigned or revoked freely.</li>
 *   <li><b>Stored</b> as names in catalog order (no duplicates, whatever the request repeats), with
 *       {@code moduleAccessAssignedAt}; every change is audited as USER_MODULE_ACCESS_CHANGED.</li>
 * </ul>
 * Authorization reads the stored record on every request, so a revocation applies to the next one.
 */
@Service
public class ModuleAssignmentService {

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final ModuleAccessService moduleAccessService;
    private final AuditService auditService;

    public ModuleAssignmentService(UserRepository userRepository, TenantRepository tenantRepository,
            ModuleAccessService moduleAccessService, AuditService auditService) {
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.moduleAccessService = moduleAccessService;
        this.auditService = auditService;
    }

    // ==================== at creation (no save) ====================

    /**
     * Gives a record being created the default assignment of {@code role}: all six modules (none for
     * a platform account) and the role's default permissions, never more than {@code scope} when a
     * granting administrator's scope applies (null: no cap).
     */
    public static void applyDefaults(user target, UserRole role, Set<ModulePermission> scope) {
        List<ModuleApps> modules = ModuleCatalog.defaultModulesFor(role);
        Set<ModulePermission> permissions = EnumSet.noneOf(ModulePermission.class);
        ModuleCatalog.defaultPermissionsFor(role).stream()
                .filter(p -> modules.contains(p.module()))
                .filter(p -> scope == null || scope.contains(p))
                .forEach(permissions::add);
        store(target, modules, permissions);
    }

    /**
     * Gives the owner who registers their own organization (self-service onboarding) all six modules
     * with every permission (ModuleCatalog.ownerPermissions).
     */
    public static void applyOwnerDefaults(user target) {
        store(target, ModuleCatalog.defaultModulesFor(UserRole.ADMIN), ModuleCatalog.ownerPermissions());
    }

    /**
     * Gives a record being created an explicit assignment (a create request that names its modules),
     * validated and kept within {@code scope} (null: no cap).
     */
    public static void applyExplicit(user target, Collection<ModuleApps> modules, Collection<ModulePermission> permissions,
            Set<ModulePermission> scope) {
        ModuleCatalog.validateAssignment(modules, permissions);
        requireWithinScope(permissions, scope);
        store(target, modules, permissions);
    }

    /**
     * After a role change, the permissions start again from the new role's defaults — so a demoted
     * administrator keeps none of their administrative module permissions — inside the modules already
     * assigned (all six if none ever were), and within {@code scope}.
     */
    public static void resetForRole(user target, UserRole role, Set<ModulePermission> scope) {
        List<ModuleApps> modules = target.getModuleAccessAssignedAt() != null
                ? ModuleCatalog.storedModules(target.getModuleAccess())
                : ModuleCatalog.defaultModulesFor(role);
        Set<ModulePermission> permissions = EnumSet.noneOf(ModulePermission.class);
        ModuleCatalog.defaultPermissionsFor(role).stream()
                .filter(p -> modules.contains(p.module()))
                .filter(p -> scope == null || scope.contains(p))
                .forEach(permissions::add);
        store(target, modules, permissions);
    }

    // ==================== reading ====================

    /** The target's assignment, plan entitlement and effective access, module by module. */
    public ModuleAccessResponse describe(user target) {
        Tenant tenant = target.getTenantId() == null ? null : tenantRepository.findById(target.getTenantId()).orElse(null);
        UserRole role = CurrentUserResolver.effectiveRole(target, tenant);
        return ModuleAccessResponse.of(target.getId(), target.getModuleAccessAssignedAt(), moduleAccessService.accessOf(target, role));
    }

    // ==================== changes (saved and audited) ====================

    /** Replaces the whole assignment. */
    public ModuleAccessResponse replace(CurrentUser actor, user target, Collection<ModuleApps> modules,
            Collection<ModulePermission> permissions, Set<ModulePermission> scope) {
        ModuleCatalog.validateAssignment(modules, permissions);
        return save(actor, target, modules, permissions, scope);
    }

    /** Assigns one module with exactly {@code permissions}; the other modules stay as they are. */
    public ModuleAccessResponse setModule(CurrentUser actor, user target, ModuleApps module,
            Collection<ModulePermission> permissions, Set<ModulePermission> scope) {
        Set<ModuleApps> modules = new LinkedHashSet<>(ModuleCatalog.storedModules(target.getModuleAccess()));
        modules.add(module);
        ModuleCatalog.validateAssignment(Set.of(module), permissions);
        Set<ModulePermission> all = EnumSet.noneOf(ModulePermission.class);
        ModuleCatalog.assignedPermissions(target.getModulePermissions(), target.getModuleAccess()).stream()
                .filter(p -> p.module() != module).forEach(all::add);
        all.addAll(permissions);
        return save(actor, target, modules, all, scope);
    }

    /** Revokes one module and every permission in it. */
    public ModuleAccessResponse revokeModule(CurrentUser actor, user target, ModuleApps module, Set<ModulePermission> scope) {
        ModuleCatalog.validateAssignment(Set.of(module), Set.of());
        Set<ModuleApps> modules = new LinkedHashSet<>(ModuleCatalog.storedModules(target.getModuleAccess()));
        modules.remove(module);
        Set<ModulePermission> remaining = EnumSet.noneOf(ModulePermission.class);
        ModuleCatalog.assignedPermissions(target.getModulePermissions(), target.getModuleAccess()).stream()
                .filter(p -> p.module() != module).forEach(remaining::add);
        return save(actor, target, modules, remaining, scope);
    }

    // ==================== helpers ====================

    private ModuleAccessResponse save(CurrentUser actor, user target, Collection<ModuleApps> modules,
            Collection<ModulePermission> permissions, Set<ModulePermission> scope) {
        List<String> beforeModules = ModuleCatalog.toStoredModules(ModuleCatalog.storedModules(target.getModuleAccess()));
        List<ModulePermission> before = ModuleCatalog.assignedPermissions(target.getModulePermissions(), target.getModuleAccess());
        List<String> afterModules = ModuleCatalog.toStoredModules(modules);
        List<String> afterPermissions = ModuleCatalog.toStoredPermissions(permissions);

        Set<ModulePermission> changed = EnumSet.noneOf(ModulePermission.class);
        permissions.stream().filter(p -> !before.contains(p)).forEach(changed::add);
        before.stream().filter(p -> !permissions.contains(p)).forEach(changed::add);
        requireWithinScope(changed, scope);

        if (afterModules.equals(beforeModules) && afterPermissions.equals(ModuleCatalog.toStoredPermissions(before))
                && target.getModuleAccessAssignedAt() != null) {
            return describe(target);
        }
        store(target, modules, permissions);
        user saved = userRepository.save(target);
        auditService.record(actor, AuditAction.USER_MODULE_ACCESS_CHANGED, saved.getTenantId(), "USER", saved.getId(),
                AuditService.details("modulesFrom", String.join(",", beforeModules), "modulesTo", String.join(",", afterModules),
                        "permissionsFrom", String.join(",", ModuleCatalog.toStoredPermissions(before)),
                        "permissionsTo", String.join(",", afterPermissions),
                        "by", actor != null && actor.role() != null ? actor.role().name() : "SYSTEM"));
        return describe(saved);
    }

    private static void store(user target, Collection<ModuleApps> modules, Collection<ModulePermission> permissions) {
        target.setModuleAccess(ModuleCatalog.toStoredModules(modules));
        target.setModulePermissions(ModuleCatalog.toStoredPermissions(permissions));
        target.setModuleAccessAssignedAt(Instant.now());
    }

    private static void requireWithinScope(Collection<ModulePermission> permissions, Set<ModulePermission> scope) {
        if (scope == null) {
            return;
        }
        List<String> outside = permissions.stream().filter(p -> !scope.contains(p)).sorted().map(Enum::name).toList();
        if (!outside.isEmpty()) {
            throw new ForbiddenOperationException("You can only grant or remove module permissions you hold yourself. Not yours: "
                    + String.join(", ", outside) + ".");
        }
    }
}
