package com.NormaOne.backend.model.plans.enums;

/**
 * What a plan history entry records (PlanHistoryEntry). Plan events concern a plan definition; tenant
 * events concern one organization's plan. Renewals, cancellations and expiries are not listed: no
 * workflow performs them yet (there is no billing integration).
 */
public enum PlanHistoryEventType {
    /** A plan, or a new version of a plan code, was created (as DRAFT). */
    PLAN_CREATED,
    /** A plan's details changed; {@code changes} lists each field with its previous and new value. */
    PLAN_UPDATED,
    /** A plan was activated, deactivated or archived; {@code status} is the new status. */
    PLAN_STATUS_CHANGED,
    /** An organization was moved to another plan (by a Super Admin directly, or by an approved request). */
    TENANT_PLAN_CHANGED,
    /** A Tenant Admin asked for their organization to move to another plan. */
    PLAN_CHANGE_REQUESTED,
    /** A Super Admin approved a request; the change itself is the TENANT_PLAN_CHANGED entry with the same correlation id. */
    PLAN_CHANGE_APPROVED,
    /** A Super Admin rejected a request. */
    PLAN_CHANGE_REJECTED,
    /** A Tenant Admin withdrew a pending request. */
    PLAN_CHANGE_CANCELLED
}
