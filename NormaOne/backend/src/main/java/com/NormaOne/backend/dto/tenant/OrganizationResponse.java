package com.NormaOne.backend.dto.tenant;

import java.time.Instant;

import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The caller's own organization, as any of its members may see it (GET /api/organization).
 *
 * Deliberately less than the administrators' TenantResponse: no user count, no package or
 * subscription, no status reason or suspension history. Those are the organization's administration;
 * this is what a member needs to know about where they work.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OrganizationResponse(
        String id,
        String name,
        String subdomain,
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
        TenantStatus status,
        Instant createdAt
) {
    public static OrganizationResponse of(Tenant t) {
        return new OrganizationResponse(t.getId(), t.getTenantName(), t.getSubdomain(), t.getCountryCode(),
                t.getDefaultLocale(), t.getDefaultTimeZone(), t.getAccountHolderName(), t.getEmailAddress(),
                t.getPhoneNumber(), t.getAddressLine(), t.getCity(), t.getPostalCode(), t.getLogoUrl(), t.getStatus(),
                t.getCreatedAt());
    }
}
