package com.NormaOne.backend.dto.onboarding;

import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Onboarding state of the authenticated caller.
 *
 * onboardingStatus: NOT_STARTED (no organization yet: show the onboarding step), IN_PROGRESS
 * (organization still provisioning), COMPLETED, or PLATFORM_ACCOUNT (Super Admin; no organization).
 * accountType: NONE, TENANT or PLATFORM. role is the canonical role the account can act with now
 * (null when inactive, not onboarded, or the organization is not ACTIVE).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OnboardingStatusResponse(
        boolean onboardingCompleted,
        String onboardingStatus,
        boolean requiresTenantSetup,
        String accountType,
        UserStatus userStatus,
        String role,
        String tenantId,
        TenantStatus tenantStatus,
        String packageCode,
        SubscriptionStatus subscriptionStatus
) {
    public static final String NOT_STARTED = "NOT_STARTED";
    public static final String IN_PROGRESS = "IN_PROGRESS";
    public static final String COMPLETED = "COMPLETED";
    public static final String PLATFORM_ACCOUNT = "PLATFORM_ACCOUNT";
}
