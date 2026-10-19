package com.NormaOne.backend.model.modules;

/**
 * The kinds of action a module permission grants. A module defines only the actions its documented
 * requirements support (see {@link ModulePermission}); no module has all of them by default.
 */
public enum ModuleAction {
    /** Open the module and read its records. */
    VIEW,
    /** Register new records. */
    CREATE,
    /** Change existing records, within the module's own rules (e.g. issued invoices are rectified, not edited). */
    EDIT,
    /** Remove or erase records, where the module allows it at all. */
    DELETE,
    /** Review, approve or decide (a segregation-of-duties step distinct from editing). */
    APPROVE,
    /** Export reports or data out of the module. */
    EXPORT,
    /** Configure the module and see its audit trail. */
    MANAGE
}
