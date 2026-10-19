package com.NormaOne.backend.repositories;

import java.util.Optional;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.notification.Notification;

/**
 * Notifications. Every lookup by id also names the tenant, so an id from another tenant is simply
 * not found. Read-state changes do not go through this repository: they are atomic MongoTemplate
 * updates on the caller's own element (NotificationInboxService).
 */
public interface NotificationRepository extends MongoRepository<Notification, String> {

    Optional<Notification> findByIdAndTenantId(String id, String tenantId);
}
