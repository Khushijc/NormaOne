package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.bootstrap.SuperAdminBootstrap;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;

/**
 * Links an invited user record (created by a Tenant Admin or Super Admin, without a Cognito
 * identity) to the Cognito account of the person who registered with that email.
 *
 * Linking happens only when the email is verified (ID-token claim or Cognito AdminGetUser) and
 * exactly one pending invitation matches: in an ACTIVE tenant, or a platform invitation of a Super
 * Admin (created by another Super Admin). The Cognito sub always comes from the validated JWT;
 * nothing in the request decides the link. A platform invitation linked here is what keeps an
 * invited Super Admin out of tenant onboarding: their first request finds a platform account.
 */
@Service
public class AccountLinkService {

    private static final Logger log = LoggerFactory.getLogger(AccountLinkService.class);

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final CognitoIdentityLookup identityLookup;
    private final AuditService auditService;
    private final SuperAdminBootstrap superAdminBootstrap;

    public AccountLinkService(
            UserRepository userRepository,
            TenantRepository tenantRepository,
            CognitoIdentityLookup identityLookup,
            AuditService auditService,
            SuperAdminBootstrap superAdminBootstrap) {
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.identityLookup = identityLookup;
        this.auditService = auditService;
        this.superAdminBootstrap = superAdminBootstrap;
    }

    /** The caller's user record, linking a pending invitation first if one matches. */
    public Optional<user> findOrLink(Jwt jwt) {
        String sub = jwt.getSubject();
        Optional<user> existing = userRepository.findByCognitoSub(sub);
        if (existing.isPresent()) {
            return existing;
        }
        // The configured first Super Admin, in TOKEN mode, is created here at its first sign-in —
        // before invitation linking or onboarding can tie the account to an organization. For any
        // other caller this does nothing (see SuperAdminBootstrap.provisionFromToken).
        Optional<user> bootstrapped = superAdminBootstrap.provisionFromToken(jwt);
        if (bootstrapped.isPresent()) {
            return bootstrapped;
        }
        CognitoIdentityLookup.Identity identity = identityLookup.forJwt(jwt);
        if (!identity.hasVerifiedEmail()) {
            return Optional.empty();
        }
        List<user> invitations = userRepository.findByEmailAndStatusAndCognitoSubIsNull(identity.email(), UserStatus.INVITED)
                .stream()
                .filter(u -> u.getRecordState() == null || u.getRecordState() == RecordState.ACTIVE)
                .filter(this::linkable)
                .toList();
        if (invitations.isEmpty()) {
            return Optional.empty();
        }
        if (invitations.size() > 1) {
            log.warn("Cognito sub {} matches {} pending invitations; not linking automatically", sub, invitations.size());
            return Optional.empty();
        }
        user invited = invitations.get(0);
        invited.setCognitoSub(sub);
        invited.setStatus(UserStatus.ACTIVE);
        invited.setActivatedAt(Instant.now());
        if ((invited.getName() == null || invited.getName().isBlank()) && identity.name() != null) {
            invited.setName(identity.name());
        }
        boolean platform = isPlatformRecord(invited);
        try {
            user linked = userRepository.save(invited);
            auditService.recordAs(linked.getId(), platform ? "SUPER_ADMIN" : "USER", AuditAction.USER_LINKED,
                    linked.getTenantId(), "USER", linked.getId(), AuditService.details("status", "INVITED -> ACTIVE"));
            if (platform) {
                log.info("Linked invited Super Admin {} to its Cognito identity", linked.getId());
            } else {
                log.info("Linked invited user {} in tenant {} to its Cognito identity", linked.getId(), linked.getTenantId());
            }
            return Optional.of(linked);
        } catch (DuplicateKeyException | OptimisticLockingFailureException race) {
            // A concurrent request linked it (or the sub was linked elsewhere): read the current state.
            return userRepository.findByCognitoSub(sub);
        }
    }

    /**
     * Whether a pending invitation can be linked now: a tenant invitation into an ACTIVE tenant, or a
     * platform invitation that holds the Super Admin role (only a Super Admin creates those, through
     * PlatformAccountService). A platform record without a platform role is never linked.
     */
    private boolean linkable(user invitation) {
        if (isPlatformRecord(invitation)) {
            return UserAdministration.hasPlatformRole(invitation);
        }
        return tenantRepository.findById(invitation.getTenantId()).map(Tenant::getStatus).orElse(null) == TenantStatus.ACTIVE;
    }

    private static boolean isPlatformRecord(user u) {
        return u.getTenantId() == null || u.getTenantId().isBlank();
    }
}
