package com.NormaOne.backend.model.plans.enums;

/**
 * How a tenant's package assignment was created.
 */
public enum SubscriptionSource {
    /** Default package assigned during self-service tenant onboarding. */
    ONBOARDING,
    /** Default package assigned when a Super Admin created the tenant. */
    SUPER_ADMIN,
    /** Default package assigned at startup to a tenant that existed before packages were introduced. */
    BACKFILL
}
