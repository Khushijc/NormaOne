package com.NormaOne.backend.repositories;

import java.util.Optional;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.core.Tenant;

public interface TenantRepository extends MongoRepository<Tenant, String> {

    Optional<Tenant> findBySubdomain(String subdomain);

    boolean existsBySubdomain(String subdomain);
}
