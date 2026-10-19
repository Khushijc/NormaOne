package com.NormaOne.backend.repositories;

import java.util.List;
import java.util.Optional;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;

public interface UserRepository extends MongoRepository<user, String> {

    Optional<user> findByCognitoSub(String cognitoSub);

    boolean existsByCognitoSub(String cognitoSub);

    Optional<user> findByTenantIdAndEmail(String tenantId, String email);

    Optional<user> findByTenantIdAndCognitoSub(String tenantId, String cognitoSub);

    /** Tenant-scoped lookup: a user of another tenant is never returned. */
    Optional<user> findByIdAndTenantId(String id, String tenantId);

    /** Pending invitations for an email (not yet linked to a Cognito identity). */
    List<user> findByEmailAndStatusAndCognitoSubIsNull(String email, UserStatus status);

    /** Every record with this (lowercase) email, across all tenants and the platform. */
    List<user> findByEmail(String email);
    /** Records holding any of these roles — used to find Super Admins, of which there are few. */
    List<user> findByRolesIn(java.util.Collection<UserRole> roles);
    long countByTenantId(String tenantId);

    long countByTenantIdAndStatusAndRolesContaining(String tenantId, UserStatus status, UserRole role);

    void deleteByTenantId(String tenantId);
}
