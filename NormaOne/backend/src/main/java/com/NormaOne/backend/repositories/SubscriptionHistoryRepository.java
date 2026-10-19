package com.NormaOne.backend.repositories;

import java.util.List;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.plans.SubscriptionHistory;

public interface SubscriptionHistoryRepository extends MongoRepository<SubscriptionHistory, String> {

    List<SubscriptionHistory> findByTenantIdOrderByEventDateDesc(String tenantId);

    void deleteByTenantId(String tenantId);
}
