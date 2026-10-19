package com.NormaOne.backend.model.notification;

import java.time.Instant;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One member's read mark on a TENANT (broadcast) notification. A receipt means read; no receipt
 * means unread. Only broadcasts have receipts — a SELECTED notification keeps read state in its
 * own {@code users} array.
 *
 * Written by an atomic upsert on (notificationId, userId), which the unique index makes one per
 * member; marking unread deletes that member's receipt only. Not an AuditedDocument: a receipt is
 * created or deleted, never edited, and {@code readAt} is its timestamp.
 */
@Document(collection = "notification_receipts")
@CompoundIndexes({
        @CompoundIndex(name = "notification_receipt_uniq", def = "{'notificationId': 1, 'userId': 1}", unique = true),
        @CompoundIndex(name = "notification_receipt_user_idx", def = "{'tenantId': 1, 'userId': 1}")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NotificationReceipt {

    @Id
    private String id;

    private String notificationId;

    private String tenantId;

    private String userId;

    private Instant readAt;
}
