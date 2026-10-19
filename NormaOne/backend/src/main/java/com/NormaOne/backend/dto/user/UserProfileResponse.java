package com.NormaOne.backend.dto.user;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserProfileResponse(
        String userId,
        String cognitoSub,
        String name,
        String email,
        String phoneNumber,
        UserStatus status,
        Set<UserRole> roles,
        String tenantId,
        String organizationName,
        String subdomain,
        boolean requiresTenantSetup,
        Instant createdAt,
        /** NOT_STARTED, IN_PROGRESS, COMPLETED or PLATFORM_ACCOUNT (see OnboardingStatusResponse). */
        String onboardingStatus,
        /** NONE, TENANT or PLATFORM. */
        String accountType,
        /** Canonical role the account can act with now: SUPER_ADMIN, ADMIN, USER or null. */
        UserRole effectiveRole,
        TenantStatus tenantStatus,
        /**
         * The modules the account can use now, by id, in catalog order: assigned, entitled (every module
         * while plan entitlement is not enforced) and the account active. This is what navigation should
         * show. Empty for a Super Admin (no organization), an inactive account and before onboarding.
         * The per-module detail is on the administrators' module routes (ModuleAccessResponse).
         */
        List<ModuleApps> modules,
        /** Every module permission the account can use now, across modules (the backend enforces these). */
        List<ModulePermission> modulePermissions
) {}
