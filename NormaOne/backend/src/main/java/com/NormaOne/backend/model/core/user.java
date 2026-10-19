package com.NormaOne.backend.model.core;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.TenantBase;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

@Document(collection = "users")
@CompoundIndexes({
        @CompoundIndex(name = "tenant_user_email_uniq", def = "{'tenantId': 1, 'email': 1}", unique = true),
        @CompoundIndex(name = "tenant_user_status_idx", def = "{'tenantId': 1, 'status': 1}")
})
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class user extends TenantBase {

    // ==================== USER IDENTITY ====================

    @NotBlank
    @Size(max = 100)
    private String name;

    /**
     * Email used for account identification and communication.
     */
    @NotBlank
    @Email
    @Size(max = 254)
    private String email;

    // ==================== AUTHENTICATION LINK ====================

    /**
     * Cognito user subject (sub).
     * Populated when the account is linked to Cognito.
     * Never use email as the permanent identity key.
     * Unique where present (an invited user has no Cognito identity until linked);
     * the index is created by MongoIndexInitializer.
     */
    @Indexed(name = "user_cognito_sub_uniq", unique = true, partialFilter = "{ 'cognitoSub': { '$type': 'string' } }")
    private String cognitoSub;

    // ==================== CONTACT DETAILS ====================

    /**
     * Optional. Collect only if required by a feature.
     */
    @Size(max = 30)
    private String phoneNumber;

    // ==================== ACCESS CONTROL ====================

    @NotNull
    @Builder.Default
    private UserStatus status = UserStatus.INVITED;

    /**
     * Application roles assigned to this user. Authorization uses UserRole.canonical():
     * SUPER_ADMIN (platform scope, no tenantId), ADMIN or USER (tenant scope).
     */
    @NotNull
    @Builder.Default
    private Set<UserRole> roles = new HashSet<>();

    // A former general "permissions" list (ORGANIZATION_VIEW, USERS_MANAGE, …) is no longer part of
    // the model: tenant administration is decided by the ADMIN role. Old documents may still carry
    // the field; it is ignored on read and dropped the next time the record is saved.

    // ==================== MODULE ACCESS ====================

    /**
     * Application modules assigned to this user, by ModuleApps name (ModuleCatalog: never NORMAONE).
     * Missing or empty means none. Whether the tenant's plan must include a module too is decided in
     * one place (ModuleAccessService; not enforced while normaone.modules.enforce-plan-entitlement is false).
     * Stored as names so that an unknown value in an old document grants nothing instead of failing.
     */
    @Builder.Default
    private List<String> moduleAccess = new ArrayList<>();

    /**
     * ModulePermission names granted inside the assigned modules — the only permissions in the
     * system. Missing or empty means none: there is no "all by default" rule.
     */
    @Builder.Default
    private List<String> modulePermissions = new ArrayList<>();

    /**
     * When module access was last assigned: by default at account creation, by the default backfill,
     * or by an administrator. Missing means it was never assigned — the only way to tell that apart
     * from an assignment deliberately emptied, because the two lists above are written as [] on save.
     */
    private Instant moduleAccessAssignedAt;

    // ==================== ACCOUNT LIFECYCLE ====================
    private Instant invitedAt;

    private Instant activatedAt;

    private Instant deactivatedAt;

    private Instant lastLoginAt;

    @Size(max = 500)
    private String statusReason;

    // ==================== PREFERENCES ====================

    /**
     * Whether this person receives email notifications (EmailPreferenceService). Null — every account
     * created before the preference existed, and every new one until it is changed — means enabled:
     * email is opt-out. In-app notifications are never affected.
     */
    private Boolean emailNotificationsEnabled;

}