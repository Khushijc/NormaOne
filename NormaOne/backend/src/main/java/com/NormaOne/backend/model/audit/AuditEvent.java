package com.NormaOne.backend.model.audit;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.AuditedDocument;

import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * Append-only record of an administrative action (tenant, user, role and package changes).
 *
 * Holds identifiers and non-sensitive before/after values only: never tokens, passwords,
 * Cognito secrets or personal data beyond what identifies the target.
 */
@Document(collection = "audit_events")
@CompoundIndexes({
    @CompoundIndex(name = "audit_tenant_time_idx", def = "{'tenantId': 1, 'occurredAt': -1}"),
    @CompoundIndex(name = "audit_target_time_idx", def = "{'targetType': 1, 'targetId': 1, 'occurredAt': -1}")
})
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder 
@NoArgsConstructor 
@AllArgsConstructor 
public class AuditEvent extends AuditedDocument {

    @NotNull
    private AuditAction action;

    @NotNull
    private Instant occurredAt;

    /** Application user id of the actor, or "system" for startup tasks. */
    private String actorUserId;

    /** Canonical role the actor acted with (SUPER_ADMIN, ADMIN, USER, SYSTEM). */
    private String actorRole;

    /** Tenant affected by the action; null for platform-level actions. */
    private String tenantId;

    /** TENANT, USER or SUBSCRIPTION. */
    private String targetType;

    private String targetId;

    /** Non-sensitive details, e.g. previous and new status. */
    @Builder.Default
    private Map<String, String> details = new LinkedHashMap<>();
}
