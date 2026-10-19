package com.NormaOne.backend.repositories;

import java.util.List;
import java.util.Optional;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.plans.TenantSubscription;

public interface TenantSubscriptionRepository extends MongoRepository<TenantSubscription, String> {

    Optional<TenantSubscription> findFirstByTenantIdAndCurrentTrue(String tenantId);

    List<TenantSubscription> findByTenantIdInAndCurrentTrue(List<String> tenantIds);

    long countByTenantId(String tenantId);

    void deleteByTenantId(String tenantId);
}
