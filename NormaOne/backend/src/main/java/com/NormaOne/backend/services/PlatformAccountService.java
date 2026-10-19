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

import com.NormaOne.backend.dto.admin.CreateSuperAdminRequest;
import com.NormaOne.backend.dto.admin.InvitationInfo;
import com.NormaOne.backend.dto.admin.PlatformAccountResponse;
import com.NormaOne.backend.dto.admin.SuperAdminResponse;
import com.NormaOne.backend.dto.admin.UserStatusRequest;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.exceptions.InvitationDeliveryException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * Platform accounts as a Super Admin manages them: other Super Admins, and the cross-tenant account
 * directory.
 *
 * SUPER ADMINS ARE INVITATIONS, exactly like tenant administrators: a platform record (no tenant,
 * role SUPER_ADMIN, status INVITED) is written, then Cognito creates the account and emails a
 * temporary password (CognitoInvitationService). If Cognito refuses, the record is deleted again
 * and the answer is 502 — nothing is left half-created. The record is linked and made ACTIVE at the
 * person's first authenticated request (AccountLinkService), so they never see tenant onboarding.
 *
 * ONLY AN ACTIVE SUPER ADMIN reaches any of this: the HTTP rule, @PreAuthorize and
 * {@link CurrentUserService#requireSuperAdmin} in every method, each against the database. No tenant
 * API, onboarding or public signup can write a platform role, and SuperAdminBootstrap (the
 * unauthenticated, configuration-only path for the first Super Admin) is unchanged: it still refuses
 * to add one when any Super Admin exists unless allow-additional is set.
 *
 * A tenant account is never turned into a Super Admin: an email that belongs to an organization
 * account is refused (409), and so is one whose sign-in is already linked to such an account.
 */
@Service
public class PlatformAccountService {

    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final UserAdministration userAdministration;
    private final AuditService auditService;
    private final CognitoInvitationService cognitoInvitations;
    private final CognitoAccountAccessService cognitoAccess;
    private final MongoTemplate mongoTemplate;

    public PlatformAccountService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            TenantRepository tenantRepository,
            UserAdministration userAdministration,
            AuditService auditService,
            CognitoInvitationService cognitoInvitations,
            CognitoAccountAccessService cognitoAccess,
            MongoTemplate mongoTemplate) {
        this.cognitoAccess = cognitoAccess;
        this.mongoTemplate = mongoTemplate;
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.userAdministration = userAdministration;
        this.auditService = auditService;
        this.cognitoInvitations = cognitoInvitations;
    }

    // ==================== SUPER ADMINS ====================

    public PageResponse<SuperAdminResponse> listSuperAdmins(Jwt jwt, String search, UserStatus status, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        UserAdministration.UserPage found = userAdministration.findPage(UserAdministration.superAdminScope(), null, search,
                status, page, size);
        return PageResponse.of(found.users().stream().map(SuperAdminResponse::of).toList(), found.page(), found.size(), found.total());
    }

    public SuperAdminResponse getSuperAdmin(Jwt jwt, String id) {
        currentUserService.requireSuperAdmin(jwt);
        return SuperAdminResponse.of(findSuperAdmin(id));
    }

    /**
     * Invites another Super Admin. Refused (409) when the email already has a platform account, or
     * belongs to an organization account that is live or whose sign-in is linked — such a sign-in
     * would keep resolving to the organization account and the invitation could never be linked.
     */
    public SuperAdminResponse createSuperAdmin(Jwt jwt, CreateSuperAdminRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        String email = CognitoIdentityLookup.normalizeEmail(request.email());
        for (user existing : userRepository.findByEmail(email)) {
            boolean platform = existing.getTenantId() == null || existing.getTenantId().isBlank();
            boolean linked = existing.getCognitoSub() != null && !existing.getCognitoSub().isBlank();
            if (platform) {
                throw new ConflictException(existing.getStatus() == UserStatus.DEACTIVATED
                        ? "A deactivated platform account with this email exists. Reactivate it with PATCH /api/super-admin/super-admins/"
                                + existing.getId() + "/status instead of creating another."
                        : "A platform account with this email already exists.");
            }
            if (existing.getStatus() != UserStatus.DEACTIVATED || linked) {
                throw new ConflictException("This email belongs to an account in an organization. An organization account "
                        + "is never made a Super Admin: use a separate email.");
            }
        }

        user invitation = user.builder()
                .tenantId(null)
                .name(request.name().trim())
                .email(email)
                .phoneNumber(blankToNull(request.phoneNumber()))
                .status(UserStatus.INVITED)
                .roles(Set.of(UserRole.SUPER_ADMIN))
                .recordState(RecordState.ACTIVE)
                .invitedAt(Instant.now())
                .build();
        user saved;
        try {
            saved = userRepository.insert(invitation);
        } catch (DuplicateKeyException race) {
            throw new ConflictException("A platform account with this email already exists.");
        }
        InvitationInfo delivered;
        try {
            delivered = cognitoInvitations.invite(saved.getEmail(), saved.getName());
        } catch (InvitationDeliveryException ex) {
            // Compensation: no invitation record without an invitation on its way. Retrying is safe.
            userRepository.deleteById(saved.getId());
            throw ex;
        }
        auditService.record(actor, AuditAction.USER_INVITED, null, "USER", saved.getId(),
                AuditService.details("role", UserRole.SUPER_ADMIN.name(), "by", "SUPER_ADMIN", "delivery", delivered.delivery()));
        return SuperAdminResponse.of(saved).withInvitation(delivered);
    }

    /** Sends a pending Super Admin invitation again, with a new temporary password. */
    public SuperAdminResponse resendSuperAdminInvitation(Jwt jwt, String id) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        user target = findSuperAdmin(id);
        if (target.getStatus() != UserStatus.INVITED) {
            throw new ConflictException("Only a pending invitation can be resent; this Super Admin is " + target.getStatus() + ".");
        }
        InvitationInfo delivered = cognitoInvitations.resend(target.getEmail(), target.getName());
        auditService.record(actor, AuditAction.USER_INVITATION_RESENT, null, "USER", target.getId(),
                AuditService.details("delivery", delivered.delivery(), "by", "SUPER_ADMIN", "role", UserRole.SUPER_ADMIN.name()));
        return SuperAdminResponse.of(target).withInvitation(delivered);
    }

    /**
     * Activates, suspends or deactivates another Super Admin through the common account lifecycle
     * (UserAdministration.applyStatus): a reason is required to suspend or deactivate, a pending
     * invitation can only be deactivated (revoked), and nothing is deleted. Removing a Super Admin's
     * platform access is deactivating them; their Cognito account is then signed out and disabled
     * (CognitoAccountAccessService), and reactivating re-enables it.
     *
     * The platform always keeps an active Super Admin: nobody changes their own status, the last
     * active one cannot be suspended or deactivated (409), and if two Super Admins remove each other
     * at the same moment the second change is undone when it finds none left.
     */
    public SuperAdminResponse changeSuperAdminStatus(Jwt jwt, String id, UserStatusRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        user target = findSuperAdmin(id);
        if (target.getId().equals(actor.userId())) {
            throw new ForbiddenOperationException("You cannot change your own status.");
        }
        UserStatus previous = target.getStatus();
        boolean removing = previous == UserStatus.ACTIVE && request.status() != UserStatus.ACTIVE;
        if (removing && activeSuperAdmins() <= 1) {
            throw new ConflictException("The platform must keep at least one active Super Admin.");
        }
        user before = snapshot(target);
        UserAdministration.applyStatus(target, request.status(), request.reason());
        cognitoAccess.beforeSave(target, previous);
        user saved = userRepository.save(target);
        if (removing && activeSuperAdmins() == 0) {
            // Another Super Admin was removed concurrently: put this one back.
            saved.setStatus(before.getStatus());
            saved.setDeactivatedAt(before.getDeactivatedAt());
            saved.setStatusReason(before.getStatusReason());
            userRepository.save(saved);
            throw new ConflictException("The platform must keep at least one active Super Admin.");
        }
        String identityProvider = cognitoAccess.afterSave(saved, previous);
        auditService.record(actor, AuditAction.USER_STATUS_CHANGED, null, "USER", saved.getId(),
                AuditService.details("from", String.valueOf(previous), "to", String.valueOf(saved.getStatus()),
                        "reason", saved.getStatusReason(), "role", UserRole.SUPER_ADMIN.name(), "by", "SUPER_ADMIN",
                        "identityProvider", identityProvider));
        return SuperAdminResponse.of(saved);
    }

    // ==================== DIRECTORY (READ ONLY) ====================

    /**
     * Every account across tenants and the platform, newest first, narrowed by any of: name or email
     * ({@code search}), canonical {@code role} (legacy role values included), {@code tenantId},
     * {@code status} and an assigned application {@code module}. Read only.
     */
    public PageResponse<PlatformAccountResponse> listAccounts(Jwt jwt, String search, UserRole role, String tenantId,
            UserStatus status, ModuleApps module, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        List<Criteria> scope = new ArrayList<>();
        if (role != null) {
            scope.add(switch (role.canonical()) {
                case SUPER_ADMIN -> UserAdministration.superAdminScope();
                case ADMIN -> UserAdministration.adminScope();
                default -> UserAdministration.regularUserScope();
            });
        }
        if (module != null) {
            if (!ModuleCatalog.isApplicationModule(module)) {
                throw new IllegalArgumentException(module + " is the portal itself, not an application module.");
            }
            scope.add(Criteria.where("moduleAccess").is(module.name()));
        }
        Criteria criteria = scope.isEmpty() ? null : scope.size() == 1 ? scope.get(0) : new Criteria().andOperator(scope);
        UserAdministration.UserPage found = userAdministration.findPage(criteria, blankToNull(tenantId), search, status, page, size);
        Map<String, Tenant> tenants = tenantsOf(found.users());
        // Platform accounts have no tenant id: never look a null key up (Map.of() rejects it).
        return PageResponse.of(found.users().stream()
                        .map(u -> PlatformAccountResponse.of(u, u.getTenantId() == null ? null : tenants.get(u.getTenantId()))).toList(),
                found.page(), found.size(), found.total());
    }

    // ==================== HELPERS ====================

    /** ACTIVE platform Super Admins (no tenant). */
    private long activeSuperAdmins() {
        return mongoTemplate.count(new Query(new Criteria().andOperator(UserAdministration.superAdminScope(),
                Criteria.where("status").is(UserStatus.ACTIVE))), user.class);
    }

    private static user snapshot(user u) {
        return user.builder().status(u.getStatus()).deactivatedAt(u.getDeactivatedAt()).statusReason(u.getStatusReason()).build();
    }

    private user findSuperAdmin(String id) {
        return userRepository.findById(id)
                .filter(UserAdministration::isPlatformSuperAdmin)
                .orElseThrow(() -> new ResourceNotFoundException("Super Admin not found."));
    }

    private Map<String, Tenant> tenantsOf(List<user> users) {
        Set<String> ids = users.stream().map(user::getTenantId).filter(Objects::nonNull).filter(s -> !s.isBlank())
                .collect(Collectors.toSet());
        if (ids.isEmpty()) {
            return Map.of();
        }
        return tenantRepository.findAllById(ids).stream().collect(Collectors.toMap(Tenant::getId, Function.identity()));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
