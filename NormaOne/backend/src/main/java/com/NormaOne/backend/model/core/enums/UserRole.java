package com.NormaOne.backend.model.core.enums;

/**
 * Application roles stored on a user record.
 *
 * Authorization uses three canonical roles: SUPER_ADMIN (platform scope), ADMIN and USER
 * (tenant scope). The remaining values were defined before the canonical model and are kept so
 * existing documents still deserialize; they are mapped with {@link #canonical()}.
 */
public enum UserRole {

    /** Platform administrator. Never assignable through public or tenant APIs. */
    SUPER_ADMIN,

    /** Administrator of one tenant. */
    ADMIN,

    /** Ordinary member of one tenant. */
    USER,

    /** Legacy name of SUPER_ADMIN. */
    PLATFORM_ADMIN,

    /** Legacy name of ADMIN, written by onboarding before the canonical model. */
    TENANT_ADMIN,

    /** Legacy tenant-level roles, treated as USER. */
    HR_MANAGER,
    FINANCE_MANAGER,
    COMPLIANCE_MANAGER,
    EMPLOYEE;

    /** The canonical role used for authorization. */
    public UserRole canonical() {
        return switch (this) {
            case SUPER_ADMIN, PLATFORM_ADMIN -> SUPER_ADMIN;
            case ADMIN, TENANT_ADMIN -> ADMIN;
            case USER, HR_MANAGER, FINANCE_MANAGER, COMPLIANCE_MANAGER, EMPLOYEE -> USER;
        };
    }

    /** True for roles that grant platform-wide administration. */
    public boolean isPlatformRole() {
        return canonical() == SUPER_ADMIN;
    }
}
