package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.bson.Document;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.aggregation.Aggregation;
import org.springframework.data.mongodb.core.aggregation.AggregationOperation;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.admin.CreateTenantRequest;
import com.NormaOne.backend.dto.admin.InvitationInfo;
import com.NormaOne.backend.dto.admin.PlatformDashboardResponse;
import com.NormaOne.backend.dto.admin.TenantResponse;
import com.NormaOne.backend.dto.admin.TenantStatusRequest;
import com.NormaOne.backend.dto.admin.UpdateTenantRequest;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.DuplicateSubdomainException;
import com.NormaOne.backend.exceptions.InvitationDeliveryException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.TenantSubscriptionRepository;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * Platform administration (SUPER_ADMIN only, re-checked here for every call).
 *
 * Organizations and the dashboard. Administrators, regular users and the audit trail are in
 * SuperAdminAccountService.
 *
 * There is deliberately no endpoint that changes an existing account's role: no account is ever
 * promoted to Super Admin. New Super Admins are invited as platform accounts (PlatformAccountService);
 * the first one is provisioned by SuperAdminBootstrap.
 */
@Service
public class SuperAdminService {

    private final CurrentUserService currentUserService;
    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final TenantSubscriptionRepository subscriptionRepository;
    private final PackageService packageService;
    private final TenantProvisioningService provisioningService;
    private final AuditService auditService;
    private final MongoTemplate mongoTemplate;
    private final CognitoInvitationService cognitoInvitations;

    public SuperAdminService(
            CurrentUserService currentUserService,
            TenantRepository tenantRepository,
            UserRepository userRepository,
            TenantSubscriptionRepository subscriptionRepository,
            PackageService packageService,
            TenantProvisioningService provisioningService,
            AuditService auditService,
            MongoTemplate mongoTemplate,
            CognitoInvitationService cognitoInvitations) {
        this.currentUserService = currentUserService;
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.packageService = packageService;
        this.provisioningService = provisioningService;
        this.auditService = auditService;
        this.mongoTemplate = mongoTemplate;
        this.cognitoInvitations = cognitoInvitations;
    }

    // ==================== TENANTS ====================

    public PageResponse<TenantResponse> listTenants(Jwt jwt, String search, TenantStatus status, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), UserAdministration.MAX_PAGE_SIZE);
        List<Criteria> filters = new ArrayList<>();
        if (status != null) {
            filters.add(Criteria.where("status").is(status));
        }
        if (search != null && !search.isBlank()) {
            String pattern = Pattern.quote(search.trim());
            filters.add(new Criteria().orOperator(
                    Criteria.where("tenantName").regex(pattern, "i"),
                    Criteria.where("subdomain").regex(pattern, "i"),
                    Criteria.where("emailAddress").regex(pattern, "i")));
        }
        Query query = filters.isEmpty() ? new Query() : new Query(new Criteria().andOperator(filters));
        long total = mongoTemplate.count(query, Tenant.class);
        query.with(Sort.by(Sort.Direction.DESC, "createdAt")).skip((long) safePage * safeSize).limit(safeSize);
        List<Tenant> tenants = mongoTemplate.find(query, Tenant.class);
        Map<String, String> planByTenant = subscriptionRepository
                .findByTenantIdInAndCurrentTrue(tenants.stream().map(Tenant::getId).toList())
                .stream()
                .collect(Collectors.toMap(TenantSubscription::getTenantId, s -> String.valueOf(s.getPlanCode()), (a, b) -> a));
        List<TenantResponse> content = tenants.stream()
                .map(t -> TenantResponse.of(t, planByTenant.get(t.getId()), null, null))
                .toList();
        return PageResponse.of(content, safePage, safeSize, total);
    }

    /**
     * Creates an ACTIVE tenant with the default package and an invited ADMIN. Cognito emails that
     * administrator a temporary password; they become ACTIVE at their first sign-in after setting a
     * permanent one. Creating the tenant grants nobody else anything.
     */
    public TenantResponse createTenant(Jwt jwt, CreateTenantRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        String subdomain = request.subdomain().trim().toLowerCase(Locale.ROOT);
        if (tenantRepository.existsBySubdomain(subdomain)) {
            throw new DuplicateSubdomainException(
                    "Subdomain '" + subdomain + "' is already taken. Please choose a different subdomain.");
        }
        String adminEmail = CognitoIdentityLookup.normalizeEmail(request.initialAdmin().email());
        String contactEmail = request.emailAddress() != null && !request.emailAddress().isBlank()
                ? CognitoIdentityLookup.normalizeEmail(request.emailAddress()) : adminEmail;
        String holder = request.accountHolderName() != null && !request.accountHolderName().isBlank()
                ? request.accountHolderName().trim() : request.initialAdmin().name().trim();

        TenantProvisioningService.Provisioned provisioned = provisioningService.provision(
                new TenantProvisioningService.TenantDraft(request.organizationName().trim(), holder, subdomain,
                        request.countryCode(), request.defaultLocale(), request.defaultTimeZone(), contactEmail,
                        request.phoneNumber(), request.addressLine(), request.city(), request.postalCode(),
                        request.logoUrl(), null),
                new TenantProvisioningService.AdminSeed(request.initialAdmin().name().trim(), adminEmail,
                        request.initialAdmin().phoneNumber(), null),
                SubscriptionSource.SUPER_ADMIN, actor.userId());

        Tenant tenant = provisioned.tenant();
        // The administrator's Cognito invitation is part of creating the tenant: if it fails, the
        // tenant, its package and the invitation record are discarded, and the request can be retried.
        InvitationInfo delivered;
        try {
            delivered = cognitoInvitations.invite(provisioned.admin().getEmail(), provisioned.admin().getName());
        } catch (InvitationDeliveryException ex) {
            provisioningService.discardAbandoned(tenant);
            throw ex;
        }
        auditService.record(actor, AuditAction.TENANT_CREATED, tenant.getId(), "TENANT", tenant.getId(),
                AuditService.details("subdomain", tenant.getSubdomain()));
        auditService.record(actor, AuditAction.USER_INVITED, tenant.getId(), "USER", provisioned.admin().getId(),
                AuditService.details("role", UserRole.ADMIN.name(), "delivery", delivered.delivery()));
        if (provisioned.subscription() != null) {
            auditService.record(actor, AuditAction.PACKAGE_ASSIGNED, tenant.getId(), "SUBSCRIPTION",
                    provisioned.subscription().getId(), AuditService.details("planCode", provisioned.subscription().getPlanCode(),
                            "source", SubscriptionSource.SUPER_ADMIN.name()));
        }
        TenantPackageResponse pkg = packageService.describeIfAssigned(tenant.getId()).orElse(null);
        return TenantResponse.of(tenant, pkg != null && pkg.plan() != null ? pkg.plan().planCode() : null, 1L, pkg)
                .withAdminInvitation(delivered);
    }

    public TenantResponse getTenant(Jwt jwt, String tenantId) {
        currentUserService.requireSuperAdmin(jwt);
        Tenant tenant = findTenant(tenantId);
        TenantPackageResponse pkg = packageService.describeIfAssigned(tenant.getId()).orElse(null);
        return TenantResponse.of(tenant, pkg != null && pkg.plan() != null ? pkg.plan().planCode() : null,
                userRepository.countByTenantId(tenant.getId()), pkg);
    }

    public TenantResponse updateTenant(Jwt jwt, String tenantId, UpdateTenantRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        Tenant tenant = findTenant(tenantId);
        List<String> changed = new ArrayList<>();
        changed.addAll(setRequired(request.tenantName(), tenant.getTenantName(), tenant::setTenantName, "tenantName"));
        changed.addAll(setRequired(request.accountHolderName(), tenant.getAccountHolderName(), tenant::setAccountHolderName, "accountHolderName"));
        changed.addAll(set(lower(request.emailAddress()), tenant.getEmailAddress(), tenant::setEmailAddress, "emailAddress"));
        changed.addAll(set(request.phoneNumber(), tenant.getPhoneNumber(), tenant::setPhoneNumber, "phoneNumber"));
        changed.addAll(set(request.addressLine(), tenant.getAddressLine(), tenant::setAddressLine, "addressLine"));
        changed.addAll(set(request.city(), tenant.getCity(), tenant::setCity, "city"));
        changed.addAll(set(request.postalCode(), tenant.getPostalCode(), tenant::setPostalCode, "postalCode"));
        changed.addAll(set(request.logoUrl(), tenant.getLogoUrl(), tenant::setLogoUrl, "logoUrl"));
        if (request.defaultLocale() != null && request.defaultLocale() != tenant.getDefaultLocale()) {
            tenant.setDefaultLocale(request.defaultLocale());
            changed.add("defaultLocale");
        }
        if (request.defaultTimeZone() != null && request.defaultTimeZone() != tenant.getDefaultTimeZone()) {
            tenant.setDefaultTimeZone(request.defaultTimeZone());
            changed.add("defaultTimeZone");
        }
        if (changed.isEmpty()) {
            return getTenant(jwt, tenantId);
        }
        Tenant saved = tenantRepository.save(tenant);
        auditService.record(actor, AuditAction.TENANT_UPDATED, saved.getId(), "TENANT", saved.getId(),
                AuditService.details("fields", String.join(",", changed)));
        return getTenant(jwt, tenantId);
    }

    public TenantResponse changeTenantStatus(Jwt jwt, String tenantId, TenantStatusRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        Tenant tenant = findTenant(tenantId);
        TenantStatus target = request.status();
        if (target != TenantStatus.ACTIVE && target != TenantStatus.SUSPENDED) {
            throw new IllegalArgumentException("Status must be ACTIVE or SUSPENDED.");
        }
        TenantStatus previous = tenant.getStatus();
        if (previous == TenantStatus.PROVISIONING || previous == TenantStatus.DELETED) {
            throw new ConflictException("A tenant in status " + previous + " cannot be " + (target == TenantStatus.ACTIVE ? "activated" : "suspended") + " here.");
        }
        if (previous == target) {
            throw new ConflictException("The tenant is already " + target + ".");
        }
        String reason = request.reason() != null && !request.reason().isBlank() ? request.reason().trim() : null;
        Instant now = Instant.now();
        if (target == TenantStatus.SUSPENDED) {
            if (reason == null) {
                throw new IllegalArgumentException("A reason is required to suspend a tenant.");
            }
            tenant.setSuspendedAt(now);
        } else {
            tenant.setActivatedAt(now);
            tenant.setSuspendedAt(null);
        }
        tenant.setStatus(target);
        tenant.setStatusReason(reason);
        Tenant saved = tenantRepository.save(tenant);
        auditService.record(actor, AuditAction.TENANT_STATUS_CHANGED, saved.getId(), "TENANT", saved.getId(),
                AuditService.details("from", String.valueOf(previous), "to", String.valueOf(target), "reason", reason));
        return getTenant(jwt, tenantId);
    }

    public TenantPackageResponse getTenantPackage(Jwt jwt, String tenantId) {
        currentUserService.requireSuperAdmin(jwt);
        Tenant tenant = findTenant(tenantId);
        return packageService.describe(tenant.getId());
    }

    // ==================== DASHBOARD ====================

    /**
     * Platform-wide counts. Each map is one database aggregation ($match, $group by status), so
     * nothing is loaded into memory however many records there are; every status appears, with 0
     * when there is none.
     */
    public PlatformDashboardResponse dashboard(Jwt jwt) {
        currentUserService.requireSuperAdmin(jwt);
        Map<String, Long> organizations = countBy(Tenant.class, null, "status", TenantStatus.values());
        Map<String, Long> admins = countBy(user.class, UserAdministration.adminScope(), "status", UserStatus.values());
        Map<String, Long> users = countBy(user.class, UserAdministration.regularUserScope(), "status", UserStatus.values());
        Map<String, Long> byPlan = countBy(TenantSubscription.class, Criteria.where("current").is(true), "planCode", null);
        long superAdmins = mongoTemplate.count(
                new Query(Criteria.where("roles").in(UserAdministration.storedRolesFor(UserRole.SUPER_ADMIN))), user.class);
        return new PlatformDashboardResponse(
                sum(organizations), organizations,
                sum(admins), admins.get(UserStatus.ACTIVE.name()), inactive(admins), admins,
                sum(users), users.get(UserStatus.ACTIVE.name()), inactive(users), users,
                superAdmins, byPlan);
    }

    /** Counts of {@code type} matching {@code scope}, grouped by {@code field}; {@code keys} pre-fills zeros. */
    private Map<String, Long> countBy(Class<?> type, Criteria scope, String field, Enum<?>[] keys) {
        Map<String, Long> counts = new LinkedHashMap<>();
        if (keys != null) {
            for (Enum<?> key : keys) {
                counts.put(key.name(), 0L);
            }
        }
        List<AggregationOperation> stages = new ArrayList<>();
        if (scope != null) {
            stages.add(Aggregation.match(scope));
        }
        stages.add(Aggregation.group(field).count().as("count"));
        for (Document row : mongoTemplate.aggregate(Aggregation.newAggregation(stages), type, Document.class)) {
            counts.merge(String.valueOf(row.get("_id")), ((Number) row.get("count")).longValue(), Long::sum);
        }
        return counts;
    }

    private static long sum(Map<String, Long> counts) {
        return counts.values().stream().mapToLong(Long::longValue).sum();
    }

    private static long inactive(Map<String, Long> byStatus) {
        return byStatus.getOrDefault(UserStatus.SUSPENDED.name(), 0L) + byStatus.getOrDefault(UserStatus.DEACTIVATED.name(), 0L);
    }

    // ==================== HELPERS ====================

    private Tenant findTenant(String tenantId) {
        return tenantRepository.findById(tenantId).orElseThrow(() -> new ResourceNotFoundException("Tenant not found."));
    }

    private static List<String> set(String requested, String current, java.util.function.Consumer<String> setter, String field) {
        if (requested == null) {
            return List.of();
        }
        String value = requested.isBlank() ? null : requested.trim();
        if (value == null ? current == null : value.equals(current)) {
            return List.of();
        }
        setter.accept(value);
        return List.of(field);
    }

    private static List<String> setRequired(String requested, String current, java.util.function.Consumer<String> setter, String field) {
        if (requested != null && requested.isBlank()) {
            throw new IllegalArgumentException(field + " cannot be blank.");
        }
        return set(requested, current, setter, field);
    }

    private static String lower(String email) {
        return email == null ? null : email.isBlank() ? "" : email.trim().toLowerCase(Locale.ROOT);
    }
}
