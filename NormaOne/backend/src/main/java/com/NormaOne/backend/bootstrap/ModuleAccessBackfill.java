package com.NormaOne.backend.bootstrap;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Component;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.services.AuditService;
import com.NormaOne.backend.services.UserAdministration;

/**
 * Gives tenant accounts created before default module assignment existed the assignment a new
 * account receives: all six modules, with the role's default permissions (ModuleCatalog) — or every
 * permission for the owner who registered the organization themselves (their Cognito account onboarded
 * the tenant), as a newly registered owner gets. Runs at startup only when
 * {@code normaone.modules.backfill-defaults=true}.
 *
 * WHO IS TOUCHED — only a record that was never assigned modules:
 * <ul>
 *   <li>it has a tenant (a Super Admin, which has none, is never touched);</li>
 *   <li>it has no {@code moduleAccessAssignedAt};</li>
 *   <li>its {@code moduleAccess} and {@code modulePermissions} are missing or empty — the model writes
 *       [] on every save, so an empty list alone does not mean "customized";</li>
 *   <li>no USER_MODULE_ACCESS_CHANGED audit event exists for it (an administrator emptied it on purpose
 *       before the marker existed);</li>
 *   <li>it is a tenant ADMIN or a regular USER (legacy role names included), with no platform role.</li>
 * </ul>
 * Everything else — any assignment, however narrow — is left exactly as it is.
 *
 * IDEMPOTENT: each update is conditional on the record still having no marker, and sets the marker,
 * so running it twice (or on two instances at once) assigns once. Each assignment is audited as
 * USER_MODULE_ACCESS_CHANGED by "system" with source BACKFILL.
 */
@Component
@Order(25)
public class ModuleAccessBackfill implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ModuleAccessBackfill.class);

    /** What a run did. */
    public record Result(int candidates, int assignedAdmins, int assignedUsers, int skipped) {}

    private final MongoTemplate mongoTemplate;
    private final NormaOneProperties properties;
    private final AuditService auditService;

    public ModuleAccessBackfill(MongoTemplate mongoTemplate, NormaOneProperties properties, AuditService auditService) {
        this.mongoTemplate = mongoTemplate;
        this.properties = properties;
        this.auditService = auditService;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (properties.getModules().isBackfillDefaults()) {
            backfill();
        }
    }

    public Result backfill() {
        Set<String> customized = new HashSet<>(mongoTemplate.findDistinct(
                new Query(Criteria.where("action").is(AuditAction.USER_MODULE_ACCESS_CHANGED)), "targetId", AuditEvent.class, String.class));
        List<user> candidates = mongoTemplate.find(new Query(neverAssigned()), user.class);
        int admins = 0;
        int users = 0;
        int skipped = 0;
        for (user u : candidates) {
            UserRole role = UserAdministration.hasPlatformRole(u) ? null
                    : UserAdministration.isTenantAdmin(u) ? UserRole.ADMIN
                    : UserAdministration.isRegularUser(u) ? UserRole.USER : null;
            if (role == null || customized.contains(u.getId())) {
                skipped++;
                continue;
            }
            boolean owner = role == UserRole.ADMIN && isOwner(u);
            List<String> modules = ModuleCatalog.toStoredModules(ModuleCatalog.defaultModulesFor(role));
            List<String> permissions = ModuleCatalog.toStoredPermissions(
                    owner ? ModuleCatalog.ownerPermissions() : ModuleCatalog.defaultPermissionsFor(role));
            long updated = mongoTemplate.updateFirst(
                    new Query(new Criteria().andOperator(Criteria.where("id").is(u.getId()), neverAssigned())),
                    new Update().set("moduleAccess", modules).set("modulePermissions", permissions)
                            .set("moduleAccessAssignedAt", Instant.now()),
                    user.class).getModifiedCount();
            if (updated == 0) {
                skipped++;
                continue;
            }
            auditService.recordAs(AuditService.SYSTEM, "SYSTEM", AuditAction.USER_MODULE_ACCESS_CHANGED, u.getTenantId(), "USER",
                    u.getId(), AuditService.details("source", "BACKFILL", "role", owner ? "OWNER" : role.name(), "modulesTo", String.join(",", modules),
                            "permissionsTo", String.join(",", permissions)));
            if (role == UserRole.ADMIN) {
                admins++;
            } else {
                users++;
            }
        }
        Result result = new Result(candidates.size(), admins, users, skipped);
        log.warn("Module access backfill: {} candidate(s); default modules assigned to {} administrator(s) and {} user(s); {} skipped. "
                + "Accounts with any existing assignment were not touched. Turn it off again: unset NORMAONE_MODULES_BACKFILL_DEFAULTS.",
                result.candidates(), admins, users, skipped);
        return result;
    }

    /** Whether {@code u} registered their organization themselves (the tenant was onboarded by their Cognito account). */
    private boolean isOwner(user u) {
        if (u.getCognitoSub() == null || u.getCognitoSub().isBlank()) {
            return false;
        }
        Tenant tenant = mongoTemplate.findById(u.getTenantId(), Tenant.class);
        return tenant != null && u.getCognitoSub().equals(tenant.getOnboardedByCognitoSub());
    }

    /** A tenant record that was never assigned modules (see the class comment). */
    private static Criteria neverAssigned() {
        return new Criteria().andOperator(
                Criteria.where("tenantId").exists(true).nin(null, ""),
                Criteria.where("moduleAccessAssignedAt").exists(false),
                new Criteria().orOperator(Criteria.where("moduleAccess").exists(false), Criteria.where("moduleAccess").size(0)),
                new Criteria().orOperator(Criteria.where("modulePermissions").exists(false), Criteria.where("modulePermissions").size(0)));
    }
}
