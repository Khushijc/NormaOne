package com.NormaOne.backend.dto.admin;

import java.time.Instant;

import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Tenant details. {@code userCount} and {@code packageInfo} are filled where the endpoint provides them.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TenantResponse(
        String id,
        String tenantName,
        String accountHolderName,
        String subdomain,
        String logoUrl,
        String phoneNumber,
        String emailAddress,
        TenantLocale defaultLocale,
        TenantTimeZone defaultTimeZone,
        String addressLine,
        String city,
        String postalCode,
        CountryCode countryCode,
        TenantStatus status,
        Instant activatedAt,
        Instant suspendedAt,
        String statusReason,
        Instant createdAt,
        Instant updatedAt,
        String packageCode,
        Long userCount,
        TenantPackageResponse packageInfo,
        /** Only on the answer to creating a tenant: how the initial administrator's invitation reached them. */
        InvitationInfo adminInvitation
) {
    public static TenantResponse of(Tenant t, String packageCode, Long userCount, TenantPackageResponse packageInfo) {
        return new TenantResponse(t.getId(), t.getTenantName(), t.getAccountHolderName(), t.getSubdomain(),
                t.getLogoUrl(), t.getPhoneNumber(), t.getEmailAddress(), t.getDefaultLocale(), t.getDefaultTimeZone(),
                t.getAddressLine(), t.getCity(), t.getPostalCode(), t.getCountryCode(), t.getStatus(),
                t.getActivatedAt(), t.getSuspendedAt(), t.getStatusReason(), t.getCreatedAt(), t.getUpdatedAt(),
                packageCode, userCount, packageInfo, null);
    }

    public TenantResponse withAdminInvitation(InvitationInfo info) {
        return new TenantResponse(id, tenantName, accountHolderName, subdomain, logoUrl, phoneNumber, emailAddress,
                defaultLocale, defaultTimeZone, addressLine, city, postalCode, countryCode, status, activatedAt, suspendedAt,
                statusReason, createdAt, updatedAt, packageCode, userCount, packageInfo, info);
    }
}
