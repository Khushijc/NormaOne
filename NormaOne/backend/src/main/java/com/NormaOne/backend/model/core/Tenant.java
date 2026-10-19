package com.NormaOne.backend.model.core;

import java.time.Instant;

import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.AuditedDocument;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.NormaOne.backend.model.core.enums.TenantStatus;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

@Document(collection = "tenants")
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class Tenant extends AuditedDocument {

    @NotBlank
    private String tenantName;

    @NotBlank
    private String accountHolderName;

    @Indexed(unique = true)
    @NotBlank
    private String subdomain;

    private String logoUrl;

    private String phoneNumber;

    private String emailAddress;

    @NotNull
    private TenantLocale defaultLocale;

    @NotNull
    private TenantTimeZone defaultTimeZone;

    private String addressLine;

    private String city;

    private String postalCode;

    @NotNull
    private CountryCode countryCode;
    @NotNull
    @Builder.Default
    private TenantStatus status = TenantStatus.PROVISIONING;

    private Instant activatedAt;

    private Instant suspendedAt;

    private String statusReason;

    /**
     * Cognito subject of the user who started self-service onboarding (internal; never exposed).
     * Lets an abandoned PROVISIONING tenant be recovered by the same user's retry.
     */
    @Indexed(name = "tenant_onboarded_by_idx", sparse = true)
    private String onboardedByCognitoSub;
}
