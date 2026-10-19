package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.admin.AuditEventResponse;
import com.NormaOne.backend.dto.common.PageResponse;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.repositories.AuditEventRepository;
import com.NormaOne.backend.security.CurrentUser;

/**
 * Records administrative actions in the append-only {@code audit_events} collection.
 * Only identifiers and non-sensitive values are stored.
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    public static final String SYSTEM = "system";

    private final AuditEventRepository repository;
    private final MongoTemplate mongoTemplate;

    public AuditService(AuditEventRepository repository, MongoTemplate mongoTemplate) {
        this.repository = repository;
        this.mongoTemplate = mongoTemplate;
    }

    public void record(CurrentUser actor, AuditAction action, String tenantId, String targetType, String targetId,
            Map<String, String> details) {
        String actorId = actor != null && actor.userId() != null ? actor.userId() : actor != null ? actor.cognitoSub() : SYSTEM;
        String actorRole = actor != null && actor.role() != null ? actor.role().name() : actor != null ? "NONE" : "SYSTEM";
        recordAs(actorId, actorRole, action, tenantId, targetType, targetId, details);
    }

    public void recordAs(String actorId, String actorRole, AuditAction action, String tenantId, String targetType,
            String targetId, Map<String, String> details) {
        Map<String, String> clean = new LinkedHashMap<>();
        if (details != null) {
            details.forEach((k, v) -> {
                if (k != null && v != null) {
                    clean.put(k, v.length() > 500 ? v.substring(0, 500) : v);
                }
            });
        }
        AuditEvent event = AuditEvent.builder()
                .action(action)
                .occurredAt(Instant.now())
                .actorUserId(actorId)
                .actorRole(actorRole)
                .tenantId(tenantId)
                .targetType(targetType)
                .targetId(targetId)
                .details(clean)
                .build();
        try {
            repository.save(event);
        } catch (RuntimeException ex) {
            // The action itself has already succeeded; a failed audit write must be visible in logs.
            log.error("Failed to write audit event {} for {} {}: {}", action, targetType, targetId, ex.getMessage());
        }
    }

    /** Small helper for detail maps (null values are dropped). */
    public static Map<String, String> details(String... keyValues) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            if (keyValues[i + 1] != null) {
                map.put(keyValues[i], keyValues[i + 1]);
            }
        }
        return map;
    }

    /** Filters for {@link #search}; every one is optional. Dates are inclusive. */
    public record Filter(String tenantId, String targetId, String targetType, String actorUserId, AuditAction action,
            Instant from, Instant to) {}

    /**
     * The trail, newest first. The caller decides the scope: a Tenant Admin's search always carries
     * their own tenant id, so the database query itself is restricted to that tenant.
     */
    public PageResponse<AuditEventResponse> search(Filter filter, int page, int size) {
        if (filter.from() != null && filter.to() != null && filter.to().isBefore(filter.from())) {
            throw new IllegalArgumentException("'to' must not be before 'from'.");
        }
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), UserAdministration.MAX_PAGE_SIZE);
        List<Criteria> filters = new ArrayList<>();
        addIs(filters, "tenantId", filter.tenantId());
        addIs(filters, "targetId", filter.targetId());
        addIs(filters, "targetType", filter.targetType());
        addIs(filters, "actorUserId", filter.actorUserId());
        if (filter.action() != null) {
            filters.add(Criteria.where("action").is(filter.action()));
        }
        if (filter.from() != null || filter.to() != null) {
            Criteria when = Criteria.where("occurredAt");
            if (filter.from() != null) {
                when = when.gte(filter.from());
            }
            if (filter.to() != null) {
                when = when.lte(filter.to());
            }
            filters.add(when);
        }
        Query query = filters.isEmpty() ? new Query() : new Query(new Criteria().andOperator(filters));
        long total = mongoTemplate.count(query, AuditEvent.class);
        query.with(Sort.by(Sort.Order.desc("occurredAt"), Sort.Order.desc("id"))).skip((long) safePage * safeSize).limit(safeSize);
        List<AuditEventResponse> content = mongoTemplate.find(query, AuditEvent.class).stream().map(AuditEventResponse::of).toList();
        return PageResponse.of(content, safePage, safeSize, total);
    }

    private static void addIs(List<Criteria> filters, String field, String value) {
        if (value != null && !value.isBlank()) {
            filters.add(Criteria.where(field).is(value.trim()));
        }
    }
}
