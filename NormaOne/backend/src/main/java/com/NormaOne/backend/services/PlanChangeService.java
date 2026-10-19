package com.NormaOne.backend.services;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.dto.admin.OrganizationSummary;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.plans.CreatePlanChangeRequest;
import com.NormaOne.backend.dto.plans.PlanChangeDecisionRequest;
import com.NormaOne.backend.dto.plans.PlanChangeRequestResponse;
import com.NormaOne.backend.dto.plans.TenantPlanResponse;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.notification.OutboundEmail;
import com.NormaOne.backend.model.plans.PlanChangeRequest;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.PlanHistoryEntry;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.PlanChangeRequestStatus;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.NormaOne.backend.repositories.PlanChangeRequestRepository;
import com.NormaOne.backend.repositories.PlanDefinitionRepository;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * The plan catalogue as a Tenant Admin sees it, and plan-change requests.
 *
 * WHY REQUESTS AND NOT IMMEDIATE CHANGES: the application has no billing or payment integration (the
 * billing models exist but nothing creates invoices or takes payments). Applying a paid plan on a
 * Tenant Admin's word would grant it without payment, so a Tenant Admin requests and a Super Admin
 * decides: approving applies the change through the same path as a Super Admin's direct change
 * (PlanAdminService.applyPlan → PackageService.changePackage); rejecting records why.
 *
 * TENANT ISOLATION: the tenant always comes from the requesting administrator's stored record; a
 * request of another organization answers 404 to a Tenant Admin. One open (PENDING or PROCESSING)
 * request per organization, enforced by a unique partial index.
 *
 * HISTORY AND EMAIL: each step is recorded in the plan history with the step itself
 * (PlanHistoryService.withEntry) and audited. After a request is saved, the Super Admins are emailed
 * through the outbox (EmailOutboxService); an email failure never affects the saved request.
 */
@Service
public class PlanChangeService {

    static final String REFERENCE_TYPE = "PLAN_CHANGE_REQUEST";
    /** An approval still PROCESSING after this long is treated as interrupted and may be decided again. */
    private static final Duration STALE_PROCESSING = Duration.ofMinutes(5);
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'UTC'").withZone(ZoneOffset.UTC);

    private final CurrentUserService currentUserService;
    private final PlanDefinitionRepository planRepository;
    private final PlanChangeRequestRepository requestRepository;
    private final TenantRepository tenantRepository;
    private final PackageService packageService;
    private final PlanAdminService planAdminService;
    private final PlanHistoryService planHistory;
    private final EmailOutboxService outbox;
    private final AuditService auditService;
    private final MongoTemplate mongoTemplate;
    private final NormaOneProperties properties;

    public PlanChangeService(CurrentUserService currentUserService, PlanDefinitionRepository planRepository,
            PlanChangeRequestRepository requestRepository, TenantRepository tenantRepository, PackageService packageService,
            PlanAdminService planAdminService, PlanHistoryService planHistory, EmailOutboxService outbox, AuditService auditService,
            MongoTemplate mongoTemplate, NormaOneProperties properties) {
        this.currentUserService = currentUserService;
        this.planRepository = planRepository;
        this.requestRepository = requestRepository;
        this.tenantRepository = tenantRepository;
        this.packageService = packageService;
        this.planAdminService = planAdminService;
        this.planHistory = planHistory;
        this.outbox = outbox;
        this.auditService = auditService;
        this.mongoTemplate = mongoTemplate;
        this.properties = properties;
    }

    // ==================== TENANT ADMIN: CATALOGUE ====================

    /**
     * The plans a Tenant Admin can see: every ACTIVE plan offered to customers (publiclyAvailable, or
     * the default plan), plus the organization's current plan whatever its status.
     */
    public List<TenantPlanResponse> catalogue(Jwt jwt) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        String currentPlanId = packageService.currentSubscription(admin.tenantId()).map(TenantSubscription::getPlanDocsId).orElse(null);
        List<Criteria> visible = new ArrayList<>();
        visible.add(new Criteria().andOperator(Criteria.where("status").is(PlanStatus.ACTIVE),
                new Criteria().orOperator(Criteria.where("publiclyAvailable").is(true), Criteria.where("defaultPlan").is(true))));
        if (currentPlanId != null) {
            visible.add(Criteria.where("id").is(currentPlanId));
        }
        Query query = new Query(new Criteria().orOperator(visible))
                .with(Sort.by(Sort.Order.asc("listPrice"), Sort.Order.asc("planCode"), Sort.Order.desc("planVersion")));
        return mongoTemplate.find(query, PlanDefinition.class).stream()
                .map(p -> TenantPlanResponse.of(p, p.getId().equals(currentPlanId)))
                .toList();
    }

    /** One plan of the catalogue; 404 for a plan the Tenant Admin cannot see. */
    public TenantPlanResponse plan(Jwt jwt, String planId) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        String currentPlanId = packageService.currentSubscription(admin.tenantId()).map(TenantSubscription::getPlanDocsId).orElse(null);
        PlanDefinition plan = planRepository.findById(planId)
                .filter(p -> p.getId().equals(currentPlanId) || visibleToTenants(p))
                .orElseThrow(() -> new ResourceNotFoundException("Plan not found."));
        return TenantPlanResponse.of(plan, plan.getId().equals(currentPlanId));
    }

    // ==================== TENANT ADMIN: REQUESTS ====================

    /** Records a request to move the caller's own organization to an ACTIVE plan, and emails the Super Admins. */
    public PlanChangeRequestResponse request(Jwt jwt, CreatePlanChangeRequest body) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        String tenantId = admin.tenantId();
        PlanDefinition plan = planRepository.findById(body.planId().trim())
                .filter(PlanChangeService::visibleToTenants)
                .orElseThrow(() -> new ResourceNotFoundException("Plan not found."));
        TenantSubscription current = packageService.currentSubscription(tenantId).orElse(null);
        PlanDefinition currentPlan = current == null ? null : planRepository.findById(current.getPlanDocsId()).orElse(null);
        if (current != null && plan.getId().equals(current.getPlanDocsId())) {
            throw new ConflictException("Your organization is already on " + plan.getName() + ".");
        }
        requestRepository.findFirstByTenantIdAndOpenTrue(tenantId).ifPresent(open -> {
            throw new ConflictException("Your organization already has an open plan-change request (" + open.getRequestedPlanName()
                    + "). Wait for the decision or cancel it first.");
        });
        Instant now = Instant.now();
        PlanChangeRequest request = PlanChangeRequest.builder()
                .id(new org.bson.types.ObjectId().toHexString())
                .tenantId(tenantId)
                .status(PlanChangeRequestStatus.PENDING)
                .open(true)
                .requestedByUserId(admin.userId())
                .requestedByName(admin.user().getName())
                .requestedByEmail(admin.user().getEmail())
                .requestedAt(now)
                .reason(blankToNull(body.reason()))
                .currentPlanId(current != null ? current.getPlanDocsId() : null)
                .currentPlanCode(current != null ? current.getPlanCode() : null)
                .currentPlanVersion(current != null ? current.getPlanVersion() : null)
                .currentPlanName(currentPlan != null ? currentPlan.getName() : null)
                .requestedPlanId(plan.getId())
                .requestedPlanCode(plan.getPlanCode())
                .requestedPlanVersion(plan.getPlanVersion())
                .requestedPlanName(plan.getName())
                .build();
        PlanChangeRequest saved;
        try {
            saved = planHistory.withEntry(entry(PlanHistoryEventType.PLAN_CHANGE_REQUESTED, admin, request, request.getReason(), PlanChangeRequestStatus.PENDING),
                    () -> requestRepository.insert(request));
        } catch (DuplicateKeyException race) {
            throw new ConflictException("Your organization already has an open plan-change request. Wait for the decision or cancel it first.");
        }
        auditService.record(admin, AuditAction.PLAN_CHANGE_REQUESTED, tenantId, REFERENCE_TYPE, saved.getId(),
                AuditService.details("from", planLabel(saved.getCurrentPlanCode(), saved.getCurrentPlanVersion()),
                        "to", planLabel(saved.getRequestedPlanCode(), saved.getRequestedPlanVersion()), "reason", saved.getReason()));
        // Only now, with the request saved, are the Super Admins told about it.
        OutboundEmail email = notifySuperAdmins(saved, admin.tenant()).orElse(null);
        return PlanChangeRequestResponse.of(saved, OrganizationSummary.of(tenantId, admin.tenant()), email, false);
    }

    /** The caller's organization's requests, newest first. */
    public PageResponse<PlanChangeRequestResponse> listOwn(Jwt jwt, PlanChangeRequestStatus status, int page, int size) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        return list(admin.tenantId(), status, page, size, false);
    }

    public PlanChangeRequestResponse getOwn(Jwt jwt, String requestId) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        PlanChangeRequest request = requestRepository.findByIdAndTenantId(requestId, admin.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Plan-change request not found in your organization."));
        return view(request, admin.tenant(), false);
    }

    /** Withdraws the caller's organization's PENDING request. */
    public PlanChangeRequestResponse cancelOwn(Jwt jwt, String requestId) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        PlanChangeRequest request = requestRepository.findByIdAndTenantId(requestId, admin.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Plan-change request not found in your organization."));
        PlanChangeRequest cancelled = planHistory.withEntry(entry(PlanHistoryEventType.PLAN_CHANGE_CANCELLED, admin, request, null, PlanChangeRequestStatus.CANCELLED),
                () -> close(request.getId(), admin.tenantId(), PlanChangeRequestStatus.CANCELLED, admin, null, false));
        auditService.record(admin, AuditAction.PLAN_CHANGE_CANCELLED, admin.tenantId(), REFERENCE_TYPE, cancelled.getId(), null);
        return view(cancelled, admin.tenant(), false);
    }

    // ==================== SUPER ADMIN ====================

    public PageResponse<PlanChangeRequestResponse> listAll(Jwt jwt, PlanChangeRequestStatus status, String tenantId, int page, int size) {
        currentUserService.requireSuperAdmin(jwt);
        return list(blankToNull(tenantId), status, page, size, true);
    }

    public PlanChangeRequestResponse getAny(Jwt jwt, String requestId) {
        currentUserService.requireSuperAdmin(jwt);
        PlanChangeRequest request = findRequest(requestId);
        return view(request, tenantRepository.findById(request.getTenantId()).orElse(null), true);
    }

    /**
     * Approves a PENDING request and applies it. The request is claimed first (PROCESSING) so two
     * Super Admins cannot decide it at once; if applying fails (the plan is no longer ACTIVE, the
     * organization is not ACTIVE or SUSPENDED, it is already on that plan…) it returns to PENDING and
     * nothing is changed.
     */
    public PlanChangeRequestResponse approve(Jwt jwt, String requestId, PlanChangeDecisionRequest decision) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        String note = decision != null ? blankToNull(decision.note()) : null;
        PlanChangeRequest claimed = claim(requestId, actor);
        Tenant tenant = tenantRepository.findById(claimed.getTenantId()).orElse(null);
        TenantSubscription applied;
        try {
            if (tenant == null) {
                throw new ConflictException("The organization of this request no longer exists.");
            }
            PlanDefinition plan = planAdminService.findPlan(claimed.getRequestedPlanId());
            String reason = "Plan-change request approved" + (note != null ? ": " + note : "");
            applied = planHistory.withEntry(
                    entry(PlanHistoryEventType.PLAN_CHANGE_APPROVED, actor, claimed, note, PlanChangeRequestStatus.APPROVED),
                    () -> planAdminService.applyPlan(actor, tenant, plan, reason, claimed.getId()));
        } catch (RuntimeException ex) {
            release(claimed.getId());
            throw ex;
        }
        Instant now = Instant.now();
        PlanChangeRequest approved = mongoTemplate.findAndModify(
                new Query(Criteria.where("id").is(claimed.getId()).and("status").is(PlanChangeRequestStatus.PROCESSING)),
                new Update().set("status", PlanChangeRequestStatus.APPROVED).set("open", false).set("decidedByUserId", actor.userId())
                        .set("decidedByRole", roleOf(actor)).set("decidedAt", now).set("decisionNote", note)
                        .set("appliedSubscriptionId", applied.getId()).unset("processingStartedAt").set("updatedAt", now).inc("version", 1),
                FindAndModifyOptions.options().returnNew(true), PlanChangeRequest.class);
        auditService.record(actor, AuditAction.PLAN_CHANGE_APPROVED, claimed.getTenantId(), REFERENCE_TYPE, claimed.getId(),
                AuditService.details("to", planLabel(claimed.getRequestedPlanCode(), claimed.getRequestedPlanVersion()),
                        "subscription", applied.getId(), "note", note));
        return view(approved != null ? approved : findRequest(claimed.getId()), tenant, true);
    }

    /** Rejects a PENDING request, with a note saying why. */
    public PlanChangeRequestResponse reject(Jwt jwt, String requestId, PlanChangeDecisionRequest decision) {
        CurrentUser actor = currentUserService.requireSuperAdmin(jwt);
        String note = decision != null ? blankToNull(decision.note()) : null;
        if (note == null) {
            throw new IllegalArgumentException("A note is required to reject a plan-change request.");
        }
        PlanChangeRequest request = findRequest(requestId);
        PlanChangeRequest rejected = planHistory.withEntry(
                entry(PlanHistoryEventType.PLAN_CHANGE_REJECTED, actor, request, note, PlanChangeRequestStatus.REJECTED),
                () -> close(request.getId(), null, PlanChangeRequestStatus.REJECTED, actor, note, true));
        auditService.record(actor, AuditAction.PLAN_CHANGE_REJECTED, rejected.getTenantId(), REFERENCE_TYPE, rejected.getId(),
                AuditService.details("note", note));
        return view(rejected, tenantRepository.findById(rejected.getTenantId()).orElse(null), true);
    }

    // ==================== HELPERS ====================

    private PageResponse<PlanChangeRequestResponse> list(String tenantId, PlanChangeRequestStatus status, int page, int size,
            boolean superAdmin) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), UserAdministration.MAX_PAGE_SIZE);
        Criteria criteria = new Criteria();
        if (tenantId != null) {
            criteria = criteria.and("tenantId").is(tenantId);
        }
        if (status != null) {
            criteria = criteria.and("status").is(status);
        }
        Query query = new Query(criteria);
        long total = mongoTemplate.count(query, PlanChangeRequest.class);
        query.with(Sort.by(Sort.Order.desc("requestedAt"), Sort.Order.desc("id"))).skip((long) safePage * safeSize).limit(safeSize);
        List<PlanChangeRequest> requests = mongoTemplate.find(query, PlanChangeRequest.class);
        Map<String, Tenant> tenants = tenantRepository.findAllById(requests.stream().map(PlanChangeRequest::getTenantId)
                .filter(Objects::nonNull).collect(Collectors.toSet())).stream().collect(Collectors.toMap(Tenant::getId, Function.identity()));
        List<PlanChangeRequestResponse> content = requests.stream()
                .map(r -> view(r, tenants.get(r.getTenantId()), superAdmin)).toList();
        return PageResponse.of(content, safePage, safeSize, total);
    }

    private PlanChangeRequestResponse view(PlanChangeRequest request, Tenant tenant, boolean superAdmin) {
        OutboundEmail email = outbox.latestFor(REFERENCE_TYPE, request.getId()).orElse(null);
        return PlanChangeRequestResponse.of(request, OrganizationSummary.of(request.getTenantId(), tenant), email, superAdmin);
    }

    private PlanChangeRequest findRequest(String requestId) {
        return requestRepository.findById(requestId).orElseThrow(() -> new ResourceNotFoundException("Plan-change request not found."));
    }

    /** A request that is PENDING, or PROCESSING but interrupted long enough ago to be decided again. */
    private static Criteria decidable(Instant now) {
        return new Criteria().orOperator(Criteria.where("status").is(PlanChangeRequestStatus.PENDING),
                new Criteria().andOperator(Criteria.where("status").is(PlanChangeRequestStatus.PROCESSING),
                        Criteria.where("processingStartedAt").lt(now.minus(STALE_PROCESSING))));
    }

    /** Atomically moves a decidable request to PROCESSING for this approval. */
    private PlanChangeRequest claim(String requestId, CurrentUser actor) {
        PlanChangeRequest request = findRequest(requestId);
        Instant now = Instant.now();
        PlanChangeRequest claimed = mongoTemplate.findAndModify(
                new Query(new Criteria().andOperator(Criteria.where("id").is(request.getId()), decidable(now))),
                new Update().set("status", PlanChangeRequestStatus.PROCESSING).set("processingStartedAt", now)
                        .set("updatedAt", now).set("updatedByDocsId", actor.userId()).inc("version", 1),
                FindAndModifyOptions.options().returnNew(true), PlanChangeRequest.class);
        if (claimed == null) {
            throw new ConflictException("This request is " + findRequest(requestId).getStatus() + " and can no longer be decided.");
        }
        return claimed;
    }

    /** Puts a request whose approval failed back to PENDING. */
    private void release(String requestId) {
        mongoTemplate.updateFirst(new Query(Criteria.where("id").is(requestId).and("status").is(PlanChangeRequestStatus.PROCESSING)),
                new Update().set("status", PlanChangeRequestStatus.PENDING).unset("processingStartedAt").inc("version", 1),
                PlanChangeRequest.class);
    }

    /**
     * Atomically closes a decidable request as {@code to} (CANCELLED by a Tenant Admin of
     * {@code tenantId}, or REJECTED by a Super Admin); 409 when it is no longer open.
     */
    private PlanChangeRequest close(String requestId, String tenantId, PlanChangeRequestStatus to, CurrentUser actor, String note,
            boolean allowStaleProcessing) {
        Instant now = Instant.now();
        List<Criteria> filters = new ArrayList<>();
        filters.add(Criteria.where("id").is(requestId));
        if (tenantId != null) {
            filters.add(Criteria.where("tenantId").is(tenantId));
        }
        filters.add(allowStaleProcessing ? decidable(now) : Criteria.where("status").is(PlanChangeRequestStatus.PENDING));
        PlanChangeRequest closed = mongoTemplate.findAndModify(new Query(new Criteria().andOperator(filters)),
                new Update().set("status", to).set("open", false).set("decidedByUserId", actor.userId()).set("decidedByRole", roleOf(actor))
                        .set("decidedAt", now).set("decisionNote", note).unset("processingStartedAt").set("updatedAt", now).inc("version", 1),
                FindAndModifyOptions.options().returnNew(true), PlanChangeRequest.class);
        if (closed == null) {
            PlanChangeRequest current = requestRepository.findById(requestId).orElse(null);
            throw new ConflictException("This request is " + (current != null ? current.getStatus() : "gone") + " and can no longer be "
                    + (to == PlanChangeRequestStatus.CANCELLED ? "cancelled." : "decided."));
        }
        return closed;
    }

    private static boolean visibleToTenants(PlanDefinition p) {
        return p.getStatus() == PlanStatus.ACTIVE && (Boolean.TRUE.equals(p.getPubliclyAvailable()) || Boolean.TRUE.equals(p.getDefaultPlan()));
    }

    private static PlanHistoryEntry entry(PlanHistoryEventType type, CurrentUser actor, PlanChangeRequest r, String reason,
            PlanChangeRequestStatus status) {
        return PlanHistoryEntry.builder()
                .eventType(type)
                .occurredAt(Instant.now())
                .tenantId(r.getTenantId())
                .planId(r.getRequestedPlanId()).planCode(r.getRequestedPlanCode()).planVersion(r.getRequestedPlanVersion())
                .previousPlanId(r.getCurrentPlanId()).previousPlanCode(r.getCurrentPlanCode()).previousPlanVersion(r.getCurrentPlanVersion())
                .actorUserId(actor.userId())
                .actorRole(roleOf(actor))
                .reason(reason)
                .status(status.name())
                .referenceType(REFERENCE_TYPE)
                .referenceId(r.getId())
                .correlationId(r.getId())
                .build();
    }

    // ==================== EMAIL ====================

    /** Queues (and tries to send) the email telling the Super Admins about a saved request. */
    private Optional<OutboundEmail> notifySuperAdmins(PlanChangeRequest r, Tenant tenant) {
        List<String> configured = properties.getEmail().getPlanChangeRecipients().stream()
                .filter(address -> address != null && !address.isBlank()).toList();
        List<String> recipients = configured.isEmpty()
                ? mongoTemplate.find(new Query(new Criteria().andOperator(UserAdministration.superAdminScope(),
                        Criteria.where("status").is(UserStatus.ACTIVE))), user.class).stream()
                        .map(user::getEmail).filter(Objects::nonNull).toList()
                : configured;
        String organization = tenant != null ? tenant.getTenantName() : r.getTenantId();
        String subject = "[NormaOne] Plan change requested: " + organization + " → " + r.getRequestedPlanName();
        StringBuilder body = new StringBuilder()
                .append("A Tenant Admin has requested a plan change. It is waiting for a Super Admin's decision.\n\n")
                .append("Organization: ").append(organization).append(" (").append(r.getTenantId()).append(")\n")
                .append("Requested by: ").append(r.getRequestedByName()).append(" <").append(r.getRequestedByEmail()).append(">\n")
                .append("Current plan: ").append(r.getCurrentPlanName() != null
                        ? r.getCurrentPlanName() + " (" + planLabel(r.getCurrentPlanCode(), r.getCurrentPlanVersion()) + ")" : "none").append('\n')
                .append("Requested plan: ").append(r.getRequestedPlanName()).append(" (")
                .append(planLabel(r.getRequestedPlanCode(), r.getRequestedPlanVersion())).append(")\n")
                .append("Requested at: ").append(WHEN.format(r.getRequestedAt())).append('\n')
                .append("Status: ").append(r.getStatus()).append(" — no payment has been taken; approving applies the plan.\n");
        if (r.getReason() != null) {
            body.append("Reason: ").append(r.getReason()).append('\n');
        }
        String link = properties.getEmail().getPlanChangeReviewUrl();
        if (link != null && !link.isBlank()) {
            body.append("\nReview it: ").append(link.trim().replace("{requestId}", r.getId())).append('\n');
        }
        body.append("\nRequest id: ").append(r.getId()).append('\n');
        return outbox.enqueue(recipients, subject, body.toString(), REFERENCE_TYPE, r.getId(), r.getTenantId());
    }

    private static String planLabel(String code, Integer version) {
        return code == null ? null : code + " v" + version;
    }

    private static String roleOf(CurrentUser actor) {
        return actor.role() != null ? actor.role().name() : null;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
