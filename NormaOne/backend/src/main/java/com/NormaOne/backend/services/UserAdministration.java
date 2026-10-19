package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import com.NormaOne.backend.dto.admin.UserResponse;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;

/**
 * Rules and queries shared by Tenant Admin and Super Admin user management.
 */
@Component
public class UserAdministration {

    public static final int MAX_PAGE_SIZE = 100;

    private final MongoTemplate mongoTemplate;

    public UserAdministration(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    /**
     * Roles a Tenant Admin may assign: ADMIN or USER (default USER). Platform roles are
     * never assignable through any API.
     */
    public static UserRole assignableTenantRole(UserRole requested) {
        if (requested == null) {
            return UserRole.USER;
        }
        if (requested.isPlatformRole()) {
            throw new ForbiddenOperationException("The SUPER_ADMIN role cannot be assigned through this API.");
        }
        if (requested != UserRole.ADMIN && requested != UserRole.USER) {
            throw new IllegalArgumentException("Role must be ADMIN or USER.");
        }
        return requested;
    }

    public static boolean hasPlatformRole(user u) {
        return u.getRoles() != null && u.getRoles().stream().anyMatch(UserRole::isPlatformRole);
    }

    public static boolean isTenantAdmin(user u) {
        return u.getRoles() != null && u.getRoles().stream().map(UserRole::canonical).anyMatch(r -> r == UserRole.ADMIN);
    }

    /**
     * Applies a status change after validating the transition:
     * - INVITED cannot be set directly (it is the state of a new invitation);
     * - ACTIVE needs a linked Cognito account; re-enabling a revoked invitation restores INVITED;
     * - SUSPENDED and DEACTIVATED need a reason; an invitation can only be DEACTIVATED (revoked).
     */
    public static void applyStatus(user target, UserStatus requested, String reason) {
        if (requested == UserStatus.INVITED) {
            throw new IllegalArgumentException("Status must be ACTIVE, SUSPENDED or DEACTIVATED.");
        }
        boolean linked = target.getCognitoSub() != null && !target.getCognitoSub().isBlank();
        UserStatus effective = requested == UserStatus.ACTIVE && !linked ? UserStatus.INVITED : requested;
        if (target.getStatus() == effective) {
            throw new ConflictException("The user is already " + effective + ".");
        }
        String cleanReason = reason != null && !reason.isBlank() ? reason.trim() : null;
        Instant now = Instant.now();
        switch (requested) {
            case ACTIVE -> {
                if (!linked && target.getStatus() != UserStatus.DEACTIVATED) {
                    throw new ConflictException("The user has not registered yet and becomes ACTIVE at first sign-in.");
                }
                target.setStatus(effective);
                if (linked) {
                    target.setActivatedAt(now);
                }
                target.setDeactivatedAt(null);
                target.setStatusReason(cleanReason);
            }
            case SUSPENDED, DEACTIVATED -> {
                if (cleanReason == null) {
                    throw new IllegalArgumentException("A reason is required to " + (requested == UserStatus.SUSPENDED ? "suspend" : "deactivate") + " a user.");
                }
                if (target.getStatus() == UserStatus.INVITED && requested == UserStatus.SUSPENDED) {
                    throw new ConflictException("A pending invitation cannot be suspended; deactivate it to revoke it.");
                }
                target.setStatus(requested);
                target.setDeactivatedAt(now);
                target.setStatusReason(cleanReason);
            }
            default -> throw new IllegalArgumentException("Status must be ACTIVE, SUSPENDED or DEACTIVATED.");
        }
    }

    /**
     * Paged user search. With {@code tenantId} the query is restricted to that tenant (always set
     * for Tenant Admin calls); {@code role} matches the canonical role (USER includes legacy roles).
     */
    public PageResponse<UserResponse> search(String tenantId, String search, UserStatus status, UserRole role, int page, int size) {
        Criteria scope = role != null ? Criteria.where("roles").in(storedRolesFor(role.canonical())) : null;
        UserPage found = findPage(scope, tenantId, search, status, page, size);
        return PageResponse.of(found.users().stream().map(UserResponse::of).toList(), found.page(), found.size(), found.total());
    }

    /** One page of user records, newest first, with the page and size actually applied. */
    public record UserPage(List<user> users, int page, int size, long total) {}

    /**
     * Paged search inside {@code scope} (an extra criteria, or null), optionally narrowed to one
     * tenant, one status and a name/email search. The Super Admin's admin and user lists pass the
     * scopes below, so which records count as "administrators" or "users" is decided here, on the
     * server, and never by a request parameter.
     */
    public UserPage findPage(Criteria scope, String tenantId, String search, UserStatus status, int page, int size) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        List<Criteria> filters = new ArrayList<>();
        if (scope != null) {
            filters.add(scope);
        }
        if (tenantId != null) {
            filters.add(Criteria.where("tenantId").is(tenantId));
        }
        if (status != null) {
            filters.add(Criteria.where("status").is(status));
        }
        if (search != null && !search.isBlank()) {
            String pattern = Pattern.quote(search.trim());
            filters.add(new Criteria().orOperator(
                    Criteria.where("name").regex(pattern, "i"),
                    Criteria.where("email").regex(pattern, "i")));
        }
        Query query = filters.isEmpty() ? new Query() : new Query(new Criteria().andOperator(filters));
        long total = mongoTemplate.count(query, user.class);
        query.with(Sort.by(Sort.Direction.DESC, "createdAt")).skip((long) safePage * safeSize).limit(safeSize);
        return new UserPage(mongoTemplate.find(query, user.class), safePage, safeSize, total);
    }

    /** Every stored role value that maps to {@code canonical}, legacy names included. */
    public static List<UserRole> storedRolesFor(UserRole canonical) {
        return Arrays.stream(UserRole.values()).filter(r -> r.canonical() == canonical).toList();
    }

    /**
     * Tenant administrators: an ADMIN role (or a legacy name for it), a tenant, and no platform role.
     * A record that somehow carries both ADMIN and SUPER_ADMIN is a platform account, not an admin.
     */
    public static Criteria adminScope() {
        return new Criteria().andOperator(
                Criteria.where("roles").in(storedRolesFor(UserRole.ADMIN)).nin(storedRolesFor(UserRole.SUPER_ADMIN)),
                Criteria.where("tenantId").ne(null));
    }

    /** Regular users: a USER role (or a legacy name for it) and neither an admin nor a platform role. */
    public static Criteria regularUserScope() {
        List<UserRole> elevated = new ArrayList<>(storedRolesFor(UserRole.ADMIN));
        elevated.addAll(storedRolesFor(UserRole.SUPER_ADMIN));
        return Criteria.where("roles").in(storedRolesFor(UserRole.USER)).nin(elevated);
    }

    /**
     * Platform Super Admins: a platform role (or its legacy name) on a record without a tenant. A
     * platform role stored on a tenant record grants nothing (CurrentUserResolver) and is not listed.
     */
    public static Criteria superAdminScope() {
        return new Criteria().andOperator(
                Criteria.where("roles").in(storedRolesFor(UserRole.SUPER_ADMIN)),
                new Criteria().orOperator(Criteria.where("tenantId").is(null), Criteria.where("tenantId").is("")));
    }

    /** Whether a record is a platform Super Admin, by the same rule as {@link #superAdminScope()}. */
    public static boolean isPlatformSuperAdmin(user u) {
        return (u.getTenantId() == null || u.getTenantId().isBlank()) && hasPlatformRole(u);
    }

    /** The canonical role a record is listed under: SUPER_ADMIN, ADMIN, USER, or null for a record with no usable role. */
    public static UserRole accountRole(user u) {
        if (isPlatformSuperAdmin(u)) {
            return UserRole.SUPER_ADMIN;
        }
        if (isAdminAccount(u)) {
            return UserRole.ADMIN;
        }
        return isRegularUser(u) ? UserRole.USER : null;
    }

    /** Whether a record is a tenant administrator, by the same rule as {@link #adminScope()}. */
    public static boolean isAdminAccount(user u) {
        return u.getTenantId() != null && !u.getTenantId().isBlank() && isTenantAdmin(u) && !hasPlatformRole(u);
    }

    /** Whether a record is a regular user, by the same rule as {@link #regularUserScope()}. */
    public static boolean isRegularUser(user u) {
        return u.getRoles() != null
                && u.getRoles().stream().map(UserRole::canonical).anyMatch(r -> r == UserRole.USER)
                && !isTenantAdmin(u) && !hasPlatformRole(u);
    }
}
