package com.NormaOne.backend.dto.admin;

import java.time.Instant;
import java.util.Map;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;

/** One audit event, read-only. The details hold only non-sensitive values (see AuditService). */
public record AuditEventResponse(
        String id,
        AuditAction action,
        Instant occurredAt,
        String actorUserId,
        String actorRole,
        String tenantId,
        String targetType,
        String targetId,
        Map<String, String> details
) {
    public static AuditEventResponse of(AuditEvent e) {
        return new AuditEventResponse(e.getId(), e.getAction(), e.getOccurredAt(), e.getActorUserId(), e.getActorRole(),
                e.getTenantId(), e.getTargetType(), e.getTargetId(), e.getDetails());
    }
}
