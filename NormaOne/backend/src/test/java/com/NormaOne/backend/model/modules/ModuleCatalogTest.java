package com.NormaOne.backend.model.modules;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;

import com.NormaOne.backend.model.plans.enums.ModuleApps;

/**
 * The static module catalog: the six modules, their order and labels, and a permission set whose
 * identifiers, modules and actions agree everywhere they are used.
 */
class ModuleCatalogTest {

    @Test
    void theSixApplicationModulesAreEveryModuleAppExceptThePortal() {
        List<ModuleApps> ids = ModuleCatalog.modules().stream().map(ModuleCatalog.ModuleDefinition::id).toList();
        assertEquals(List.of(ModuleApps.FACTURAFLOW, ModuleApps.JORNADAPULSE, ModuleApps.DATOSPILOT, ModuleApps.PREVENWORK,
                ModuleApps.BUZONDESK, ModuleApps.SAFEVOICE), ids);
        Set<ModuleApps> expected = EnumSet.allOf(ModuleApps.class);
        expected.remove(ModuleApps.NORMAONE);
        assertEquals(expected, new HashSet<>(ids));
        assertFalse(ModuleCatalog.isApplicationModule(ModuleApps.NORMAONE));
        assertTrue(ModuleCatalog.find(ModuleApps.NORMAONE).isEmpty());
    }

    @Test
    void modulesHaveDistinctOrderAndDisplayNames() {
        List<ModuleCatalog.ModuleDefinition> modules = ModuleCatalog.modules();
        assertEquals(List.of(1, 2, 3, 4, 5, 6), modules.stream().map(ModuleCatalog.ModuleDefinition::order).toList());
        for (ModuleCatalog.ModuleDefinition m : modules) {
            assertFalse(m.name().isBlank(), m.id() + " name");
            assertFalse(m.label().isBlank(), m.id() + " label");
            assertFalse(m.description().isBlank(), m.id() + " description");
            assertTrue(m.name().equalsIgnoreCase(m.id().name()), "the display name spells the identifier: " + m.id());
        }
        assertEquals(6, modules.stream().map(ModuleCatalog.ModuleDefinition::label).distinct().count());
    }

    @Test
    void everyPermissionIsNamedAfterItsModuleAndActionAndListedUnderThatModuleOnly() {
        for (ModulePermission p : ModulePermission.values()) {
            assertTrue(ModuleCatalog.isApplicationModule(p.module()), p + " belongs to an application module");
            assertEquals(p.module().name() + "_" + p.action().name(), p.name());
            assertFalse(p.label().isBlank());
            assertFalse(p.description().isBlank());
        }
        Set<ModulePermission> listed = ModuleCatalog.modules().stream().flatMap(m -> m.permissions().stream())
                .collect(Collectors.toSet());
        assertEquals(EnumSet.allOf(ModulePermission.class), listed, "every permission is in the catalog exactly once");
        for (ModuleCatalog.ModuleDefinition m : ModuleCatalog.modules()) {
            assertTrue(m.permissions().stream().allMatch(p -> p.module() == m.id()));
            assertEquals(m.permissions().size(), m.permissions().stream().map(ModulePermission::action).distinct().count(),
                    "one permission per action in " + m.id());
            assertTrue(m.permissions().stream().anyMatch(p -> p.action() == ModuleAction.VIEW), m.id() + " can be opened");
        }
    }

    @Test
    void onlyDocumentedActionsExist() {
        // Actions are not handed out uniformly: issued invoices, working-time records and PRL evidence are
        // never deleted, so PrevenWork's retention erasure is the only DELETE.
        assertEquals(Set.of(ModulePermission.PREVENWORK_DELETE), Arrays.stream(ModulePermission.values())
                .filter(p -> p.action() == ModuleAction.DELETE).collect(Collectors.toSet()));
        // Modules without documented requirements are provisional: open and configure only.
        for (ModuleApps provisional : List.of(ModuleApps.BUZONDESK, ModuleApps.SAFEVOICE)) {
            ModuleCatalog.ModuleDefinition m = ModuleCatalog.find(provisional).orElseThrow();
            assertFalse(m.requirementsDocumented());
            assertEquals(List.of(ModuleAction.VIEW, ModuleAction.MANAGE), m.permissions().stream().map(ModulePermission::action).toList());
        }
        assertEquals(4, ModuleCatalog.modules().stream().filter(ModuleCatalog.ModuleDefinition::requirementsDocumented).count());
    }

    @Test
    void storedValuesFromOlderOrForeignDocumentsGrantNothingExtra() {
        assertEquals(List.of(), ModuleCatalog.storedModules(null));
        assertEquals(List.of(ModuleApps.FACTURAFLOW, ModuleApps.SAFEVOICE),
                ModuleCatalog.storedModules(List.of("SAFEVOICE", "NORMAONE", "LEGACY_APP", "FACTURAFLOW", "facturaflow")));
        assertEquals(EnumSet.of(ModulePermission.FACTURAFLOW_VIEW),
                ModuleCatalog.storedPermissions(Arrays.asList("FACTURAFLOW_VIEW", "INVOICES_ISSUE", null, "USERS_MANAGE")));
        assertTrue(ModuleCatalog.storedPermissions(null).isEmpty());
    }

    @Test
    void assignmentsMustStayInsideAssignedApplicationModules() {
        assertDoesNotThrow(() -> ModuleCatalog.validateAssignment(Set.of(), Set.of()));
        assertDoesNotThrow(() -> ModuleCatalog.validateAssignment(Set.of(ModuleApps.FACTURAFLOW),
                Set.of(ModulePermission.FACTURAFLOW_VIEW, ModulePermission.FACTURAFLOW_EXPORT)));
        // A module without permissions is allowed: visible in the catalog, nothing granted inside it.
        assertDoesNotThrow(() -> ModuleCatalog.validateAssignment(Set.of(ModuleApps.DATOSPILOT), Set.of()));

        IllegalArgumentException portal = assertThrows(IllegalArgumentException.class,
                () -> ModuleCatalog.validateAssignment(Set.of(ModuleApps.NORMAONE), Set.of()));
        assertTrue(portal.getMessage().contains("NORMAONE"));
        IllegalArgumentException outside = assertThrows(IllegalArgumentException.class,
                () -> ModuleCatalog.validateAssignment(Set.of(ModuleApps.FACTURAFLOW), Set.of(ModulePermission.JORNADAPULSE_VIEW)));
        assertTrue(outside.getMessage().contains("JORNADAPULSE_VIEW"));
        assertThrows(IllegalArgumentException.class, () -> ModuleCatalog.validateAssignment(null, Set.of()));
    }

    @Test
    void storedFormIsCanonicallyOrdered() {
        assertEquals(List.of("FACTURAFLOW", "SAFEVOICE"),
                ModuleCatalog.toStoredModules(Set.of(ModuleApps.SAFEVOICE, ModuleApps.NORMAONE, ModuleApps.FACTURAFLOW)));
        assertEquals(List.of("FACTURAFLOW_VIEW", "FACTURAFLOW_EXPORT"),
                ModuleCatalog.toStoredPermissions(Set.of(ModulePermission.FACTURAFLOW_EXPORT, ModulePermission.FACTURAFLOW_VIEW)));
    }
}
