package com.NormaOne.backend.services;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.notification.Notification;
import com.NormaOne.backend.model.notification.NotificationRecipient;
import com.NormaOne.backend.model.notification.enums.NotificationAudience;

/**
 * The email copy of an in-app notification, one per recipient, honouring each recipient's own
 * preference (EmailPreferenceService). The in-app notification is already saved and delivered before
 * this runs, and nothing here can change it.
 *
 * COMING SOON: while email delivery is not configured (EmailSender.configured() is false) nothing is
 * queued at all — so turning delivery on later does not suddenly send every past notification. Once it
 * is configured, each recipient with email on gets their own email through the outbox (retried, never
 * duplicated); a recipient who turned email off gets none.
 */
@Service
public class NotificationEmailService {

    private static final Logger log = LoggerFactory.getLogger(NotificationEmailService.class);
    static final String REFERENCE_TYPE = "NOTIFICATION";
    private static final Set<UserStatus> REACHABLE = EnumSet.of(UserStatus.INVITED, UserStatus.ACTIVE);

    private final EmailSender emailSender;
    private final EmailOutboxService outbox;
    private final MongoTemplate mongoTemplate;

    public NotificationEmailService(EmailSender emailSender, EmailOutboxService outbox, MongoTemplate mongoTemplate) {
        this.emailSender = emailSender;
        this.outbox = outbox;
        this.mongoTemplate = mongoTemplate;
    }

    /** Queues the email copies of a newly created notification; returns how many were queued. */
    public int queueFor(Notification notification, String organizationName) {
        if (!emailSender.configured()) {
            return 0;
        }
        try {
            List<user> recipients = EmailPreferenceService.recipients(candidates(notification));
            String subject = "[NormaOne] " + notification.getSubject();
            String body = notification.getBody() + "\n\n—\nSent to you by " + (organizationName != null ? organizationName : "your organization")
                    + " on NormaOne. You can turn these emails off in your settings; the notification stays in your NormaOne inbox."
                    + (notification.getAttachment() != null ? "\nIt has an attachment: open it in NormaOne." : "");
            for (user recipient : recipients) {
                outbox.enqueue(List.of(recipient.getEmail()), subject, body, REFERENCE_TYPE, notification.getId(), notification.getTenantId());
            }
            return recipients.size();
        } catch (RuntimeException ex) {
            // The in-app notification is saved; an email problem must not undo or fail it.
            log.error("Email copies of notification {} were not queued: {}", notification.getId(), ex.getMessage());
            return 0;
        }
    }

    /** SELECTED: the listed recipients still reachable; TENANT: every INVITED or ACTIVE member now. */
    private List<user> candidates(Notification n) {
        Criteria scope = Criteria.where("tenantId").is(n.getTenantId()).and("status").in(REACHABLE);
        if (n.getAudience() == NotificationAudience.SELECTED) {
            List<String> ids = n.getUsers() == null ? List.of() : n.getUsers().stream().map(NotificationRecipient::getUserId).toList();
            scope = scope.and("id").in(ids);
        }
        return mongoTemplate.find(new Query(scope), user.class);
    }
}
