package com.NormaOne.backend.services;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.bson.Document;
import org.bson.types.ObjectId;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.aggregation.Aggregation;
import org.springframework.data.mongodb.core.aggregation.AggregationOperation;
import org.springframework.data.mongodb.core.aggregation.AggregationUpdate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.notification.CreateNotificationRequest;
import com.NormaOne.backend.dto.notification.NotificationResponse;
import com.NormaOne.backend.dto.notification.NotificationStatusRequest;
import com.NormaOne.backend.dto.notification.RecipientOptionResponse;
import com.NormaOne.backend.dto.notification.RecipientResponse;
import com.NormaOne.backend.dto.notification.UpdateNotificationRequest;
import com.NormaOne.backend.exceptions.ConflictException;
import com.NormaOne.backend.exceptions.ForbiddenOperationException;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.notification.Notification;
import com.NormaOne.backend.model.notification.NotificationAttachment;
import com.NormaOne.backend.model.notification.NotificationReceipt;
import com.NormaOne.backend.model.notification.NotificationRecipient;
import com.NormaOne.backend.model.notification.enums.NotificationAudience;
import com.NormaOne.backend.repositories.NotificationReceiptRepository;
import com.NormaOne.backend.repositories.NotificationRepository;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;
import com.mongodb.client.result.UpdateResult;

/**
 * Notifications as administrators manage them: create, list, view, edit, archive, attachments.
 *
 * <p>Every operation runs in a {@link NotificationScope}: the Tenant Admin's own tenant (an ACTIVE
 * ADMIN of an ACTIVE tenant, the tenant read from their stored record) or the tenant a Super Admin named
 * in the route. Every lookup by id is filtered by that tenant, so another tenant's notification is
 * not found (404).
 *
 * <p>Recipients of a SELECTED notification must be INVITED or ACTIVE members of the target tenant;
 * one id that is not rejects the whole request, with the same answer whether the id does not exist
 * or belongs to another tenant. A TENANT notification takes no ids and is never platform-wide.
 *
 * <p>Edits are single atomic updates that set only what changed. The recipient list is rewritten on
 * the server from its current value, so members' read states written meanwhile are kept.
 */
@Service
public class NotificationService {

    static final String COLLECTION = "notifications";
    private static final String TARGET = "NOTIFICATION";
    private static final Set<UserStatus> ELIGIBLE = EnumSet.of(UserStatus.INVITED, UserStatus.ACTIVE);

    private final CurrentUserService currentUserService;
    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final NotificationRepository notificationRepository;
    private final NotificationReceiptRepository receiptRepository;
    private final NotificationAttachments attachments;
    private final AuditService auditService;
    private final MongoTemplate mongo;
    private final NormaOneProperties properties;
    private final UserAdministration userAdministration;
    private final NotificationEmailService notificationEmails;

    public NotificationService(
            CurrentUserService currentUserService,
            TenantRepository tenantRepository,
            UserRepository userRepository,
            NotificationRepository notificationRepository,
            NotificationReceiptRepository receiptRepository,
            NotificationAttachments attachments,
            AuditService auditService,
            MongoTemplate mongo,
            NormaOneProperties properties,
            UserAdministration userAdministration,
            NotificationEmailService notificationEmails) {
        this.notificationEmails = notificationEmails;
        this.userAdministration = userAdministration;
        this.currentUserService = currentUserService;
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.notificationRepository = notificationRepository;
        this.receiptRepository = receiptRepository;
        this.attachments = attachments;
        this.auditService = auditService;
        this.mongo = mongo;
        this.properties = properties;
    }

    // ==================== scopes ====================

    /** A Tenant Admin (ACTIVE ADMIN of an ACTIVE tenant), in the tenant on their own stored record. */
    public NotificationScope tenantScope(Jwt jwt) {
        CurrentUser admin = currentUserService.requireTenantAdmin(jwt);
        return new NotificationScope(admin, admin.tenant());
    }

    /** A Super Admin, in the tenant named in the route; it must exist. */
    public NotificationScope platformScope(Jwt jwt, String tenantId) {
        CurrentUser root = currentUserService.requireSuperAdmin(jwt);
        Tenant tenant = tenantRepository.findById(tenantId.trim())
                .orElseThrow(() -> new ResourceNotFoundException("Organization not found."));
        return new NotificationScope(root, tenant);
    }

    // ==================== create ====================

    /**
     * Creates a notification, with an optional attachment. The attachment file is stored first, under
     * the new notification's id; if the notification cannot be saved, the file is deleted again.
     */
    public NotificationResponse create(NotificationScope scope, CreateNotificationRequest request, MultipartFile file) {
        requireActiveTenant(scope);
        List<NotificationRecipient> recipients = recipientsFor(scope.tenantId(), request.audience(), request.userIds());
        String id = new ObjectId().toHexString();
        NotificationAttachment attachment = file == null ? null : attachments.store(scope.tenantId(), id, file, scope.actor());
        Notification notification = Notification.builder()
                .id(id)
                .tenantId(scope.tenantId())
                .recordState(RecordState.ACTIVE)
                .subject(request.subject().strip())
                .body(request.body().strip())
                .audience(request.audience())
                .users(recipients)
                .attachment(attachment)
                .createdByRole(scope.actor().role())
                .build();
        Notification saved;
        try {
            saved = notificationRepository.insert(notification);
        } catch (RuntimeException ex) {
            attachments.discard(attachment);
            throw ex;
        }
        auditService.record(scope.actor(), AuditAction.NOTIFICATION_CREATED, scope.tenantId(), TARGET, saved.getId(),
                AuditService.details("audience", saved.getAudience().name(),
                        "recipientCount", String.valueOf(recipients.size()),
                        "attachment", attachment != null ? "yes" : "no"));
        // In-app delivery is done; email copies follow each recipient's preference (none while email is not configured).
        notificationEmails.queueFor(saved, scope.tenant() != null ? scope.tenant().getTenantName() : null);
        return detail(saved);
    }

    // ==================== read ====================

    /**
     * The tenant's notifications, newest first, ACTIVE and ARCHIVED unless {@code status} narrows it.
     * Rows carry counts, not recipient lists.
     */
    public PageResponse<NotificationResponse> list(NotificationScope scope, RecordState status,
            NotificationAudience audience, String createdBy, int page, int size) {
        Document match = new Document("tenantId", scope.tenantId());
        if (status != null) {
            match.append("recordState", status.name());
        }
        if (audience != null) {
            match.append("audience", audience.name());
        }
        if (createdBy != null && !createdBy.isBlank()) {
            match.append("createdByDocsId", createdBy.trim());
        }
        long total = mongo.getCollection(COLLECTION).countDocuments(match);

        Document users = new Document("$ifNull", List.of("$users", List.of()));
        List<AggregationOperation> stages = List.of(
                context -> new Document("$match", match),
                context -> new Document("$sort", new Document("createdAt", -1).append("_id", -1)),
                context -> new Document("$skip", (long) page * size),
                context -> new Document("$limit", size),
                context -> new Document("$addFields", new Document()
                        .append("recipientCount", new Document("$size", users))
                        .append("selectedReadCount", new Document("$size", new Document("$filter", new Document()
                                .append("input", users)
                                .append("cond", new Document("$eq", List.of("$$this.readStatus", true))))))),
                context -> new Document("$project", new Document("users", 0)));
        List<Document> rows = mongo.aggregate(Aggregation.newAggregation(stages), COLLECTION, Document.class).getMappedResults();

        List<String> broadcastIds = rows.stream()
                .filter(row -> NotificationAudience.TENANT.name().equals(row.getString("audience")))
                .map(row -> row.getObjectId("_id").toHexString())
                .toList();
        Map<String, Long> receipts = receiptCounts(broadcastIds);

        List<NotificationResponse> content = rows.stream().map(row -> {
            Notification n = mongo.getConverter().read(Notification.class, row);
            if (n.getAudience() == NotificationAudience.TENANT) {
                return NotificationResponse.of(n, null, null, receipts.getOrDefault(n.getId(), 0L), null);
            }
            return NotificationResponse.of(n, null, ((Number) row.get("recipientCount")).intValue(),
                    ((Number) row.get("selectedReadCount")).longValue(), null);
        }).toList();
        return PageResponse.of(content, page, size, total);
    }

    /** One notification with its recipients and their read states (SELECTED) or counts (TENANT). */
    public NotificationResponse get(NotificationScope scope, String id) {
        return detail(find(scope, id));
    }

    /**
     * The members a SELECTED notification can be sent to in the scope's tenant — exactly the ones
     * {@link #requireMembers} accepts (INVITED or ACTIVE) — narrowed by name or email: the ids a
     * SELECTED notification is addressed to.
     */
    public PageResponse<RecipientOptionResponse> recipients(NotificationScope scope, String search, int page, int size) {
        UserAdministration.UserPage found = userAdministration.findPage(Criteria.where("status").in(ELIGIBLE), scope.tenantId(),
                search, null, page, size);
        return PageResponse.of(found.users().stream().map(RecipientOptionResponse::of).toList(), found.page(), found.size(),
                found.total());
    }

    // ==================== update ====================

    /**
     * Changes subject, body and (SELECTED) recipients of an ACTIVE notification. One atomic update:
     * recipients are removed and added on the server from the list as it is at that moment, so a
     * member who reads it meanwhile keeps that read state, and the update is refused if it would
     * leave no recipient.
     */
    public NotificationResponse update(NotificationScope scope, String id, UpdateNotificationRequest request) {
        requireActiveTenant(scope);
        Notification n = find(scope, id);
        requireChangeable(scope, n);

        String subject = request.subject() == null ? null : request.subject().strip();
        String body = request.body() == null ? null : request.body().strip();
        if (subject != null && subject.isEmpty()) {
            throw new IllegalArgumentException("Subject must not be blank.");
        }
        if (body != null && body.isEmpty()) {
            throw new IllegalArgumentException("Body must not be blank.");
        }
        LinkedHashSet<String> add = distinct(request.addUserIds());
        LinkedHashSet<String> remove = distinct(request.removeUserIds());
        boolean recipientsChange = !add.isEmpty() || !remove.isEmpty();
        if (subject == null && body == null && !recipientsChange) {
            throw new IllegalArgumentException("Nothing to change: send subject, body, addUserIds or removeUserIds.");
        }
        if (recipientsChange && n.getAudience() == NotificationAudience.TENANT) {
            throw new IllegalArgumentException("A TENANT notification reaches the whole organization; it has no recipient list to change.");
        }

        Set<String> current = recipientIds(n);
        if (recipientsChange) {
            List<String> both = add.stream().filter(remove::contains).toList();
            if (!both.isEmpty()) {
                throw new IllegalArgumentException("The same id cannot be added and removed: " + both + ".");
            }
            List<String> strangers = remove.stream().filter(userId -> !current.contains(userId)).limit(20).toList();
            if (!strangers.isEmpty()) {
                throw new IllegalArgumentException("Not recipients of this notification: " + strangers + ".");
            }
            add.removeAll(current);
            if (!add.isEmpty()) {
                requireMembers(scope.tenantId(), add);
            }
            int after = current.size() - remove.size() + add.size();
            if (after < 1) {
                throw new IllegalArgumentException("A SELECTED notification keeps at least one recipient; archive it instead.");
            }
            requireWithinLimit(after);
        }

        Document set = new Document();
        if (subject != null) {
            set.append("subject", literal(subject));
        }
        if (body != null) {
            set.append("body", literal(body));
        }
        set.append("updatedAt", literal(Date.from(Instant.now())));
        set.append("updatedByDocsId", literal(scope.actor().userId()));
        Criteria guard = Criteria.where("id").is(n.getId()).and("tenantId").is(scope.tenantId())
                .and("recordState").is(RecordState.ACTIVE);
        if (recipientsChange) {
            set.append("users", rewrittenRecipients(remove, add));
            if (!remove.isEmpty()) {
                // Someone else may have removed recipients too: refuse rather than leave the list empty.
                guard = guard.and("users").elemMatch(Criteria.where("userId").nin(remove));
            }
        }
        UpdateResult result = mongo.updateFirst(new Query(guard),
                AggregationUpdate.from(List.<AggregationOperation>of(context -> new Document("$set", set))), Notification.class);
        if (result.getMatchedCount() == 0) {
            throw new ConflictException("The notification changed while you were editing it. Reload it and try again.");
        }

        List<String> fields = new ArrayList<>();
        if (subject != null) {
            fields.add("subject");
        }
        if (body != null) {
            fields.add("body");
        }
        auditService.record(scope.actor(), AuditAction.NOTIFICATION_UPDATED, scope.tenantId(), TARGET, n.getId(),
                AuditService.details("fields", fields.isEmpty() ? null : String.join(",", fields),
                        "recipientsAdded", add.isEmpty() ? null : String.valueOf(add.size()),
                        "recipientsRemoved", remove.isEmpty() ? null : String.valueOf(remove.size())));
        return detail(find(scope, id));
    }

    /**
     * Archives a notification: it leaves every inbox and unread count, stays in the admin lists, and
     * is not deleted. Archived notifications are not reactivated. Archiving twice changes nothing.
     */
    public NotificationResponse changeStatus(NotificationScope scope, String id, NotificationStatusRequest request) {
        if (request.status() == RecordState.ACTIVE) {
            return restore(scope, id, request);
        }
        if (request.status() != RecordState.ARCHIVED) {
            throw new IllegalArgumentException("Status must be ARCHIVED (archive) or ACTIVE (restore an archived notification).");
        }
        Notification n = find(scope, id);
        requireOwner(scope, n);
        if (n.getRecordState() == RecordState.ARCHIVED) {
            return detail(n);
        }
        Instant now = Instant.now();
        UpdateResult result = mongo.updateFirst(activeQuery(scope, n.getId()), new Update()
                .set("recordState", RecordState.ARCHIVED)
                .set("archivedAt", now)
                .set("updatedAt", now)
                .set("updatedByDocsId", scope.actor().userId()), Notification.class);
        if (result.getModifiedCount() == 1) {
            String reason = request.reason() == null || request.reason().isBlank() ? null : request.reason().strip();
            auditService.record(scope.actor(), AuditAction.NOTIFICATION_ARCHIVED, scope.tenantId(), TARGET, n.getId(),
                    AuditService.details("audience", n.getAudience().name(), "reason", reason));
        }
        return detail(find(scope, id));
    }

    /**
     * Restores an archived notification: it becomes ACTIVE again, back in its recipients' inboxes and
     * unread counts, and editable. Only its state changes — subject, body, audience, recipients, every
     * read state and receipt, the attachment and the audit trail are kept as they were. The same people
     * who may archive it may restore it (a Tenant Admin: notifications an ADMIN sent; a Super Admin: any
     * in the tenant), and the organization must be ACTIVE. Restoring an ACTIVE notification changes nothing.
     */
    private NotificationResponse restore(NotificationScope scope, String id, NotificationStatusRequest request) {
        requireActiveTenant(scope);
        Notification n = find(scope, id);
        requireOwner(scope, n);
        if (n.getRecordState() == RecordState.ACTIVE) {
            return detail(n);
        }
        Instant now = Instant.now();
        UpdateResult result = mongo.updateFirst(
                new Query(Criteria.where("id").is(n.getId()).and("tenantId").is(scope.tenantId()).and("recordState").is(RecordState.ARCHIVED)),
                new Update().set("recordState", RecordState.ACTIVE).unset("archivedAt").set("updatedAt", now)
                        .set("updatedByDocsId", scope.actor().userId()),
                Notification.class);
        if (result.getModifiedCount() == 1) {
            String reason = request.reason() == null || request.reason().isBlank() ? null : request.reason().strip();
            auditService.record(scope.actor(), AuditAction.NOTIFICATION_RESTORED, scope.tenantId(), TARGET, n.getId(),
                    AuditService.details("audience", n.getAudience().name(), "archivedAt", String.valueOf(n.getArchivedAt()), "reason", reason));
        }
        return detail(find(scope, id));
    }

    // ==================== attachments ====================

    /** Adds or replaces the attachment; the previous file is deleted once nothing refers to it. */
    public NotificationResponse replaceAttachment(NotificationScope scope, String id, MultipartFile file) {
        requireActiveTenant(scope);
        Notification n = find(scope, id);
        requireChangeable(scope, n);
        NotificationAttachment fresh = attachments.store(scope.tenantId(), n.getId(), file, scope.actor());
        Notification previous;
        try {
            previous = mongo.findAndModify(activeQuery(scope, n.getId()), touched(scope).set("attachment", fresh),
                    FindAndModifyOptions.options().returnNew(false), Notification.class);
        } catch (RuntimeException ex) {
            attachments.discard(fresh);
            throw ex;
        }
        if (previous == null) {
            attachments.discard(fresh);
            throw new ConflictException("The notification was archived meanwhile; the attachment was not saved.");
        }
        attachments.discard(previous.getAttachment());
        auditService.record(scope.actor(), AuditAction.NOTIFICATION_UPDATED, scope.tenantId(), TARGET, n.getId(),
                AuditService.details("attachment", previous.getAttachment() == null ? "ADDED" : "REPLACED",
                        "contentType", fresh.getContentType(), "sizeBytes", String.valueOf(fresh.getSizeBytes())));
        return detail(find(scope, id));
    }

    /** Removes the attachment and deletes its file. Without one, nothing changes. */
    public NotificationResponse removeAttachment(NotificationScope scope, String id) {
        Notification n = find(scope, id);
        requireChangeable(scope, n);
        if (n.getAttachment() == null) {
            return detail(n);
        }
        Notification previous = mongo.findAndModify(activeQuery(scope, n.getId()), touched(scope).set("attachment", null),
                FindAndModifyOptions.options().returnNew(false), Notification.class);
        if (previous == null) {
            throw new ConflictException("The notification was archived meanwhile; its attachment was kept.");
        }
        attachments.discard(previous.getAttachment());
        if (previous.getAttachment() != null) {
            auditService.record(scope.actor(), AuditAction.NOTIFICATION_UPDATED, scope.tenantId(), TARGET, n.getId(),
                    AuditService.details("attachment", "REMOVED"));
        }
        return detail(find(scope, id));
    }

    /** The attachment of a notification in scope, ACTIVE or ARCHIVED. */
    public ResponseEntity<?> downloadAttachment(NotificationScope scope, String id) {
        return attachments.download(find(scope, id).getAttachment());
    }

    // ==================== helpers ====================

    private Notification find(NotificationScope scope, String id) {
        return notificationRepository.findByIdAndTenantId(id, scope.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Notification not found."));
    }

    private static Query activeQuery(NotificationScope scope, String id) {
        return new Query(Criteria.where("id").is(id).and("tenantId").is(scope.tenantId()).and("recordState").is(RecordState.ACTIVE));
    }

    private static Update touched(NotificationScope scope) {
        return new Update().set("updatedAt", Instant.now()).set("updatedByDocsId", scope.actor().userId());
    }

    private static void requireActiveTenant(NotificationScope scope) {
        if (scope.tenant().getStatus() != TenantStatus.ACTIVE) {
            throw new ConflictException("Notifications can only be sent in an ACTIVE organization; this one is "
                    + scope.tenant().getStatus() + ".");
        }
    }

    /** A Tenant Admin changes only notifications an ADMIN created; a Super Admin changes any. */
    private static void requireOwner(NotificationScope scope, Notification n) {
        if (!scope.platform() && n.getCreatedByRole() != UserRole.ADMIN) {
            throw new ForbiddenOperationException(
                    "This notification was sent by the platform. Only a Super Admin can change or archive it.");
        }
    }

    private static void requireChangeable(NotificationScope scope, Notification n) {
        requireOwner(scope, n);
        if (n.getRecordState() != RecordState.ACTIVE) {
            throw new ConflictException("An archived notification cannot be changed.");
        }
    }

    private List<NotificationRecipient> recipientsFor(String tenantId, NotificationAudience audience, List<String> userIds) {
        boolean listed = userIds != null && !userIds.isEmpty();
        if (audience == NotificationAudience.TENANT) {
            if (listed) {
                throw new IllegalArgumentException("A TENANT notification reaches the whole organization; it takes no userIds.");
            }
            return new ArrayList<>();
        }
        if (!listed) {
            throw new IllegalArgumentException("A SELECTED notification needs at least one recipient in userIds.");
        }
        LinkedHashSet<String> ids = distinct(userIds);
        if (ids.isEmpty()) {
            throw new IllegalArgumentException("A SELECTED notification needs at least one recipient in userIds.");
        }
        requireWithinLimit(ids.size());
        requireMembers(tenantId, ids);
        return ids.stream()
                .map(userId -> NotificationRecipient.builder().userId(userId).readStatus(false).readAt(null).build())
                .collect(Collectors.toCollection(ArrayList::new));
    }

    /**
     * Every id must be an INVITED or ACTIVE member of the tenant. The refusal names the ids as sent,
     * without saying whether one exists elsewhere.
     */
    private void requireMembers(String tenantId, Collection<String> ids) {
        Query query = new Query(Criteria.where("id").in(ids).and("tenantId").is(tenantId).and("status").in(ELIGIBLE));
        query.fields().include("id");
        Set<String> found = mongo.find(query, user.class).stream().map(user::getId).collect(Collectors.toSet());
        List<String> refused = ids.stream().filter(userId -> !found.contains(userId)).limit(20).toList();
        if (!refused.isEmpty()) {
            throw new IllegalArgumentException(
                    "These ids are not members of this organization who can receive notifications: " + refused + ".");
        }
    }

    private void requireWithinLimit(int count) {
        int max = properties.getNotifications().getMaxRecipients();
        if (count > max) {
            throw new IllegalArgumentException("A notification can have at most " + max + " recipients; this one would have " + count + ".");
        }
    }

    private static LinkedHashSet<String> distinct(List<String> ids) {
        LinkedHashSet<String> distinct = new LinkedHashSet<>();
        if (ids != null) {
            for (String id : ids) {
                if (id != null && !id.isBlank()) {
                    distinct.add(id.trim());
                }
            }
        }
        return distinct;
    }

    private static Set<String> recipientIds(Notification n) {
        return n.getUsers() == null ? Set.of()
                : n.getUsers().stream().map(NotificationRecipient::getUserId).collect(Collectors.toSet());
    }

    /**
     * The new recipient list, computed by MongoDB from the stored one: the kept recipients as they are
     * (with any read state written meanwhile), then the added ones that are not already there.
     */
    private static Document rewrittenRecipients(Collection<String> remove, Collection<String> add) {
        Object kept = remove.isEmpty() ? "$users"
                : new Document("$filter", new Document()
                        .append("input", "$users")
                        .append("cond", new Document("$not", List.of(
                                new Document("$in", List.of("$$this.userId", literal(new ArrayList<>(remove))))))));
        List<Document> fresh = add.stream()
                .map(userId -> new Document("userId", userId).append("readStatus", false).append("readAt", null))
                .toList();
        Document added = new Document("$filter", new Document()
                .append("input", literal(fresh))
                .append("cond", new Document("$not", List.of(new Document("$in", List.of("$$this.userId", "$users.userId"))))));
        return new Document("$concatArrays", List.of(kept, added));
    }

    /** A value an update pipeline must not read as an expression (a subject may start with "$"). */
    private static Document literal(Object value) {
        return new Document("$literal", value);
    }

    private Map<String, Long> receiptCounts(List<String> notificationIds) {
        if (notificationIds.isEmpty()) {
            return Map.of();
        }
        Aggregation counts = Aggregation.newAggregation(
                Aggregation.match(Criteria.where("notificationId").in(notificationIds)),
                Aggregation.group("notificationId").count().as("count"));
        Map<String, Long> result = new HashMap<>();
        for (Document row : mongo.aggregate(counts, NotificationReceipt.class, Document.class).getMappedResults()) {
            result.put(row.getString("_id"), ((Number) row.get("count")).longValue());
        }
        return result;
    }

    private NotificationResponse detail(Notification n) {
        if (n.getAudience() == NotificationAudience.TENANT) {
            long read = receiptRepository.countByNotificationId(n.getId());
            Query eligible = new Query(Criteria.where("tenantId").is(n.getTenantId()).and("status").in(ELIGIBLE)
                    .orOperator(Criteria.where("createdAt").lte(n.getCreatedAt()), Criteria.where("createdAt").is(null)));
            return NotificationResponse.of(n, List.of(), null, read, mongo.count(eligible, user.class));
        }
        List<NotificationRecipient> recipients = n.getUsers() == null ? List.of() : n.getUsers();
        Map<String, user> people = new HashMap<>();
        userRepository.findAllById(recipients.stream().map(NotificationRecipient::getUserId).toList())
                .forEach(person -> people.put(person.getId(), person));
        List<RecipientResponse> users = recipients.stream().map(r -> {
            user person = people.get(r.getUserId());
            return new RecipientResponse(r.getUserId(), Boolean.TRUE.equals(r.getReadStatus()), r.getReadAt(),
                    person != null ? person.getName() : null, person != null ? person.getEmail() : null);
        }).toList();
        long read = users.stream().filter(RecipientResponse::readStatus).count();
        return NotificationResponse.of(n, users, users.size(), read, null);
    }
}
