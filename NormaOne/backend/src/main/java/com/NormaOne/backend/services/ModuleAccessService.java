package com.NormaOne.backend.services;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.NormaOne.backend.repositories.PlanDefinitionRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * What a member may do in the application modules, decided on the server from stored data only.
 * Module permissions are the only permissions involved: no role-level or general permission list
 * opens a module.
 *
 * A module permission is effective when ALL of these hold:
 * <ol>
 *   <li>the caller acts as ADMIN or USER of an ACTIVE tenant (a Super Admin belongs to no tenant and
 *       has no module access; an inactive account, or one whose organization is not ACTIVE, has none);</li>
 *   <li>the module is in the user's {@code moduleAccess};</li>
 *   <li>the permission is in the user's {@code modulePermissions};</li>
 *   <li>the module is entitled — see {@link #entitledModules}. PLAN ENTITLEMENT IS NOT ENFORCED FOR
 *       NOW ({@code normaone.modules.enforce-plan-entitlement=false}): every module is entitled, so a
 *       BASIC plan never blocks an assigned module. The plan's own modules are still reported
 *       ({@link #planModules}). Turning the property on restores plan enforcement here, and so for
 *       every caller, without touching anything else.</li>
 * </ol>
 * The role grants nothing by itself: an ADMIN with no module assignment has no module access. The
 * frontend may hide what is not effective, but endpoints must call {@link #requireModulePermission}
 * — hiding a button is not access control.
 */
@Service
public class ModuleAccessService {

    /** Subscription states that keep a plan's modules available. Any other state, or none, makes them unavailable. */
    static final Set<SubscriptionStatus> ENTITLING = EnumSet.of(SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE);

    private final PackageService packageService;
    private final PlanDefinitionRepository planRepository;
    private final CurrentUserService currentUserService;
    private final NormaOneProperties properties;

    public ModuleAccessService(PackageService packageService, PlanDefinitionRepository planRepository,
            CurrentUserService currentUserService, NormaOneProperties properties) {
        this.packageService = packageService;
        this.planRepository = planRepository;
        this.currentUserService = currentUserService;
        this.properties = properties;
    }

    /**
     * A user's module access: what is assigned, what is entitled under the current policy, what the
     * plan lists (informational), and what is effective given the role they act with now.
     */
    public record ModuleAccess(
            /** Whether the account acts as an ADMIN or USER of an ACTIVE tenant right now. */
            boolean active,
            /** Whether plan entitlement is enforced (normaone.modules.enforce-plan-entitlement). */
            boolean planEnforced,
            List<ModuleApps> assignedModules,
            Set<ModulePermission> assignedPermissions,
            /** Modules usable under the current entitlement policy: all six while the plan is not enforced. */
            List<ModuleApps> entitledModules,
            /** Modules the organization's current plan lists — reported, enforced only when planEnforced. */
            List<ModuleApps> planModules,
            List<ModuleApps> effectiveModules,
            Set<ModulePermission> effectivePermissions) {

        public static ModuleAccess none(boolean planEnforced) {
            return new ModuleAccess(false, planEnforced, List.of(), EnumSet.noneOf(ModulePermission.class), List.of(), List.of(),
                    List.of(), EnumSet.noneOf(ModulePermission.class));
        }

        /** The assigned permissions that belong to {@code module}, in enum order. */
        public List<ModulePermission> assignedIn(ModuleApps module) {
            return assignedPermissions.stream().filter(p -> p.module() == module).sorted().toList();
        }

        /** The effective permissions that belong to {@code module}, in enum order. */
        public List<ModulePermission> effectiveIn(ModuleApps module) {
            return effectivePermissions.stream().filter(p -> p.module() == module).sorted().toList();
        }
    }

    /** Whether a module must also be in the organization's plan to be usable. Read here and nowhere else. */
    public boolean planEnforced() {
        return properties.getModules().isEnforcePlanEntitlement();
    }

    /**
     * The modules a tenant account may use under the current entitlement policy: all six while plan
     * entitlement is not enforced; otherwise the plan's modules. None for a platform account.
     */
    public List<ModuleApps> entitledModules(String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            return List.of();
        }
        return planEnforced() ? planModules(tenantId) : ModuleCatalog.moduleIds();
    }

    /** The application modules a tenant's current plan lists; none without a TRIAL or ACTIVE subscription. */
    public List<ModuleApps> planModules(String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            return List.of();
        }
        TenantSubscription subscription = packageService.currentSubscription(tenantId).orElse(null);
        if (subscription == null || !ENTITLING.contains(subscription.getStatus())) {
            return List.of();
        }
        PlanDefinition plan = planRepository.findById(subscription.getPlanDocsId()).orElse(null);
        return plan == null ? List.of() : ModuleCatalog.applicationModules(plan.getModuleApps());
    }

    /** {@code role} is the role the user acts with now (CurrentUserResolver.effectiveRole), or null. */
    public ModuleAccess accessOf(user u, UserRole role) {
        boolean enforced = planEnforced();
        if (u == null) {
            return ModuleAccess.none(enforced);
        }
        List<ModuleApps> assigned = ModuleCatalog.storedModules(u.getModuleAccess());
        // A permission counts only inside an assigned module, so a stored permission whose module was
        // revoked is neither shown as assigned nor effective.
        Set<ModulePermission> assignedPermissions = EnumSet.noneOf(ModulePermission.class);
        ModuleCatalog.storedPermissions(u.getModulePermissions()).stream()
                .filter(p -> assigned.contains(p.module())).forEach(assignedPermissions::add);
        boolean member = role == UserRole.ADMIN || role == UserRole.USER;
        List<ModuleApps> plan = planModules(u.getTenantId());
        List<ModuleApps> entitled = enforced ? plan : entitledModules(u.getTenantId());
        List<ModuleApps> effective = member ? assigned.stream().filter(entitled::contains).toList() : List.of();
        Set<ModulePermission> effectivePermissions = EnumSet.noneOf(ModulePermission.class);
        assignedPermissions.stream().filter(p -> effective.contains(p.module())).forEach(effectivePermissions::add);
        return new ModuleAccess(member, enforced, assigned, assignedPermissions, entitled, plan, effective, effectivePermissions);
    }

    /**
     * The caller, when they may perform {@code permission} right now; 403 otherwise. Every module
     * endpoint should call this rather than rely on the frontend showing or hiding the module.
     */
    public CurrentUser requireModulePermission(Jwt jwt, ModulePermission permission) {
        CurrentUser current = currentUserService.requireTenantMember(jwt);
        if (!accessOf(current.user(), current.role()).effectivePermissions().contains(permission)) {
            throw new AccessDeniedException("This operation requires the " + permission.name() + " module permission.");
        }
        return current;
    }
}
