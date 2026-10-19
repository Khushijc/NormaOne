package com.NormaOne.backend.repositories;

import java.util.List;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;

public interface AuditEventRepository extends MongoRepository<AuditEvent, String> {

    List<AuditEvent> findByTargetIdOrderByOccurredAtDesc(String targetId);

    List<AuditEvent> findByActionOrderByOccurredAtDesc(AuditAction action);

    void deleteByTenantId(String tenantId);
}
