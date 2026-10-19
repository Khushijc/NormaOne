package com.NormaOne.backend.dto.onboarding;

import java.time.Instant;
import java.util.Set;

import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record TenantOnboardingResponse(
        String tenantId,
        String organizationName,
        String subdomain,
        TenantStatus status,
        CountryCode countryCode,
        TenantLocale defaultLocale,
        TenantTimeZone defaultTimeZone,
        String accountHolderName,
        String emailAddress,
        String phoneNumber,
        String addressLine,
        String city,
        String postalCode,
        String logoUrl,
        String userId,
        String userName,
        String userEmail,
        Set<UserRole> userRoles,
        Instant createdAt,
        String packageCode,
        String subscriptionId,
        SubscriptionStatus subscriptionStatus
) {}
