package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.MongoTransactionManager;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.NormaOne.backend.config.MongoTopology;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.plans.PlanHistoryResponse;
import com.NormaOne.backend.model.plans.PlanHistoryEntry;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;
import com.NormaOne.backend.repositories.PlanHistoryRepository;

/**
 * Writes and reads the plan history (PlanHistoryEntry). Callers authorize; this class does not.
 *
 * RELIABLE: {@link #withEntry} writes an entry together with the operation it records. Where MongoDB
 * supports transactions both happen in one; on a standalone server the entry is written first and
 * removed again if the operation fails, so there is never an operation without its entry, nor an
 * entry for an operation that did not happen. Entries are never updated.
 */
@Service
public class PlanHistoryService {

    private static final Logger log = LoggerFactory.getLogger(PlanHistoryService.class);

    private final PlanHistoryRepository repository;
    private final MongoTemplate mongoTemplate;
    private final MongoTopology topology;
    private final TransactionTemplate transactionTemplate;

    public PlanHistoryService(PlanHistoryRepository repository, MongoTemplate mongoTemplate, MongoTopology topology,
            MongoTransactionManager transactionManager) {
        this.repository = repository;
        this.mongoTemplate = mongoTemplate;
        this.topology = topology;
        this.transactionTemplate = transactionManager != null ? new TransactionTemplate(transactionManager) : null;
    }

    /** Runs {@code operation} and records {@code entry} with it, or neither (see the class comment). */
    public <T> T withEntry(PlanHistoryEntry entry, Supplier<T> operation) {
        if (transactionTemplate != null && topology.supportsTransactions()) {
            return transactionTemplate.execute(status -> {
                T result = operation.get();
                repository.insert(entry);
                return result;
            });
        }
        PlanHistoryEntry saved = repository.insert(entry);
        try {
            return operation.get();
        } catch (RuntimeException ex) {
            remove(saved.getId());
            throw ex;
        }
    }

    /**
     * Inserts an entry as one step of a larger operation that already handles its own consistency
     * (a transaction, or compensation that calls {@link #remove}).
     */
    public PlanHistoryEntry insert(PlanHistoryEntry entry) {
        return repository.insert(entry);
    }

    /** Undoes an entry whose operation failed. Never used on a recorded operation. */
    public void remove(String entryId) {
        if (entryId == null) {
            return;
        }
        try {
            repository.deleteById(entryId);
        } catch (RuntimeException ex) {
            log.error("Could not remove plan history entry {} of a failed operation; it records something that did not happen.",
                    entryId, ex);
        }
    }

    /** The history, newest first, narrowed by any of the filters (all optional; dates inclusive). */
    public PageResponse<PlanHistoryResponse> search(PlanHistoryEventType eventType, String tenantId, String actorUserId,
            String planId, Instant from, Instant to, int page, int size) {
        if (from != null && to != null && to.isBefore(from)) {
            throw new IllegalArgumentException("'to' must not be before 'from'.");
        }
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), UserAdministration.MAX_PAGE_SIZE);
        List<Criteria> filters = new ArrayList<>();
        if (eventType != null) {
            filters.add(Criteria.where("eventType").is(eventType));
        }
        if (tenantId != null && !tenantId.isBlank()) {
            filters.add(Criteria.where("tenantId").is(tenantId.trim()));
        }
        if (actorUserId != null && !actorUserId.isBlank()) {
            filters.add(Criteria.where("actorUserId").is(actorUserId.trim()));
        }
        if (planId != null && !planId.isBlank()) {
            String id = planId.trim();
            filters.add(new Criteria().orOperator(Criteria.where("planId").is(id), Criteria.where("previousPlanId").is(id)));
        }
        if (from != null || to != null) {
            Criteria when = Criteria.where("occurredAt");
            if (from != null) {
                when = when.gte(from);
            }
            if (to != null) {
                when = when.lte(to);
            }
            filters.add(when);
        }
        Query query = filters.isEmpty() ? new Query() : new Query(new Criteria().andOperator(filters));
        long total = mongoTemplate.count(query, PlanHistoryEntry.class);
        query.with(Sort.by(Sort.Order.desc("occurredAt"), Sort.Order.desc("id"))).skip((long) safePage * safeSize).limit(safeSize);
        List<PlanHistoryResponse> content = mongoTemplate.find(query, PlanHistoryEntry.class).stream()
                .map(PlanHistoryResponse::of).toList();
        return PageResponse.of(content, safePage, safeSize, total);
    }
}
