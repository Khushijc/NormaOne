package com.NormaOne.backend.bootstrap;

import java.util.ArrayList;
import java.util.List;

import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.data.domain.Sort.Direction;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.index.PartialIndexFilter;
import org.springframework.stereotype.Component;

/**
 * Creates the indexes the authentication, tenant and package rules rely on.
 *
 * Spring Data's automatic index creation is off by default, so the {@code @Indexed} and
 * {@code @CompoundIndex} annotations on the models are not applied by themselves; this runner is
 * the source of truth (same names and definitions as the annotations).
 *
 * Before a unique index is created, existing documents are checked for duplicates. If any are
 * found the index is skipped and the conflicting values are logged for manual clean-up, rather
 * than failing startup. Partial filters keep legacy documents without the indexed field (e.g. a
 * user without a Cognito identity) out of the uniqueness rule.
 */
@Component
@Order(10)
public class MongoIndexInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(MongoIndexInitializer.class);

    private final MongoTemplate mongoTemplate;

    public MongoIndexInitializer(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        // users
        unique("users", "user_cognito_sub_uniq", new Document("cognitoSub", new Document("$type", "string")), "cognitoSub");
        unique("users", "tenant_user_email_uniq", null, "tenantId", "email");
        plain("users", new Index().on("tenantId", Direction.ASC).on("status", Direction.ASC).named("tenant_user_status_idx"));
        plain("users", new Index().on("email", Direction.ASC).on("status", Direction.ASC).named("user_email_status_idx"));

        // tenants
        unique("tenants", "subdomain", null, "subdomain");
        plain("tenants", new Index().on("onboardedByCognitoSub", Direction.ASC).sparse().named("tenant_onboarded_by_idx"));

        // plan_definitions
        unique("plan_definitions", "plan_code_version_uniq", null, "planCode", "planVersion");
        unique("plan_definitions", "plan_default_uniq", new Document("defaultPlan", true), "defaultPlan");
        plain("plan_definitions", new Index().on("status", Direction.ASC).on("effectiveFrom", Direction.DESC)
                .on("effectiveUntil", Direction.ASC).named("plan_status_effective_idx"));

        // tenant_subscriptions
        unique("tenant_subscriptions", "tenant_current_subscription_uniq", new Document("current", true), "tenantId");
        plain("tenant_subscriptions", new Index().on("tenantId", Direction.ASC).on("status", Direction.ASC).named("tenant_subscription_status_idx"));
        plain("tenant_subscriptions", new Index().on("planDocsId", Direction.ASC).named("planDocsId"));

        // subscription_history
        plain("subscription_history", new Index().on("tenantSubscriptionDocId", Direction.ASC).on("eventDate", Direction.DESC)
                .named("subscription_history_timeline_idx"));
        plain("subscription_history", new Index().on("tenantId", Direction.ASC).on("eventDate", Direction.DESC)
                .named("tenant_history_timeline_idx"));

        // plan_history: the platform timeline, and its tenant, event type, actor and plan filters
        plain("plan_history", new Index().on("occurredAt", Direction.DESC).named("plan_history_time_idx"));
        plain("plan_history", new Index().on("tenantId", Direction.ASC).on("occurredAt", Direction.DESC).named("plan_history_tenant_time_idx"));
        plain("plan_history", new Index().on("eventType", Direction.ASC).on("occurredAt", Direction.DESC).named("plan_history_type_time_idx"));
        plain("plan_history", new Index().on("actorUserId", Direction.ASC).on("occurredAt", Direction.DESC).named("plan_history_actor_time_idx"));
        plain("plan_history", new Index().on("planId", Direction.ASC).on("occurredAt", Direction.DESC).named("plan_history_plan_time_idx"));

        // plan_change_requests: at most one open request per organization; the lists
        unique("plan_change_requests", "plan_change_open_uniq", new Document("open", true), "tenantId");
        plain("plan_change_requests", new Index().on("tenantId", Direction.ASC).on("requestedAt", Direction.DESC)
                .named("plan_change_tenant_time_idx"));
        plain("plan_change_requests", new Index().on("status", Direction.ASC).on("requestedAt", Direction.DESC)
                .named("plan_change_status_time_idx"));

        // email_outbox: due retries; the latest email about a record
        plain("email_outbox", new Index().on("status", Direction.ASC).on("nextAttemptAt", Direction.ASC).named("email_outbox_due_idx"));
        plain("email_outbox", new Index().on("referenceType", Direction.ASC).on("referenceId", Direction.ASC)
                .on("createdAt", Direction.DESC).named("email_outbox_reference_idx"));

        // audit_events
        plain("audit_events", new Index().on("tenantId", Direction.ASC).on("occurredAt", Direction.DESC).named("audit_tenant_time_idx"));
        plain("audit_events", new Index().on("occurredAt", Direction.DESC).named("audit_time_idx"));
        plain("audit_events", new Index().on("actorUserId", Direction.ASC).on("occurredAt", Direction.DESC).named("audit_actor_time_idx"));
        plain("audit_events", new Index().on("targetType", Direction.ASC).on("targetId", Direction.ASC)
                .on("occurredAt", Direction.DESC).named("audit_target_time_idx"));

        // notifications: the inbox's TENANT branch and the admin lists; its SELECTED branch; "created by"
        plain("notifications", new Index().on("tenantId", Direction.ASC).on("recordState", Direction.ASC)
                .on("audience", Direction.ASC).on("createdAt", Direction.DESC).named("notification_tenant_audience_time_idx"));
        plain("notifications", new Index().on("tenantId", Direction.ASC).on("users.userId", Direction.ASC)
                .on("recordState", Direction.ASC).on("createdAt", Direction.DESC).named("notification_recipient_time_idx"));
        plain("notifications", new Index().on("tenantId", Direction.ASC).on("createdByDocsId", Direction.ASC)
                .on("createdAt", Direction.DESC).named("notification_creator_time_idx"));

        // notification_receipts: one read mark per member and broadcast; a member's marks for the inbox
        unique("notification_receipts", "notification_receipt_uniq", null, "notificationId", "userId");
        plain("notification_receipts", new Index().on("tenantId", Direction.ASC).on("userId", Direction.ASC)
                .named("notification_receipt_user_idx"));
    }

    private void unique(String collection, String name, Document partialFilter, String... fields) {
        List<Document> duplicates = duplicates(collection, partialFilter, fields);
        if (!duplicates.isEmpty()) {
            log.error("Unique index {}.{} NOT created: {} duplicate value group(s) exist, e.g. {}. "
                    + "Resolve the duplicates and restart.", collection, name, duplicates.size(), duplicates.get(0).get("_id"));
            return;
        }
        Index index = new Index().named(name).unique();
        for (String field : fields) {
            index.on(field, Direction.ASC);
        }
        if (partialFilter != null) {
            index.partial(PartialIndexFilter.of(partialFilter));
        }
        plain(collection, index);
    }

    private void plain(String collection, Index index) {
        try {
            mongoTemplate.indexOps(collection).createIndex(index);
        } catch (RuntimeException ex) {
            // e.g. an index with the same name but different options already exists.
            log.warn("Index {} on {} not created: {}", index.getIndexOptions().get("name"), collection, ex.getMessage());
        }
    }

    /** Groups of documents (matching the partial filter, if any) that share the indexed values. */
    private List<Document> duplicates(String collection, Document partialFilter, String... fields) {
        Document groupId = new Document();
        for (String field : fields) {
            groupId.append(field.replace('.', '_'), "$" + field);
        }
        List<Document> pipeline = new ArrayList<>();
        if (partialFilter != null) {
            pipeline.add(new Document("$match", partialFilter));
        }
        pipeline.add(new Document("$group", new Document("_id", groupId).append("count", new Document("$sum", 1))));
        pipeline.add(new Document("$match", new Document("count", new Document("$gt", 1))));
        pipeline.add(new Document("$limit", 5));
        List<Document> result = new ArrayList<>();
        mongoTemplate.getCollection(collection).aggregate(pipeline).into(result);
        return result;
    }
}
