package com.NormaOne.backend.services;

import java.util.List;
import java.util.function.Supplier;

import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.repositories.PlanDefinitionRepository;

/**
 * User seats: the plan's {@code maxUsers}, enforced on the backend.
 *
 * THE LIMIT is the {@code maxUsers} of the plan version the organization's current subscription
 * references (published versions are immutable, so it cannot change under a subscription). No current
 * subscription, or a plan without maxUsers, means no limit.
 *
 * WHAT TAKES A SEAT: every account of the organization, administrators and users alike, that is
 * ACTIVE, INVITED (a pending invitation reserves its seat, or more invitations than seats could be
 * sent) or SUSPENDED (temporarily blocked, still the organization's, and reactivated without a new
 * invitation). A DEACTIVATED account frees its seat. Platform accounts belong to no organization.
 *
 * WHAT NEEDS A FREE SEAT: inviting a user or an administrator (by a Tenant Admin or a Super Admin),
 * and reactivating a DEACTIVATED account. Moving to a plan with fewer seats than are in use is allowed
 * — nobody loses access — but no seat is given out until enough accounts are deactivated.
 *
 * CONCURRENCY: the check and the write run under the organization's seat lock
 * (ResourceLockService, "seats:{tenantId}"), so simultaneous invitations cannot exceed the limit.
 */
@Service
public class SeatService {

    /** The statuses that occupy a seat. */
    public static final List<UserStatus> SEATED = List.of(UserStatus.ACTIVE, UserStatus.INVITED, UserStatus.SUSPENDED);

    private final PackageService packageService;
    private final PlanDefinitionRepository planRepository;
    private final MongoTemplate mongoTemplate;
    private final ResourceLockService locks;

    public SeatService(PackageService packageService, PlanDefinitionRepository planRepository, MongoTemplate mongoTemplate,
            ResourceLockService locks) {
        this.packageService = packageService;
        this.planRepository = planRepository;
        this.mongoTemplate = mongoTemplate;
        this.locks = locks;
    }

    /** The organization's seat limit, or null for no limit. */
    public Integer limitOf(String tenantId) {
        return packageService.currentSubscription(tenantId)
                .flatMap(s -> planRepository.findById(s.getPlanDocsId()))
                .map(PlanDefinition::getMaxUsers)
                .orElse(null);
    }

    /** Seats in use: the organization's ACTIVE, INVITED and SUSPENDED accounts. */
    public long usedBy(String tenantId) {
        return mongoTemplate.count(new Query(Criteria.where("tenantId").is(tenantId).and("status").in(SEATED)), user.class);
    }

    /** Limit and usage, as shown with a package. */
    public TenantPackageResponse.Seats seatsOf(String tenantId) {
        return new TenantPackageResponse.Seats(limitOf(tenantId), usedBy(tenantId));
    }

    /**
     * Runs {@code takeSeat} — a write that gives one more account a seat — only if a seat is free,
     * all under the organization's seat lock. 409 when the limit is reached; nothing is written then.
     */
    public <T> T withFreeSeat(String tenantId, Supplier<T> takeSeat) {
        return locks.withLock("seats:" + tenantId, () -> {
            Integer limit = limitOf(tenantId);
            if (limit != null) {
                long used = usedBy(tenantId);
                if (used >= limit) {
                    throw new ConflictException("The organization's plan allows " + limit + " user seat" + (limit == 1 ? "" : "s")
                            + " and " + used + " " + (used == 1 ? "is" : "are") + " in use (active, suspended and invited accounts). "
                            + "Deactivate an account or move to a plan with more seats first.");
                }
            }
            return takeSeat.get();
        });
    }

    /** Whether moving an account from {@code from} to {@code to} gives it a seat it did not have. */
    public static boolean takesASeat(UserStatus from, UserStatus to) {
        return !SEATED.contains(from) && SEATED.contains(to);
    }
}
