package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.notification.AttachmentInfo;
import com.NormaOne.backend.dto.notification.NotificationInboxItem;
import com.NormaOne.backend.dto.notification.NotificationReadFilter;
import com.NormaOne.backend.dto.notification.UnreadCountResponse;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.notification.Notification;
import com.NormaOne.backend.model.notification.NotificationReceipt;
import com.NormaOne.backend.model.notification.NotificationRecipient;
import com.NormaOne.backend.model.notification.enums.NotificationAudience;
import com.NormaOne.backend.repositories.NotificationReceiptRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * The signed-in member's notifications (ADMIN or USER of an ACTIVE tenant; a Super Admin has none).
 *
 * <p>Visible to a member: ACTIVE notifications of their own tenant that are either SELECTED with
 * them in {@code users}, or TENANT broadcasts created on or after their membership started — the
 * creation time of their user record, so somebody who joins later does not inherit older broadcasts.
 * Anything else is "not found", including another tenant's notifications and archived ones.
 *
 * <p>Read state is the caller's own and nobody else's: their element of {@code users} (SELECTED),
 * changed by an atomic positional update, or their NotificationReceipt (TENANT), upserted or
 * deleted. Responses carry only the caller's state, never the recipient list. Viewing a
 * notification does not mark it read.
 */
@Service
public class NotificationInboxService {

    private final CurrentUserService currentUserService;
    private final MongoTemplate mongo;
    private final NotificationReceiptRepository receiptRepository;
    private final NotificationAttachments attachments;

    public NotificationInboxService(CurrentUserService currentUserService, MongoTemplate mongo,
            NotificationReceiptRepository receiptRepository, NotificationAttachments attachments) {
        this.currentUserService = currentUserService;
        this.mongo = mongo;
        this.receiptRepository = receiptRepository;
        this.attachments = attachments;
    }

    public PageResponse<NotificationInboxItem> list(Jwt jwt, NotificationReadFilter filter, int page, int size) {
        CurrentUser me = currentUserService.requireTenantMember(jwt);
        Map<String, Instant> reads = receipts(me);
        Criteria visible = visible(me, filter == null ? NotificationReadFilter.ALL : filter, reads.keySet());
        long total = mongo.count(new Query(visible), Notification.class);
        Query query = callerProjection(new Query(visible), me)
                .with(Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id")))
                .skip((long) page * size)
                .limit(size);
        List<NotificationInboxItem> items = mongo.find(query, Notification.class).stream()
                .map(n -> item(n, me, reads.get(n.getId())))
                .toList();
        return PageResponse.of(items, page, size, total);
    }

    /** Same visibility and read rules as the inbox's UNREAD filter. */
    public UnreadCountResponse unreadCount(Jwt jwt) {
        CurrentUser me = currentUserService.requireTenantMember(jwt);
        Criteria unread = visible(me, NotificationReadFilter.UNREAD, receipts(me).keySet());
        return new UnreadCountResponse(mongo.count(new Query(unread), Notification.class));
    }

    /** One visible notification. Does not mark it read. */
    public NotificationInboxItem get(Jwt jwt, String id) {
        CurrentUser me = currentUserService.requireTenantMember(jwt);
        return view(me, findVisible(me, id));
    }

    /**
     * Marks the caller's own copy read or unread. Repeating a request changes nothing: a second
     * "read" keeps the first readAt, a second "unread" finds nothing to undo.
     */
    public NotificationInboxItem setReadStatus(Jwt jwt, String id, boolean read) {
        CurrentUser me = currentUserService.requireTenantMember(jwt);
        Notification n = findVisible(me, id);
        if (n.getAudience() == NotificationAudience.SELECTED) {
            // Only the caller's own element, and only if it is in the other state: atomic, and a repeat is a no-op.
            Criteria own = Criteria.where("id").is(n.getId()).and("tenantId").is(me.tenantId())
                    .and("recordState").is(RecordState.ACTIVE)
                    .and("users").elemMatch(Criteria.where("userId").is(me.userId()).and("readStatus").is(!read));
            Update update = read
                    ? new Update().set("users.$.readStatus", true).set("users.$.readAt", Instant.now())
                    : new Update().set("users.$.readStatus", false).set("users.$.readAt", null);
            mongo.updateFirst(new Query(own), update, Notification.class);
        } else if (read) {
            Query mine = new Query(Criteria.where("notificationId").is(n.getId()).and("userId").is(me.userId()));
            try {
                mongo.upsert(mine, new Update().setOnInsert("tenantId", me.tenantId()).setOnInsert("readAt", Instant.now()),
                        NotificationReceipt.class);
            } catch (DuplicateKeyException concurrent) {
                // Another request of the same member inserted the receipt first: it is read either way.
            }
        } else {
            mongo.remove(new Query(Criteria.where("notificationId").is(n.getId()).and("userId").is(me.userId())),
                    NotificationReceipt.class);
        }
        return view(me, findVisible(me, id));
    }

    /** The attachment of a visible notification: the same check as viewing it. */
    public ResponseEntity<?> downloadAttachment(Jwt jwt, String id) {
        CurrentUser me = currentUserService.requireTenantMember(jwt);
        return attachments.download(findVisible(me, id).getAttachment());
    }

    /**
     * When a member's membership started: their user record's creation (the invitation, or onboarding
     * for an owner). Older records without one see every broadcast of their tenant.
     */
    static Instant membershipStart(user member) {
        if (member.getCreatedAt() != null) {
            return member.getCreatedAt();
        }
        if (member.getInvitedAt() != null) {
            return member.getInvitedAt();
        }
        if (member.getActivatedAt() != null) {
            return member.getActivatedAt();
        }
        return Instant.EPOCH;
    }

    private Notification findVisible(CurrentUser me, String id) {
        Query query = callerProjection(new Query(new Criteria().andOperator(
                Criteria.where("id").is(id), visible(me, NotificationReadFilter.ALL, Set.of()))), me);
        Notification n = mongo.findOne(query, Notification.class);
        if (n == null) {
            throw new ResourceNotFoundException("Notification not found.");
        }
        return n;
    }

    private NotificationInboxItem view(CurrentUser me, Notification n) {
        Instant receipt = n.getAudience() == NotificationAudience.TENANT
                ? receiptRepository.findByNotificationIdAndUserId(n.getId(), me.userId()).map(NotificationReceipt::getReadAt).orElse(null)
                : null;
        return item(n, me, receipt);
    }

    /**
     * What the caller may see, optionally narrowed to their unread or read ones. {@code readIds} are
     * the broadcasts the caller has a receipt for.
     */
    private static Criteria visible(CurrentUser me, NotificationReadFilter filter, Collection<String> readIds) {
        String userId = me.userId();
        Criteria selected = Criteria.where("audience").is(NotificationAudience.SELECTED);
        Criteria broadcast = Criteria.where("audience").is(NotificationAudience.TENANT)
                .and("createdAt").gte(membershipStart(me.user()));
        switch (filter) {
            case UNREAD -> {
                selected = selected.and("users").elemMatch(Criteria.where("userId").is(userId).and("readStatus").is(false));
                broadcast = broadcast.and("id").nin(readIds);
            }
            case READ -> {
                selected = selected.and("users").elemMatch(Criteria.where("userId").is(userId).and("readStatus").is(true));
                broadcast = broadcast.and("id").in(readIds);
            }
            default -> selected = selected.and("users.userId").is(userId);
        }
        return Criteria.where("tenantId").is(me.tenantId()).and("recordState").is(RecordState.ACTIVE)
                .orOperator(selected, broadcast);
    }

    /** Loads the notification with only the caller's own element of {@code users}. */
    private static Query callerProjection(Query query, CurrentUser me) {
        query.fields()
                .include("tenantId", "subject", "body", "audience", "attachment", "createdByRole", "createdAt", "updatedAt", "recordState")
                .elemMatch("users", Criteria.where("userId").is(me.userId()));
        return query;
    }

    private Map<String, Instant> receipts(CurrentUser me) {
        Map<String, Instant> reads = new HashMap<>();
        for (NotificationReceipt receipt : receiptRepository.findByTenantIdAndUserId(me.tenantId(), me.userId())) {
            reads.put(receipt.getNotificationId(), receipt.getReadAt());
        }
        return reads;
    }

    private static NotificationInboxItem item(Notification n, CurrentUser me, Instant broadcastReadAt) {
        boolean read;
        Instant readAt;
        if (n.getAudience() == NotificationAudience.SELECTED) {
            NotificationRecipient mine = n.getUsers() == null ? null : n.getUsers().stream()
                    .filter(r -> me.userId().equals(r.getUserId())).findFirst().orElse(null);
            read = mine != null && Boolean.TRUE.equals(mine.getReadStatus());
            readAt = read ? mine.getReadAt() : null;
        } else {
            read = broadcastReadAt != null;
            readAt = broadcastReadAt;
        }
        return new NotificationInboxItem(n.getId(), n.getSubject(), n.getBody(), n.getAudience(), read, readAt,
                AttachmentInfo.of(n.getAttachment()), n.getCreatedByRole(), n.getCreatedAt(), n.getUpdatedAt());
    }
}
