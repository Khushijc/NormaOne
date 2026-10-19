package com.NormaOne.backend.services;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Currency;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.bson.types.ObjectId;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.dto.admin.OrganizationSummary;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.plans.ChangeTenantPlanRequest;
import com.NormaOne.backend.dto.plans.CreatePlanRequest;
import com.NormaOne.backend.dto.plans.PlanHistoryResponse;
import com.NormaOne.backend.dto.plans.PlanResponse;
import com.NormaOne.backend.dto.plans.PlanStatusRequest;
import com.NormaOne.backend.dto.plans.SubscriptionHistoryResponse;
import com.NormaOne.backend.dto.plans.TenantSubscriptionResponse;
import com.NormaOne.backend.dto.plans.UpdatePlanRequest;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.modules.ModuleCatalog;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.PlanHistoryEntry;
import com.NormaOne.backend.model.plans.SubscriptionHistory;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.NormaOne.backend.repositories.PlanDefinitionRepository;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * Plans ("packages") and tenant subscriptions, for the Super Admin only (re-checked in every method).
 *
 * PLAN VERSIONS ARE IMMUTABLE ONCE PUBLISHED, as PlanDefinition requires: a DRAFT can be edited
 * freely; any other plan changes only its metadata (name, description, public availability, sale
 * period). New pricing, billing cycle, duration, trial, limits or modules are a new version of the
 * same plan code, created as DRAFT and activated when ready. Existing subscriptions keep the version
 * they were assigned, whatever happens to the plan afterwards. Nothing deletes a plan.
 *
 * STATUS decides only whether a plan can be assigned from now on (ACTIVE). The latest ACTIVE version
 * of the configured default plan code is what every new organization receives, so the last one of
 * those cannot be deactivated or archived (409) — onboarding would stop working.
 *
 * HISTORY: every create, update and status change is recorded in the plan history together with the
 * change itself (PlanHistoryService.withEntry), with the previous and new value of each field.
 *
 * A PLAN CHANGE goes through PackageService.changePackage: the subscription history and the plan
 * history record it and the previous subscription is closed. No payment is taken: there is no
 * billing integration.
 */
@Service
public class PlanAdminService {

    private final CurrentUserService currentUserService;
    private final PlanDefinitionRepository planRepository;
    private final TenantRepository tenantRepository;
    private final PackageService packageService;
    private final AuditService auditService;
    private final MongoTemplate mongoTemplate;
    private final NormaOneProperties properties;
    private final PlanHistoryService planHistory;

    public PlanAdminService(
            CurrentUserService currentUserService,
            PlanDefinitionRepository planRepository,
            TenantRepository tenantRepository,
            PackageService packageService,
            AuditService auditService,
            MongoTemplate mongoTemplate,
            NormaOneProperties properties,
            PlanHistoryService planHistory) {
        this.currentUserService = currentUserService;
        this.planRepository = planRepository;
        this.tenantRepository = tenantRepository;
        this.packageService = packageService;
        this.auditService = auditService;
        this.mongoTemplate = mongoTemplate;
        this.properties = properties;
        this.planHistory = planHistory;
    }

    // ==================== PLANS ====================

    /** Plans, by code then newest version first, narrowed by status and code. */
    public PageResponse<PlanResponse> listPlans(Jwt jwt, PlanStatus status, String planCode, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), UserAdministration.MAX_PAGE_SIZE);
        List<Criteria> filters = new ArrayList<>();
        if (status != null) {
            filters.add(Criteria.where("status").is(status));
        }
        if (planCode != null && !planCode.isBlank()) {
            filters.add(Criteria.where("planCode").is(normalizeCode(planCode)));
        }
        Query query = filters.isEmpty() ? new Query() : new Query(new Criteria().andOperator(filters));
        long total = mongoTemplate.count(query, PlanDefinition.class);
        query.with(Sort.by(Sort.Order.asc("planCode"), Sort.Order.desc("planVersion"))).skip((long) safePage * safeSize).limit(safeSize);
        List<PlanDefinition> plans = mongoTemplate.find(query, PlanDefinition.class);
        Map<String, Integer> latest = latestVersions(plans);
        List<PlanResponse> content = plans.stream()
                .map(p -> PlanResponse.of(p, null, isLatest(p, latest))).toList();
        return PageResponse.of(content, safePage, safeSize, total);
    }

    public PlanResponse getPlan(Jwt jwt, String planId) {
        currentUserService.requireSuperAdmin(jwt);
        return describe(findPlan(planId));
    }

    /** Creates a DRAFT plan, or a new DRAFT version of an existing plan code. Never the default plan. */
    public PlanResponse createPlan(Jwt jwt, CreatePlanRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        String code = normalizeCode(request.planCode());
        int version = request.planVersion() != null ? request.planVersion()
                : planRepository.findFirstByPlanCodeOrderByPlanVersionDesc(code).map(p -> p.getPlanVersion() + 1).orElse(1);
        requireSalePeriod(request.effectiveFrom(), request.effectiveUntil());
        PlanDefinition plan = PlanDefinition.builder()
                .id(new ObjectId().toHexString())
                .planCode(code)
                .planVersion(version)
                .defaultPlan(false)
                .name(request.name().trim())
                .description(blankToNull(request.description()))
                .status(PlanStatus.DRAFT)
                .billingCycle(request.billingCycle())
                .publiclyAvailable(Boolean.TRUE.equals(request.publiclyAvailable()))
                .effectiveFrom(request.effectiveFrom())
                .effectiveUntil(request.effectiveUntil())
                .trialDays(request.trialDays() != null ? request.trialDays() : 0)
                .listPrice(request.listPrice())
                .currencyCode(request.currencyCode() != null ? currency(request.currencyCode()) : "EUR")
                .maxEmployees(request.maxEmployees())
                .maxUsers(request.maxUsers())
                .durationMonths(request.durationMonths())
                .moduleApps(modules(request.moduleApps()))
                .build();
        PlanHistoryEntry entry = entry(PlanHistoryEventType.PLAN_CREATED, actor, plan, PlanStatus.DRAFT, null, List.of());
        PlanDefinition saved;
        try {
            saved = planHistory.withEntry(entry, () -> planRepository.insert(plan));
        } catch (DuplicateKeyException ex) {
            throw new ConflictException("Plan " + code + " version " + version + " already exists. Omit planVersion to use the next one.");
        }
        auditService.record(actor, AuditAction.PLAN_CREATED, null, "PLAN", saved.getId(),
                AuditService.details("planCode", code, "planVersion", String.valueOf(version), "status", PlanStatus.DRAFT.name()));
        return PlanResponse.of(saved, 0L, true);
    }

    /** Changes a plan's fields; see the class comment for what a published plan may still change. */
    public PlanResponse updatePlan(Jwt jwt, String planId, UpdatePlanRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        PlanDefinition plan = findPlan(planId);
        if (plan.getStatus() == PlanStatus.ARCHIVED) {
            throw new ConflictException("An archived plan cannot be changed.");
        }
        boolean draft = plan.getStatus() == PlanStatus.DRAFT;
        List<PlanHistoryEntry.FieldChange> changed = new ArrayList<>();
        List<String> frozen = new ArrayList<>();

        if (request.name() != null) {
            String name = request.name().trim();
            if (name.isEmpty()) {
                throw new IllegalArgumentException("Name must not be blank.");
            }
            apply(name, plan.getName(), plan::setName, "name", changed);
        }
        if (request.description() != null) {
            apply(blankToNull(request.description()), plan.getDescription(), plan::setDescription, "description", changed);
        }
        apply(request.publiclyAvailable(), plan.getPubliclyAvailable(), plan::setPubliclyAvailable, "publiclyAvailable", changed);
        apply(request.effectiveFrom(), plan.getEffectiveFrom(), plan::setEffectiveFrom, "effectiveFrom", changed);
        apply(request.effectiveUntil(), plan.getEffectiveUntil(), plan::setEffectiveUntil, "effectiveUntil", changed);

        termsChange(request.billingCycle(), plan.getBillingCycle(), plan::setBillingCycle, "billingCycle", draft, changed, frozen);
        termsChange(request.trialDays(), plan.getTrialDays(), plan::setTrialDays, "trialDays", draft, changed, frozen);
        // Prices compare by value, so 49.9 and 49.90 are the same price.
        BigDecimal price = request.listPrice();
        if (price != null && (plan.getListPrice() == null || price.compareTo(plan.getListPrice()) != 0)) {
            termsChange(price, plan.getListPrice(), plan::setListPrice, "listPrice", draft, changed, frozen);
        }
        termsChange(request.currencyCode() != null ? currency(request.currencyCode()) : null, plan.getCurrencyCode(),
                plan::setCurrencyCode, "currencyCode", draft, changed, frozen);
        termsChange(request.maxEmployees(), plan.getMaxEmployees(), plan::setMaxEmployees, "maxEmployees", draft, changed, frozen);
        termsChange(request.maxUsers(), plan.getMaxUsers(), plan::setMaxUsers, "maxUsers", draft, changed, frozen);
        termsChange(request.durationMonths(), plan.getDurationMonths(), plan::setDurationMonths, "durationMonths", draft, changed, frozen);
        if (request.moduleApps() != null) {
            termsChange(modules(request.moduleApps()), plan.getModuleApps(), plan::setModuleApps, "moduleApps", draft, changed, frozen);
        }
        if (!frozen.isEmpty()) {
            throw new ConflictException("A published plan version is not changed in place (" + String.join(", ", frozen)
                    + "). Create a new version: POST /api/super-admin/plans with planCode " + plan.getPlanCode() + ".");
        }
        requireSalePeriod(plan.getEffectiveFrom(), plan.getEffectiveUntil());
        if (changed.isEmpty()) {
            return describe(plan);
        }
        PlanHistoryEntry entry = entry(PlanHistoryEventType.PLAN_UPDATED, actor, plan, plan.getStatus(), null, changed);
        PlanDefinition saved = planHistory.withEntry(entry, () -> planRepository.save(plan));
        auditService.record(actor, AuditAction.PLAN_UPDATED, null, "PLAN", saved.getId(),
                AuditService.details("fields", changed.stream().map(PlanHistoryEntry.FieldChange::field).collect(Collectors.joining(",")),
                        "planCode", saved.getPlanCode(), "planVersion", String.valueOf(saved.getPlanVersion())));
        return describe(saved);
    }

    /**
     * Activates, deactivates or archives a plan; see PlanStatusRequest for the allowed transitions.
     * Subscriptions on the plan and their history are untouched: status only governs new assignments.
     */
    public PlanResponse changePlanStatus(Jwt jwt, String planId, PlanStatusRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        PlanDefinition plan = findPlan(planId);
        PlanStatus from = plan.getStatus();
        PlanStatus to = request.status();
        if (from == to) {
            throw new ConflictException("The plan is already " + to + ".");
        }
        boolean allowed = switch (from) {
            case DRAFT -> to == PlanStatus.ACTIVE || to == PlanStatus.ARCHIVED;
            case ACTIVE -> to == PlanStatus.INACTIVE || to == PlanStatus.ARCHIVED;
            case INACTIVE -> to == PlanStatus.ACTIVE || to == PlanStatus.ARCHIVED;
            case ARCHIVED -> false;
        };
        if (!allowed) {
            throw new ConflictException("A plan cannot go from " + from + " to " + to + ".");
        }
        if (from == PlanStatus.ACTIVE && isDefaultCode(plan.getPlanCode())
                && planRepository.countByPlanCodeAndStatus(plan.getPlanCode(), PlanStatus.ACTIVE) <= 1) {
            throw new ConflictException("This is the last ACTIVE version of the default plan " + plan.getPlanCode()
                    + ", which every new organization receives. Activate another version of it first.");
        }
        plan.setStatus(to);
        PlanHistoryEntry entry = entry(PlanHistoryEventType.PLAN_STATUS_CHANGED, actor, plan, to, blankToNull(request.reason()),
                List.of(new PlanHistoryEntry.FieldChange("status", from.name(), to.name())));
        PlanDefinition saved = planHistory.withEntry(entry, () -> planRepository.save(plan));
        auditService.record(actor, AuditAction.PLAN_STATUS_CHANGED, null, "PLAN", saved.getId(),
                AuditService.details("from", from.name(), "to", to.name(), "reason", blankToNull(request.reason()),
                        "planCode", saved.getPlanCode(), "planVersion", String.valueOf(saved.getPlanVersion())));
        return describe(saved);
    }

    // ==================== HISTORY ====================

    /** The platform-wide plan history, newest first (PlanHistoryService.search). */
    public PageResponse<PlanHistoryResponse> planHistory(Jwt jwt, PlanHistoryEventType eventType, String tenantId, String actorUserId,
            String planId, Instant from, Instant to, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        return planHistory.search(eventType, tenantId, actorUserId, planId, from, to, page, size);
    }

    // ==================== SUBSCRIPTIONS ====================

    /**
     * Every organization's current subscription, newest first, narrowed by plan code, one plan version
     * ({@code planId}: which organizations are on that plan) and status.
     */
    public PageResponse<TenantSubscriptionResponse> listSubscriptions(Jwt jwt, String planCode, String planId, SubscriptionStatus status,
            int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), UserAdministration.MAX_PAGE_SIZE);
        Criteria criteria = Criteria.where("current").is(true);
        if (planCode != null && !planCode.isBlank()) {
            criteria = criteria.and("planCode").is(normalizeCode(planCode));
        }
        if (planId != null && !planId.isBlank()) {
            criteria = criteria.and("planDocsId").is(planId.trim());
        }
        if (status != null) {
            criteria = criteria.and("status").is(status);
        }
        Query query = new Query(criteria);
        long total = mongoTemplate.count(query, TenantSubscription.class);
        query.with(Sort.by(Sort.Direction.DESC, "startDate")).skip((long) safePage * safeSize).limit(safeSize);
        List<TenantSubscription> subscriptions = mongoTemplate.find(query, TenantSubscription.class);
        Map<String, Tenant> tenants = tenantRepository.findAllById(subscriptions.stream().map(TenantSubscription::getTenantId)
                .collect(Collectors.toSet())).stream().collect(Collectors.toMap(Tenant::getId, Function.identity()));
        Map<String, PlanDefinition> plans = planRepository.findAllById(subscriptions.stream().map(TenantSubscription::getPlanDocsId)
                .filter(Objects::nonNull).collect(Collectors.toSet())).stream()
                .collect(Collectors.toMap(PlanDefinition::getId, Function.identity()));
        List<TenantSubscriptionResponse> content = subscriptions.stream()
                .map(s -> new TenantSubscriptionResponse(OrganizationSummary.of(s.getTenantId(), tenants.get(s.getTenantId())),
                        PackageService.toResponse(s, plans.get(s.getPlanDocsId()))))
                .toList();
        return PageResponse.of(content, safePage, safeSize, total);
    }

    /** An organization's subscription history, newest first. */
    public PageResponse<SubscriptionHistoryResponse> subscriptionHistory(Jwt jwt, String tenantId, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        Tenant tenant = findTenant(tenantId);
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), UserAdministration.MAX_PAGE_SIZE);
        Query query = new Query(Criteria.where("tenantId").is(tenant.getId()));
        long total = mongoTemplate.count(query, SubscriptionHistory.class);
        query.with(Sort.by(Sort.Order.desc("eventDate"), Sort.Order.desc("id"))).skip((long) safePage * safeSize).limit(safeSize);
        List<SubscriptionHistoryResponse> content = mongoTemplate.find(query, SubscriptionHistory.class).stream()
                .map(SubscriptionHistoryResponse::of).toList();
        return PageResponse.of(content, safePage, safeSize, total);
    }

    /**
     * Moves an organization to another plan version. The plan must be ACTIVE and the organization
     * ACTIVE or SUSPENDED (one still being provisioned, or deleted, is refused).
     */
    public TenantPackageResponse changeTenantPlan(Jwt jwt, String tenantId, ChangeTenantPlanRequest request) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        Tenant tenant = findTenant(tenantId);
        PlanDefinition plan = findPlan(request.planId().trim());
        TenantSubscription created = applyPlan(actor, tenant, plan, request.reason(), null);
        return PackageService.toResponse(created, plan);
    }

    /**
     * Applies a plan to an organization on a Super Admin's authority — directly, or by approving a
     * Tenant Admin's request ({@code correlationId}: the request's id). Checks the organization and the
     * plan, changes the package, and audits it.
     */
    TenantSubscription applyPlan(CurrentUser actor, Tenant tenant, PlanDefinition plan, String reason, String correlationId) {
        if (tenant.getStatus() != TenantStatus.ACTIVE && tenant.getStatus() != TenantStatus.SUSPENDED) {
            throw new ConflictException("The package of an organization in status " + tenant.getStatus() + " cannot be changed.");
        }
        if (plan.getStatus() != PlanStatus.ACTIVE) {
            throw new ConflictException("Only an ACTIVE plan can be assigned; " + plan.getPlanCode() + " v" + plan.getPlanVersion()
                    + " is " + plan.getStatus() + ".");
        }
        String previousCode = packageService.currentSubscription(tenant.getId())
                .map(s -> s.getPlanCode() + " v" + s.getPlanVersion()).orElse(null);
        TenantSubscription created = packageService.changePackage(tenant.getId(), plan, actor.userId(),
                actor.role() != null ? actor.role().name() : null, reason, correlationId);
        auditService.record(actor, AuditAction.PACKAGE_CHANGED, tenant.getId(), "SUBSCRIPTION", created.getId(),
                AuditService.details("from", previousCode, "to", plan.getPlanCode() + " v" + plan.getPlanVersion(),
                        "reason", blankToNull(reason), "request", correlationId));
        return created;
    }

    // ==================== HELPERS ====================

    PlanDefinition findPlan(String planId) {
        return planRepository.findById(planId).orElseThrow(() -> new ResourceNotFoundException("Plan not found."));
    }

    private Tenant findTenant(String tenantId) {
        return tenantRepository.findById(tenantId).orElseThrow(() -> new ResourceNotFoundException("Tenant not found."));
    }

    private PlanResponse describe(PlanDefinition plan) {
        boolean latest = planRepository.findFirstByPlanCodeOrderByPlanVersionDesc(plan.getPlanCode())
                .map(p -> p.getPlanVersion().equals(plan.getPlanVersion())).orElse(true);
        return PlanResponse.of(plan, currentSubscriptionsOn(plan.getId()), latest);
    }

    /** The highest version of each plan code on a page, in one query per distinct code. */
    private Map<String, Integer> latestVersions(List<PlanDefinition> plans) {
        Map<String, Integer> latest = new HashMap<>();
        plans.stream().map(PlanDefinition::getPlanCode).distinct().forEach(code -> planRepository
                .findFirstByPlanCodeOrderByPlanVersionDesc(code).ifPresent(p -> latest.put(code, p.getPlanVersion())));
        return latest;
    }

    private static boolean isLatest(PlanDefinition plan, Map<String, Integer> latest) {
        Integer highest = latest.get(plan.getPlanCode());
        return highest == null || highest.equals(plan.getPlanVersion());
    }

    private long currentSubscriptionsOn(String planId) {
        return mongoTemplate.count(new Query(Criteria.where("planDocsId").is(planId).and("current").is(true)), TenantSubscription.class);
    }

    private boolean isDefaultCode(String code) {
        return code != null && code.equalsIgnoreCase(properties.getPackages().getDefaultPlanCode());
    }

    private static PlanHistoryEntry entry(PlanHistoryEventType type, CurrentUser actor, PlanDefinition plan, PlanStatus status,
            String reason, List<PlanHistoryEntry.FieldChange> changes) {
        return PlanHistoryEntry.builder()
                .eventType(type)
                .occurredAt(Instant.now())
                .planId(plan.getId())
                .planCode(plan.getPlanCode())
                .planVersion(plan.getPlanVersion())
                .changes(new ArrayList<>(changes))
                .actorUserId(actor.userId())
                .actorRole(actor.role() != null ? actor.role().name() : null)
                .reason(reason)
                .status(status != null ? status.name() : null)
                .referenceType("PLAN")
                .referenceId(plan.getId())
                .build();
    }

    /** Plan codes are stored in upper case, like the seeded BASIC. */
    private static String normalizeCode(String code) {
        return code.trim().toUpperCase(Locale.ROOT);
    }

    /** An ISO 4217 currency code, upper case; 400 when it is not one (e.g. "ABC"). */
    private static String currency(String code) {
        String upper = code.trim().toUpperCase(Locale.ROOT);
        try {
            Currency.getInstance(upper);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Currency " + upper + " is not an ISO 4217 currency code (e.g. EUR).");
        }
        return upper;
    }

    /**
     * Distinct, without nulls, NORMAONE first and then the application modules in catalog order.
     * Values outside ModuleApps never get here: Jackson refuses them with 400.
     */
    private static List<ModuleApps> modules(List<ModuleApps> requested) {
        if (requested == null) {
            return new ArrayList<>();
        }
        Set<ModuleApps> distinct = new LinkedHashSet<>();
        requested.stream().filter(Objects::nonNull).forEach(distinct::add);
        List<ModuleApps> ordered = new ArrayList<>();
        if (distinct.contains(ModuleApps.NORMAONE)) {
            ordered.add(ModuleApps.NORMAONE);
        }
        ordered.addAll(ModuleCatalog.applicationModules(distinct));
        return ordered;
    }

    private static void requireSalePeriod(Instant from, Instant until) {
        if (from != null && until != null && !until.isAfter(from)) {
            throw new IllegalArgumentException("effectiveUntil must be after effectiveFrom.");
        }
    }

    private static <T> void apply(T requested, T current, java.util.function.Consumer<T> setter, String field,
            List<PlanHistoryEntry.FieldChange> changed) {
        if (requested != null && !requested.equals(current)) {
            setter.accept(requested);
            changed.add(new PlanHistoryEntry.FieldChange(field, text(current), text(requested)));
        }
    }

    /** A commercial term or feature: changed on a DRAFT, refused (collected in {@code frozen}) otherwise. */
    private static <T> void termsChange(T requested, T current, java.util.function.Consumer<T> setter, String field, boolean draft,
            List<PlanHistoryEntry.FieldChange> changed, List<String> frozen) {
        if (requested == null || requested.equals(current)) {
            return;
        }
        if (!draft) {
            frozen.add(field);
            return;
        }
        setter.accept(requested);
        changed.add(new PlanHistoryEntry.FieldChange(field, text(current), text(requested)));
    }

    private static String text(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal decimal) {
            return decimal.toPlainString();
        }
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf).collect(Collectors.joining(","));
        }
        String s = String.valueOf(value);
        return s.length() > 500 ? s.substring(0, 500) : s;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
