package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.admin.AdminResponse;
import com.NormaOne.backend.dto.admin.AuditEventResponse;
import com.NormaOne.backend.dto.admin.CreateAdminRequest;
import com.NormaOne.backend.dto.admin.InvitationInfo;
import com.NormaOne.backend.dto.admin.PlatformUserResponse;
import com.NormaOne.backend.dto.admin.UpdateAdminRequest;
import com.NormaOne.backend.dto.admin.UserStatusRequest;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.modules.ModuleAccessRequest;
import com.NormaOne.backend.dto.modules.ModuleAccessResponse;
import com.NormaOne.backend.dto.modules.ModulePermissionsRequest;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.InvitationDeliveryException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * The Super Admin's view of accounts: tenant administrators (managed) and regular users (read only),
 * plus the audit trail.
 *
 * WHO COUNTS AS WHAT is decided by {@link UserAdministration#adminScope()} and
 * {@link UserAdministration#regularUserScope()} — server-side, from the stored roles. An id that
 * belongs to the other kind answers 404 here, so an administrator endpoint can never be pointed at a
 * regular user (or a Super Admin) to change it.
 *
 * REGULAR USERS ARE READ ONLY. This class has no method that writes a regular user, and the
 * controller has no route that could reach one. Their profile, role and status belong to their
 * organization's administrators (TenantAdminService).
 *
 * ADMINISTRATORS ARE INVITATIONS, as everywhere else in NormaOne. Creating one writes an INVITED
 * record, then Cognito creates the account and emails a temporary password (CognitoInvitationService);
 * if Cognito refuses, the record is removed again. The record is linked and made ACTIVE at the
 * person's first authenticated request after they set a permanent password (AccountLinkService).
 *
 * Every method re-checks SUPER_ADMIN against the database before doing anything, on top of the HTTP
 * rule and @PreAuthorize on the controller.
 */
@Service
public class SuperAdminAccountService {

    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final UserAdministration userAdministration;
    private final AuditService auditService;
    private final MongoTemplate mongoTemplate;
    private final CognitoInvitationService cognitoInvitations;
    private final ModuleAssignmentService moduleAssignments;
    private final CognitoAccountAccessService cognitoAccess;

    public SuperAdminAccountService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            TenantRepository tenantRepository,
            UserAdministration userAdministration,
            AuditService auditService,
            MongoTemplate mongoTemplate,
            CognitoInvitationService cognitoInvitations,
            ModuleAssignmentService moduleAssignments,
            CognitoAccountAccessService cognitoAccess) {
        this.cognitoAccess = cognitoAccess;
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.userAdministration = userAdministration;
        this.auditService = auditService;
        this.mongoTemplate = mongoTemplate;
        this.cognitoInvitations = cognitoInvitations;
        this.moduleAssignments = moduleAssignments;
    }

    // ==================== ADMINISTRATORS ====================

    public PageResponse<AdminResponse> listAdmins(Jwt jwt, String search, String tenantId, UserStatus status, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        UserAdministration.UserPage found = userAdministration.findPage(UserAdministration.adminScope(),
                blankToNull(tenantId), search, status, page, size);
        Map<String, Tenant> tenants = tenantsOf(found.users());
        return PageResponse.of(found.users().stream().map(u -> AdminResponse.of(u, tenants.get(u.getTenantId()))).toList(),
                found.page(), found.size(), found.total());
    }

    public AdminResponse getAdmin(Jwt jwt, String adminId) {
        currentUserService.requireSuperAdmin(jwt);
        user admin = findAdmin(adminId);
        return AdminResponse.of(admin, tenantOf(admin));
    }

    /**
     * Invites an administrator into an existing, ACTIVE organization.
     *
     * Refused when the organization does not exist (404) or is not ACTIVE (409 — an invitation into
     * one could never be linked), when the email already has a record in that organization (409),
     * and when it already belongs to a live account anywhere else (409): one Cognito account is one
     * organization's member, and two pending invitations for one email would make linking ambiguous.
     */
    public AdminResponse createAdmin(Jwt jwt, CreateAdminRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        Tenant tenant = tenantRepository.findById(request.tenantId().trim())
                .orElseThrow(() -> new ResourceNotFoundException("Organization not found."));
        if (tenant.getStatus() != TenantStatus.ACTIVE) {
            throw new ConflictException("Administrators can only be invited into an ACTIVE organization; this one is "
                    + tenant.getStatus() + ".");
        }
        // Modules: all six with the ADMIN defaults unless the request names them; a named assignment is
        // validated (a missing half is an empty list) before anything is written.
        boolean explicitModules = request.moduleAccess() != null || request.modulePermissions() != null;
        Set<ModuleApps> modules = request.moduleAccess() == null ? Set.of() : request.moduleAccess();
        Set<ModulePermission> modulePermissions = request.modulePermissions() == null ? Set.of() : request.modulePermissions();
        if (explicitModules) {
            ModuleCatalog.validateAssignment(modules, modulePermissions);
        }
        String email = CognitoIdentityLookup.normalizeEmail(request.email());
        for (user existing : userRepository.findByEmail(email)) {
            if (tenant.getId().equals(existing.getTenantId())) {
                throw new ConflictException("An account with this email already exists in this organization.");
            }
            if (existing.getStatus() != UserStatus.DEACTIVATED) {
                throw new ConflictException("This email already belongs to an account in another organization or on the platform.");
            }
        }

        user invitation = user.builder()
                .tenantId(tenant.getId())
                .name(request.name().trim())
                .email(email)
                .phoneNumber(blankToNull(request.phoneNumber()))
                .status(UserStatus.INVITED)
                .roles(Set.of(UserRole.ADMIN))
                .recordState(RecordState.ACTIVE)
                .invitedAt(Instant.now())
                .build();
        if (explicitModules) {
            ModuleAssignmentService.applyExplicit(invitation, modules, modulePermissions, null);
        } else {
            ModuleAssignmentService.applyDefaults(invitation, UserRole.ADMIN, null);
        }
        user saved;
        try {
            saved = userRepository.insert(invitation);
        } catch (DuplicateKeyException race) {
            throw new ConflictException("An account with this email already exists in this organization.");
        }
        InvitationInfo delivered;
        try {
            delivered = cognitoInvitations.invite(saved.getEmail(), saved.getName());
        } catch (InvitationDeliveryException ex) {
            userRepository.deleteById(saved.getId());
            throw ex;
        }
        auditService.record(actor, AuditAction.USER_INVITED, tenant.getId(), "USER", saved.getId(),
                AuditService.details("role", UserRole.ADMIN.name(), "by", "SUPER_ADMIN", "delivery", delivered.delivery(),
                        "modules", String.join(",", saved.getModuleAccess()),
                        "modulePermissions", String.join(",", saved.getModulePermissions())));
        return AdminResponse.of(saved, tenant).withInvitation(delivered);
    }

    // ==================== MODULE ACCESS ====================

    /** An administrator's module assignment, their organization's plan entitlement and what is effective now. */
    public ModuleAccessResponse getAdminModules(Jwt jwt, String adminId) {
        currentUserService.requireSuperAdmin(jwt);
        return moduleAssignments.describe(findAdmin(adminId));
    }

    /**
     * Replaces an administrator's module assignment. Both lists are required (empty = no access);
     * every permission must belong to an assigned module, and NORMAONE (the portal) is not a module.
     * Assigning a module the plan does not include is allowed — it becomes usable when the plan does.
     * The Super Admin is not limited to a scope of their own.
     */
    public ModuleAccessResponse setAdminModules(Jwt jwt, String adminId, ModuleAccessRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        return moduleAssignments.replace(actor, findAdmin(adminId), request.modules(), request.permissions(), null);
    }

    /** Assigns one module to an administrator with exactly these permissions; their other modules are kept. */
    public ModuleAccessResponse setAdminModule(Jwt jwt, String adminId, ModuleApps module, ModulePermissionsRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        return moduleAssignments.setModule(actor, findAdmin(adminId), module, request.permissions(), null);
    }

    /** Revokes one module, and every permission in it, from an administrator. */
    public ModuleAccessResponse revokeAdminModule(Jwt jwt, String adminId, ModuleApps module) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        return moduleAssignments.revokeModule(actor, findAdmin(adminId), module, null);
    }

    /** Sends a pending administrator invitation again, with a new temporary password. */
    public AdminResponse resendAdminInvitation(Jwt jwt, String adminId) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        user admin = findAdmin(adminId);
        if (admin.getStatus() != UserStatus.INVITED) {
            throw new ConflictException("Only a pending invitation can be resent; this administrator is " + admin.getStatus() + ".");
        }
        InvitationInfo delivered = cognitoInvitations.resend(admin.getEmail(), admin.getName());
        auditService.record(actor, AuditAction.USER_INVITATION_RESENT, admin.getTenantId(), "USER", admin.getId(),
                AuditService.details("delivery", delivered.delivery(), "by", "SUPER_ADMIN"));
        return AdminResponse.of(admin, tenantOf(admin)).withInvitation(delivered);
    }

    /** Replaces the editable profile: name and phone number. Nothing else can be reached from here. */
    public AdminResponse updateAdmin(Jwt jwt, String adminId, UpdateAdminRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        user admin = findAdmin(adminId);
        List<String> changed = new ArrayList<>();
        String name = request.name().trim();
        if (!name.equals(admin.getName())) {
            admin.setName(name);
            changed.add("name");
        }
        String phone = blankToNull(request.phoneNumber());
        if (!Objects.equals(phone, admin.getPhoneNumber())) {
            admin.setPhoneNumber(phone);
            changed.add("phoneNumber");
        }
        if (changed.isEmpty()) {
            return AdminResponse.of(admin, tenantOf(admin));
        }
        user saved = userRepository.save(admin);
        auditService.record(actor, AuditAction.USER_UPDATED, saved.getTenantId(), "USER", saved.getId(),
                AuditService.details("fields", String.join(",", changed), "by", "SUPER_ADMIN"));
        return AdminResponse.of(saved, tenantOf(saved));
    }

    /**
     * Activates, suspends or deactivates an administrator through the same lifecycle every account
     * follows (UserAdministration.applyStatus): nothing is deleted, an invitation cannot be made
     * ACTIVE (it becomes so at first sign-in), and suspending or deactivating needs a reason.
     *
     * The organization's only active administrator is suspended or deactivated only on explicit
     * confirmation (confirmNoActiveAdmin: true, 409 otherwise) — the platform must be able to lock out a
     * compromised account — and the way back stays open: the Super Admin invites a replacement with
     * POST /admins. Nothing is deleted, the tenant is untouched, and the Cognito account is signed out
     * (and disabled when deactivated) after the record is saved (CognitoAccountAccessService).
     */
    public AdminResponse changeAdminStatus(Jwt jwt, String adminId, UserStatusRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        user admin = findAdmin(adminId);
        UserStatus previous = admin.getStatus();
        // Validates the transition and the reason first (400/409), then the last-administrator rule.
        UserAdministration.applyStatus(admin, request.status(), request.reason());
        boolean lastActive = previous == UserStatus.ACTIVE && admin.getStatus() != UserStatus.ACTIVE
                && activeAdminsOf(admin.getTenantId()) <= 1;
        if (lastActive && !Boolean.TRUE.equals(request.confirmNoActiveAdmin())) {
            Tenant tenant = tenantOf(admin);
            throw new ConflictException("This is the only active administrator of " + (tenant != null ? tenant.getTenantName() : "the organization")
                    + ". Invite or reactivate another administrator first, or confirm with confirmNoActiveAdmin: true "
                    + "(then invite a replacement with POST /api/super-admin/admins).");
        }
        cognitoAccess.beforeSave(admin, previous);
        user saved = userRepository.save(admin);
        String identityProvider = cognitoAccess.afterSave(saved, previous);
        auditService.record(actor, AuditAction.USER_STATUS_CHANGED, saved.getTenantId(), "USER", saved.getId(),
                AuditService.details("from", String.valueOf(previous), "to", String.valueOf(saved.getStatus()),
                        "reason", saved.getStatusReason(), "role", UserRole.ADMIN.name(), "by", "SUPER_ADMIN",
                        "identityProvider", identityProvider, "leftWithoutActiveAdmin", lastActive ? "true" : null));
        return AdminResponse.of(saved, tenantOf(saved));
    }

    // ==================== REGULAR USERS (READ ONLY) ====================

    public PageResponse<PlatformUserResponse> listUsers(Jwt jwt, String search, String tenantId, UserStatus status, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        UserAdministration.UserPage found = userAdministration.findPage(UserAdministration.regularUserScope(),
                blankToNull(tenantId), search, status, page, size);
        Map<String, Tenant> tenants = tenantsOf(found.users());
        return PageResponse.of(found.users().stream().map(u -> PlatformUserResponse.of(u, tenants.get(u.getTenantId()))).toList(),
                found.page(), found.size(), found.total());
    }

    public PlatformUserResponse getUser(Jwt jwt, String userId) {
        currentUserService.requireSuperAdmin(jwt);
        user found = userRepository.findById(userId)
                .filter(UserAdministration::isRegularUser)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No regular user has this id. Administrators are under /api/super-admin/admins."));
        return PlatformUserResponse.of(found, tenantOf(found));
    }

    // ==================== AUDIT (READ ONLY) ====================

    /** The platform-wide audit trail, newest first, narrowed by any of the filters. */
    public PageResponse<AuditEventResponse> listAuditEvents(Jwt jwt, AuditService.Filter filter, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        return auditService.search(filter, page, size);
    }

    // ==================== HELPERS ====================

    private user findAdmin(String adminId) {
        return userRepository.findById(adminId)
                .filter(UserAdministration::isAdminAccount)
                .orElseThrow(() -> new ResourceNotFoundException("Administrator not found."));
    }

    /** ACTIVE administrators of a tenant (legacy admin role names included). */
    private long activeAdminsOf(String tenantId) {
        return mongoTemplate.count(new Query(new Criteria().andOperator(UserAdministration.adminScope(),
                Criteria.where("tenantId").is(tenantId), Criteria.where("status").is(UserStatus.ACTIVE))), user.class);
    }

    private Tenant tenantOf(user u) {
        return u.getTenantId() == null ? null : tenantRepository.findById(u.getTenantId()).orElse(null);
    }

    /** The tenants of a page of accounts, in one query rather than one per row. */
    private Map<String, Tenant> tenantsOf(List<user> users) {
        Set<String> ids = users.stream().map(user::getTenantId).filter(Objects::nonNull).collect(Collectors.toSet());
        if (ids.isEmpty()) {
            return Map.of();
        }
        return tenantRepository.findAllById(ids).stream().collect(Collectors.toMap(Tenant::getId, Function.identity()));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
