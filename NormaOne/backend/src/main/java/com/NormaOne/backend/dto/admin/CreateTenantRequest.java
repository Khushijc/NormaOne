package com.NormaOne.backend.dto.admin;

import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Super Admin creation of an organization. The initial administrator is created as an
 * invitation (status INVITED, no Cognito identity) and becomes ACTIVE when that person
 * registers and verifies the same email.
 */
public record CreateTenantRequest(

        @NotBlank(message = "Organization name is required")
        @Size(max = 100, message = "Organization name must not exceed 100 characters")
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
        String logoUrl,

        @NotNull(message = "The initial tenant administrator is required")
        @Valid
        InitialAdmin initialAdmin
) {
    public record InitialAdmin(
            @NotBlank(message = "Administrator name is required")
            @Size(max = 100, message = "Administrator name must not exceed 100 characters")
            String name,

            @NotBlank(message = "Administrator email is required")
            @Email(message = "Administrator email must be a valid email address")
            @Size(max = 254, message = "Administrator email must not exceed 254 characters")
            String email,

            @Size(max = 30, message = "Phone number must not exceed 30 characters")
            String phoneNumber
    ) {}
}
