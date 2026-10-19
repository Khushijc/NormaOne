package com.NormaOne.backend.model.modules;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.plans.enums.ModuleApps;

/**
 * The six NormaOne application modules: the one static, server-side list of them.
 *
 * Identifiers are the existing {@link ModuleApps} values (also used by PlanDefinition.moduleApps).
 * NORMAONE is the portal shell itself, not an application module: it is never assigned to a user
 * and has no permissions. Order and Spanish labels follow the portal's module list
 * (PrevenWork/frontend/src/layout/AppShell.tsx, which the mini-apps share); the BRD titles of the
 * documented modules are in their descriptions.
 *
 * Module access and module permissions are separate on purpose: access says a module is assigned to
 * a user, permissions say what they may do inside it (ModuleAccessService decides when a module is
 * usable). New tenant accounts are assigned all six modules, with the role's default permissions
 * ({@link #defaultPermissionsFor}) — never every permission, except for the owner who registers the
 * organization themselves ({@link #ownerPermissions}).
 */
public final class ModuleCatalog {

    /** One application module. {@code requirementsDocumented} is false when its permissions are provisional. */
    public record ModuleDefinition(
            ModuleApps id,
            int order,
            String name,
            String label,
            String description,
            boolean requirementsDocumented,
            List<ModulePermission> permissions) {}

    private static final List<ModuleDefinition> MODULES = List.of(
            define(ModuleApps.FACTURAFLOW, 1, "FacturaFlow", "Facturación y Cumplimiento",
                    "Sales invoices, rectifications, collections, supplier invoices and expenses, and the accountant handover (BRD: Facturas y Gastos).",
                    true),
            define(ModuleApps.JORNADAPULSE, 2, "JornadaPulse", "Registro de Jornada y Turnos",
                    "Working-time records with breaks, absences, corrections, schedules and period close (BRD: Jornada y Ausencias).",
                    true),
            define(ModuleApps.DATOSPILOT, 3, "DatosPilot", "PRL y Coordinación de Evidencias",
                    "Occupational risk prevention evidence: requirements, documentation, training, PPE, risk register, preventive actions and CAE (BRD: PRL y Documentación).",
                    true),
            define(ModuleApps.PREVENWORK, 4, "PrevenWork", "Privacidad y Operaciones RGPD",
                    "GDPR / LOPDGDD operations: processing activities, data-subject rights, security incidents, suppliers and retention.",
                    true),
            define(ModuleApps.BUZONDESK, 5, "BuzonDesk", "Canal de Denuncias (Ley 2/2023)",
                    "Internal reporting channel under Ley 2/2023. No requirements are documented in this repository yet.",
                    false),
            define(ModuleApps.SAFEVOICE, 6, "SafeVoice", "Comunicaciones y Alertas Pyme",
                    "Company communications and alerts. No requirements are documented in this repository yet.",
                    false));

    private ModuleCatalog() {}

    private static ModuleDefinition define(ModuleApps id, int order, String name, String label, String description,
            boolean documented) {
        List<ModulePermission> permissions = Arrays.stream(ModulePermission.values())
                .filter(p -> p.module() == id)
                .sorted(Comparator.comparing(ModulePermission::action))
                .toList();
        return new ModuleDefinition(id, order, name, label, description, documented, permissions);
    }

    /** The six modules, in display order. */
    public static List<ModuleDefinition> modules() {
        return MODULES;
    }

    /** The six module identifiers, in display order. */
    public static List<ModuleApps> moduleIds() {
        return MODULES.stream().map(ModuleDefinition::id).toList();
    }

    // ==================== default assignment (role policy) ====================

    /**
     * The modules a new account of {@code role} is assigned: all six for a tenant ADMIN or USER, none
     * for anything else (a Super Admin is a platform account and has no tenant modules).
     */
    public static List<ModuleApps> defaultModulesFor(UserRole role) {
        UserRole canonical = role == null ? null : role.canonical();
        return canonical == UserRole.ADMIN || canonical == UserRole.USER ? moduleIds() : List.of();
    }

    /**
     * The module permissions a new account of {@code role} receives in each assigned module — the one
     * place the default policy is written down. Assigning a module never grants all of its permissions:
     * <ul>
     *   <li>ADMIN: every action except DELETE. Destructive actions (PrevenWork's erasure under the
     *       retention rules) are never a default: they are granted explicitly.</li>
     *   <li>USER: VIEW only. No administrative permission is a default for a user; an administrator
     *       grants more where the user's work needs it.</li>
     *   <li>Anyone else, a Super Admin included: none.</li>
     * </ul>
     */
    public static Set<ModulePermission> defaultPermissionsFor(UserRole role) {
        UserRole canonical = role == null ? null : role.canonical();
        Set<ModulePermission> result = EnumSet.noneOf(ModulePermission.class);
        for (ModulePermission p : ModulePermission.values()) {
            if (canonical == UserRole.ADMIN && p.action() != ModuleAction.DELETE
                    || canonical == UserRole.USER && p.action() == ModuleAction.VIEW) {
                result.add(p);
            }
        }
        return result;
    }

    /**
     * Every permission of every module, DELETE included — what the owner who registers an organization
     * themselves (self-service onboarding) receives. They are its first administrator, and an
     * administrator grants only what they hold, so anything withheld from them could never be granted
     * to anyone in the organization. Administrators and users they invite get what they choose, by
     * default the role's defaults.
     */
    public static Set<ModulePermission> ownerPermissions() {
        return EnumSet.allOf(ModulePermission.class);
    }

    public static Optional<ModuleDefinition> find(ModuleApps id) {
        return MODULES.stream().filter(m -> m.id() == id).findFirst();
    }

    /** Whether {@code id} is one of the six application modules (NORMAONE, the portal, is not). */
    public static boolean isApplicationModule(ModuleApps id) {
        return find(id).isPresent();
    }

    /** The application modules among {@code ids}, in catalog order; NORMAONE and nulls are dropped. */
    public static List<ModuleApps> applicationModules(Collection<ModuleApps> ids) {
        if (ids == null) {
            return List.of();
        }
        return MODULES.stream().map(ModuleDefinition::id).filter(ids::contains).toList();
    }

    // ==================== stored values ====================

    /**
     * The modules a stored list names, in catalog order. Unknown names (and NORMAONE) grant nothing,
     * so a document written with a value since removed reads as less access, never more.
     */
    public static List<ModuleApps> storedModules(Collection<String> stored) {
        if (stored == null || stored.isEmpty()) {
            return List.of();
        }
        return MODULES.stream().map(ModuleDefinition::id).filter(id -> stored.contains(id.name())).toList();
    }

    /** The permissions a stored list names, in enum order. Unknown names grant nothing. */
    public static Set<ModulePermission> storedPermissions(Collection<String> stored) {
        Set<ModulePermission> result = EnumSet.noneOf(ModulePermission.class);
        if (stored == null) {
            return result;
        }
        stored.stream().filter(Objects::nonNull).forEach(name -> Arrays.stream(ModulePermission.values())
                .filter(p -> p.name().equals(name))
                .findFirst()
                .ifPresent(result::add));
        return result;
    }

    /**
     * The stored permissions that lie inside the stored modules, in enum order: a permission whose
     * module is no longer assigned grants nothing and is not shown as assigned.
     */
    public static List<ModulePermission> assignedPermissions(Collection<String> storedPermissions, Collection<String> storedModules) {
        List<ModuleApps> modules = storedModules(storedModules);
        return storedPermissions(storedPermissions).stream().filter(p -> modules.contains(p.module())).sorted().toList();
    }

    /**
     * Checks an assignment: only application modules, and every permission inside an assigned module.
     * Empty sets are valid and mean no access. Throws IllegalArgumentException (400) otherwise.
     */
    public static void validateAssignment(Collection<ModuleApps> modules, Collection<ModulePermission> permissions) {
        // anyMatch, not contains(null): immutable collections (Set.of) throw on contains(null).
        if (modules == null || permissions == null || modules.stream().anyMatch(Objects::isNull)
                || permissions.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("modules and permissions are required lists (they may be empty).");
        }
        List<String> notModules = modules.stream().filter(m -> !isApplicationModule(m)).map(Enum::name).toList();
        if (!notModules.isEmpty()) {
            throw new IllegalArgumentException("Not an application module: " + String.join(", ", notModules)
                    + ". Assignable modules: " + String.join(", ", MODULES.stream().map(m -> m.id().name()).toList()) + ".");
        }
        List<String> outside = permissions.stream().filter(p -> !modules.contains(p.module()))
                .map(p -> p.name() + " (module " + p.module() + ")").toList();
        if (!outside.isEmpty()) {
            throw new IllegalArgumentException("These permissions belong to modules that are not assigned: "
                    + String.join(", ", outside) + ".");
        }
    }

    /** How assigned modules are stored: names, in catalog order. */
    public static List<String> toStoredModules(Collection<ModuleApps> modules) {
        return new ArrayList<>(applicationModules(modules).stream().map(Enum::name).toList());
    }

    /** How assigned permissions are stored: names, in enum order. */
    public static List<String> toStoredPermissions(Collection<ModulePermission> permissions) {
        return new ArrayList<>(permissions.stream().filter(Objects::nonNull).distinct().sorted().map(Enum::name).toList());
    }
}
