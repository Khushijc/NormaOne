package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.EnumSet;
import java.util.Set;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.admin.AuditEventResponse;
import com.NormaOne.backend.dto.admin.CreateTenantUserRequest;
import com.NormaOne.backend.dto.admin.InvitationInfo;
import com.NormaOne.backend.dto.admin.TenantResponse;
import com.NormaOne.backend.dto.admin.UpdateTenantUserRequest;
import com.NormaOne.backend.dto.admin.UserResponse;
import com.NormaOne.backend.dto.admin.UserStatusRequest;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.modules.ModuleAccessRequest;
import com.NormaOne.backend.dto.modules.ModuleAccessResponse;
import com.NormaOne.backend.dto.modules.ModulePermissionsRequest;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.exceptions.InvitationDeliveryException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.modules.ModulePermission;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * Tenant Admin operations. Every query and write is scoped to the tenant on the caller's
 * persisted user record; ids of other tenants' users are reported as not found.
 *
 * Who may call: an ACTIVE ADMIN of an ACTIVE tenant (CurrentUserService.requireTenantAdmin) — the
 * role decides, with no separate general permission list. Within that, the resource rules below
 * still apply: not your own role, status or module access; not a platform account; the last active
 * administrator cannot be removed; and module permissions only within your own (moduleScope).
 */
@Service
public class TenantAdminService {

    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final PackageService packageService;
    private final UserAdministration userAdministration;
    private final AuditService auditService;
    private final CognitoInvitationService cognitoInvitations;
    private final ModuleAssignmentService moduleAssignments;
    private final CognitoAccountAccessService cognitoAccess;

    public TenantAdminService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            PackageService packageService,
            UserAdministration userAdministration,
            AuditService auditService,
            CognitoInvitationService cognitoInvitations,
            ModuleAssignmentService moduleAssignments,
            CognitoAccountAccessService cognitoAccess) {
        this.cognitoAccess = cognitoAccess;
        this.moduleAssignments = moduleAssignments;
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.packageService = packageService;
        this.userAdministration = userAdministration;
        this.auditService = auditService;
        this.cognitoInvitations = cognitoInvitations;
    }

    public TenantResponse ownTenant(Jwt jwt) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        TenantPackageResponse pkg = packageService.describeIfAssigned(admin.tenantId()).orElse(null);
        return TenantResponse.of(admin.tenant(), pkg != null && pkg.plan() != null ? pkg.plan().planCode() : null,
                userRepository.countByTenantId(admin.tenantId()), pkg);
    }

    public TenantPackageResponse ownPackage(Jwt jwt) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        return packageService.describe(admin.tenantId());
    }

    /**
     * The audit trail of the caller's own organization. The tenant filter is set here from the caller's
     * record and is part of the database query, whatever the request asks for; platform events (no
     * tenant) and other organizations' events are never read.
     */
    public PageResponse<AuditEventResponse> auditEvents(Jwt jwt, String targetId, String targetType, String actorUserId,
            AuditAction action, Instant from, Instant to, int page, int size) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        return auditService.search(new AuditService.Filter(admin.tenantId(), targetId, targetType, actorUserId, action, from, to),
                page, size);
    }

    public PageResponse<UserResponse> listUsers(Jwt jwt, String search, UserStatus status, UserRole role, int page, int size) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        return userAdministration.search(admin.tenantId(), search, status, role, page, size);
    }

    public UserResponse getUser(Jwt jwt, String userId) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        return UserResponse.of(findInTenant(admin, userId));
    }

    /**
     * Creates an invitation in the caller's tenant (status INVITED) and has Cognito email the person a
     * temporary password (CognitoInvitationService). Their first sign-in must set a permanent password;
     * the record is then linked and made ACTIVE at their first authenticated request. If Cognito
     * refuses, the record is removed and nothing is left pending.
     */
    public UserResponse createUser(Jwt jwt, CreateTenantUserRequest request) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        UserRole role = UserAdministration.assignableTenantRole(request.role());
        String email = CognitoIdentityLookup.normalizeEmail(request.email());
        if (userRepository.findByTenantIdAndEmail(admin.tenantId(), email).isPresent()) {
            throw new ConflictException("A user with this email already exists in your organization.");
        }
        Instant now = Instant.now();
        user invitation = user.builder()
                .tenantId(admin.tenantId())
                .name(request.name().trim())
                .email(email)
                .phoneNumber(blankToNull(request.phoneNumber()))
                .status(UserStatus.INVITED)
                .roles(Set.of(role))
                .recordState(RecordState.ACTIVE)
                .invitedAt(now)
                .build();
        // All six modules with the role's defaults unless the request names them — never more module
        // permissions than the inviting administrator holds, validated before anything is written.
        if (request.moduleAccess() != null || request.modulePermissions() != null) {
            ModuleAssignmentService.applyExplicit(invitation,
                    request.moduleAccess() == null ? Set.of() : request.moduleAccess(),
                    request.modulePermissions() == null ? Set.of() : request.modulePermissions(), moduleScope(admin));
        } else {
            ModuleAssignmentService.applyDefaults(invitation, role, moduleScope(admin));
        }
        user saved;
        try {
            saved = userRepository.insert(invitation);
        } catch (DuplicateKeyException ex) {
            throw new ConflictException("A user with this email already exists in your organization.");
        }
        InvitationInfo delivered = deliver(saved);
        auditService.record(admin, AuditAction.USER_INVITED, admin.tenantId(), "USER", saved.getId(),
                AuditService.details("role", role.name(), "delivery", delivered.delivery(),
                        "modules", String.join(",", saved.getModuleAccess()),
                        "modulePermissions", String.join(",", saved.getModulePermissions())));
        return UserResponse.of(saved).withInvitation(delivered);
    }

    // ==================== MODULE ACCESS ====================

    /** A user's module assignment, the organization's plan entitlement and what is effective, module by module. */
    public ModuleAccessResponse getUserModules(Jwt jwt, String userId) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        return moduleAssignments.describe(findInTenant(admin, userId));
    }

    /** Replaces a user's module assignment, within the caller's own module permissions. */
    public ModuleAccessResponse setUserModules(Jwt jwt, String userId, ModuleAccessRequest request) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        user target = manageableModulesOf(admin, userId);
        return moduleAssignments.replace(admin, target, request.modules(), request.permissions(), moduleScope(admin));
    }

    /** Assigns one module with exactly these permissions; the user's other modules are kept. */
    public ModuleAccessResponse setUserModule(Jwt jwt, String userId, ModuleApps module, ModulePermissionsRequest request) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        user target = manageableModulesOf(admin, userId);
        return moduleAssignments.setModule(admin, target, module, request.permissions(), moduleScope(admin));
    }

    /** Revokes one module and every permission in it. */
    public ModuleAccessResponse revokeUserModule(Jwt jwt, String userId, ModuleApps module) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        user target = manageableModulesOf(admin, userId);
        return moduleAssignments.revokeModule(admin, target, module, moduleScope(admin));
    }

    /** A user of the caller's tenant whose modules the caller may change: not a platform account, not themselves. */
    private user manageableModulesOf(CurrentUser admin, String userId) {
        user target = findInTenant(admin, userId);
        guardManageable(target);
        if (target.getId().equals(admin.userId())) {
            throw new ForbiddenOperationException("You cannot change your own module access.");
        }
        return target;
    }

    /**
     * The module permissions a Tenant Admin may grant or remove: the ones assigned to them, so a
     * tenant administrator never hands out — or strips — what a Super Admin withheld from them.
     */
    private static Set<ModulePermission> moduleScope(CurrentUser admin) {
        Set<ModulePermission> scope = EnumSet.noneOf(ModulePermission.class);
        scope.addAll(ModuleCatalog.assignedPermissions(admin.user().getModulePermissions(), admin.user().getModuleAccess()));
        return scope;
    }

    /**
     * Sends a pending invitation again — a new temporary password, which is also how an expired one is
     * replaced. Only for a user still INVITED: an active account has its own password.
     */
    public UserResponse resendInvitation(Jwt jwt, String userId) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        user target = findInTenant(admin, userId);
        guardManageable(target);
        if (target.getStatus() != UserStatus.INVITED) {
            throw new ConflictException("Only a pending invitation can be resent; this user is " + target.getStatus() + ".");
        }
        InvitationInfo invitation = cognitoInvitations.resend(target.getEmail(), target.getName());
        auditService.record(admin, AuditAction.USER_INVITATION_RESENT, admin.tenantId(), "USER", target.getId(),
                AuditService.details("delivery", invitation.delivery()));
        return UserResponse.of(target).withInvitation(invitation);
    }

    /** The Cognito invitation for a record just written; the record is removed again if it fails. */
    private InvitationInfo deliver(user saved) {
        try {
            return cognitoInvitations.invite(saved.getEmail(), saved.getName());
        } catch (InvitationDeliveryException ex) {
            userRepository.deleteById(saved.getId());
            throw ex;
        }
    }

    public UserResponse updateUser(Jwt jwt, String userId, UpdateTenantUserRequest request) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        user target = findInTenant(admin, userId);
        guardManageable(target);

        boolean changed = false;
        if (request.name() != null && !request.name().isBlank() && !request.name().trim().equals(target.getName())) {
            target.setName(request.name().trim());
            changed = true;
        }
        if (request.phoneNumber() != null && !request.phoneNumber().equals(target.getPhoneNumber())) {
            target.setPhoneNumber(blankToNull(request.phoneNumber()));
            changed = true;
        }
        String previousRole = null;
        if (request.role() != null) {
            UserRole role = UserAdministration.assignableTenantRole(request.role());
            boolean wasAdmin = UserAdministration.isTenantAdmin(target);
            boolean onlyThisRole = target.getRoles() != null && target.getRoles().size() == 1 && target.getRoles().contains(role);
            if (!onlyThisRole) {
                if (target.getId().equals(admin.userId())) {
                    throw new ForbiddenOperationException("You cannot change your own role.");
                }
                if (wasAdmin && role != UserRole.ADMIN && target.getStatus() == UserStatus.ACTIVE) {
                    ensureAnotherActiveAdmin(admin.tenantId());
                }
                previousRole = String.valueOf(target.getRoles());
                target.setRoles(Set.of(role));
                // Module permissions start again from the new role's defaults (within the caller's
                // own), so a demoted administrator keeps no administrative module permission.
                ModuleAssignmentService.resetForRole(target, role, moduleScope(admin));
                changed = true;
            }
        }
        if (!changed) {
            return UserResponse.of(target);
        }
        user saved = userRepository.save(target);
        if (previousRole != null) {
            auditService.record(admin, AuditAction.USER_ROLE_CHANGED, admin.tenantId(), "USER", saved.getId(),
                    AuditService.details("from", previousRole, "to", String.valueOf(saved.getRoles())));
        } else {
            auditService.record(admin, AuditAction.USER_UPDATED, admin.tenantId(), "USER", saved.getId(), null);
        }
        return UserResponse.of(saved);
    }

    public UserResponse changeUserStatus(Jwt jwt, String userId, UserStatusRequest request) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        user target = findInTenant(admin, userId);
        guardManageable(target);
        if (target.getId().equals(admin.userId())) {
            throw new ForbiddenOperationException("You cannot change your own status.");
        }
        UserStatus previous = target.getStatus();
        if (request.status() != UserStatus.ACTIVE && previous == UserStatus.ACTIVE && UserAdministration.isTenantAdmin(target)) {
            ensureAnotherActiveAdmin(admin.tenantId());
        }
        UserAdministration.applyStatus(target, request.status(), request.reason());
        cognitoAccess.beforeSave(target, previous);
        user saved = userRepository.save(target);
        String identityProvider = cognitoAccess.afterSave(saved, previous);
        auditService.record(admin, AuditAction.USER_STATUS_CHANGED, admin.tenantId(), "USER", saved.getId(),
                AuditService.details("from", String.valueOf(previous), "to", String.valueOf(saved.getStatus()),
                        "reason", saved.getStatusReason(), "identityProvider", identityProvider));
        return UserResponse.of(saved);
    }

    private user findInTenant(CurrentUser admin, String userId) {
        return userRepository.findByIdAndTenantId(userId, admin.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("User not found in your organization."));
    }

    /** A record carrying a platform role is never managed through tenant APIs. */
    private static void guardManageable(user target) {
        if (UserAdministration.hasPlatformRole(target)) {
            throw new ForbiddenOperationException("Platform administrator accounts cannot be managed through tenant APIs.");
        }
    }

    private void ensureAnotherActiveAdmin(String tenantId) {
        long activeAdmins = userRepository.countByTenantIdAndStatusAndRolesContaining(tenantId, UserStatus.ACTIVE, UserRole.ADMIN);
        if (activeAdmins <= 1) {
            throw new ConflictException("The organization must keep at least one active tenant administrator.");
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
