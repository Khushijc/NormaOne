package com.NormaOne.backend.repositories;

import java.util.List;
import java.util.Optional;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.notification.NotificationReceipt;

/** Read marks on TENANT notifications, one per member and notification. */
public interface NotificationReceiptRepository extends MongoRepository<NotificationReceipt, String> {

    List<NotificationReceipt> findByTenantIdAndUserId(String tenantId, String userId);

    Optional<NotificationReceipt> findByNotificationIdAndUserId(String notificationId, String userId);

    long countByNotificationId(String notificationId);
}
