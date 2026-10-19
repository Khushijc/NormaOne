package com.NormaOne.backend.bootstrap;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.services.AuditService;
import com.NormaOne.backend.services.CognitoIdentityLookup;
import com.NormaOne.backend.services.UserAdministration;

/**
 * Explicit, server-side provisioning of the platform's first Super Admin.
 *
 * THERE IS NO ENDPOINT. Nothing a client sends can create a Super Admin: this runs only when the
 * operator starting the server sets {@code normaone.bootstrap.super-admin.enabled=true} together
 * with the Cognito sub and email of one account that has already registered and verified its email
 * through the ordinary /api/auth flow. Ordinary Admins and Users have no way to invoke it.
 *
 * THE IDENTITY IS PROVEN, never taken on trust, in one of two ways (see {@link NormaOneProperties.Verification}):
 * <ul>
 *   <li>COGNITO — at startup, AdminGetUser must report the account CONFIRMED, with this sub and this
 *       verified email.</li>
 *   <li>TOKEN — nothing happens at startup; the record is created at the account's first sign-in,
 *       from a resource-server-validated ID token carrying this sub, this email and
 *       email_verified=true. The token is the same proof every other request relies on, and it
 *       needs no AWS credentials, which is what makes it the local-development option.</li>
 * </ul>
 *
 * WHAT IT REFUSES, logging why and writing nothing:
 * <ul>
 *   <li>a sub that already belongs to an organization — an ADMIN or USER is never promoted, because
 *       a Super Admin has no tenant and stripping one would orphan that organization's record;</li>
 *   <li>a Super Admin that already exists for a different account, unless allow-additional=true —
 *       so a configuration left in place cannot quietly add a second one;</li>
 *   <li>an email that belongs to a live account in an organization;</li>
 *   <li>any identity mismatch.</li>
 * </ul>
 *
 * It is idempotent: an existing Super Admin with this sub is left exactly as it is — never replaced,
 * and never reactivated if it was deactivated.
 */
@Component
@Order(30)
public class SuperAdminBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SuperAdminBootstrap.class);

    /** What a provisioning attempt did. Everything but PROVISIONED and ALREADY_PROVISIONED wrote nothing. */
    public enum Outcome {
        DISABLED,
        MISCONFIGURED,
        PROVISIONED,
        ALREADY_PROVISIONED,
        /** TOKEN mode at startup: waiting for the configured account's first sign-in. */
        AWAITING_SIGN_IN,
        IDENTITY_NOT_VERIFIED,
        TENANT_ACCOUNT,
        ANOTHER_SUPER_ADMIN_EXISTS,
        EMAIL_IN_USE
    }

    private final NormaOneProperties properties;
    private final UserRepository userRepository;
    private final CognitoIdentityLookup identityLookup;
    private final AuditService auditService;

    public SuperAdminBootstrap(
            NormaOneProperties properties,
            UserRepository userRepository,
            CognitoIdentityLookup identityLookup,
            AuditService auditService) {
        this.properties = properties;
        this.userRepository = userRepository;
        this.identityLookup = identityLookup;
        this.auditService = auditService;
    }

    @Override
    public void run(ApplicationArguments args) {
        provision();
    }

    /**
     * The startup attempt. In COGNITO mode it verifies and provisions; in TOKEN mode it only checks
     * that provisioning would be allowed and reports that it is waiting for the first sign-in.
     */
    public Outcome provision() {
        NormaOneProperties.SuperAdmin cfg = config();
        if (!cfg.isEnabled()) {
            return Outcome.DISABLED;
        }
        String sub = configuredSub();
        String email = configuredEmail();
        if (sub == null || email == null) {
            return report(Outcome.MISCONFIGURED, "cognito-sub and email are both required");
        }

        Outcome blocked = blockers(sub, email);
        if (blocked != null) {
            return report(blocked, null);
        }

        if (cfg.getVerification() == NormaOneProperties.Verification.TOKEN) {
            log.warn("Super Admin bootstrap (TOKEN): {} will be provisioned at its first sign-in. Sign in as {} and call "
                    + "GET /api/users/me with the ID token.", sub, email);
            return Outcome.AWAITING_SIGN_IN;
        }

        Optional<CognitoIdentityLookup.Identity> found = identityLookup.adminGetUser(sub);
        if (found.isEmpty()) {
            return report(Outcome.IDENTITY_NOT_VERIFIED,
                    "Cognito AdminGetUser found no such account or was not permitted (use verification=TOKEN without AWS credentials)");
        }
        CognitoIdentityLookup.Identity id = found.get();
        if (!Boolean.TRUE.equals(id.confirmed()) || !id.hasVerifiedEmail() || !email.equals(id.email())
                || id.sub() == null || !sub.equals(id.sub())) {
            return report(Outcome.IDENTITY_NOT_VERIFIED,
                    "the Cognito account must be CONFIRMED, with this sub and this verified email");
        }
        return create(sub, email, "startup, verified with Cognito AdminGetUser");
    }

    /**
     * TOKEN mode: called with the caller's validated JWT before their record is looked up for linking
     * (AccountLinkService). Returns the Super Admin record when — and only when — bootstrap is
     * enabled in TOKEN mode, the token's sub is the configured one, and it is an ID token proving
     * the configured, verified email. For every other caller it does nothing and returns empty.
     */
    public Optional<user> provisionFromToken(Jwt jwt) {
        NormaOneProperties.SuperAdmin cfg = config();
        String sub = configuredSub();
        if (!cfg.isEnabled() || cfg.getVerification() != NormaOneProperties.Verification.TOKEN
                || jwt == null || sub == null || !sub.equals(jwt.getSubject())) {
            return Optional.empty();
        }
        String email = configuredEmail();
        if (email == null) {
            report(Outcome.MISCONFIGURED, "email is required");
            return Optional.empty();
        }
        String tokenEmail = CognitoIdentityLookup.normalizeEmail(jwt.getClaimAsString("email"));
        boolean verified = Boolean.parseBoolean(String.valueOf(jwt.getClaims().get("email_verified")));
        if (!"id".equals(jwt.getClaimAsString("token_use")) || !email.equals(tokenEmail) || !verified) {
            report(Outcome.IDENTITY_NOT_VERIFIED,
                    "sign in with the ID token of the configured account: its email must match and be verified");
            return Optional.empty();
        }

        Optional<user> existing = userRepository.findByCognitoSub(sub);
        Outcome blocked = blockers(sub, email);
        if (blocked == Outcome.ALREADY_PROVISIONED) {
            return existing;
        }
        if (blocked != null) {
            report(blocked, null);
            return Optional.empty();
        }
        return create(sub, email, "first sign-in, verified by the Cognito ID token") == Outcome.PROVISIONED
                ? userRepository.findByCognitoSub(sub)
                : Optional.empty();
    }

    // ==================== RULES ====================

    /** Why this sub and email must not be provisioned, or null when they may be. */
    private Outcome blockers(String sub, String email) {
        Optional<user> existing = userRepository.findByCognitoSub(sub);
        if (existing.isPresent()) {
            user u = existing.get();
            if (isPlatformSuperAdmin(u)) {
                if (u.getStatus() != UserStatus.ACTIVE) {
                    log.warn("Super Admin {} exists but is {}; the bootstrap never reactivates an account.", u.getId(), u.getStatus());
                }
                return Outcome.ALREADY_PROVISIONED;
            }
            return Outcome.TENANT_ACCOUNT;
        }
        List<user> byEmail = userRepository.findByEmail(email);
        boolean emailTakenByTenant = byEmail.stream()
                .anyMatch(u -> !isPlatformSuperAdmin(u) && u.getStatus() != UserStatus.DEACTIVATED);
        if (emailTakenByTenant) {
            return Outcome.EMAIL_IN_USE;
        }
        boolean hasExistingPlatformAdminForThisEmail = byEmail.stream().anyMatch(this::isPlatformSuperAdmin);
        if (!hasExistingPlatformAdminForThisEmail && !config().isAllowAdditional() && userRepository
                .findByRolesIn(UserAdministration.storedRolesFor(UserRole.SUPER_ADMIN)).stream()
                .anyMatch(this::isPlatformSuperAdmin)) {
            return Outcome.ANOTHER_SUPER_ADMIN_EXISTS;
        }
        return null;
    }

    private boolean isPlatformSuperAdmin(user u) {
        return (u.getTenantId() == null || u.getTenantId().isBlank()) && UserAdministration.hasPlatformRole(u);
    }

    private Outcome create(String sub, String email, String source) {
        NormaOneProperties.SuperAdmin cfg = config();
        List<user> byEmail = userRepository.findByEmail(email);
        Optional<user> existingPlatformOpt = byEmail.stream()
                .filter(this::isPlatformSuperAdmin)
                .findFirst();

        if (existingPlatformOpt.isPresent()) {
            user existing = existingPlatformOpt.get();
            existing.setCognitoSub(sub);
            existing.setStatus(UserStatus.ACTIVE);
            if (cfg.getName() != null && !cfg.getName().isBlank()) {
                existing.setName(cfg.getName().trim());
            }
            if (existing.getActivatedAt() == null) {
                existing.setActivatedAt(Instant.now());
            }
            user saved = userRepository.save(existing);
            auditService.recordAs(saved.getId(), "SUPER_ADMIN", AuditAction.SUPER_ADMIN_PROVISIONED, null, "USER",
                    saved.getId(), AuditService.details("source", source, "email", email, "updatedSub", "true"));
            log.info("Linked configured Super Admin {} ({}) with Cognito sub {} — {}.",
                    saved.getId(), email, sub, source);
            return Outcome.PROVISIONED;
        }

        user admin = user.builder()
                .tenantId(null)
                .cognitoSub(sub)
                .name(cfg.getName() != null && !cfg.getName().isBlank() ? cfg.getName().trim() : "Platform Administrator")
                .email(email)
                .status(UserStatus.ACTIVE)
                .roles(Set.of(UserRole.SUPER_ADMIN))
                .recordState(RecordState.ACTIVE)
                .activatedAt(Instant.now())
                .build();
        try {
            user saved = userRepository.insert(admin);
            auditService.recordAs(AuditService.SYSTEM, "SYSTEM", AuditAction.SUPER_ADMIN_PROVISIONED, null, "USER",
                    saved.getId(), AuditService.details("source", source, "email", email));
            log.warn("Provisioned Super Admin {} ({}) — {}. Disable the bootstrap now: unset NORMAONE_SUPER_ADMIN_ENABLED.",
                    saved.getId(), email, source);
            return Outcome.PROVISIONED;
        } catch (DuplicateKeyException race) {
            // A concurrent sign-in or start-up got there first: whatever it wrote decides the outcome.
            return userRepository.findByCognitoSub(sub).filter(this::isPlatformSuperAdmin).isPresent()
                    ? Outcome.ALREADY_PROVISIONED
                    : Outcome.TENANT_ACCOUNT;
        }
    }

    private Outcome report(Outcome outcome, String detail) {
        switch (outcome) {
            case ALREADY_PROVISIONED -> log.warn("Super Admin bootstrap: {} is already provisioned; nothing changed. "
                    + "Disable the bootstrap: unset NORMAONE_SUPER_ADMIN_ENABLED.", configuredSub());
            case TENANT_ACCOUNT -> log.error("Super Admin bootstrap refused: this Cognito account belongs to an organization, "
                    + "and a tenant account is never promoted. Use a separate Cognito account.");
            case ANOTHER_SUPER_ADMIN_EXISTS -> log.error("Super Admin bootstrap refused: a Super Admin already exists for "
                    + "another account. Set allow-additional=true only if a second one is really intended.");
            case EMAIL_IN_USE -> log.error("Super Admin bootstrap refused: this email belongs to a live account in an organization.");
            default -> log.error("Super Admin bootstrap: {} — {}. Nothing provisioned.", outcome, detail);
        }
        return outcome;
    }

    private NormaOneProperties.SuperAdmin config() {
        return properties.getBootstrap().getSuperAdmin();
    }

    private String configuredSub() {
        String sub = config().getCognitoSub();
        return sub == null || sub.isBlank() ? null : sub.trim();
    }

    private String configuredEmail() {
        return CognitoIdentityLookup.normalizeEmail(config().getEmail());
    }
}
