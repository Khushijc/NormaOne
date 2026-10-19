package com.NormaOne.backend.repositories;

import java.util.Optional;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.enums.PlanStatus;

public interface PlanDefinitionRepository extends MongoRepository<PlanDefinition, String> {

    Optional<PlanDefinition> findByPlanCodeAndPlanVersion(String planCode, Integer planVersion);

    Optional<PlanDefinition> findFirstByPlanCodeAndStatusOrderByPlanVersionDesc(String planCode, PlanStatus status);

    Optional<PlanDefinition> findFirstByDefaultPlanTrue();

    long countByPlanCode(String planCode);

    /** The highest version of a plan code, whatever its status (the next version is this + 1). */
    Optional<PlanDefinition> findFirstByPlanCodeOrderByPlanVersionDesc(String planCode);

    long countByPlanCodeAndStatus(String planCode, PlanStatus status);
}
