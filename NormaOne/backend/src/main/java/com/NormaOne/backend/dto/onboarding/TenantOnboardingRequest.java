package com.NormaOne.backend.dto.onboarding;

import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.fasterxml.jackson.annotation.JsonAlias;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record TenantOnboardingRequest(

        @NotBlank(message = "Organization name is required")
        @Size(max = 100, message = "Organization name must not exceed 100 characters")
        @JsonAlias({"name", "tenantName"})
        String organizationName,

        @NotBlank(message = "Subdomain is required")
        @Size(min = 2, max = 50, message = "Subdomain must be between 2 and 50 characters")
        @Pattern(
                regexp = "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$",
                message = "Subdomain must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen"
        )
        String subdomain,

        @NotNull(message = "Country code is required")
        CountryCode countryCode,

        TenantLocale defaultLocale,

        TenantTimeZone defaultTimeZone,

        @Size(max = 100, message = "Account holder name must not exceed 100 characters")
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
        String logoUrl
) {}
