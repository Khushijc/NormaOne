package com.NormaOne.backend.repositories;

import java.util.Optional;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.plans.PlanChangeRequest;

public interface PlanChangeRequestRepository extends MongoRepository<PlanChangeRequest, String> {

    Optional<PlanChangeRequest> findByIdAndTenantId(String id, String tenantId);

    Optional<PlanChangeRequest> findFirstByTenantIdAndOpenTrue(String tenantId);
}
