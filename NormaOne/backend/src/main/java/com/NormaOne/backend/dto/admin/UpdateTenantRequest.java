package com.NormaOne.backend.dto.admin;

import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;

/**
 * Fields a Super Admin may change on a tenant (null = unchanged). Subdomain, status, country
 * and package are not editable here: status has its own endpoint, and changing the subdomain
 * or package needs a dedicated workflow that does not exist yet.
 */
public record UpdateTenantRequest(
        @Size(min = 1, max = 100, message = "Organization name must be 1 to 100 characters")
        String tenantName,

        @Size(min = 1, max = 100, message = "Account holder name must be 1 to 100 characters")
        String accountHolderName,

        @Email(message = "Email must be a valid email address")
        @Size(max = 254, message = "Email must not exceed 254 characters")
        String emailAddress,

        @Size(max = 30, message = "Phone number must not exceed 30 characters")
        String phoneNumber,

        @Size(max = 255, message = "Address line must not exceed 255 characters")
        String addressLine,

        @Size(max = 100, message = "City must not exceed 100 characters")
        String city,

        @Size(max = 20, message = "Postal code must not exceed 20 characters")
        String postalCode,

        @Size(max = 500, message = "Logo URL must not exceed 500 characters")
        String logoUrl,

        TenantLocale defaultLocale,

        TenantTimeZone defaultTimeZone
) {}
