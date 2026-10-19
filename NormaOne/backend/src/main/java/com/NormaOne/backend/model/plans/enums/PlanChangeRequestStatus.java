package com.NormaOne.backend.model.plans.enums;

/** The lifecycle of a Tenant Admin's plan-change request (PlanChangeRequest). */
public enum PlanChangeRequestStatus {
    /** Waiting for a Super Admin. At most one open request per organization. */
    PENDING,
    /** A Super Admin's approval is being applied; becomes APPROVED, or PENDING again if applying fails. */
    PROCESSING,
    /** Approved and applied: the organization is on the requested plan. */
    APPROVED,
    /** Refused by a Super Admin. */
    REJECTED,
    /** Withdrawn by a Tenant Admin of the organization. */
    CANCELLED
}
