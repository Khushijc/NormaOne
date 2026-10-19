package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Objects;

import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.user.EmailPreferenceResponse;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * Email-notification preferences: who may read and change whose, and whom an email may go to.
 *
 * THE DEFAULT is enabled: an account whose preference was never set (every existing account, and a
 * new one until it changes it) receives email. Email is opt-out; in-app notifications are never
 * affected by it.
 *
 * WHO MAY CHANGE WHAT (the actor always comes from the validated token and their stored record):
 * <ul>
 *   <li>Anyone with an active account — SUPER_ADMIN, ADMIN or USER — reads and changes their own
 *       preference (/api/users/me/email-preference). There is no user id to supply, so nobody can
 *       reach another account through it.</li>
 *   <li>An ACTIVE ADMIN of an ACTIVE organization reads and changes the preference of the regular
 *       USER accounts of that organization (/api/tenant/users/{id}/email-preference). Another
 *       organization's account is 404 — the lookup is filtered by the admin's own tenant — and another
 *       administrator, a platform account or their own account through this route is 403: an
 *       administrator's preference is theirs to set.</li>
 *   <li>A Super Admin has no control over tenant accounts' preferences.</li>
 * </ul>
 * Every change is audited as USER_EMAIL_PREFERENCE_CHANGED and written as a single-field update, so
 * it never overwrites a concurrent change to the rest of the record.
 */
@Service
public class EmailPreferenceService {

    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final MongoTemplate mongoTemplate;
    private final AuditService auditService;
    private final EmailSender emailSender;

    public EmailPreferenceService(CurrentUserService currentUserService, UserRepository userRepository, MongoTemplate mongoTemplate,
            AuditService auditService, EmailSender emailSender) {
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.mongoTemplate = mongoTemplate;
        this.auditService = auditService;
        this.emailSender = emailSender;
    }

    /** The effective preference: true unless it was turned off. */
    public static boolean enabled(user u) {
        return u != null && !Boolean.FALSE.equals(u.getEmailNotificationsEnabled());
    }

    /** The accounts among {@code candidates} that may be emailed: email turned on and an address on record. */
    public static List<user> recipients(Collection<user> candidates) {
        return candidates.stream().filter(Objects::nonNull).filter(EmailPreferenceService::enabled)
                .filter(u -> u.getEmail() != null && !u.getEmail().isBlank()).toList();
    }

    // ==================== own ====================

    public EmailPreferenceResponse own(Jwt jwt) {
        CurrentUser me = requireActiveAccount(jwt);
        return view(me.user(), me.role());
    }

    public EmailPreferenceResponse setOwn(Jwt jwt, boolean enabled) {
        CurrentUser me = requireActiveAccount(jwt);
        user saved = write(me, me.user(), enabled, "SELF");
        return view(saved, me.role());
    }

    // ==================== a Tenant Admin's team ====================

    public EmailPreferenceResponse forTeamUser(Jwt jwt, String userId) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        user target = teamUser(admin, userId);
        return view(target, UserAdministration.accountRole(target));
    }

    public EmailPreferenceResponse setForTeamUser(Jwt jwt, String userId, boolean enabled) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        user target = teamUser(admin, userId);
        user saved = write(admin, target, enabled, "ADMIN");
        return view(saved, UserAdministration.accountRole(saved));
    }

    /**
     * A regular USER of the admin's own organization. The tenant filter is part of the lookup, so
     * another organization's id is simply not found.
     */
    private user teamUser(CurrentUser admin, String userId) {
        user target = userRepository.findByIdAndTenantId(userId, admin.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("User not found in your organization."));
        if (target.getId().equals(admin.userId())) {
            throw new ForbiddenOperationException("Change your own email preference in your own settings (/api/users/me/email-preference).");
        }
        if (!UserAdministration.isRegularUser(target) || UserAdministration.hasPlatformRole(target)) {
            throw new ForbiddenOperationException("Administrators manage their own email preference; only USER accounts are managed here.");
        }
        return target;
    }

    // ==================== helpers ====================

    /** Any account that acts with a role now: ACTIVE, and its organization ACTIVE (SUPER_ADMIN, ADMIN, USER). */
    private CurrentUser requireActiveAccount(Jwt jwt) {
        CurrentUser current = currentUserService.current(jwt);
        if (current.role() == null || !current.hasRecord()) {
            throw new AccessDeniedException("An active account is required.");
        }
        return current;
    }

    private user write(CurrentUser actor, user target, boolean enabled, String by) {
        boolean before = enabled(target);
        user saved = mongoTemplate.findAndModify(new Query(Criteria.where("id").is(target.getId())),
                new Update().set("emailNotificationsEnabled", enabled).set("updatedAt", Instant.now()).set("updatedByDocsId", actor.userId())
                        .inc("version", 1),
                FindAndModifyOptions.options().returnNew(true), user.class);
        if (saved == null) {
            throw new ResourceNotFoundException("User not found.");
        }
        auditService.record(actor, AuditAction.USER_EMAIL_PREFERENCE_CHANGED, saved.getTenantId(), "USER", saved.getId(),
                AuditService.details("from", before ? "enabled" : "disabled", "to", enabled ? "enabled" : "disabled", "by", by));
        return saved;
    }

    private EmailPreferenceResponse view(user u, UserRole role) {
        return EmailPreferenceResponse.of(u, role, emailSender.configured());
    }
}
