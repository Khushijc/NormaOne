package com.NormaOne.backend.model.plans;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.AuditedDocument;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * The platform-wide history of plan operations: plan definitions (created, updated, activated,
 * deactivated, archived) and organizations' plans (requested, approved, rejected, cancelled, changed).
 *
 * APPEND-ONLY. Entries are inserted by PlanHistoryService together with the operation they record —
 * in one transaction where MongoDB supports it, otherwise the operation is undone when its entry cannot
 * be written — and are never updated. They are removed only to undo an operation that failed half-way.
 *
 * SubscriptionHistory stays the per-subscription lifecycle of one organization (it requires a tenant
 * and a subscription); a tenant entry here carries that subscription's id as {@code referenceId}, so
 * the two can be read together. Indexes: MongoIndexInitializer.
 */
@Document(collection = "plan_history")
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class PlanHistoryEntry extends AuditedDocument {

    @NotNull
    private PlanHistoryEventType eventType;

    @NotNull
    private Instant occurredAt;

    /** The organization, for tenant events; null for plan definition events. */
    private String tenantId;

    // ==================== THE PLAN (the new one, for a change) ====================

    private String planId;
    private String planCode;
    private Integer planVersion;

    // ==================== THE PREVIOUS PLAN (tenant changes and requests) ====================

    private String previousPlanId;
    private String previousPlanCode;
    private Integer previousPlanVersion;

    /** For PLAN_UPDATED and PLAN_STATUS_CHANGED: each changed field with its previous and new value. */
    @Builder.Default
    private List<FieldChange> changes = new ArrayList<>();

    // ==================== WHO, WHY AND WHAT FOR ====================

    private String actorUserId;
    /** SUPER_ADMIN, ADMIN, or SYSTEM. */
    private String actorRole;

    @Size(max = 500)
    private String reason;

    /** The state the event left things in: a plan's status, or a plan-change request's status. */
    private String status;

    /** PLAN, PLAN_CHANGE_REQUEST or SUBSCRIPTION, with the id of that document. */
    private String referenceType;
    private String referenceId;

    /** Ties the entries of one workflow together: a plan-change request's id. */
    private String correlationId;

    /** One changed field; values are rendered as text (null when absent). */
    public record FieldChange(String field, String from, String to) {}
}
